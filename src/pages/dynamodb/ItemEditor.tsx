import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DeleteItemCommand, GetItemCommand, PutItemCommand, type TableDescription } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { Trash2 } from 'lucide-react'
import { useSettings } from '@/lib/settings'
import { useAction } from '@/lib/hooks'
import { attrType, avText, fromWireJson, itemKey, keysOf, toWireJson, type Item } from '@/lib/dynamodb'
import { Button, Confirm, ErrorBox, JsonEditor, Modal, Option, Select, Spinner } from '@/components/common'

type Format = 'dynamodb' | 'plain'

/** Plain JSON for display and editing: sets become arrays, binaries base64. */
function toPlain(item: Item): string {
  return JSON.stringify(unmarshall(item), (_, v) => {
    if (v instanceof Set) return [...v]
    if (v instanceof Uint8Array) return btoa(String.fromCharCode(...v))
    return v
  }, 2)
}

function fromPlain(text: string): Item {
  const obj = JSON.parse(text)
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('An item must be a JSON object')
  return marshall(obj, { removeUndefinedValues: true }) as Item
}

function parse(text: string, format: Format): Item {
  return format === 'plain' ? fromPlain(text) : fromWireJson(text)
}

function template(table: TableDescription): Item {
  const keys = keysOf(table.KeySchema)
  const item: Item = {}
  for (const k of [keys.hash, keys.range]) {
    if (!k) continue
    const t = attrType(table, k)
    item[k] = t === 'N' ? { N: '0' } : t === 'B' ? { B: new Uint8Array() } : { S: '' }
  }
  return item
}

export default function ItemEditor({ table, item, onClose, onSaved }: {
  table: TableDescription
  item: Item | null
  onClose: () => void
  onSaved: () => void
}) {
  const { clients } = useSettings()
  const keys = keysOf(table.KeySchema)
  const [format, setFormat] = useState<Format>('dynamodb')
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Rows from an index may hold only projected attributes, so load the
  // whole item from the table.
  const full = useQuery({
    queryKey: ['dynamodb', 'item', table.TableName, item && JSON.stringify(itemKey(item, keys), (_, v) => (v instanceof Uint8Array ? [...v] : v))],
    queryFn: async () => ((await clients.dynamodb.send(new GetItemCommand({
      TableName: table.TableName, Key: itemKey(item!, keys), ConsistentRead: true,
    }))).Item ?? null) as Item | null,
    enabled: !!item,
    gcTime: 0,
  })
  const blank = useMemo(() => template(table), [table])
  const original = item ? full.data : blank

  useEffect(() => {
    if (original) setText(format === 'plain' ? toPlain(original) : toWireJson(original))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [original])

  const switchFormat = (next: Format) => {
    try {
      const parsed = parse(text, format)
      setText(next === 'plain' ? toPlain(parsed) : toWireJson(parsed))
      setFormat(next)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const save = useAction(
    async () => {
      const next = parse(text, format)
      for (const k of [keys.hash, keys.range]) {
        if (k && !next[k]) throw new Error(`The item must include the key attribute ${k}`)
      }
      if (item && original && [keys.hash, keys.range].some((k) => k && avText(next[k]) !== avText(original[k]))) {
        throw new Error('Key attributes cannot be changed. Create a new item instead.')
      }
      await clients.dynamodb.send(new PutItemCommand({
        TableName: table.TableName, Item: next,
        // A new item must not silently replace an existing one.
        ConditionExpression: item ? undefined : 'attribute_not_exists(#k)',
        ExpressionAttributeNames: item ? undefined : { '#k': keys.hash },
      }))
    },
    { invalidate: [['dynamodb']], success: item ? 'Item saved' : 'Item created', onSuccess: () => { onSaved(); onClose() } },
  )
  const del = useAction(
    () => clients.dynamodb.send(new DeleteItemCommand({ TableName: table.TableName, Key: itemKey(item!, keys) })),
    { invalidate: [['dynamodb']], success: 'Item deleted', onSuccess: () => { onSaved(); onClose() } },
  )

  return (
    <>
      <Modal wide title={item ? 'Edit item' : 'Create item'}
        description={item ? `Key: ${[keys.hash, keys.range].filter(Boolean).map((k) => `${k} = ${avText(item[k!])}`).join(', ')}`
          : `New item in ${table.TableName}`}
        onClose={onClose}
        footer={<>
          {item && <Button variant="danger" icon={<Trash2 />} className="mr-auto" onClick={() => setConfirmDelete(true)}>Delete</Button>}
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!text.trim()} loading={save.isPending} onClick={() => save.mutate(undefined)}>
            {item ? 'Save' : 'Create item'}
          </Button>
        </>}>
        {item && full.isLoading ? <Spinner /> : full.isError ? <ErrorBox error={full.error} /> : item && !full.data ? (
          <ErrorBox error={new Error('This item no longer exists.')} />
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Format</span>
              <Select value={format} onChange={(e) => switchFormat(e.target.value as Format)}>
                <Option value="dynamodb">DynamoDB JSON</Option>
                <Option value="plain">Plain JSON</Option>
              </Select>
              <span className="text-xs text-muted-foreground">
                {format === 'plain' ? 'Sets and binary values become lists and strings in plain JSON.' : 'Typed values, e.g. {"S": "text"}, {"N": "1"}, {"SS": ["a"]}.'}
              </span>
            </div>
            <JsonEditor value={text} onChange={(v) => { setText(v); setError(null) }} rows={18} />
            {error && <span className="text-sm text-destructive">{error}</span>}
          </div>
        )}
      </Modal>
      {confirmDelete && (
        <Confirm title="Delete item?" loading={del.isPending} onConfirm={() => del.mutate(undefined)} onClose={() => setConfirmDelete(false)}>
          <p>The item is permanently deleted from {table.TableName}.</p>
        </Confirm>
      )}
    </>
  )
}
