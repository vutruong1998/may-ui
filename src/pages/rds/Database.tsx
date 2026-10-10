import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  AddTagsToResourceCommand, CreateDBSnapshotCommand, ModifyDBInstanceCommand, RebootDBInstanceCommand, RemoveTagsFromResourceCommand,
  StartDBInstanceCommand, StopDBInstanceCommand, type DBInstance,
} from '@aws-sdk/client-rds'
import { Camera, DatabaseZap, Play, RotateCw, Square, Trash2 } from 'lucide-react'
import { useSettings } from '@/lib/settings'
import { useAction } from '@/lib/hooks'
import { formatDate } from '@/lib/format'
import { useSecurityGroups } from '@/lib/ec2'
import {
  connectionUrl, dbStatusTone, engineLabels, instanceClasses, snapshotTone, useDatabaseEndpoints, useDBInstances,
  useParameterGroups, useSnapshots,
} from '@/lib/rds'
import { TagsEditor } from '@/components/TagsEditor'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Badge, Button, CodeBlock, Empty, ErrorBox, Field, Input, KeyValue, Modal, Mono, NameCell, Option, PageHeader, Panel,
  RefreshButton, Select, Spinner, Table, Tabs,
} from '@/components/common'
import { DeleteDatabases } from './Databases'

type Tab = 'details' | 'connect' | 'modify' | 'snapshots' | 'tags'

export default function Database() {
  const { id = '' } = useParams()
  const { clients } = useSettings()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) ?? 'details'
  const dbs = useDBInstances()
  const db = dbs.data?.find((d) => d.DBInstanceIdentifier === id)
  const [deleting, setDeleting] = useState(false)
  const DBInstanceIdentifier = id
  const start = useAction(() => clients.rds.send(new StartDBInstanceCommand({ DBInstanceIdentifier })), { invalidate: [['rds']], success: 'Starting' })
  const stop = useAction(() => clients.rds.send(new StopDBInstanceCommand({ DBInstanceIdentifier })), { invalidate: [['rds']], success: 'Stopping' })
  const reboot = useAction(() => clients.rds.send(new RebootDBInstanceCommand({ DBInstanceIdentifier })), { invalidate: [['rds']], success: 'Rebooting' })
  const status = db?.DBInstanceStatus

  return (
    <>
      <PageHeader
        title={id}
        crumbs={[{ label: 'RDS databases', to: '/rds/databases' }, { label: id }]}
        description={db && (
          <span className="inline-flex items-center gap-2">
            <Badge tone={dbStatusTone(status)}>{status}</Badge>
            {engineLabels[db.Engine ?? ''] ?? db.Engine} {db.EngineVersion} · {db.DBInstanceClass}
          </span>
        )}
        actions={db && <>
          <RefreshButton onClick={() => dbs.refetch()} spinning={dbs.isFetching} />
          {status === 'stopped'
            ? <Button icon={<Play />} loading={start.isPending} onClick={() => start.mutate(undefined)}>Start</Button>
            : <Button icon={<Square />} disabled={status !== 'available'} loading={stop.isPending} onClick={() => stop.mutate(undefined)}>Stop</Button>}
          <Button icon={<RotateCw />} disabled={status !== 'available' && status !== 'incompatible-parameters'} loading={reboot.isPending}
            onClick={() => reboot.mutate(undefined)}>Reboot</Button>
          <Button variant="danger" icon={<Trash2 />} disabled={status === 'deleting'} onClick={() => setDeleting(true)}>Delete</Button>
        </>}
      />
      {dbs.isLoading ? <Spinner /> : !db ? <ErrorBox error={new Error(`Database ${id} does not exist.`)} /> : (
        <>
          <Tabs value={tab} onChange={(t) => setParams(t === 'details' ? {} : { tab: t })} tabs={[
            { id: 'details', label: 'Details' }, { id: 'connect', label: 'Connect' }, { id: 'modify', label: 'Modify' },
            { id: 'snapshots', label: 'Snapshots' }, { id: 'tags', label: 'Tags' },
          ]} />
          {tab === 'details' ? <Details db={db} />
            : tab === 'connect' ? <Connect db={db} />
              : tab === 'modify' ? <Modify key={db.DBInstanceIdentifier} db={db} onRenamed={(next) => navigate(`/rds/databases/${next}?tab=modify`, { replace: true })} />
                : tab === 'snapshots' ? <Snapshots db={db} /> : <Tags db={db} />}
        </>
      )}
      {deleting && <DeleteDatabases ids={[id]} onClose={() => setDeleting(false)} onDone={() => navigate('/rds/databases')} />}
    </>
  )
}

function Details({ db }: { db: DBInstance }) {
  const pg = db.DBParameterGroups?.[0]
  return (
    <div className="flex flex-col gap-6">
      <Panel title="Configuration">
        <KeyValue items={[
          ['Identifier', <Mono copy>{db.DBInstanceIdentifier}</Mono>],
          ['Status', <Badge tone={dbStatusTone(db.DBInstanceStatus)}>{db.DBInstanceStatus}</Badge>],
          ['Engine', `${engineLabels[db.Engine ?? ''] ?? db.Engine} ${db.EngineVersion}`],
          ['Instance class', db.DBInstanceClass],
          ['Master username', <Mono copy>{db.MasterUsername}</Mono>],
          ['Database name', db.DBName],
          ['Parameter group', pg && (
            <span className="inline-flex items-center gap-2">
              <NameCell to={`/rds/parameter-groups?open=${pg.DBParameterGroupName}`}>{pg.DBParameterGroupName}</NameCell>
              <Badge tone={pg.ParameterApplyStatus === 'in-sync' ? 'neutral' : 'amber'}>{pg.ParameterApplyStatus}</Badge>
            </span>
          )],
          ['Option group', db.OptionGroupMemberships?.[0]?.OptionGroupName],
          ['License', db.LicenseModel],
          ['Created', formatDate(db.InstanceCreateTime)],
          ['Resource ID', <Mono copy>{db.DbiResourceId}</Mono>],
          ['ARN', <Mono copy>{db.DBInstanceArn}</Mono>],
        ]} />
      </Panel>
      <Panel title="Connectivity">
        <KeyValue items={[
          ['Endpoint', <Mono copy>{db.Endpoint?.Address}</Mono>],
          ['Port', db.Endpoint?.Port],
          ['VPC', <Mono copy>{db.DBSubnetGroup?.VpcId}</Mono>],
          ['Subnet group', db.DBSubnetGroup?.DBSubnetGroupName],
          ['Availability zone', db.AvailabilityZone],
          ['Multi-AZ', db.MultiAZ ? `Yes (standby in ${db.SecondaryAvailabilityZone})` : 'No'],
          ['Publicly accessible', db.PubliclyAccessible ? 'Yes' : 'No'],
          ['Security groups', (
            <span className="flex flex-wrap gap-2">
              {(db.VpcSecurityGroups ?? []).map((g) => (
                <NameCell key={g.VpcSecurityGroupId} to={`/ec2/security-groups?open=${g.VpcSecurityGroupId}`}>{g.VpcSecurityGroupId}</NameCell>
              ))}
            </span>
          )],
        ]} />
      </Panel>
      <Panel title="Storage and backups">
        <KeyValue items={[
          ['Allocated storage', `${db.AllocatedStorage} GiB`],
          ['Storage autoscaling limit', db.MaxAllocatedStorage ? `${db.MaxAllocatedStorage} GiB` : 'Off'],
          ['Storage type', db.StorageType],
          ['IOPS', db.Iops],
          ['Throughput', db.StorageThroughput && `${db.StorageThroughput} MiB/s`],
          ['Encrypted', db.StorageEncrypted ? 'Yes' : 'No'],
          ['Backup retention', `${db.BackupRetentionPeriod} day${db.BackupRetentionPeriod === 1 ? '' : 's'}`],
          ['Backup window', db.PreferredBackupWindow],
          ['Maintenance window', db.PreferredMaintenanceWindow],
          ['Deletion protection', db.DeletionProtection ? 'On' : 'Off'],
        ]} />
      </Panel>
    </div>
  )
}

function Connect({ db }: { db: DBInstance }) {
  const endpoints = useDatabaseEndpoints()
  const e = endpoints.data?.find((x) => x.dbInstanceIdentifier === db.DBInstanceIdentifier)
  if (endpoints.isLoading) return <Spinner />
  if (!e) {
    return (
      <Empty title="Not running as a container" icon={<DatabaseZap />}>
        may is in API-only mode, or this database isn't running. Start may with <code>-docker</code> to run a real database server.
      </Empty>
    )
  }
  const isPg = db.Engine === 'postgres'
  const name = db.DBName ?? (isPg ? 'postgres' : '')
  const env = isPg
    ? `PGHOST=localhost PGPORT=${e.port} PGUSER=${e.masterUsername}${name ? ` PGDATABASE=${name}` : ''}`
    : `MYSQL_HOST=127.0.0.1 MYSQL_TCP_PORT=${e.port}`
  return (
    <div className="flex flex-col gap-6">
      <Panel title="From this machine" description="Use the master password you chose.">
        <div className="flex flex-col gap-3">
          <CodeBlock>{e.connect}</CodeBlock>
          <CodeBlock>{connectionUrl(db, e.port)}</CodeBlock>
          <CodeBlock>{env}</CodeBlock>
        </div>
      </Panel>
      <Panel title="From other containers" description="EC2 real-mode instances and other containers reach the database through the host.">
        <CodeBlock>{`host.docker.internal:${e.port}`}</CodeBlock>
      </Panel>
      <Panel title="Shell inside the server">
        <CodeBlock>{isPg
          ? `docker exec -it ${e.container} psql -U ${e.masterUsername} -d ${name}`
          : `docker exec -it ${e.container} ${db.Engine === 'mariadb' ? 'mariadb' : 'mysql'} -u ${e.masterUsername} -p${name ? ` ${name}` : ''}`}</CodeBlock>
      </Panel>
      <Panel title="Container">
        <KeyValue items={[['Name', <Mono copy>{e.container}</Mono>], ['Image', e.image], ['Published on', `127.0.0.1:${e.port}`]]} />
      </Panel>
    </div>
  )
}

function Modify({ db, onRenamed }: { db: DBInstance; onRenamed: (id: string) => void }) {
  const { clients } = useSettings()
  const paramGroups = useParameterGroups()
  const groups = useSecurityGroups()
  const initial = () => ({
    id: db.DBInstanceIdentifier ?? '', cls: db.DBInstanceClass ?? '', storage: String(db.AllocatedStorage ?? 20),
    password: '', port: String(db.Endpoint?.Port ?? ''), backup: String(db.BackupRetentionPeriod ?? 1),
    paramGroup: db.DBParameterGroups?.[0]?.DBParameterGroupName ?? '', deletionProtection: !!db.DeletionProtection,
    sgIds: new Set((db.VpcSecurityGroups ?? []).map((g) => g.VpcSecurityGroupId!)),
  })
  const [form, setForm] = useState(initial)
  const family = (paramGroups.data ?? []).find((g) => g.DBParameterGroupName === db.DBParameterGroups?.[0]?.DBParameterGroupName)?.DBParameterGroupFamily
  const familyGroups = (paramGroups.data ?? []).filter((g) => g.DBParameterGroupFamily === family)
  const vpcGroups = (groups.data ?? []).filter((g) => g.VpcId === db.DBSubnetGroup?.VpcId)
  const busy = db.DBInstanceStatus !== 'available'

  const changes: string[] = []
  const sgChanged = [...form.sgIds].sort().join() !== (db.VpcSecurityGroups ?? []).map((g) => g.VpcSecurityGroupId).sort().join()
  if (form.id !== db.DBInstanceIdentifier) changes.push(`Identifier → ${form.id}`)
  if (form.cls !== db.DBInstanceClass) changes.push(`Class → ${form.cls}`)
  if (Number(form.storage) !== db.AllocatedStorage) changes.push(`Storage → ${form.storage} GiB`)
  if (form.password) changes.push('Master password')
  if (Number(form.port) !== db.Endpoint?.Port) changes.push(`Port → ${form.port}`)
  if (Number(form.backup) !== db.BackupRetentionPeriod) changes.push(`Backup retention → ${form.backup} days`)
  if (form.paramGroup !== db.DBParameterGroups?.[0]?.DBParameterGroupName) changes.push(`Parameter group → ${form.paramGroup}`)
  if (form.deletionProtection !== !!db.DeletionProtection) changes.push(`Deletion protection ${form.deletionProtection ? 'on' : 'off'}`)
  if (sgChanged) changes.push('Security groups')

  const save = useAction(
    () => clients.rds.send(new ModifyDBInstanceCommand({
      DBInstanceIdentifier: db.DBInstanceIdentifier, ApplyImmediately: true,
      NewDBInstanceIdentifier: form.id !== db.DBInstanceIdentifier ? form.id : undefined,
      DBInstanceClass: form.cls !== db.DBInstanceClass ? form.cls : undefined,
      AllocatedStorage: Number(form.storage) !== db.AllocatedStorage ? Number(form.storage) : undefined,
      MasterUserPassword: form.password || undefined,
      DBPortNumber: Number(form.port) !== db.Endpoint?.Port ? Number(form.port) : undefined,
      BackupRetentionPeriod: Number(form.backup) !== db.BackupRetentionPeriod ? Number(form.backup) : undefined,
      DBParameterGroupName: form.paramGroup !== db.DBParameterGroups?.[0]?.DBParameterGroupName ? form.paramGroup : undefined,
      DeletionProtection: form.deletionProtection !== !!db.DeletionProtection ? form.deletionProtection : undefined,
      VpcSecurityGroupIds: sgChanged ? [...form.sgIds] : undefined,
    })),
    {
      invalidate: [['rds']],
      success: 'Changes applied',
      onSuccess: (r) => {
        setForm((f) => ({ ...f, password: '' }))
        const next = r.DBInstance?.DBInstanceIdentifier
        if (next && next !== db.DBInstanceIdentifier) onRenamed(next)
      },
    },
  )
  const set = <K extends keyof ReturnType<typeof initial>>(k: K, v: ReturnType<typeof initial>[K]) => setForm({ ...form, [k]: v })

  return (
    <Panel title="Modify" description="Changes apply immediately (may has no maintenance windows). Parameter group changes take effect after a reboot in real mode."
      actions={<>
        {changes.length > 0 && <Button variant="ghost" onClick={() => setForm(initial())}>Discard</Button>}
        <Button variant="primary" disabled={!changes.length || busy} loading={save.isPending} onClick={() => save.mutate(undefined)}>Apply changes</Button>
      </>}>
      <div className="flex flex-col gap-5">
        {busy && <p className="text-sm text-muted-foreground">The database is {db.DBInstanceStatus}; it can be modified once it is available.</p>}
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="DB instance identifier"><Input value={form.id} onChange={(e) => set('id', e.target.value)} /></Field>
          <Field label="Instance class">
            <Select className="w-full" value={form.cls} onChange={(e) => set('cls', e.target.value)}>
              {[...new Set([db.DBInstanceClass!, ...instanceClasses])].map((c) => <Option key={c} value={c}>{c}</Option>)}
            </Select>
          </Field>
          <Field label="Storage (GiB)" hint="Can only grow.">
            <Input type="number" min={db.AllocatedStorage} value={form.storage} onChange={(e) => set('storage', e.target.value)} />
          </Field>
          <Field label="New master password" hint="Leave empty to keep the current one.">
            <Input type="password" autoComplete="new-password" value={form.password} onChange={(e) => set('password', e.target.value)} />
          </Field>
          <Field label="Port"><Input type="number" value={form.port} onChange={(e) => set('port', e.target.value)} /></Field>
          <Field label="Backup retention (days)"><Input type="number" min={0} max={35} value={form.backup} onChange={(e) => set('backup', e.target.value)} /></Field>
        </div>
        <Field label="Parameter group">
          <Select className="w-full sm:w-1/2" value={form.paramGroup} onChange={(e) => set('paramGroup', e.target.value)}>
            {familyGroups.map((g) => <Option key={g.DBParameterGroupName} value={g.DBParameterGroupName}>{g.DBParameterGroupName}</Option>)}
          </Select>
        </Field>
        <Field label="VPC security groups">
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {vpcGroups.map((g) => (
              <label key={g.GroupId} className="flex items-center gap-2 text-sm">
                <Checkbox checked={form.sgIds.has(g.GroupId!)} onCheckedChange={() => {
                  const next = new Set(form.sgIds)
                  if (next.has(g.GroupId!)) next.delete(g.GroupId!)
                  else next.add(g.GroupId!)
                  set('sgIds', next)
                }} />
                {g.GroupName} <span className="font-mono text-xs text-muted-foreground">{g.GroupId}</span>
              </label>
            ))}
          </div>
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={form.deletionProtection} onCheckedChange={(v) => set('deletionProtection', v === true)} />
          Deletion protection
        </label>
        {changes.length > 0 && <p className="text-sm text-muted-foreground">Pending: {changes.join(' · ')}</p>}
      </div>
    </Panel>
  )
}

function Snapshots({ db }: { db: DBInstance }) {
  const { clients } = useSettings()
  const snapshots = useSnapshots()
  const mine = snapshots.data?.filter((s) => s.DBInstanceIdentifier === db.DBInstanceIdentifier)
  const [naming, setNaming] = useState<string | null>(null)
  const create = useAction(
    () => clients.rds.send(new CreateDBSnapshotCommand({ DBInstanceIdentifier: db.DBInstanceIdentifier, DBSnapshotIdentifier: naming! })),
    { invalidate: [['rds']], success: `Creating snapshot ${naming}`, onSuccess: () => setNaming(null) },
  )
  return (
    <Panel flush title="Snapshots" description="may records snapshots but copies no data and cannot restore them yet."
      actions={<Button icon={<Camera />} disabled={db.DBInstanceStatus !== 'available'}
        onClick={() => setNaming(`${db.DBInstanceIdentifier}-${new Date().toISOString().slice(0, 10)}`)}>Take snapshot</Button>}>
      <Table
        rows={mine}
        loading={snapshots.isLoading}
        error={snapshots.error}
        rowKey={(s) => s.DBSnapshotIdentifier!}
        empty={<Empty title="No snapshots" icon={<Camera />} />}
        columns={[
          { header: 'Snapshot', render: (s) => <NameCell icon={<Camera />} to="/rds/snapshots">{s.DBSnapshotIdentifier}</NameCell> },
          { header: 'Status', className: 'w-32', render: (s) => <Badge tone={snapshotTone(s.Status)}>{s.Status}</Badge> },
          { header: 'Created', className: 'w-52', render: (s) => formatDate(s.SnapshotCreateTime) },
        ]}
      />
      {naming !== null && (
        <Modal title="Take snapshot" onClose={() => setNaming(null)} footer={<>
          <Button variant="secondary" onClick={() => setNaming(null)}>Cancel</Button>
          <Button variant="primary" disabled={!naming} loading={create.isPending} onClick={() => create.mutate(undefined)}>Take snapshot</Button>
        </>}>
          <Field label="Snapshot identifier"><Input autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} /></Field>
        </Modal>
      )}
    </Panel>
  )
}

function Tags({ db }: { db: DBInstance }) {
  const { clients } = useSettings()
  const tags = db.TagList ?? []
  const ResourceName = db.DBInstanceArn
  const save = useAction(
    async (next: { Key: string; Value: string }[]) => {
      const removed = tags.filter((t) => !next.some((n) => n.Key === t.Key)).map((t) => t.Key!)
      if (removed.length) await clients.rds.send(new RemoveTagsFromResourceCommand({ ResourceName, TagKeys: removed }))
      if (next.length) await clients.rds.send(new AddTagsToResourceCommand({ ResourceName, Tags: next }))
    },
    { invalidate: [['rds']], success: 'Tags saved' },
  )
  return <Panel title="Tags"><TagsEditor tags={tags} saving={save.isPending} onSave={(t) => save.mutate(t)} /></Panel>
}
