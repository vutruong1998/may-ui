import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  CreateDBParameterGroupCommand, DeleteDBParameterGroupCommand, ModifyDBParameterGroupCommand, ResetDBParameterGroupCommand,
  type ApplyMethod,
} from '@aws-sdk/client-rds'
import { Plus, SlidersHorizontal, Trash2 } from 'lucide-react'
import { useSettings } from '@/lib/settings'
import { useAction } from '@/lib/hooks'
import { useDBInstances, useEngineVersions, useParameterGroups, useParameters } from '@/lib/rds'
import {
  Badge, Button, Confirm, Drawer, Empty, ErrorBox, Field, IconButton, Input, KeyValue, Modal, Mono, NameCell, Option, PageHeader,
  Panel, RefreshButton, Select, Spinner, Table,
} from '@/components/common'

const isDefault = (name: string | undefined) => !!name?.startsWith('default.')

export default function ParameterGroups() {
  const { clients } = useSettings()
  const groups = useParameterGroups()
  const [params, setParams] = useSearchParams()
  const open = params.get('open')
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const del = useAction((DBParameterGroupName: string) => clients.rds.send(new DeleteDBParameterGroupCommand({ DBParameterGroupName })), {
    invalidate: [['rds']], success: 'Parameter group deleted', onSuccess: () => setDeleting(null),
  })
  return (
    <>
      <PageHeader
        title="DB parameter groups"
        description="Server settings for databases. In real mode the values are passed to the server when it starts, so changes apply on reboot."
        actions={<>
          <RefreshButton onClick={() => groups.refetch()} spinning={groups.isFetching} />
          <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>Create parameter group</Button>
        </>}
      />
      <Panel flush>
        <Table
          rows={groups.data}
          loading={groups.isLoading}
          error={groups.error}
          rowKey={(g) => g.DBParameterGroupName!}
          filterPlaceholder="Find parameter groups"
          empty={<Empty title="No parameter groups" icon={<SlidersHorizontal />}>Default groups appear once a database uses them.</Empty>}
          columns={[
            { header: 'Name', text: (g) => `${g.DBParameterGroupName} ${g.DBParameterGroupFamily}`, render: (g) => (
              <NameCell icon={<SlidersHorizontal />} onClick={() => setParams({ open: g.DBParameterGroupName! })}>{g.DBParameterGroupName}</NameCell>
            ) },
            { header: 'Family', className: 'w-40', render: (g) => g.DBParameterGroupFamily },
            { header: 'Type', className: 'w-28', render: (g) => <Badge tone={isDefault(g.DBParameterGroupName) ? 'neutral' : 'blue'}>{isDefault(g.DBParameterGroupName) ? 'Default' : 'Custom'}</Badge> },
            { header: 'Description', render: (g) => g.Description },
            { header: '', className: 'w-14 text-right', render: (g) => !isDefault(g.DBParameterGroupName) && (
              <IconButton label={`Delete ${g.DBParameterGroupName}`} onClick={() => setDeleting(g.DBParameterGroupName!)}><Trash2 /></IconButton>
            ) },
          ]}
        />
      </Panel>
      {creating && <Create onClose={() => setCreating(false)} onCreated={(name) => setParams({ open: name })} />}
      {open && <GroupDrawer name={open} onClose={() => setParams({})} />}
      {deleting && (
        <Confirm title={`Delete ${deleting}?`} loading={del.isPending} onConfirm={() => del.mutate(deleting)} onClose={() => setDeleting(null)}>
          <p>Groups used by a database cannot be deleted.</p>
        </Confirm>
      )}
    </>
  )
}

function Create({ onClose, onCreated }: { onClose: () => void; onCreated: (name: string) => void }) {
  const { clients } = useSettings()
  const versions = useEngineVersions()
  const families = [...new Set((versions.data ?? []).map((v) => v.DBParameterGroupFamily!))].sort()
  const [name, setName] = useState('')
  const [family, setFamily] = useState('')
  const [description, setDescription] = useState('')
  const fam = family || families.find((f) => f.startsWith('postgres')) || families[0] || ''
  const create = useAction(
    () => clients.rds.send(new CreateDBParameterGroupCommand({ DBParameterGroupName: name, DBParameterGroupFamily: fam, Description: description || name })),
    { invalidate: [['rds']], success: `Created ${name.toLowerCase()}`, onSuccess: (r) => { onClose(); onCreated(r.DBParameterGroup!.DBParameterGroupName!) } },
  )
  return (
    <Modal title="Create parameter group" onClose={onClose} footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button variant="primary" disabled={!name || !fam} loading={create.isPending} onClick={() => create.mutate(undefined)}>Create</Button>
    </>}>
      <div className="flex flex-col gap-5">
        <Field label="Name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="app-postgres16" /></Field>
        <Field label="Family" hint="Must match the engine version of the databases that use it.">
          <Select className="w-full" value={fam} onChange={(e) => setFamily(e.target.value)}>
            {families.map((f) => <Option key={f} value={f}>{f}</Option>)}
          </Select>
        </Field>
        <Field label="Description"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}

function GroupDrawer({ name, onClose }: { name: string; onClose: () => void }) {
  const { clients } = useSettings()
  const groups = useParameterGroups()
  const g = groups.data?.find((x) => x.DBParameterGroupName === name)
  const parameters = useParameters(name)
  const dbs = useDBInstances()
  const users = (dbs.data ?? []).filter((d) => d.DBParameterGroups?.some((p) => p.DBParameterGroupName === name))
  const [editing, setEditing] = useState<{ name: string; value: string; method: ApplyMethod; isNew: boolean } | null>(null)
  const readOnly = isDefault(name)

  const save = useAction(
    () => clients.rds.send(new ModifyDBParameterGroupCommand({ DBParameterGroupName: name, Parameters: [
      { ParameterName: editing!.name, ParameterValue: editing!.value, ApplyMethod: editing!.method },
    ] })),
    { invalidate: [['rds']], success: 'Parameter saved', onSuccess: () => setEditing(null) },
  )
  const reset = useAction(
    (p: string) => clients.rds.send(new ResetDBParameterGroupCommand({ DBParameterGroupName: name, Parameters: [{ ParameterName: p, ApplyMethod: 'immediate' }] })),
    { invalidate: [['rds']], success: 'Parameter reset' },
  )

  return (
    <Drawer title={name} description={g?.Description} onClose={onClose}>
      {!g ? <Spinner /> : (
        <div className="flex flex-col gap-6">
          <KeyValue items={[
            ['Family', g.DBParameterGroupFamily],
            ['ARN', <Mono copy>{g.DBParameterGroupArn}</Mono>],
            ['Used by', users.length ? users.map((d) => d.DBInstanceIdentifier).join(', ') : 'No databases'],
          ]} />
          {parameters.isError && <ErrorBox error={parameters.error} />}
          <Panel flush title={<span className="flex items-center gap-2">Parameters <Badge>{parameters.data?.length ?? 0}</Badge></span>}
            description={readOnly ? 'Default groups cannot be modified; create a custom group.' : 'Only values you set are listed; everything else uses the engine default.'}
            actions={!readOnly && <Button icon={<Plus />} onClick={() => setEditing({ name: '', value: '', method: 'pending-reboot', isNew: true })}>Add</Button>}>
            <Table
              rows={parameters.data}
              loading={parameters.isLoading}
              rowKey={(p) => p.ParameterName!}
              empty={<Empty title="No parameters set" icon={<SlidersHorizontal />} />}
              columns={[
                { header: 'Name', render: (p) => readOnly ? <span className="font-mono text-xs">{p.ParameterName}</span> : (
                  <NameCell onClick={() => setEditing({ name: p.ParameterName!, value: p.ParameterValue ?? '', method: (p.ApplyMethod ?? 'immediate') as ApplyMethod, isNew: false })}>
                    <span className="font-mono text-xs">{p.ParameterName}</span>
                  </NameCell>
                ) },
                { header: 'Value', className: 'font-mono text-xs', render: (p) => p.ParameterValue },
                { header: 'Apply', className: 'w-32', render: (p) => p.ApplyMethod },
                { header: '', className: 'w-12 text-right', render: (p) => !readOnly && (
                  <IconButton label="Reset to default" onClick={() => reset.mutate(p.ParameterName!)}><Trash2 /></IconButton>
                ) },
              ]}
            />
          </Panel>
        </div>
      )}
      {editing && (
        <Modal title={editing.isNew ? 'Set parameter' : `Edit ${editing.name}`} onClose={() => setEditing(null)} footer={<>
          <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
          <Button variant="primary" disabled={!editing.name} loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button>
        </>}>
          <div className="flex flex-col gap-5">
            <Field label="Name" hint={g?.DBParameterGroupFamily?.startsWith('postgres') ? 'A PostgreSQL setting, e.g. max_connections or work_mem.' : 'A server variable, e.g. max_connections or long_query_time.'}>
              <Input autoFocus={editing.isNew} disabled={!editing.isNew} className="font-mono" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            <Field label="Value"><Input autoFocus={!editing.isNew} className="font-mono" value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} /></Field>
            <Field label="Apply method" hint="In real mode, values apply when the database reboots either way.">
              <Select className="w-full" value={editing.method} onChange={(e) => setEditing({ ...editing, method: e.target.value as ApplyMethod })}>
                <Option value="pending-reboot">pending-reboot</Option>
                <Option value="immediate">immediate</Option>
              </Select>
            </Field>
          </div>
        </Modal>
      )}
    </Drawer>
  )
}
