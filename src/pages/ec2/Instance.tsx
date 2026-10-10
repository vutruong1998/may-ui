import { useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  CreateTagsCommand, DeleteTagsCommand, DescribeInstanceAttributeCommand, GetConsoleOutputCommand, RebootInstancesCommand,
  StartInstancesCommand, StopInstancesCommand, TerminateInstancesCommand,
} from '@aws-sdk/client-ec2'
import { Play, RotateCw, Square, Terminal, Trash2 } from 'lucide-react'
import { useSettings } from '@/lib/settings'
import { useAction } from '@/lib/hooks'
import { formatDate } from '@/lib/format'
import { fromBase64, nameTag, stateTone, useInstanceEndpoints, useInstances } from '@/lib/ec2'
import { TagsEditor } from '@/components/TagsEditor'
import {
  Badge, Button, CodeBlock, Confirm, Empty, ErrorBox, KeyValue, Mono, NameCell, PageHeader, Panel, RefreshButton, Spinner, Tabs,
} from '@/components/common'

type Tab = 'details' | 'connect' | 'console' | 'tags'

export default function Instance() {
  const { id = '' } = useParams()
  const { clients } = useSettings()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) ?? 'details'
  const instances = useInstances()
  const inst = instances.data?.find((i) => i.InstanceId === id)
  const [confirmTerminate, setConfirmTerminate] = useState(false)
  const InstanceIds = [id]
  const start = useAction(() => clients.ec2.send(new StartInstancesCommand({ InstanceIds })), { invalidate: [['ec2']], success: 'Starting' })
  const stop = useAction(() => clients.ec2.send(new StopInstancesCommand({ InstanceIds })), { invalidate: [['ec2']], success: 'Stopping' })
  const reboot = useAction(() => clients.ec2.send(new RebootInstancesCommand({ InstanceIds })), { invalidate: [['ec2']], success: 'Rebooting' })
  const terminate = useAction(() => clients.ec2.send(new TerminateInstancesCommand({ InstanceIds })), {
    invalidate: [['ec2'], ['count']], success: 'Terminating', onSuccess: () => setConfirmTerminate(false),
  })
  const state = inst?.State?.Name
  const title = (inst && nameTag(inst.Tags)) || id

  return (
    <>
      <PageHeader
        title={title}
        crumbs={[{ label: 'EC2 instances', to: '/ec2/instances' }, { label: title }]}
        description={inst && <span className="inline-flex items-center gap-2"><Badge tone={stateTone(state)}>{state}</Badge>{inst.InstanceType} · {id}</span>}
        actions={inst && <>
          <RefreshButton onClick={() => instances.refetch()} spinning={instances.isFetching} />
          {state === 'stopped'
            ? <Button icon={<Play />} loading={start.isPending} onClick={() => start.mutate(undefined)}>Start</Button>
            : <Button icon={<Square />} disabled={state !== 'running' && state !== 'pending'} loading={stop.isPending} onClick={() => stop.mutate(undefined)}>Stop</Button>}
          <Button icon={<RotateCw />} disabled={state !== 'running'} loading={reboot.isPending} onClick={() => reboot.mutate(undefined)}>Reboot</Button>
          <Button variant="danger" icon={<Trash2 />} disabled={state === 'terminated' || state === 'shutting-down'} onClick={() => setConfirmTerminate(true)}>Terminate</Button>
        </>}
      />
      {instances.isLoading ? <Spinner /> : !inst ? <ErrorBox error={new Error(`Instance ${id} does not exist.`)} /> : (
        <>
          <Tabs value={tab} onChange={(t) => setParams(t === 'details' ? {} : { tab: t })} tabs={[
            { id: 'details', label: 'Details' }, { id: 'connect', label: 'Connect' },
            { id: 'console', label: 'Console output' }, { id: 'tags', label: 'Tags' },
          ]} />
          {tab === 'details' ? <Details id={id} /> : tab === 'connect' ? <Connect id={id} /> : tab === 'console' ? <Console id={id} /> : <Tags id={id} />}
        </>
      )}
      {confirmTerminate && (
        <Confirm title={`Terminate ${title}?`} confirmLabel="Terminate" loading={terminate.isPending}
          onConfirm={() => terminate.mutate(undefined)} onClose={() => setConfirmTerminate(false)}>
          <p>The instance and its root volume are deleted. This cannot be undone.</p>
        </Confirm>
      )}
    </>
  )
}

function Details({ id }: { id: string }) {
  const { clients } = useSettings()
  const instances = useInstances()
  const inst = instances.data!.find((i) => i.InstanceId === id)!
  const userData = useQuery({
    queryKey: ['ec2', 'user-data', id],
    queryFn: async () => (await clients.ec2.send(new DescribeInstanceAttributeCommand({ InstanceId: id, Attribute: 'userData' }))).UserData?.Value ?? '',
  })
  return (
    <div className="flex flex-col gap-6">
      <Panel title="Instance">
        <KeyValue items={[
          ['Instance ID', <Mono copy>{inst.InstanceId}</Mono>],
          ['State', <Badge tone={stateTone(inst.State?.Name)}>{inst.State?.Name}</Badge>],
          ['State reason', inst.StateReason?.Message ?? inst.StateTransitionReason],
          ['Instance type', inst.InstanceType],
          ['AMI', <Mono copy>{inst.ImageId}</Mono>],
          ['Architecture', inst.Architecture],
          ['Key pair', inst.KeyName],
          ['IAM instance profile', inst.IamInstanceProfile?.Arn],
          ['Launched', formatDate(inst.LaunchTime)],
          ['Metadata (IMDS) tokens', inst.MetadataOptions?.HttpTokens],
        ]} />
      </Panel>
      <Panel title="Networking">
        <KeyValue items={[
          ['VPC', <Mono copy>{inst.VpcId}</Mono>],
          ['Subnet', <Mono copy>{inst.SubnetId}</Mono>],
          ['Availability zone', inst.Placement?.AvailabilityZone],
          ['Private IP', <Mono copy>{inst.PrivateIpAddress}</Mono>],
          ['Private DNS', <Mono copy>{inst.PrivateDnsName}</Mono>],
          ['Public IP', <Mono copy>{inst.PublicIpAddress}</Mono>],
          ['Network interface', <Mono>{inst.NetworkInterfaces?.[0]?.NetworkInterfaceId}</Mono>],
          ['Security groups', (
            <span className="flex flex-wrap gap-2">
              {(inst.SecurityGroups ?? []).map((g) => <NameCell key={g.GroupId} to={`/ec2/security-groups?open=${g.GroupId}`}>{g.GroupName}</NameCell>)}
            </span>
          )],
        ]} />
      </Panel>
      <Panel title="Storage">
        <KeyValue items={(inst.BlockDeviceMappings ?? []).map((b) => [b.DeviceName, <Mono copy>{b.Ebs?.VolumeId}</Mono>])} />
      </Panel>
      <Panel title="User data">
        {userData.isLoading ? <Spinner /> : userData.data ? <CodeBlock>{fromBase64(userData.data)}</CodeBlock>
          : <span className="text-sm text-muted-foreground">None</span>}
      </Panel>
    </div>
  )
}

function Connect({ id }: { id: string }) {
  const endpoints = useInstanceEndpoints()
  const e = endpoints.data?.find((x) => x.instanceId === id)
  if (endpoints.isLoading) return <Spinner />
  if (!e) {
    return (
      <Empty title="Not running as a container" icon={<Terminal />}>
        may is in API-only mode, or this instance isn't running. Start may with <code>-docker</code> to run instances as containers you can SSH into.
      </Empty>
    )
  }
  const ports = Object.entries(e.ports).filter(([p]) => p !== '22')
  return (
    <div className="flex flex-col gap-6">
      {e.ssh && (
        <Panel title="SSH" description={`sshd is installed for ${e.defaultUser} during the first boot; give it a minute after launch.`}>
          <CodeBlock>{e.ssh.replace('<key file>', '~/.ssh/<key-pair-name>.pem')}</CodeBlock>
        </Panel>
      )}
      <Panel title="Shell without SSH">
        <CodeBlock>{e.exec}</CodeBlock>
      </Panel>
      <Panel title="Published ports" description="TCP ports opened by the instance's security groups, reachable on localhost.">
        {ports.length === 0 ? <span className="text-sm text-muted-foreground">None. Open a TCP port in a security group before launch to publish it.</span> : (
          <KeyValue items={ports.map(([p, hp]) => [`Port ${p}`, <a className="font-mono text-primary hover:underline" href={`http://localhost:${hp}`} target="_blank" rel="noreferrer">localhost:{hp}</a>])} />
        )}
      </Panel>
      <Panel title="Container">
        <KeyValue items={[['Name', <Mono copy>{e.container}</Mono>], ['Image', e.image], ['Default user', e.defaultUser]]} />
      </Panel>
    </div>
  )
}

function Console({ id }: { id: string }) {
  const { clients } = useSettings()
  const out = useQuery({
    queryKey: ['ec2', 'console', id],
    queryFn: async () => (await clients.ec2.send(new GetConsoleOutputCommand({ InstanceId: id }))).Output ?? '',
    refetchInterval: 3000,
  })
  return (
    <Panel title="Console output" description="Refreshes every 3 seconds.">
      {out.isLoading ? <Spinner /> : out.isError ? <ErrorBox error={out.error} /> : <CodeBlock>{fromBase64(out.data || '') || '(empty)'}</CodeBlock>}
    </Panel>
  )
}

function Tags({ id }: { id: string }) {
  const { clients } = useSettings()
  const instances = useInstances()
  const tags = instances.data?.find((i) => i.InstanceId === id)?.Tags ?? []
  const save = useAction(
    async (next: { Key: string; Value: string }[]) => {
      const removed = tags.filter((t) => !next.some((n) => n.Key === t.Key)).map((t) => ({ Key: t.Key }))
      if (removed.length) await clients.ec2.send(new DeleteTagsCommand({ Resources: [id], Tags: removed }))
      if (next.length) await clients.ec2.send(new CreateTagsCommand({ Resources: [id], Tags: next }))
    },
    { invalidate: [['ec2']], success: 'Tags saved' },
  )
  return <Panel title="Tags"><TagsEditor tags={tags} saving={save.isPending} onSave={(t) => save.mutate(t)} /></Panel>
}
