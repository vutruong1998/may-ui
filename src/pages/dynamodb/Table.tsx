import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  DeleteTableCommand, DescribeContinuousBackupsCommand, DescribeTimeToLiveCommand, ListTagsOfResourceCommand,
  TagResourceCommand, UntagResourceCommand, UpdateContinuousBackupsCommand, UpdateTableCommand, UpdateTimeToLiveCommand,
  type ProjectionType, type ScalarAttributeType, type StreamViewType, type TableDescription, type UpdateTableCommandInput,
} from '@aws-sdk/client-dynamodb'
import { Layers, Plus, Trash2 } from 'lucide-react'
import { useSettings } from '@/lib/settings'
import { useAction } from '@/lib/hooks'
import { formatBytes, formatDate } from '@/lib/format'
import { attrType, billingLabel, isOnDemand, keysOf, typeLabel } from '@/lib/dynamodb'
import { useTable } from '@/lib/dynamodb'
import { TagsEditor } from '@/components/TagsEditor'
import {
  Badge, Button, Confirm, Empty, ErrorBox, Field, IconButton, Input, KeyValue, Modal, Mono, Option, PageHeader, Panel,
  RefreshButton, Select, Spinner, Table as DataTable, Tabs,
} from '@/components/common'
import Items from './Items'
import { KeyInput } from './Tables'

type Tab = 'items' | 'indexes' | 'settings' | 'tags'

export default function Table() {
  const { name = '' } = useParams()
  const { clients } = useSettings()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) ?? 'items'
  const table = useTable(name)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const del = useAction(() => clients.dynamodb.send(new DeleteTableCommand({ TableName: name })), {
    invalidate: [['count'], ['dynamodb', 'tables']], success: `Deleted table ${name}`, onSuccess: () => navigate('/dynamodb'),
  })

  const t = table.data
  const keys = keysOf(t?.KeySchema)
  return (
    <>
      <PageHeader
        title={name}
        crumbs={[{ label: 'DynamoDB', to: '/dynamodb' }, { label: name }]}
        description={t && <span className="inline-flex flex-wrap items-center gap-2">
          <Badge tone="green">{t.TableStatus}</Badge>
          Partition key <code>{keys.hash}</code>{keys.range && <> · Sort key <code>{keys.range}</code></>}
          · {t.ItemCount?.toLocaleString()} items · {formatBytes(t.TableSizeBytes)}
        </span>}
        actions={table.isSuccess && <>
          <RefreshButton onClick={() => table.refetch()} spinning={table.isFetching} />
          <Button variant="danger" icon={<Trash2 />} onClick={() => setConfirmDelete(true)}>Delete table</Button>
        </>}
      />
      {table.isLoading ? <Spinner /> : table.isError ? <ErrorBox error={table.error} onRetry={() => table.refetch()} /> : (
        <>
          <Tabs value={tab} onChange={(v) => setParams(v === 'items' ? {} : { tab: v })} tabs={[
            { id: 'items', label: 'Items' }, { id: 'indexes', label: 'Indexes' },
            { id: 'settings', label: 'Settings' }, { id: 'tags', label: 'Tags' },
          ]} />
          {tab === 'items' ? <Items table={t!} />
            : tab === 'indexes' ? <Indexes table={t!} />
            : tab === 'settings' ? <Settings table={t!} />
            : <Tags table={t!} />}
        </>
      )}
      {confirmDelete && (
        <Confirm title={`Delete table ${name}?`} confirmText={name} loading={del.isPending}
          onConfirm={() => del.mutate(undefined)} onClose={() => setConfirmDelete(false)}>
          {t?.DeletionProtectionEnabled
            ? <p>Deletion protection is on: turn it off in Settings first.</p>
            : <p>The table, its indexes and all of its items are deleted. This cannot be undone.</p>}
        </Confirm>
      )}
    </>
  )
}

function useUpdateTable(table: TableDescription, success: string) {
  const { clients } = useSettings()
  return useAction(
    (input: Omit<UpdateTableCommandInput, 'TableName'>) => clients.dynamodb.send(new UpdateTableCommand({ TableName: table.TableName, ...input })),
    { invalidate: [['dynamodb']], success },
  )
}

// Indexes.

interface IndexRow {
  name: string
  kind: 'Global' | 'Local'
  hash: string
  range?: string
  projection: string
  status?: string
  items?: number
  size?: number
  capacity?: string
}

function Indexes({ table }: { table: TableDescription }) {
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const update = useUpdateTable(table, 'Index deleted')
  const rows: IndexRow[] = [
    ...(table.GlobalSecondaryIndexes ?? []).map((i): IndexRow => ({
      name: i.IndexName!, kind: 'Global', ...keysOf(i.KeySchema), status: i.IndexStatus, items: i.ItemCount, size: i.IndexSizeBytes,
      projection: projectionText(i.Projection?.ProjectionType, i.Projection?.NonKeyAttributes),
      capacity: isOnDemand(table) ? 'On-demand' : `${i.ProvisionedThroughput?.ReadCapacityUnits} RCU / ${i.ProvisionedThroughput?.WriteCapacityUnits} WCU`,
    })),
    ...(table.LocalSecondaryIndexes ?? []).map((i): IndexRow => ({
      name: i.IndexName!, kind: 'Local', ...keysOf(i.KeySchema), status: 'ACTIVE', items: i.ItemCount, size: i.IndexSizeBytes,
      projection: projectionText(i.Projection?.ProjectionType, i.Projection?.NonKeyAttributes),
    })),
  ]
  const keyCell = (n?: string) => (n ? <span className="inline-flex items-center gap-1.5"><code className="text-xs">{n}</code> <Badge>{typeLabel(attrType(table, n))}</Badge></span> : '—')

  return (
    <>
      <Panel title="Secondary indexes" description="Global indexes can be added and removed at any time; local indexes are fixed when the table is created."
        flush actions={<Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>Create global index</Button>}>
        <DataTable
          rows={rows}
          rowKey={(r) => r.name}
          empty={<Empty title="No indexes" icon={<Layers />}>Add a global secondary index to query by other attributes.</Empty>}
          columns={[
            { header: 'Name', render: (r) => <span className="font-medium">{r.name}</span> },
            { header: 'Type', className: 'w-24', render: (r) => <Badge tone={r.kind === 'Global' ? 'blue' : 'neutral'}>{r.kind}</Badge> },
            { header: 'Partition key', render: (r) => keyCell(r.hash) },
            { header: 'Sort key', render: (r) => keyCell(r.range) },
            { header: 'Projection', render: (r) => r.projection },
            { header: 'Status', className: 'w-24', render: (r) => <Badge tone="green">{r.status}</Badge> },
            { header: 'Items', className: 'w-20 tabular-nums', render: (r) => r.items?.toLocaleString() },
            { header: 'Capacity', className: 'text-muted-foreground', render: (r) => r.capacity ?? 'Shared with table' },
            { header: '', className: 'w-14 text-right', render: (r) => r.kind === 'Global' && (
              <IconButton label={`Delete ${r.name}`} onClick={() => setDeleting(r.name)}><Trash2 /></IconButton>
            ) },
          ]}
        />
      </Panel>
      {creating && <CreateIndex table={table} onClose={() => setCreating(false)} />}
      {deleting && (
        <Confirm title={`Delete index ${deleting}?`} loading={update.isPending}
          onConfirm={() => update.mutate({ GlobalSecondaryIndexUpdates: [{ Delete: { IndexName: deleting } }] }, { onSuccess: () => setDeleting(null) })}
          onClose={() => setDeleting(null)}>
          <p>Queries that use this index will fail. Table items are not affected.</p>
        </Confirm>
      )}
    </>
  )
}

function projectionText(type?: string, attrs?: string[]) {
  if (type === 'INCLUDE') return `Include: ${attrs?.join(', ')}`
  return type === 'KEYS_ONLY' ? 'Keys only' : 'All attributes'
}

function CreateIndex({ table, onClose }: { table: TableDescription; onClose: () => void }) {
  const [name, setName] = useState('')
  const [hash, setHash] = useState('')
  const [hashType, setHashType] = useState('S')
  const [range, setRange] = useState('')
  const [rangeType, setRangeType] = useState('S')
  const [projection, setProjection] = useState<ProjectionType>('ALL')
  const [include, setInclude] = useState('')
  const [rcu, setRcu] = useState('5')
  const [wcu, setWcu] = useState('5')
  const update = useUpdateTable(table, `Created index ${name}`)
  const defined = (n: string) => table.AttributeDefinitions?.find((d) => d.AttributeName === n)?.AttributeType
  const conflict = [[hash, hashType], [range, rangeType]].find(([n, t]) => n && defined(n) && defined(n) !== t)
  const valid = /^[A-Za-z0-9_.-]{3,255}$/.test(name) && !!hash.trim() && !conflict && (projection !== 'INCLUDE' || !!include.trim())

  const submit = () => {
    const attrs = [[hash.trim(), hashType], ...(range.trim() ? [[range.trim(), rangeType]] : [])]
    update.mutate({
      AttributeDefinitions: attrs.map(([AttributeName, AttributeType]) => ({ AttributeName, AttributeType: AttributeType as ScalarAttributeType })),
      GlobalSecondaryIndexUpdates: [{
        Create: {
          IndexName: name,
          KeySchema: [{ AttributeName: hash.trim(), KeyType: 'HASH' }, ...(range.trim() ? [{ AttributeName: range.trim(), KeyType: 'RANGE' as const }] : [])],
          Projection: { ProjectionType: projection, NonKeyAttributes: projection === 'INCLUDE' ? include.split(',').map((s) => s.trim()).filter(Boolean) : undefined },
          ProvisionedThroughput: isOnDemand(table) ? undefined : { ReadCapacityUnits: Number(rcu), WriteCapacityUnits: Number(wcu) },
        },
      }],
    }, { onSuccess: onClose })
  }

  return (
    <Modal title="Create global secondary index" onClose={onClose} footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button variant="primary" disabled={!valid} loading={update.isPending} onClick={submit}>Create index</Button>
    </>}>
      <div className="flex flex-col gap-5">
        <Field label="Index name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="by-customer" /></Field>
        <KeyInput label="Partition key" name={hash} type={hashType} onName={setHash} onType={setHashType} />
        <KeyInput label="Sort key" name={range} type={rangeType} onName={setRange} onType={setRangeType} optional />
        {conflict && <span className="text-sm text-destructive">{conflict[0]} is already defined as {typeLabel(defined(conflict[0])!)}.</span>}
        <Field label="Projected attributes">
          <Select className="w-full" value={projection} onChange={(e) => setProjection(e.target.value as ProjectionType)}>
            <Option value="ALL">All attributes</Option>
            <Option value="KEYS_ONLY">Keys only</Option>
            <Option value="INCLUDE">Keys and selected attributes</Option>
          </Select>
        </Field>
        {projection === 'INCLUDE' && (
          <Field label="Attributes to include" hint="Comma-separated names">
            <Input value={include} onChange={(e) => setInclude(e.target.value)} placeholder="status, total" />
          </Field>
        )}
        {!isOnDemand(table) && (
          <div className="grid grid-cols-2 gap-5">
            <Field label="Read capacity units"><Input type="number" min={1} value={rcu} onChange={(e) => setRcu(e.target.value)} /></Field>
            <Field label="Write capacity units"><Input type="number" min={1} value={wcu} onChange={(e) => setWcu(e.target.value)} /></Field>
          </div>
        )}
      </div>
    </Modal>
  )
}

// Settings.

function Settings({ table: t }: { table: TableDescription }) {
  return (
    <div className="flex flex-col gap-6">
      <Panel title="Overview">
        <KeyValue items={[
          ['ARN', <Mono copy>{t.TableArn}</Mono>],
          ['Table ID', <Mono>{t.TableId}</Mono>],
          ['Created', formatDate(t.CreationDateTime)],
          ['Partition key', `${keysOf(t.KeySchema).hash} (${typeLabel(attrType(t, keysOf(t.KeySchema).hash))})`],
          ['Sort key', keysOf(t.KeySchema).range ? `${keysOf(t.KeySchema).range} (${typeLabel(attrType(t, keysOf(t.KeySchema).range))})` : '—'],
          ['Items', t.ItemCount?.toLocaleString()],
          ['Size', formatBytes(t.TableSizeBytes)],
          ['Table class', t.TableClassSummary?.TableClass ?? 'STANDARD'],
          ['Encryption', t.SSEDescription?.Status === 'ENABLED' ? `KMS (${t.SSEDescription.KMSMasterKeyArn})` : 'Owned by DynamoDB'],
        ]} />
      </Panel>
      <div className="grid gap-6 lg:grid-cols-2">
        <Capacity table={t} />
        <TimeToLive table={t} />
        <Stream table={t} />
        <Protection table={t} />
      </div>
    </div>
  )
}

function Capacity({ table }: { table: TableDescription }) {
  const onDemand = isOnDemand(table)
  const [mode, setMode] = useState(onDemand ? 'PAY_PER_REQUEST' : 'PROVISIONED')
  const [rcu, setRcu] = useState(String(table.ProvisionedThroughput?.ReadCapacityUnits || 5))
  const [wcu, setWcu] = useState(String(table.ProvisionedThroughput?.WriteCapacityUnits || 5))
  const update = useUpdateTable(table, 'Capacity updated')
  useEffect(() => {
    setMode(onDemand ? 'PAY_PER_REQUEST' : 'PROVISIONED')
    setRcu(String(table.ProvisionedThroughput?.ReadCapacityUnits || 5))
    setWcu(String(table.ProvisionedThroughput?.WriteCapacityUnits || 5))
  }, [table, onDemand])
  const dirty = mode !== (onDemand ? 'PAY_PER_REQUEST' : 'PROVISIONED') ||
    (mode === 'PROVISIONED' && (Number(rcu) !== table.ProvisionedThroughput?.ReadCapacityUnits || Number(wcu) !== table.ProvisionedThroughput?.WriteCapacityUnits))
  const gsis = table.GlobalSecondaryIndexes ?? []

  const save = () => update.mutate(mode === 'PAY_PER_REQUEST' ? { BillingMode: 'PAY_PER_REQUEST' } : {
    BillingMode: 'PROVISIONED',
    ProvisionedThroughput: { ReadCapacityUnits: Number(rcu), WriteCapacityUnits: Number(wcu) },
    // Switching to provisioned needs capacity for every global index too.
    GlobalSecondaryIndexUpdates: onDemand && gsis.length
      ? gsis.map((g) => ({ Update: { IndexName: g.IndexName, ProvisionedThroughput: { ReadCapacityUnits: Number(rcu), WriteCapacityUnits: Number(wcu) } } }))
      : undefined,
  })

  return (
    <Panel title="Capacity" description={billingLabel(table)} actions={dirty && <Button variant="primary" loading={update.isPending} onClick={save}>Save</Button>}>
      <div className="flex flex-col gap-5">
        <Field label="Capacity mode">
          <Select className="w-full" value={mode} onChange={(e) => setMode(e.target.value)}>
            <Option value="PAY_PER_REQUEST">On-demand</Option>
            <Option value="PROVISIONED">Provisioned</Option>
          </Select>
        </Field>
        {mode === 'PROVISIONED' && (
          <div className="grid grid-cols-2 gap-5">
            <Field label="Read capacity units"><Input type="number" min={1} value={rcu} onChange={(e) => setRcu(e.target.value)} /></Field>
            <Field label="Write capacity units"><Input type="number" min={1} value={wcu} onChange={(e) => setWcu(e.target.value)} /></Field>
          </div>
        )}
      </div>
    </Panel>
  )
}

function TimeToLive({ table }: { table: TableDescription }) {
  const { clients } = useSettings()
  const ttl = useQuery({
    queryKey: ['dynamodb', 'ttl', table.TableName],
    queryFn: async () => (await clients.dynamodb.send(new DescribeTimeToLiveCommand({ TableName: table.TableName }))).TimeToLiveDescription,
  })
  const [attr, setAttr] = useState('expires_at')
  const set = useAction(
    (Enabled: boolean) => clients.dynamodb.send(new UpdateTimeToLiveCommand({
      TableName: table.TableName, TimeToLiveSpecification: { Enabled, AttributeName: Enabled ? attr : ttl.data?.AttributeName },
    })),
    { invalidate: [['dynamodb', 'ttl', table.TableName]], success: 'Time to live updated' },
  )
  const enabled = ttl.data?.TimeToLiveStatus === 'ENABLED'
  return (
    <Panel title="Time to live" description="may stores the setting; it does not delete expired items."
      actions={ttl.isSuccess && (enabled
        ? <Button loading={set.isPending} onClick={() => set.mutate(false)}>Turn off</Button>
        : <Button variant="primary" disabled={!attr.trim()} loading={set.isPending} onClick={() => set.mutate(true)}>Turn on</Button>)}>
      {ttl.isLoading ? <Spinner /> : ttl.isError ? <ErrorBox error={ttl.error} /> : enabled ? (
        <KeyValue items={[['Status', <Badge tone="green">Enabled</Badge>], ['Attribute', <Mono>{ttl.data?.AttributeName}</Mono>]]} />
      ) : (
        <Field label="Expiry attribute" hint="A Number attribute holding a Unix timestamp in seconds.">
          <Input value={attr} onChange={(e) => setAttr(e.target.value)} />
        </Field>
      )}
    </Panel>
  )
}

function Stream({ table }: { table: TableDescription }) {
  const update = useUpdateTable(table, 'Stream updated')
  const [view, setView] = useState<StreamViewType>('NEW_AND_OLD_IMAGES')
  const enabled = table.StreamSpecification?.StreamEnabled
  return (
    <Panel title="Stream" description="may reports stream settings but produces no stream records."
      actions={enabled
        ? <Button loading={update.isPending} onClick={() => update.mutate({ StreamSpecification: { StreamEnabled: false } })}>Turn off</Button>
        : <Button variant="primary" loading={update.isPending} onClick={() => update.mutate({ StreamSpecification: { StreamEnabled: true, StreamViewType: view } })}>Turn on</Button>}>
      {enabled ? (
        <KeyValue items={[
          ['View type', table.StreamSpecification?.StreamViewType],
          ['Stream ARN', <Mono copy>{table.LatestStreamArn}</Mono>],
        ]} />
      ) : (
        <Field label="View type">
          <Select className="w-full" value={view} onChange={(e) => setView(e.target.value as StreamViewType)}>
            <Option value="NEW_AND_OLD_IMAGES">New and old images</Option>
            <Option value="NEW_IMAGE">New image</Option>
            <Option value="OLD_IMAGE">Old image</Option>
            <Option value="KEYS_ONLY">Keys only</Option>
          </Select>
        </Field>
      )}
    </Panel>
  )
}

function Protection({ table }: { table: TableDescription }) {
  const { clients } = useSettings()
  const update = useUpdateTable(table, 'Deletion protection updated')
  const pitr = useQuery({
    queryKey: ['dynamodb', 'pitr', table.TableName],
    queryFn: async () => (await clients.dynamodb.send(new DescribeContinuousBackupsCommand({ TableName: table.TableName })))
      .ContinuousBackupsDescription?.PointInTimeRecoveryDescription?.PointInTimeRecoveryStatus,
  })
  const setPitr = useAction(
    (on: boolean) => clients.dynamodb.send(new UpdateContinuousBackupsCommand({
      TableName: table.TableName, PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: on },
    })),
    { invalidate: [['dynamodb', 'pitr', table.TableName]], success: 'Point-in-time recovery updated' },
  )
  const protectedOn = !!table.DeletionProtectionEnabled
  const pitrOn = pitr.data === 'ENABLED'
  return (
    <Panel title="Protection">
      <div className="flex flex-col gap-4 text-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-medium">Deletion protection</div>
            <div className="text-muted-foreground">Blocks DeleteTable while on.</div>
          </div>
          <Button loading={update.isPending} onClick={() => update.mutate({ DeletionProtectionEnabled: !protectedOn })}>
            {protectedOn ? 'Turn off' : 'Turn on'}
          </Button>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-medium">Point-in-time recovery {pitr.isSuccess && <Badge tone={pitrOn ? 'green' : 'neutral'}>{pitrOn ? 'On' : 'Off'}</Badge>}</div>
            <div className="text-muted-foreground">Stored setting only; may keeps no backups.</div>
          </div>
          <Button disabled={!pitr.isSuccess} loading={setPitr.isPending} onClick={() => setPitr.mutate(!pitrOn)}>{pitrOn ? 'Turn off' : 'Turn on'}</Button>
        </div>
      </div>
    </Panel>
  )
}

function Tags({ table }: { table: TableDescription }) {
  const { clients } = useSettings()
  const arn = table.TableArn!
  const tags = useQuery({
    queryKey: ['dynamodb', 'tags', arn],
    queryFn: async () => (await clients.dynamodb.send(new ListTagsOfResourceCommand({ ResourceArn: arn }))).Tags ?? [],
  })
  const save = useAction(
    async (next: { Key: string; Value: string }[]) => {
      const removed = (tags.data ?? []).map((t) => t.Key!).filter((k) => !next.some((n) => n.Key === k))
      if (removed.length) await clients.dynamodb.send(new UntagResourceCommand({ ResourceArn: arn, TagKeys: removed }))
      if (next.length) await clients.dynamodb.send(new TagResourceCommand({ ResourceArn: arn, Tags: next }))
    },
    { invalidate: [['dynamodb', 'tags', arn]], success: 'Tags saved' },
  )
  return (
    <Panel title="Tags">
      {tags.isLoading ? <Spinner /> : tags.isError ? <ErrorBox error={tags.error} /> : (
        <TagsEditor tags={tags.data} saving={save.isPending} onSave={(t) => save.mutate(t)} />
      )}
    </Panel>
  )
}
