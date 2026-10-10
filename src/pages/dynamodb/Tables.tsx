import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CreateTableCommand, DeleteTableCommand, type AttributeDefinition, type KeySchemaElement, type ScalarAttributeType,
  type TableDescription,
} from '@aws-sdk/client-dynamodb'
import { Plus, Table2, Trash2 } from 'lucide-react'
import { useSettings } from '@/lib/settings'
import { useAction } from '@/lib/hooks'
import { formatBytes } from '@/lib/format'
import { billingLabel, keysOf, tableNamePattern, typeLabel, attrType, useTables } from '@/lib/dynamodb'
import {
  Badge, Button, Confirm, Empty, Field, IconButton, Input, Modal, NameCell, Option, PageHeader, Panel, RefreshButton,
  Select, Table,
} from '@/components/common'

export default function Tables() {
  const { clients } = useSettings()
  const tables = useTables()
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const del = useAction(
    async (TableName: string) => {
      await clients.dynamodb.send(new DeleteTableCommand({ TableName }))
      return TableName
    },
    { invalidate: [['dynamodb'], ['count']], success: (n) => `Deleted table ${n}`, onSuccess: () => setDeleting(null) },
  )

  return (
    <>
      <PageHeader
        title="DynamoDB tables"
        description="Key-value and document tables compatible with the Amazon DynamoDB API."
        actions={<>
          <RefreshButton onClick={() => tables.refetch()} spinning={tables.isFetching} />
          <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>Create table</Button>
        </>}
      />
      <Panel flush>
        <Table
          rows={tables.data}
          loading={tables.isLoading}
          error={tables.error}
          onRetry={() => tables.refetch()}
          rowKey={(t) => t.TableName!}
          filterPlaceholder="Find tables by name"
          empty={<Empty title="No tables" icon={<Table2 />}>Create a table to start storing items.</Empty>}
          columns={[
            { header: 'Name', text: (t) => t.TableName!, render: (t) => (
              <NameCell icon={<Table2 />} to={`/dynamodb/${encodeURIComponent(t.TableName!)}`}>{t.TableName}</NameCell>
            ) },
            { header: 'Status', className: 'w-28', render: (t) => <Badge tone={t.TableStatus === 'ACTIVE' ? 'green' : 'amber'}>{t.TableStatus}</Badge> },
            { header: 'Partition key', render: (t) => keyCell(t, keysOf(t.KeySchema).hash) },
            { header: 'Sort key', render: (t) => keyCell(t, keysOf(t.KeySchema).range) },
            { header: 'Indexes', className: 'w-20 tabular-nums', render: (t) => (t.GlobalSecondaryIndexes?.length ?? 0) + (t.LocalSecondaryIndexes?.length ?? 0) },
            { header: 'Items', className: 'w-20 tabular-nums', render: (t) => t.ItemCount?.toLocaleString() },
            { header: 'Size', className: 'w-24 tabular-nums', render: (t) => formatBytes(t.TableSizeBytes) },
            { header: 'Capacity', className: 'w-56 text-muted-foreground', render: (t) => billingLabel(t) },
            { header: '', className: 'w-14 text-right', render: (t) => (
              <IconButton label={`Delete ${t.TableName}`} onClick={() => setDeleting(t.TableName!)}><Trash2 /></IconButton>
            ) },
          ]}
        />
      </Panel>
      {creating && <CreateTable onClose={() => setCreating(false)} />}
      {deleting && (
        <Confirm title={`Delete table ${deleting}?`} confirmText={deleting} loading={del.isPending}
          onConfirm={() => del.mutate(deleting)} onClose={() => setDeleting(null)}>
          <p>The table, its indexes and all of its items are deleted. This cannot be undone.</p>
        </Confirm>
      )}
    </>
  )
}

function keyCell(t: TableDescription, name: string | undefined) {
  if (!name) return <span className="text-muted-foreground">—</span>
  return <span className="inline-flex items-center gap-1.5"><code className="text-xs">{name}</code> <Badge>{typeLabel(attrType(t, name))}</Badge></span>
}

export function KeyInput({ label, name, type, onName, onType, optional }: {
  label: string
  name: string
  type: string
  onName: (v: string) => void
  onType: (v: string) => void
  optional?: boolean
}) {
  return (
    <div className="grid grid-cols-[1fr_8rem] items-end gap-2">
      <Field label={label} hint={optional ? 'Optional. Items with the same partition key are sorted by it.' : undefined}>
        <Input value={name} onChange={(e) => onName(e.target.value)} placeholder={optional ? 'sk' : 'pk'} />
      </Field>
      <Field label="Type" hint={optional ? ' ' : undefined}>
        <Select className="w-full" value={type} onChange={(e) => onType(e.target.value)}>
          <Option value="S">String</Option>
          <Option value="N">Number</Option>
          <Option value="B">Binary</Option>
        </Select>
      </Field>
    </div>
  )
}

function CreateTable({ onClose }: { onClose: () => void }) {
  const { clients } = useSettings()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [hash, setHash] = useState('pk')
  const [hashType, setHashType] = useState('S')
  const [range, setRange] = useState('')
  const [rangeType, setRangeType] = useState('S')
  const [mode, setMode] = useState<'PAY_PER_REQUEST' | 'PROVISIONED'>('PAY_PER_REQUEST')
  const [rcu, setRcu] = useState('5')
  const [wcu, setWcu] = useState('5')
  const valid = tableNamePattern.test(name) && !!hash.trim() && range.trim() !== hash.trim()

  const create = useAction(
    () => {
      const KeySchema: KeySchemaElement[] = [{ AttributeName: hash.trim(), KeyType: 'HASH' }]
      const AttributeDefinitions: AttributeDefinition[] = [{ AttributeName: hash.trim(), AttributeType: hashType as ScalarAttributeType }]
      if (range.trim()) {
        KeySchema.push({ AttributeName: range.trim(), KeyType: 'RANGE' })
        AttributeDefinitions.push({ AttributeName: range.trim(), AttributeType: rangeType as ScalarAttributeType })
      }
      return clients.dynamodb.send(new CreateTableCommand({
        TableName: name, KeySchema, AttributeDefinitions, BillingMode: mode,
        ProvisionedThroughput: mode === 'PROVISIONED' ? { ReadCapacityUnits: Number(rcu), WriteCapacityUnits: Number(wcu) } : undefined,
      }))
    },
    { invalidate: [['dynamodb'], ['count']], success: `Created table ${name}`, onSuccess: () => navigate(`/dynamodb/${encodeURIComponent(name)}`) },
  )
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (valid) create.mutate(undefined)
  }

  return (
    <Modal title="Create table" description="Indexes can be added after the table is created." onClose={onClose} footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button variant="primary" type="submit" form="create-table" disabled={!valid} loading={create.isPending}>Create table</Button>
    </>}>
      <form id="create-table" className="flex flex-col gap-5" onSubmit={submit}>
        <Field label="Table name" error={name && !tableNamePattern.test(name) ? '3–255 characters: letters, numbers, underscores, hyphens and dots.' : null}>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="orders" />
        </Field>
        <KeyInput label="Partition key" name={hash} type={hashType} onName={setHash} onType={setHashType} />
        <KeyInput label="Sort key" name={range} type={rangeType} onName={setRange} onType={setRangeType} optional />
        <Field label="Capacity mode">
          <Select className="w-full" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
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
      </form>
    </Modal>
  )
}
