import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BatchWriteItemCommand, QueryCommand, ScanCommand, type AttributeValue, type TableDescription,
} from '@aws-sdk/client-dynamodb'
import { ChevronsDown, Play, Plus, Rows3, Trash2 } from 'lucide-react'
import { useSettings } from '@/lib/settings'
import { useAction } from '@/lib/hooks'
import { attrType, avText, avType, itemKey, itemKeyString, keysOf, keyValue, typeLabel, type Item, type Keys } from '@/lib/dynamodb'
import {
  Badge, Button, Confirm, Empty, Field, IconButton, Input, NameCell, Option, Panel, Select, Table,
} from '@/components/common'
import ItemEditor from './ItemEditor'

type KeyOp = '' | '=' | '<' | '<=' | '>' | '>=' | 'between' | 'begins_with'
type FilterOp = '=' | '<>' | '<' | '<=' | '>' | '>=' | 'begins_with' | 'contains' | 'exists' | 'not_exists'
type FilterType = 'S' | 'N' | 'BOOL' | 'NULL'

interface Filter {
  name: string
  op: FilterOp
  type: FilterType
  value: string
}

interface Results {
  items: Item[]
  count: number
  scanned: number
  lastKey?: Item
}

const MAX_COLUMNS = 14

function filterValue(f: Filter): AttributeValue {
  switch (f.type) {
    case 'N': return { N: f.value }
    case 'BOOL': return { BOOL: f.value === 'true' }
    case 'NULL': return { NULL: true }
    default: return { S: f.value }
  }
}

export default function Items({ table }: { table: TableDescription }) {
  const { clients } = useSettings()
  const tableKeys = keysOf(table.KeySchema)
  const indexes = [...(table.GlobalSecondaryIndexes ?? []), ...(table.LocalSecondaryIndexes ?? [])]

  const [mode, setMode] = useState<'scan' | 'query'>('scan')
  const [index, setIndex] = useState('')
  const [hashValue, setHashValue] = useState('')
  const [rangeOp, setRangeOp] = useState<KeyOp>('')
  const [rangeValue, setRangeValue] = useState('')
  const [rangeValue2, setRangeValue2] = useState('')
  const [forward, setForward] = useState(true)
  const [filters, setFilters] = useState<Filter[]>([])
  const [pageSize, setPageSize] = useState('50')
  const [results, setResults] = useState<Results | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<Item | 'new' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const ix = indexes.find((i) => i.IndexName === index)
  const keys: Keys = ix ? keysOf(ix.KeySchema) : tableKeys
  const hashType = attrType(table, keys.hash)
  const rangeType = attrType(table, keys.range)

  const filterError = filters.find((f) => !f.name.trim() || (f.op !== 'exists' && f.op !== 'not_exists' && f.type !== 'NULL' && f.type !== 'BOOL' && !f.value)
    || (f.type === 'N' && f.value && Number.isNaN(Number(f.value))))
  const queryError = mode === 'query' && (!hashValue || (rangeOp && !rangeValue) || (rangeOp === 'between' && !rangeValue2))
  const canRun = !filterError && !queryError

  const fetchPage = async (startKey?: Item): Promise<Results> => {
    const names: Record<string, string> = {}
    const values: Record<string, AttributeValue> = {}
    const name = (n: string) => {
      const k = `#a${Object.keys(names).length}`
      names[k] = n
      return k
    }
    const value = (v: AttributeValue) => {
      const k = `:v${Object.keys(values).length}`
      values[k] = v
      return k
    }
    const conds = filters.map((f) => {
      const a = name(f.name.trim())
      switch (f.op) {
        case 'exists': return `attribute_exists(${a})`
        case 'not_exists': return `attribute_not_exists(${a})`
        case 'begins_with': case 'contains': return `${f.op}(${a}, ${value(filterValue(f))})`
        default: return `${a} ${f.op} ${value(filterValue(f))}`
      }
    })
    const common = {
      TableName: table.TableName,
      IndexName: index || undefined,
      Limit: Number(pageSize),
      ExclusiveStartKey: startKey,
      FilterExpression: conds.length ? conds.join(' AND ') : undefined,
    }
    let out
    if (mode === 'query') {
      let kc = `${name(keys.hash)} = ${value(keyValue(hashType, hashValue))}`
      if (rangeOp && keys.range) {
        const r = name(keys.range)
        const v = value(keyValue(rangeType, rangeValue))
        kc += rangeOp === 'between' ? ` AND ${r} BETWEEN ${v} AND ${value(keyValue(rangeType, rangeValue2))}`
          : rangeOp === 'begins_with' ? ` AND begins_with(${r}, ${v})` : ` AND ${r} ${rangeOp} ${v}`
      }
      out = await clients.dynamodb.send(new QueryCommand({
        ...common, KeyConditionExpression: kc, ScanIndexForward: forward,
        ExpressionAttributeNames: names, ExpressionAttributeValues: Object.keys(values).length ? values : undefined,
      }))
    } else {
      out = await clients.dynamodb.send(new ScanCommand({
        ...common,
        ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
        ExpressionAttributeValues: Object.keys(values).length ? values : undefined,
      }))
    }
    return { items: (out.Items ?? []) as Item[], count: out.Count ?? 0, scanned: out.ScannedCount ?? 0, lastKey: out.LastEvaluatedKey as Item | undefined }
  }

  // Whether the running request continues the current results ("Load more").
  const runMore = useRef(false)
  const run = useAction((startKey: Item | undefined) => fetchPage(startKey), {
    onSuccess: (page) => setResults((prev) => (prev && runMore.current
      ? { items: [...prev.items, ...page.items], count: prev.count + page.count, scanned: prev.scanned + page.scanned, lastKey: page.lastKey }
      : page)),
  })
  const go = (more: boolean) => {
    runMore.current = more
    if (!more) setSelected(new Set())
    run.mutate(more ? results?.lastKey : undefined)
  }

  // Load the first page when the table opens and whenever the target changes.
  useEffect(() => {
    if (mode === 'scan') go(false)
    else setResults(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table.TableName, index, mode])

  const remove = useAction(
    async (rows: Item[]) => {
      for (let i = 0; i < rows.length; i += 25) {
        await clients.dynamodb.send(new BatchWriteItemCommand({
          RequestItems: { [table.TableName!]: rows.slice(i, i + 25).map((r) => ({ DeleteRequest: { Key: itemKey(r, tableKeys) } })) },
        }))
      }
      return rows.length
    },
    {
      invalidate: [['dynamodb']],
      success: (n) => `Deleted ${n} item${n === 1 ? '' : 's'}`,
      onSuccess: () => {
        setConfirmDelete(false)
        go(false)
      },
    },
  )

  const columns = useMemo(() => {
    const first = [tableKeys.hash, tableKeys.range, keys.hash, keys.range].filter((k, i, a): k is string => !!k && a.indexOf(k) === i)
    const rest = new Set<string>()
    for (const it of results?.items ?? []) Object.keys(it).forEach((k) => !first.includes(k) && rest.add(k))
    const all = [...first, ...[...rest].sort()]
    return { shown: all.slice(0, MAX_COLUMNS), hidden: Math.max(0, all.length - MAX_COLUMNS) }
  }, [results, tableKeys.hash, tableKeys.range, keys.hash, keys.range])

  const selectedItems = (results?.items ?? []).filter((it) => selected.has(itemKeyString(it, tableKeys)))
  const setFilter = (i: number, patch: Partial<Filter>) => setFilters(filters.map((f, j) => (j === i ? { ...f, ...patch } : f)))
  const projected = ix && ix.Projection?.ProjectionType !== 'ALL'

  return (
    <div className="flex flex-col gap-6">
      <Panel title="Explore items" actions={
        <Button variant="primary" icon={<Play />} disabled={!canRun} loading={run.isPending && !runMore.current} onClick={() => go(false)}>Run</Button>
      }>
        <div className="flex flex-col gap-5">
          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="Operation">
              <Select className="w-full" value={mode} onChange={(e) => setMode(e.target.value as 'scan' | 'query')}>
                <Option value="scan">Scan</Option>
                <Option value="query">Query</Option>
              </Select>
            </Field>
            <Field label="Table or index">
              <Select className="w-full" value={index} onChange={(e) => { setIndex(e.target.value); setRangeOp('') }}>
                <Option value="">Table: {table.TableName}</Option>
                {indexes.map((i) => <Option key={i.IndexName} value={i.IndexName}>Index: {i.IndexName}</Option>)}
              </Select>
            </Field>
            <Field label="Page size">
              <Select className="w-full" value={pageSize} onChange={(e) => setPageSize(e.target.value)}>
                {['25', '50', '100', '300'].map((n) => <Option key={n} value={n}>{n}</Option>)}
              </Select>
            </Field>
          </div>

          {mode === 'query' && (
            <div className="grid gap-5 sm:grid-cols-3">
              <Field label={<>{keys.hash} <Badge>{typeLabel(hashType)}</Badge></>} hint="Partition key (equals)">
                <Input value={hashValue} onChange={(e) => setHashValue(e.target.value)} placeholder="Value" />
              </Field>
              {keys.range ? <>
                <Field label={<>{keys.range} <Badge>{typeLabel(rangeType)}</Badge></>} hint="Sort key condition">
                  <div className="grid grid-cols-[8rem_1fr] gap-2">
                    <Select className="w-full" value={rangeOp} onChange={(e) => setRangeOp(e.target.value as KeyOp)}>
                      <Option value="">Any</Option>
                      {['=', '<', '<=', '>', '>='].map((o) => <Option key={o} value={o}>{o}</Option>)}
                      <Option value="between">Between</Option>
                      {rangeType !== 'N' && <Option value="begins_with">Begins with</Option>}
                    </Select>
                    <Input value={rangeValue} disabled={!rangeOp} onChange={(e) => setRangeValue(e.target.value)} placeholder="Value" />
                  </div>
                </Field>
                {rangeOp === 'between'
                  ? <Field label="And"><Input value={rangeValue2} onChange={(e) => setRangeValue2(e.target.value)} placeholder="Value" /></Field>
                  : <Field label="Sort order">
                    <Select className="w-full" value={forward ? 'asc' : 'desc'} onChange={(e) => setForward(e.target.value === 'asc')}>
                      <Option value="asc">Ascending</Option>
                      <Option value="desc">Descending</Option>
                    </Select>
                  </Field>}
              </> : null}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Filters</span>
            {filters.map((f, i) => (
              <div key={i} className="grid grid-cols-[1fr_9rem_7rem_1fr_2rem] items-center gap-2">
                <Input value={f.name} placeholder="Attribute name" aria-invalid={!f.name.trim()} onChange={(e) => setFilter(i, { name: e.target.value })} />
                <Select className="w-full" value={f.op} onChange={(e) => setFilter(i, { op: e.target.value as FilterOp })}>
                  {['=', '<>', '<', '<=', '>', '>='].map((o) => <Option key={o} value={o}>{o}</Option>)}
                  <Option value="begins_with">Begins with</Option>
                  <Option value="contains">Contains</Option>
                  <Option value="exists">Exists</Option>
                  <Option value="not_exists">Not exists</Option>
                </Select>
                <Select className="w-full" value={f.type} disabled={f.op === 'exists' || f.op === 'not_exists'}
                  onChange={(e) => setFilter(i, { type: e.target.value as FilterType })}>
                  <Option value="S">String</Option>
                  <Option value="N">Number</Option>
                  <Option value="BOOL">Boolean</Option>
                  <Option value="NULL">Null</Option>
                </Select>
                {f.type === 'BOOL' ? (
                  <Select className="w-full" value={f.value || 'true'} disabled={f.op === 'exists' || f.op === 'not_exists'}
                    onChange={(e) => setFilter(i, { value: e.target.value })}>
                    <Option value="true">true</Option>
                    <Option value="false">false</Option>
                  </Select>
                ) : (
                  <Input value={f.value} placeholder="Value" disabled={f.op === 'exists' || f.op === 'not_exists' || f.type === 'NULL'}
                    onChange={(e) => setFilter(i, { value: e.target.value })} />
                )}
                <IconButton label="Remove filter" onClick={() => setFilters(filters.filter((_, j) => j !== i))}><Trash2 /></IconButton>
              </div>
            ))}
            <div>
              <Button icon={<Plus />} onClick={() => setFilters([...filters, { name: '', op: '=', type: 'S', value: '' }])}>Add filter</Button>
            </div>
          </div>
        </div>
      </Panel>

      <Panel flush title={results ? <span className="flex items-center gap-2">Items
        <Badge>{results.count.toLocaleString()} returned</Badge>
        {results.scanned !== results.count && <Badge>{results.scanned.toLocaleString()} scanned</Badge>}
      </span> : 'Items'}
        description={projected ? `Index ${index} projects ${ix?.Projection?.ProjectionType === 'KEYS_ONLY' ? 'only key attributes' : 'some attributes'}; open an item to see all of it.` : undefined}
        actions={<>
          <Button variant="danger" icon={<Trash2 />} disabled={!selected.size} onClick={() => setConfirmDelete(true)}>Delete</Button>
          <Button variant="primary" icon={<Plus />} onClick={() => setEditing('new')}>Create item</Button>
        </>}>
        <Table
          rows={results?.items}
          loading={run.isPending && !results}
          error={run.error}
          onRetry={() => go(false)}
          rowKey={(it) => itemKeyString(it, tableKeys)}
          selectable
          selected={selected}
          onSelect={setSelected}
          empty={results
            ? <Empty title="No items found" icon={<Rows3 />}>{mode === 'query' || filters.length ? 'Nothing matches these conditions.' : 'This table is empty.'}</Empty>
            : <Empty title="Run a query" icon={<Rows3 />}>Enter a partition key value and press Run.</Empty>}
          columns={[
            ...columns.shown.map((c, ci) => ({
              header: <span className="inline-flex items-center gap-1">{c}{c === tableKeys.hash || c === tableKeys.range ? <Badge tone="blue">key</Badge> : null}</span>,
              className: 'max-w-64',
              render: (it: Item) => {
                const text = avText(it[c])
                const cell = it[c] === undefined ? <span className="text-muted-foreground/50">—</span>
                  : <span className="block truncate font-mono text-xs" title={`${avType(it[c])}: ${text}`}>{text === '' ? '""' : text}</span>
                return ci === 0 ? <NameCell onClick={() => setEditing(it)}>{cell}</NameCell> : cell
              },
            })),
            ...(columns.hidden ? [{ header: <span className="text-muted-foreground">+{columns.hidden} more</span>, render: () => null }] : []),
          ]}
        />
        {results?.lastKey && (
          <div className="flex justify-center border-t p-3">
            <Button icon={<ChevronsDown />} loading={run.isPending && runMore.current} onClick={() => go(true)}>Load more</Button>
          </div>
        )}
      </Panel>

      {editing && (
        <ItemEditor table={table} item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)} onSaved={() => go(false)} />
      )}
      {confirmDelete && (
        <Confirm title={`Delete ${selectedItems.length} item${selectedItems.length === 1 ? '' : 's'}?`} loading={remove.isPending}
          onConfirm={() => remove.mutate(selectedItems)} onClose={() => setConfirmDelete(false)}>
          <p>The selected items are permanently deleted from {table.TableName}.</p>
        </Confirm>
      )}
    </div>
  )
}
