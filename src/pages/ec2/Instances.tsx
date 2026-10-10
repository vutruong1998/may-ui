import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  RebootInstancesCommand, RunInstancesCommand, StartInstancesCommand, StopInstancesCommand, TerminateInstancesCommand,
  type _InstanceType,
} from '@aws-sdk/client-ec2'
import { Play, Plus, RotateCw, Server, Square, Trash2 } from 'lucide-react'
import { useSettings } from '@/lib/settings'
import { useAction } from '@/lib/hooks'
import { formatDate } from '@/lib/format'
import {
  nameTag, stateTone, toBase64, useImages, useInstanceEndpoints, useInstances, useKeyPairs, useSecurityGroups, useSubnets,
} from '@/lib/ec2'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Badge, Button, Confirm, Empty, Field, Input, Modal, NameCell, Option, PageHeader, Panel, RefreshButton, Select, Table, Textarea,
} from '@/components/common'

const instanceTypes: Record<string, string[]> = {
  x86_64: ['t2.micro', 't3.nano', 't3.micro', 't3.small', 't3.medium', 't3.large', 'm7i.large', 'c7i.large'],
  arm64: ['t4g.nano', 't4g.micro', 't4g.small', 't4g.medium', 't4g.large', 'm7g.large', 'c7g.large', 'r7g.large'],
}
const defaultType: Record<string, string> = { x86_64: 't3.micro', arm64: 't4g.micro' }

export default function Instances() {
  const { clients } = useSettings()
  const instances = useInstances()
  const endpoints = useInstanceEndpoints()
  const realMode = (endpoints.data?.length ?? 0) > 0
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [launching, setLaunching] = useState(false)
  const [confirmTerminate, setConfirmTerminate] = useState(false)
  const ids = [...selected]

  const useBulk = (label: string, fn: (InstanceIds: string[]) => Promise<unknown>) =>
    useAction(() => fn(ids), { invalidate: [['ec2'], ['count']], success: `${label} ${ids.length} instance${ids.length === 1 ? '' : 's'}` })
  const start = useBulk('Starting', (InstanceIds) => clients.ec2.send(new StartInstancesCommand({ InstanceIds })))
  const stop = useBulk('Stopping', (InstanceIds) => clients.ec2.send(new StopInstancesCommand({ InstanceIds })))
  const reboot = useBulk('Rebooting', (InstanceIds) => clients.ec2.send(new RebootInstancesCommand({ InstanceIds })))
  const terminate = useAction(() => clients.ec2.send(new TerminateInstancesCommand({ InstanceIds: ids })), {
    invalidate: [['ec2'], ['count']], success: `Terminating ${ids.length} instance${ids.length === 1 ? '' : 's'}`,
    onSuccess: () => { setConfirmTerminate(false); setSelected(new Set()) },
  })

  return (
    <>
      <PageHeader
        title="EC2 instances"
        description={realMode
          ? 'Real mode: each instance runs as a Docker container you can SSH into.'
          : 'API-only mode: instances change state realistically but nothing runs. Start may with -docker to run them as containers.'}
        actions={<>
          <RefreshButton onClick={() => instances.refetch()} spinning={instances.isFetching} />
          <Button variant="primary" icon={<Plus />} onClick={() => setLaunching(true)}>Launch instances</Button>
        </>}
      />
      <Panel flush>
        <Table
          rows={instances.data}
          loading={instances.isLoading}
          error={instances.error}
          onRetry={() => instances.refetch()}
          rowKey={(i) => i.InstanceId!}
          selectable
          selected={selected}
          onSelect={setSelected}
          filterPlaceholder="Find instances by name, ID or IP"
          toolbar={<>
            <Button icon={<Play />} disabled={!ids.length} loading={start.isPending} onClick={() => start.mutate(undefined)}>Start</Button>
            <Button icon={<Square />} disabled={!ids.length} loading={stop.isPending} onClick={() => stop.mutate(undefined)}>Stop</Button>
            <Button icon={<RotateCw />} disabled={!ids.length} loading={reboot.isPending} onClick={() => reboot.mutate(undefined)}>Reboot</Button>
            <Button variant="danger" icon={<Trash2 />} disabled={!ids.length} onClick={() => setConfirmTerminate(true)}>Terminate</Button>
          </>}
          empty={<Empty title="No instances" icon={<Server />}>Launch an instance to get started.</Empty>}
          columns={[
            { header: 'Name', text: (i) => `${nameTag(i.Tags)} ${i.InstanceId} ${i.PrivateIpAddress ?? ''} ${i.PublicIpAddress ?? ''}`, render: (i) => (
              <NameCell icon={<Server />} to={`/ec2/instances/${i.InstanceId}`}>{nameTag(i.Tags) || i.InstanceId}</NameCell>
            ) },
            { header: 'Instance ID', className: 'font-mono text-xs', render: (i) => i.InstanceId },
            { header: 'State', className: 'w-32', render: (i) => <Badge tone={stateTone(i.State?.Name)}>{i.State?.Name}</Badge> },
            { header: 'Type', className: 'w-28', render: (i) => i.InstanceType },
            { header: 'Zone', className: 'w-28', render: (i) => i.Placement?.AvailabilityZone },
            { header: 'Private IP', className: 'w-32 font-mono text-xs', render: (i) => i.PrivateIpAddress ?? '—' },
            { header: 'Public IP', className: 'w-32 font-mono text-xs', render: (i) => i.PublicIpAddress ?? '—' },
            { header: 'Launched', className: 'w-52', render: (i) => formatDate(i.LaunchTime) },
          ]}
        />
      </Panel>
      {launching && <Launch onClose={() => setLaunching(false)} />}
      {confirmTerminate && (
        <Confirm title={`Terminate ${ids.length} instance${ids.length === 1 ? '' : 's'}?`} confirmLabel="Terminate" loading={terminate.isPending}
          onConfirm={() => terminate.mutate(undefined)} onClose={() => setConfirmTerminate(false)}>
          <p>Root volumes are deleted.{realMode && ' The containers and their data are removed.'} This cannot be undone.</p>
        </Confirm>
      )}
    </>
  )
}

function Launch({ onClose }: { onClose: () => void }) {
  const { clients } = useSettings()
  const navigate = useNavigate()
  const images = useImages()
  const subnets = useSubnets()
  const groups = useSecurityGroups()
  const keys = useKeyPairs()
  const [name, setName] = useState('')
  const [imageId, setImageId] = useState('')
  const [type, setType] = useState('t3.micro')
  const [subnetId, setSubnetId] = useState('')
  const [sgIds, setSgIds] = useState<Set<string>>(new Set())
  const [keyName, setKeyName] = useState('')
  const [count, setCount] = useState('1')
  const [userData, setUserData] = useState('#!/bin/bash\necho "hello from $(hostname)" > /tmp/hello\n')

  // Default to x86 Ubuntu 24.04, the most common choice.
  const image = images.data?.find((i) => i.ImageId === imageId)
    ?? images.data?.find((i) => i.Architecture === 'x86_64' && i.Name?.includes('noble'))
    ?? images.data?.[0]
  const arch = image?.Architecture ?? 'x86_64'
  const typeChoices = instanceTypes[arch] ?? instanceTypes.x86_64
  const subnet = subnets.data?.find((s) => s.SubnetId === subnetId) ?? subnets.data?.find((s) => s.DefaultForAz) ?? subnets.data?.[0]
  const vpcGroups = useMemo(() => (groups.data ?? []).filter((g) => g.VpcId === subnet?.VpcId), [groups.data, subnet])
  const archMismatch = !typeChoices.includes(type)

  const launch = useAction(
    () => clients.ec2.send(new RunInstancesCommand({
      ImageId: image!.ImageId, InstanceType: type as _InstanceType, MinCount: Number(count), MaxCount: Number(count),
      SubnetId: subnet?.SubnetId, SecurityGroupIds: sgIds.size ? [...sgIds] : undefined, KeyName: keyName || undefined,
      UserData: userData.trim() ? toBase64(userData) : undefined,
      TagSpecifications: name ? [{ ResourceType: 'instance', Tags: [{ Key: 'Name', Value: name }] }] : undefined,
    })),
    {
      invalidate: [['ec2'], ['count']],
      success: (r) => `Launched ${r.Instances?.length} instance${r.Instances?.length === 1 ? '' : 's'}`,
      onSuccess: (r) => (r.Instances?.length === 1 ? navigate(`/ec2/instances/${r.Instances[0].InstanceId}`) : onClose()),
    },
  )

  return (
    <Modal wide title="Launch instances" onClose={onClose} footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button variant="primary" disabled={!image || !subnet || !!archMismatch} loading={launch.isPending} onClick={() => launch.mutate(undefined)}>Launch</Button>
    </>}>
      <div className="flex flex-col gap-5">
        <div className="grid gap-5 sm:grid-cols-[1fr_8rem]">
          <Field label="Name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="web-1" /></Field>
          <Field label="Count"><Input type="number" min={1} max={20} value={count} onChange={(e) => setCount(e.target.value)} /></Field>
        </div>
        <div className="grid gap-5 sm:grid-cols-[1fr_12rem]">
          <Field label="Image (AMI)" hint={image && <>{image.Description} · <code>{image.ImageId}</code></>}>
            <Select className="w-full" value={image?.ImageId ?? ''} onChange={(e) => {
              setImageId(e.target.value)
              // Keep the instance type compatible with the image's architecture.
              const next = images.data?.find((i) => i.ImageId === e.target.value)?.Architecture ?? 'x86_64'
              if (!(instanceTypes[next] ?? []).includes(type)) setType(defaultType[next] ?? 't3.micro')
            }}>
              {(images.data ?? []).map((i) => <Option key={i.ImageId} value={i.ImageId}>{i.Name}</Option>)}
            </Select>
          </Field>
          <Field label="Instance type" hint={arch === 'arm64' ? 'Graviton (arm64) types' : 'x86_64 types'}
            error={archMismatch ? `${type} doesn't match the AMI's ${arch} architecture` : null}>
            <Select className="w-full" value={type} onChange={(e) => setType(e.target.value)}>
              {typeChoices.map((t) => <Option key={t} value={t}>{t}</Option>)}
            </Select>
          </Field>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Subnet">
            <Select className="w-full" value={subnet?.SubnetId ?? ''} onChange={(e) => { setSubnetId(e.target.value); setSgIds(new Set()) }}>
              {(subnets.data ?? []).map((s) => (
                <Option key={s.SubnetId} value={s.SubnetId}>{s.SubnetId} · {s.CidrBlock} · {s.AvailabilityZone}{s.DefaultForAz ? ' (default)' : ''}</Option>
              ))}
            </Select>
          </Field>
          <Field label="Key pair" hint={keyName ? 'In real mode, sshd is installed for this key at first boot.' : 'Without a key pair you cannot SSH in.'}>
            <Select className="w-full" value={keyName} onChange={(e) => setKeyName(e.target.value)}>
              <Option value="">None</Option>
              {(keys.data ?? []).map((k) => <Option key={k.KeyName} value={k.KeyName}>{k.KeyName}</Option>)}
            </Select>
          </Field>
        </div>
        <Field label="Security groups" hint="None selected: the VPC's default group. In real mode, TCP ports they open are published on localhost.">
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {vpcGroups.map((g) => (
              <label key={g.GroupId} className="flex items-center gap-2 text-sm">
                <Checkbox checked={sgIds.has(g.GroupId!)} onCheckedChange={() => {
                  const next = new Set(sgIds)
                  if (next.has(g.GroupId!)) next.delete(g.GroupId!)
                  else next.add(g.GroupId!)
                  setSgIds(next)
                }} />
                {g.GroupName} <span className="font-mono text-xs text-muted-foreground">{g.GroupId}</span>
              </label>
            ))}
          </div>
        </Field>
        <Field label="User data" hint="A #! script run at first boot (real mode).">
          <Textarea className="min-h-24 font-mono text-xs" spellCheck={false} value={userData} onChange={(e) => setUserData(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
