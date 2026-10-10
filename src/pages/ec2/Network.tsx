import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  AttachInternetGatewayCommand, CreateInternetGatewayCommand, CreateSubnetCommand, CreateVpcCommand, DeleteSubnetCommand,
  DeleteVpcCommand, DescribeAvailabilityZonesCommand, DescribeInternetGatewaysCommand, DescribeRouteTablesCommand,
} from '@aws-sdk/client-ec2'
import { Network as NetworkIcon, Plus, Trash2 } from 'lucide-react'
import { useSettings } from '@/lib/settings'
import { useAction } from '@/lib/hooks'
import { nameTag, useSubnets, useVpcs } from '@/lib/ec2'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Badge, Button, Confirm, Empty, Field, IconButton, Input, Modal, Option, PageHeader, Panel, RefreshButton, Select, Table, Tabs,
} from '@/components/common'

type Tab = 'vpcs' | 'subnets' | 'gateways' | 'routes'

export default function Network() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) ?? 'vpcs'
  return (
    <>
      <PageHeader title="VPC networking" description="VPCs, subnets, internet gateways and route tables. Each region starts with a default VPC." />
      <Tabs value={tab} onChange={(t) => setParams(t === 'vpcs' ? {} : { tab: t })} tabs={[
        { id: 'vpcs', label: 'VPCs' }, { id: 'subnets', label: 'Subnets' },
        { id: 'gateways', label: 'Internet gateways' }, { id: 'routes', label: 'Route tables' },
      ]} />
      {tab === 'vpcs' ? <Vpcs /> : tab === 'subnets' ? <Subnets /> : tab === 'gateways' ? <Gateways /> : <Routes />}
    </>
  )
}

function Vpcs() {
  const { clients } = useSettings()
  const vpcs = useVpcs()
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const del = useAction((VpcId: string) => clients.ec2.send(new DeleteVpcCommand({ VpcId })), {
    invalidate: [['ec2']], success: 'VPC deleted', onSuccess: () => setDeleting(null),
  })
  return (
    <Panel flush title="VPCs" actions={<>
      <RefreshButton onClick={() => vpcs.refetch()} spinning={vpcs.isFetching} />
      <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>Create VPC</Button>
    </>}>
      <Table
        rows={vpcs.data}
        loading={vpcs.isLoading}
        error={vpcs.error}
        rowKey={(v) => v.VpcId!}
        filterPlaceholder="Find VPCs"
        empty={<Empty title="No VPCs" icon={<NetworkIcon />} />}
        columns={[
          { header: 'Name', text: (v) => `${nameTag(v.Tags)} ${v.VpcId}`, render: (v) => nameTag(v.Tags) || '—' },
          { header: 'VPC ID', className: 'font-mono text-xs', render: (v) => v.VpcId },
          { header: 'CIDR', className: 'font-mono text-xs', render: (v) => v.CidrBlock },
          { header: 'Default', className: 'w-24', render: (v) => (v.IsDefault ? <Badge tone="blue">default</Badge> : null) },
          { header: 'Tenancy', className: 'w-28', render: (v) => v.InstanceTenancy },
          { header: '', className: 'w-14 text-right', render: (v) => (
            <IconButton label={`Delete ${v.VpcId}`} onClick={() => setDeleting(v.VpcId!)}><Trash2 /></IconButton>
          ) },
        ]}
      />
      {creating && <CreateVpc onClose={() => setCreating(false)} />}
      {deleting && (
        <Confirm title={`Delete ${deleting}?`} loading={del.isPending} onConfirm={() => del.mutate(deleting)} onClose={() => setDeleting(null)}>
          <p>Delete its subnets, gateways, route tables and security groups first: like AWS, may refuses to delete a VPC with dependencies.</p>
        </Confirm>
      )}
    </Panel>
  )
}

function CreateVpc({ onClose }: { onClose: () => void }) {
  const { clients } = useSettings()
  const [name, setName] = useState('')
  const [cidr, setCidr] = useState('10.0.0.0/16')
  const [publicSubnet, setPublicSubnet] = useState(true)
  const create = useAction(
    async () => {
      const vpc = (await clients.ec2.send(new CreateVpcCommand({
        CidrBlock: cidr, TagSpecifications: name ? [{ ResourceType: 'vpc', Tags: [{ Key: 'Name', Value: name }] }] : undefined,
      }))).Vpc!
      if (publicSubnet) {
        // A starter public subnet: the first /24, with an internet gateway.
        const base = cidr.split('/')[0].split('.')
        await clients.ec2.send(new CreateSubnetCommand({ VpcId: vpc.VpcId, CidrBlock: `${base[0]}.${base[1]}.${base[2]}.0/24` }))
        const igw = (await clients.ec2.send(new CreateInternetGatewayCommand({}))).InternetGateway!
        await clients.ec2.send(new AttachInternetGatewayCommand({ InternetGatewayId: igw.InternetGatewayId, VpcId: vpc.VpcId }))
      }
    },
    { invalidate: [['ec2']], success: 'VPC created', onSuccess: onClose },
  )
  return (
    <Modal title="Create VPC" onClose={onClose} footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button variant="primary" disabled={!/^\d+\.\d+\.\d+\.\d+\/\d+$/.test(cidr)} loading={create.isPending} onClick={() => create.mutate(undefined)}>Create</Button>
    </>}>
      <div className="flex flex-col gap-5">
        <Field label="Name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="IPv4 CIDR" hint="/16 to /28"><Input className="font-mono" value={cidr} onChange={(e) => setCidr(e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={publicSubnet} onCheckedChange={(v) => setPublicSubnet(v === true)} />
          Also create a /24 subnet and attach an internet gateway
        </label>
      </div>
    </Modal>
  )
}

function Subnets() {
  const { clients } = useSettings()
  const subnets = useSubnets()
  const vpcs = useVpcs()
  const zones = useQuery({
    queryKey: ['ec2', 'zones'],
    queryFn: async () => (await clients.ec2.send(new DescribeAvailabilityZonesCommand({}))).AvailabilityZones ?? [],
  })
  const [form, setForm] = useState<{ vpc: string; cidr: string; az: string } | null>(null)
  const create = useAction(
    () => clients.ec2.send(new CreateSubnetCommand({ VpcId: form!.vpc, CidrBlock: form!.cidr, AvailabilityZone: form!.az || undefined })),
    { invalidate: [['ec2']], success: 'Subnet created', onSuccess: () => setForm(null) },
  )
  const del = useAction((SubnetId: string) => clients.ec2.send(new DeleteSubnetCommand({ SubnetId })), { invalidate: [['ec2']], success: 'Subnet deleted' })
  return (
    <Panel flush title="Subnets" actions={<>
      <RefreshButton onClick={() => subnets.refetch()} spinning={subnets.isFetching} />
      <Button variant="primary" icon={<Plus />} onClick={() => setForm({ vpc: vpcs.data?.find((v) => !v.IsDefault)?.VpcId ?? vpcs.data?.[0]?.VpcId ?? '', cidr: '', az: '' })}>Create subnet</Button>
    </>}>
      <Table
        rows={subnets.data}
        loading={subnets.isLoading}
        error={subnets.error}
        rowKey={(s) => s.SubnetId!}
        filterPlaceholder="Find subnets"
        empty={<Empty title="No subnets" />}
        columns={[
          { header: 'Subnet ID', text: (s) => `${s.SubnetId} ${s.VpcId} ${nameTag(s.Tags)}`, className: 'font-mono text-xs', render: (s) => s.SubnetId },
          { header: 'Name', render: (s) => nameTag(s.Tags) || '—' },
          { header: 'VPC', className: 'font-mono text-xs', render: (s) => s.VpcId },
          { header: 'CIDR', className: 'font-mono text-xs', render: (s) => s.CidrBlock },
          { header: 'Zone', render: (s) => s.AvailabilityZone },
          { header: 'Free IPs', className: 'tabular-nums', render: (s) => s.AvailableIpAddressCount },
          { header: 'Public IPs', render: (s) => (s.MapPublicIpOnLaunch ? <Badge tone="blue">auto-assign</Badge> : '—') },
          { header: '', className: 'w-14 text-right', render: (s) => <IconButton label="Delete" onClick={() => del.mutate(s.SubnetId!)}><Trash2 /></IconButton> },
        ]}
      />
      {form && (
        <Modal title="Create subnet" onClose={() => setForm(null)} footer={<>
          <Button variant="secondary" onClick={() => setForm(null)}>Cancel</Button>
          <Button variant="primary" disabled={!form.vpc || !form.cidr} loading={create.isPending} onClick={() => create.mutate(undefined)}>Create</Button>
        </>}>
          <div className="flex flex-col gap-5">
            <Field label="VPC">
              <Select className="w-full" value={form.vpc} onChange={(e) => setForm({ ...form, vpc: e.target.value })}>
                {(vpcs.data ?? []).map((v) => <Option key={v.VpcId} value={v.VpcId}>{v.VpcId} · {v.CidrBlock}{v.IsDefault ? ' (default)' : ''}</Option>)}
              </Select>
            </Field>
            <Field label="IPv4 CIDR" hint="Inside the VPC's CIDR and not overlapping other subnets">
              <Input className="font-mono" value={form.cidr} onChange={(e) => setForm({ ...form, cidr: e.target.value })} placeholder="10.0.1.0/24" />
            </Field>
            <Field label="Availability zone">
              <Select className="w-full" value={form.az} onChange={(e) => setForm({ ...form, az: e.target.value })}>
                <Option value="">No preference</Option>
                {(zones.data ?? []).map((z) => <Option key={z.ZoneName} value={z.ZoneName}>{z.ZoneName} ({z.ZoneId})</Option>)}
              </Select>
            </Field>
          </div>
        </Modal>
      )}
    </Panel>
  )
}

function Gateways() {
  const { clients } = useSettings()
  const igws = useQuery({
    queryKey: ['ec2', 'igws'],
    queryFn: async () => (await clients.ec2.send(new DescribeInternetGatewaysCommand({}))).InternetGateways ?? [],
  })
  return (
    <Panel flush title="Internet gateways">
      <Table
        rows={igws.data}
        loading={igws.isLoading}
        error={igws.error}
        rowKey={(g) => g.InternetGatewayId!}
        empty={<Empty title="No internet gateways" />}
        columns={[
          { header: 'ID', className: 'font-mono text-xs', render: (g) => g.InternetGatewayId },
          { header: 'Name', render: (g) => nameTag(g.Tags) || '—' },
          { header: 'Attached to', className: 'font-mono text-xs', render: (g) => g.Attachments?.[0]?.VpcId ?? '—' },
          { header: 'State', render: (g) => (g.Attachments?.length ? <Badge tone="green">attached</Badge> : <Badge>detached</Badge>) },
        ]}
      />
    </Panel>
  )
}

function Routes() {
  const { clients } = useSettings()
  const tables = useQuery({
    queryKey: ['ec2', 'route-tables'],
    queryFn: async () => (await clients.ec2.send(new DescribeRouteTablesCommand({}))).RouteTables ?? [],
  })
  return (
    <Panel flush title="Route tables">
      <Table
        rows={tables.data}
        loading={tables.isLoading}
        error={tables.error}
        rowKey={(t) => t.RouteTableId!}
        empty={<Empty title="No route tables" />}
        columns={[
          { header: 'ID', className: 'font-mono text-xs align-top', render: (t) => t.RouteTableId },
          { header: 'VPC', className: 'font-mono text-xs align-top', render: (t) => t.VpcId },
          { header: 'Main', className: 'align-top', render: (t) => (t.Associations?.some((a) => a.Main) ? <Badge tone="blue">main</Badge> : '—') },
          { header: 'Routes', render: (t) => (
            <ul className="flex flex-col gap-0.5 font-mono text-xs">
              {(t.Routes ?? []).map((r) => <li key={r.DestinationCidrBlock}>{r.DestinationCidrBlock} → {r.GatewayId ?? r.NatGatewayId ?? r.InstanceId ?? '?'}{r.State === 'blackhole' ? ' (blackhole)' : ''}</li>)}
            </ul>
          ) },
          { header: 'Subnets', className: 'font-mono text-xs align-top', render: (t) => (t.Associations ?? []).filter((a) => a.SubnetId).map((a) => a.SubnetId).join(', ') || '—' },
        ]}
      />
    </Panel>
  )
}
