import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  AuthorizeSecurityGroupEgressCommand, AuthorizeSecurityGroupIngressCommand, CreateSecurityGroupCommand,
  DeleteSecurityGroupCommand, DescribeSecurityGroupRulesCommand, RevokeSecurityGroupEgressCommand,
  RevokeSecurityGroupIngressCommand, type SecurityGroupRule,
} from '@aws-sdk/client-ec2'
import { Plus, Shield, Trash2 } from 'lucide-react'
import { useSettings } from '@/lib/settings'
import { useAction } from '@/lib/hooks'
import { useSecurityGroups, useVpcs } from '@/lib/ec2'
import {
  Badge, Button, Confirm, Drawer, Empty, ErrorBox, Field, IconButton, Input, KeyValue, Modal, Mono, NameCell, Option, PageHeader,
  Panel, RefreshButton, Select, Spinner, Table,
} from '@/components/common'

export default function SecurityGroups() {
  const { clients } = useSettings()
  const groups = useSecurityGroups()
  const [params, setParams] = useSearchParams()
  const open = params.get('open')
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const del = useAction((GroupId: string) => clients.ec2.send(new DeleteSecurityGroupCommand({ GroupId })), {
    invalidate: [['ec2']], success: 'Security group deleted', onSuccess: () => setDeleting(null),
  })
  return (
    <>
      <PageHeader
        title="Security groups"
        description="Stored like AWS, not enforced. In EC2 real mode, TCP ports they open are published on localhost."
        actions={<>
          <RefreshButton onClick={() => groups.refetch()} spinning={groups.isFetching} />
          <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>Create security group</Button>
        </>}
      />
      <Panel flush>
        <Table
          rows={groups.data}
          loading={groups.isLoading}
          error={groups.error}
          rowKey={(g) => g.GroupId!}
          filterPlaceholder="Find security groups"
          empty={<Empty title="No security groups" icon={<Shield />} />}
          columns={[
            { header: 'Name', text: (g) => `${g.GroupName} ${g.GroupId} ${g.VpcId}`, render: (g) => (
              <NameCell icon={<Shield />} onClick={() => setParams({ open: g.GroupId! })}>{g.GroupName}</NameCell>
            ) },
            { header: 'Group ID', className: 'font-mono text-xs', render: (g) => g.GroupId },
            { header: 'VPC', className: 'font-mono text-xs', render: (g) => g.VpcId },
            { header: 'Description', render: (g) => g.Description },
            { header: 'Inbound', className: 'w-24 tabular-nums', render: (g) => (g.IpPermissions ?? []).reduce((n, p) => n + (p.IpRanges?.length ?? 0) + (p.UserIdGroupPairs?.length ?? 0) + (p.Ipv6Ranges?.length ?? 0), 0) },
            { header: '', className: 'w-14 text-right', render: (g) => g.GroupName !== 'default' && (
              <IconButton label={`Delete ${g.GroupName}`} onClick={() => setDeleting(g.GroupId!)}><Trash2 /></IconButton>
            ) },
          ]}
        />
      </Panel>
      {creating && <CreateGroup onClose={() => setCreating(false)} />}
      {open && <GroupDrawer id={open} onClose={() => setParams({})} />}
      {deleting && (
        <Confirm title={`Delete ${deleting}?`} loading={del.isPending} onConfirm={() => del.mutate(deleting)} onClose={() => setDeleting(null)}>
          <p>Groups used by instances or referenced by other groups cannot be deleted.</p>
        </Confirm>
      )}
    </>
  )
}

function CreateGroup({ onClose }: { onClose: () => void }) {
  const { clients } = useSettings()
  const vpcs = useVpcs()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [vpc, setVpc] = useState('')
  const vpcId = vpc || vpcs.data?.find((v) => v.IsDefault)?.VpcId || ''
  const create = useAction(
    () => clients.ec2.send(new CreateSecurityGroupCommand({ GroupName: name, Description: description || name, VpcId: vpcId })),
    { invalidate: [['ec2']], success: `Created ${name}`, onSuccess: onClose },
  )
  return (
    <Modal title="Create security group" onClose={onClose} footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button variant="primary" disabled={!name || !vpcId} loading={create.isPending} onClick={() => create.mutate(undefined)}>Create</Button>
    </>}>
      <div className="flex flex-col gap-5">
        <Field label="Name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="web" /></Field>
        <Field label="Description"><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Web servers" /></Field>
        <Field label="VPC">
          <Select className="w-full" value={vpcId} onChange={(e) => setVpc(e.target.value)}>
            {(vpcs.data ?? []).map((v) => <Option key={v.VpcId} value={v.VpcId}>{v.VpcId} · {v.CidrBlock}{v.IsDefault ? ' (default)' : ''}</Option>)}
          </Select>
        </Field>
      </div>
    </Modal>
  )
}

function ruleTarget(r: SecurityGroupRule) {
  return r.CidrIpv4 ?? r.CidrIpv6 ?? r.ReferencedGroupInfo?.GroupId ?? r.PrefixListId ?? '—'
}

function portText(r: SecurityGroupRule) {
  if (r.IpProtocol === '-1') return 'All'
  if (r.FromPort === r.ToPort) return String(r.FromPort)
  return `${r.FromPort}–${r.ToPort}`
}

function GroupDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { clients } = useSettings()
  const groups = useSecurityGroups()
  const g = groups.data?.find((x) => x.GroupId === id)
  const rules = useQuery({
    queryKey: ['ec2', 'rules', id],
    queryFn: async () => (await clients.ec2.send(new DescribeSecurityGroupRulesCommand({ Filters: [{ Name: 'group-id', Values: [id] }] }))).SecurityGroupRules ?? [],
  })
  const [adding, setAdding] = useState<{ egress: boolean; protocol: string; from: string; to: string; cidr: string; description: string } | null>(null)
  const add = useAction(
    () => {
      const p = adding!
      const perm = {
        IpProtocol: p.protocol, FromPort: p.protocol === '-1' ? undefined : Number(p.from),
        ToPort: p.protocol === '-1' ? undefined : Number(p.to || p.from),
        IpRanges: [{ CidrIp: p.cidr, Description: p.description || undefined }],
      }
      return p.egress
        ? clients.ec2.send(new AuthorizeSecurityGroupEgressCommand({ GroupId: id, IpPermissions: [perm] }))
        : clients.ec2.send(new AuthorizeSecurityGroupIngressCommand({ GroupId: id, IpPermissions: [perm] }))
    },
    { invalidate: [['ec2']], success: 'Rule added', onSuccess: () => setAdding(null) },
  )
  const revoke = useAction(
    (r: SecurityGroupRule) => r.IsEgress
      ? clients.ec2.send(new RevokeSecurityGroupEgressCommand({ GroupId: id, SecurityGroupRuleIds: [r.SecurityGroupRuleId!] }))
      : clients.ec2.send(new RevokeSecurityGroupIngressCommand({ GroupId: id, SecurityGroupRuleIds: [r.SecurityGroupRuleId!] })),
    { invalidate: [['ec2']], success: 'Rule removed' },
  )
  const table = (egress: boolean) => (
    <Table
      rows={rules.data?.filter((r) => !!r.IsEgress === egress)}
      rowKey={(r) => r.SecurityGroupRuleId!}
      empty={<Empty title={egress ? 'No outbound rules' : 'No inbound rules'} />}
      columns={[
        { header: 'Protocol', render: (r) => (r.IpProtocol === '-1' ? 'All' : r.IpProtocol?.toUpperCase()) },
        { header: 'Ports', render: portText },
        { header: egress ? 'Destination' : 'Source', className: 'font-mono text-xs', render: ruleTarget },
        { header: 'Description', render: (r) => r.Description ?? '' },
        { header: '', className: 'w-12 text-right', render: (r) => <IconButton label="Remove rule" onClick={() => revoke.mutate(r)}><Trash2 /></IconButton> },
      ]}
    />
  )
  return (
    <Drawer title={g?.GroupName ?? id} description={g?.Description} onClose={onClose}>
      {!g ? <Spinner /> : (
        <div className="flex flex-col gap-6">
          <KeyValue items={[['Group ID', <Mono copy>{g.GroupId}</Mono>], ['VPC', <Mono>{g.VpcId}</Mono>]]} />
          {rules.isError && <ErrorBox error={rules.error} />}
          <Panel flush title={<span className="flex items-center gap-2">Inbound <Badge>{rules.data?.filter((r) => !r.IsEgress).length ?? 0}</Badge></span>}
            actions={<Button icon={<Plus />} onClick={() => setAdding({ egress: false, protocol: 'tcp', from: '22', to: '', cidr: '0.0.0.0/0', description: '' })}>Add</Button>}>
            {table(false)}
          </Panel>
          <Panel flush title="Outbound"
            actions={<Button icon={<Plus />} onClick={() => setAdding({ egress: true, protocol: '-1', from: '', to: '', cidr: '0.0.0.0/0', description: '' })}>Add</Button>}>
            {table(true)}
          </Panel>
        </div>
      )}
      {adding && (
        <Modal title={`Add ${adding.egress ? 'outbound' : 'inbound'} rule`} onClose={() => setAdding(null)} footer={<>
          <Button variant="secondary" onClick={() => setAdding(null)}>Cancel</Button>
          <Button variant="primary" disabled={!adding.cidr || (adding.protocol !== '-1' && !adding.from)} loading={add.isPending} onClick={() => add.mutate(undefined)}>Add rule</Button>
        </>}>
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Protocol">
                <Select className="w-full" value={adding.protocol} onChange={(e) => setAdding({ ...adding, protocol: e.target.value })}>
                  <Option value="tcp">TCP</Option>
                  <Option value="udp">UDP</Option>
                  <Option value="icmp">ICMP</Option>
                  <Option value="-1">All traffic</Option>
                </Select>
              </Field>
              <Field label="From port"><Input disabled={adding.protocol === '-1'} value={adding.from} onChange={(e) => setAdding({ ...adding, from: e.target.value })} /></Field>
              <Field label="To port"><Input disabled={adding.protocol === '-1'} value={adding.to} placeholder={adding.from} onChange={(e) => setAdding({ ...adding, to: e.target.value })} /></Field>
            </div>
            <Field label={adding.egress ? 'Destination CIDR' : 'Source CIDR'}>
              <Input className="font-mono" value={adding.cidr} onChange={(e) => setAdding({ ...adding, cidr: e.target.value })} />
            </Field>
            <Field label="Description"><Input value={adding.description} onChange={(e) => setAdding({ ...adding, description: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </Drawer>
  )
}
