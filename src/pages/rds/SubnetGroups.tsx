import { useState } from 'react'
import { CreateDBSubnetGroupCommand, DeleteDBSubnetGroupCommand } from '@aws-sdk/client-rds'
import { Network, Plus, Trash2 } from 'lucide-react'
import { useSettings } from '@/lib/settings'
import { useAction } from '@/lib/hooks'
import { nameTag, useSubnets, useVpcs } from '@/lib/ec2'
import { useSubnetGroups } from '@/lib/rds'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Button, Confirm, Empty, Field, IconButton, Input, Modal, Option, PageHeader, Panel, RefreshButton, Select, Table,
} from '@/components/common'

export default function SubnetGroups() {
  const { clients } = useSettings()
  const groups = useSubnetGroups()
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const del = useAction((DBSubnetGroupName: string) => clients.rds.send(new DeleteDBSubnetGroupCommand({ DBSubnetGroupName })), {
    invalidate: [['rds']], success: 'Subnet group deleted', onSuccess: () => setDeleting(null),
  })
  return (
    <>
      <PageHeader
        title="DB subnet groups"
        description="The VPC subnets a database can be placed in. Groups must cover at least two availability zones."
        actions={<>
          <RefreshButton onClick={() => groups.refetch()} spinning={groups.isFetching} />
          <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>Create subnet group</Button>
        </>}
      />
      <Panel flush>
        <Table
          rows={groups.data}
          loading={groups.isLoading}
          error={groups.error}
          rowKey={(g) => g.DBSubnetGroupName!}
          filterPlaceholder="Find subnet groups"
          empty={<Empty title="No subnet groups" icon={<Network />}>Databases created without one use the default VPC.</Empty>}
          columns={[
            { header: 'Name', text: (g) => `${g.DBSubnetGroupName} ${g.VpcId} ${g.DBSubnetGroupDescription}`, render: (g) => (
              <span className="inline-flex items-center gap-2 font-medium"><Network className="size-4 text-muted-foreground" />{g.DBSubnetGroupName}</span>
            ) },
            { header: 'Description', render: (g) => g.DBSubnetGroupDescription },
            { header: 'VPC', className: 'font-mono text-xs', render: (g) => g.VpcId },
            { header: 'Subnets', render: (g) => (
              <span className="flex flex-col gap-0.5 font-mono text-xs">
                {(g.Subnets ?? []).map((s) => <span key={s.SubnetIdentifier}>{s.SubnetIdentifier} · {s.SubnetAvailabilityZone?.Name}</span>)}
              </span>
            ) },
            { header: '', className: 'w-14 text-right', render: (g) => (
              <IconButton label={`Delete ${g.DBSubnetGroupName}`} onClick={() => setDeleting(g.DBSubnetGroupName!)}><Trash2 /></IconButton>
            ) },
          ]}
        />
      </Panel>
      {creating && <Create onClose={() => setCreating(false)} />}
      {deleting && (
        <Confirm title={`Delete ${deleting}?`} loading={del.isPending} onConfirm={() => del.mutate(deleting)} onClose={() => setDeleting(null)}>
          <p>Groups used by a database cannot be deleted.</p>
        </Confirm>
      )}
    </>
  )
}

function Create({ onClose }: { onClose: () => void }) {
  const { clients } = useSettings()
  const vpcs = useVpcs()
  const subnets = useSubnets()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [vpc, setVpc] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const vpcId = vpc || vpcs.data?.find((v) => !v.IsDefault)?.VpcId || vpcs.data?.[0]?.VpcId || ''
  const vpcSubnets = (subnets.data ?? []).filter((s) => s.VpcId === vpcId)
    .sort((a, b) => (a.AvailabilityZone ?? '').localeCompare(b.AvailabilityZone ?? ''))
  const zones = new Set(vpcSubnets.filter((s) => picked.has(s.SubnetId!)).map((s) => s.AvailabilityZone))
  const create = useAction(
    () => clients.rds.send(new CreateDBSubnetGroupCommand({
      DBSubnetGroupName: name, DBSubnetGroupDescription: description || name, SubnetIds: [...picked],
    })),
    { invalidate: [['rds']], success: `Created ${name.toLowerCase()}`, onSuccess: onClose },
  )
  return (
    <Modal title="Create DB subnet group" onClose={onClose} footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button variant="primary" disabled={!name || zones.size < 2} loading={create.isPending} onClick={() => create.mutate(undefined)}>Create</Button>
    </>}>
      <div className="flex flex-col gap-5">
        <Field label="Name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="app-db" /></Field>
        <Field label="Description"><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Private subnets for the app database" /></Field>
        <Field label="VPC">
          <Select className="w-full" value={vpcId} onChange={(e) => { setVpc(e.target.value); setPicked(new Set()) }}>
            {(vpcs.data ?? []).map((v) => <Option key={v.VpcId} value={v.VpcId}>{v.VpcId} · {v.CidrBlock}{v.IsDefault ? ' (default)' : ''}</Option>)}
          </Select>
        </Field>
        <Field label="Subnets" error={picked.size > 0 && zones.size < 2 ? 'Pick subnets in at least two availability zones.' : null}>
          <div className="flex flex-col gap-2">
            {vpcSubnets.length === 0 && <span className="text-sm text-muted-foreground">This VPC has no subnets.</span>}
            {vpcSubnets.map((s) => (
              <label key={s.SubnetId} className="flex items-center gap-2 text-sm">
                <Checkbox checked={picked.has(s.SubnetId!)} onCheckedChange={() => {
                  const next = new Set(picked)
                  if (next.has(s.SubnetId!)) next.delete(s.SubnetId!)
                  else next.add(s.SubnetId!)
                  setPicked(next)
                }} />
                <span className="font-mono text-xs">{s.SubnetId}</span> {s.CidrBlock} · {s.AvailabilityZone}
                {nameTag(s.Tags) && <span className="text-muted-foreground">({nameTag(s.Tags)})</span>}
              </label>
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  )
}
