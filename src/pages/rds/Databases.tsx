import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CreateDBInstanceCommand, DeleteDBInstanceCommand, RebootDBInstanceCommand, StartDBInstanceCommand, StopDBInstanceCommand,
} from '@aws-sdk/client-rds'
import { DatabaseZap, Play, Plus, RotateCw, Square, Trash2 } from 'lucide-react'
import { useSettings } from '@/lib/settings'
import { useAction } from '@/lib/hooks'
import { formatDate } from '@/lib/format'
import { useSecurityGroups, useSubnets } from '@/lib/ec2'
import {
  dbStatusTone, engineLabels, instanceClasses, useDatabaseEndpoints, useDBInstances, useEngineVersions, useParameterGroups,
  useSubnetGroups,
} from '@/lib/rds'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Badge, Button, Confirm, Empty, Field, Input, Modal, NameCell, Option, PageHeader, Panel, RefreshButton, Select, Table,
} from '@/components/common'

export default function Databases() {
  const { clients } = useSettings()
  const dbs = useDBInstances()
  const endpoints = useDatabaseEndpoints()
  const realMode = (endpoints.data?.length ?? 0) > 0
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<string[] | null>(null)
  const ids = [...selected]
  const status = (id: string) => dbs.data?.find((d) => d.DBInstanceIdentifier === id)?.DBInstanceStatus

  // Each instance gets its own call; RDS has no batch actions.
  const useBulk = (label: string, want: string, fn: (id: string) => Promise<unknown>) =>
    useAction(async () => { await Promise.all(ids.filter((id) => status(id) === want).map(fn)) }, {
      invalidate: [['rds'], ['count']], success: `${label} ${ids.length} database${ids.length === 1 ? '' : 's'}`,
    })
  const start = useBulk('Starting', 'stopped', (id) => clients.rds.send(new StartDBInstanceCommand({ DBInstanceIdentifier: id })))
  const stop = useBulk('Stopping', 'available', (id) => clients.rds.send(new StopDBInstanceCommand({ DBInstanceIdentifier: id })))
  const reboot = useBulk('Rebooting', 'available', (id) => clients.rds.send(new RebootDBInstanceCommand({ DBInstanceIdentifier: id })))

  return (
    <>
      <PageHeader
        title="RDS databases"
        description={realMode
          ? 'Real mode: each database runs as a PostgreSQL, MySQL or MariaDB container you can connect to on localhost.'
          : 'API-only mode: databases change status realistically but nothing runs. Start may with -docker to run real database servers.'}
        actions={<>
          <RefreshButton onClick={() => dbs.refetch()} spinning={dbs.isFetching} />
          <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>Create database</Button>
        </>}
      />
      <Panel flush>
        <Table
          rows={dbs.data}
          loading={dbs.isLoading}
          error={dbs.error}
          onRetry={() => dbs.refetch()}
          rowKey={(d) => d.DBInstanceIdentifier!}
          selectable
          selected={selected}
          onSelect={setSelected}
          filterPlaceholder="Find databases by identifier or engine"
          toolbar={<>
            <Button icon={<Play />} disabled={!ids.some((id) => status(id) === 'stopped')} loading={start.isPending} onClick={() => start.mutate(undefined)}>Start</Button>
            <Button icon={<Square />} disabled={!ids.some((id) => status(id) === 'available')} loading={stop.isPending} onClick={() => stop.mutate(undefined)}>Stop</Button>
            <Button icon={<RotateCw />} disabled={!ids.some((id) => status(id) === 'available')} loading={reboot.isPending} onClick={() => reboot.mutate(undefined)}>Reboot</Button>
            <Button variant="danger" icon={<Trash2 />} disabled={!ids.length} onClick={() => setDeleting(ids)}>Delete</Button>
          </>}
          empty={<Empty title="No databases" icon={<DatabaseZap />}>Create a PostgreSQL, MySQL or MariaDB database to get started.</Empty>}
          columns={[
            { header: 'Identifier', text: (d) => `${d.DBInstanceIdentifier} ${d.Engine} ${d.DBName ?? ''}`, render: (d) => (
              <NameCell icon={<DatabaseZap />} to={`/rds/databases/${d.DBInstanceIdentifier}`}>{d.DBInstanceIdentifier}</NameCell>
            ) },
            { header: 'Status', className: 'w-40', render: (d) => <Badge tone={dbStatusTone(d.DBInstanceStatus)}>{d.DBInstanceStatus}</Badge> },
            { header: 'Engine', className: 'w-40', render: (d) => `${engineLabels[d.Engine ?? ''] ?? d.Engine} ${d.EngineVersion}` },
            { header: 'Class', className: 'w-32', render: (d) => d.DBInstanceClass },
            { header: 'Endpoint', className: 'font-mono text-xs', render: (d) => (d.Endpoint ? `${d.Endpoint.Address}:${d.Endpoint.Port}` : '—') },
            { header: 'Zone', className: 'w-28', render: (d) => d.AvailabilityZone },
            { header: 'Created', className: 'w-52', render: (d) => formatDate(d.InstanceCreateTime) },
          ]}
        />
      </Panel>
      {creating && <Create onClose={() => setCreating(false)} />}
      {deleting && <DeleteDatabases ids={deleting} onClose={() => setDeleting(null)} onDone={() => { setDeleting(null); setSelected(new Set()) }} />}
    </>
  )
}

/** Deletes one or more instances, optionally taking a final snapshot of each. */
export function DeleteDatabases({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: () => void }) {
  const { clients } = useSettings()
  const dbs = useDBInstances()
  const [finalSnapshot, setFinalSnapshot] = useState(false)
  const protectedIds = ids.filter((id) => dbs.data?.find((d) => d.DBInstanceIdentifier === id)?.DeletionProtection)
  const del = useAction(
    async () => {
      for (const id of ids) {
        await clients.rds.send(new DeleteDBInstanceCommand(finalSnapshot
          ? { DBInstanceIdentifier: id, FinalDBSnapshotIdentifier: `${id}-final-${Date.now()}` }
          : { DBInstanceIdentifier: id, SkipFinalSnapshot: true }))
      }
    },
    { invalidate: [['rds'], ['count']], success: `Deleting ${ids.length} database${ids.length === 1 ? '' : 's'}`, onSuccess: onDone },
  )
  const one = ids.length === 1 ? ids[0] : `${ids.length} databases`
  return (
    <Confirm title={`Delete ${one}?`} confirmText={ids.length === 1 ? ids[0] : 'delete'} loading={del.isPending}
      onConfirm={() => del.mutate(undefined)} onClose={onClose}>
      {protectedIds.length > 0 && (
        <p className="text-destructive">Deletion protection is on for {protectedIds.join(', ')}. Turn it off in Modify first.</p>
      )}
      <p>In real mode the database container and its data volume are removed. This cannot be undone.</p>
      <label className="flex items-center gap-2">
        <Checkbox checked={finalSnapshot} onCheckedChange={(v) => setFinalSnapshot(v === true)} />
        Take a final snapshot first (may records snapshots but cannot restore them yet)
      </label>
    </Confirm>
  )
}

const defaultUser: Record<string, string> = { postgres: 'postgres', mysql: 'admin', mariadb: 'admin' }
const defaultPort: Record<string, number> = { postgres: 5432, mysql: 3306, mariadb: 3306 }
const idPattern = /^[a-zA-Z](?!.*--)[a-zA-Z0-9-]{0,62}$/

function Create({ onClose }: { onClose: () => void }) {
  const { clients } = useSettings()
  const navigate = useNavigate()
  const versions = useEngineVersions()
  const subnetGroups = useSubnetGroups()
  const paramGroups = useParameterGroups()
  const subnets = useSubnets()
  const groups = useSecurityGroups()

  const [engine, setEngine] = useState('postgres')
  const [version, setVersion] = useState('')
  const [id, setId] = useState('')
  const [cls, setCls] = useState('db.t3.micro')
  const [storage, setStorage] = useState('20')
  const [user, setUser] = useState('postgres')
  const [password, setPassword] = useState('')
  const [dbName, setDbName] = useState('')
  const [port, setPort] = useState('5432')
  const [subnetGroup, setSubnetGroup] = useState('')
  const [sgIds, setSgIds] = useState<Set<string>>(new Set())
  const [paramGroup, setParamGroup] = useState('')
  const [deletionProtection, setDeletionProtection] = useState(false)

  const engineVersions = (versions.data ?? []).filter((v) => v.Engine === engine)
  const ev = engineVersions.find((v) => v.EngineVersion === version) ?? engineVersions[engineVersions.length - 1]
  const familyGroups = (paramGroups.data ?? []).filter((g) => g.DBParameterGroupFamily === ev?.DBParameterGroupFamily && !g.DBParameterGroupName?.startsWith('default.'))
  // Without a subnet group RDS uses the default VPC.
  const vpcId = subnetGroups.data?.find((g) => g.DBSubnetGroupName === subnetGroup)?.VpcId
    ?? subnets.data?.find((s) => s.DefaultForAz)?.VpcId
  const vpcGroups = useMemo(() => (groups.data ?? []).filter((g) => g.VpcId === vpcId), [groups.data, vpcId])

  const idError = id && (!idPattern.test(id) || id.endsWith('-'))
    ? 'Start with a letter; use letters, digits and single hyphens; no trailing hyphen.' : null
  const pwError = password && (password.length < 8 || /[/@"\s]/.test(password))
    ? 'At least 8 characters, without /, @, " or spaces.' : null

  const create = useAction(
    () => clients.rds.send(new CreateDBInstanceCommand({
      DBInstanceIdentifier: id, Engine: engine, EngineVersion: ev?.EngineVersion, DBInstanceClass: cls,
      AllocatedStorage: Number(storage), MasterUsername: user, MasterUserPassword: password, DBName: dbName || undefined,
      Port: Number(port), DBSubnetGroupName: subnetGroup || undefined, VpcSecurityGroupIds: sgIds.size ? [...sgIds] : undefined,
      DBParameterGroupName: paramGroup || undefined, DeletionProtection: deletionProtection,
    })),
    {
      invalidate: [['rds'], ['count']],
      success: `Creating ${id.toLowerCase()}`,
      onSuccess: (r) => navigate(`/rds/databases/${r.DBInstance?.DBInstanceIdentifier}`),
    },
  )

  const pickEngine = (e: string) => {
    setEngine(e)
    setVersion('')
    setParamGroup('')
    if (user === defaultUser[engine]) setUser(defaultUser[e])
    if (port === String(defaultPort[engine])) setPort(String(defaultPort[e]))
  }
  const ready = id && !idError && user && password && !pwError && Number(storage) >= 20

  return (
    <Modal wide title="Create database" onClose={onClose} footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button variant="primary" disabled={!ready} loading={create.isPending} onClick={() => create.mutate(undefined)}>Create database</Button>
    </>}>
      <div className="flex flex-col gap-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Engine">
            <Select className="w-full" value={engine} onChange={(e) => pickEngine(e.target.value)}>
              {Object.entries(engineLabels).map(([k, label]) => <Option key={k} value={k}>{label}</Option>)}
            </Select>
          </Field>
          <Field label="Version" hint={ev && `Parameter group family ${ev.DBParameterGroupFamily}`}>
            <Select className="w-full" value={ev?.EngineVersion ?? ''} onChange={(e) => { setVersion(e.target.value); setParamGroup('') }}>
              {engineVersions.map((v) => <Option key={v.EngineVersion} value={v.EngineVersion}>{v.DBEngineVersionDescription}</Option>)}
            </Select>
          </Field>
        </div>
        <div className="grid gap-5 sm:grid-cols-[1fr_12rem_8rem]">
          <Field label="DB instance identifier" error={idError}>
            <Input autoFocus value={id} onChange={(e) => setId(e.target.value)} placeholder="app-db" />
          </Field>
          <Field label="Instance class" hint="Limits CPU and memory in real mode.">
            <Select className="w-full" value={cls} onChange={(e) => setCls(e.target.value)}>
              {instanceClasses.map((c) => <Option key={c} value={c}>{c}</Option>)}
            </Select>
          </Field>
          <Field label="Storage (GiB)">
            <Input type="number" min={20} value={storage} onChange={(e) => setStorage(e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Master username"><Input value={user} onChange={(e) => setUser(e.target.value)} /></Field>
          <Field label="Master password" error={pwError}>
            <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-5 sm:grid-cols-[1fr_8rem]">
          <Field label="Initial database name" hint={engine === 'postgres' ? 'Optional; the postgres database always exists.' : 'Optional.'}>
            <Input value={dbName} onChange={(e) => setDbName(e.target.value)} placeholder="app" />
          </Field>
          <Field label="Port" hint="On localhost in real mode.">
            <Input type="number" value={port} onChange={(e) => setPort(e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Subnet group">
            <Select className="w-full" value={subnetGroup} onChange={(e) => { setSubnetGroup(e.target.value); setSgIds(new Set()) }}>
              <Option value="">Default VPC</Option>
              {(subnetGroups.data ?? []).filter((g) => g.DBSubnetGroupName !== 'default').map((g) => (
                <Option key={g.DBSubnetGroupName} value={g.DBSubnetGroupName}>{g.DBSubnetGroupName} · {g.VpcId}</Option>
              ))}
            </Select>
          </Field>
          <Field label="Parameter group">
            <Select className="w-full" value={paramGroup} onChange={(e) => setParamGroup(e.target.value)}>
              <Option value="">default.{ev?.DBParameterGroupFamily}</Option>
              {familyGroups.map((g) => <Option key={g.DBParameterGroupName} value={g.DBParameterGroupName}>{g.DBParameterGroupName}</Option>)}
            </Select>
          </Field>
        </div>
        <Field label="VPC security groups" hint="None selected: the VPC's default group. Stored, not enforced.">
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
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={deletionProtection} onCheckedChange={(v) => setDeletionProtection(v === true)} />
          Deletion protection
        </label>
      </div>
    </Modal>
  )
}
