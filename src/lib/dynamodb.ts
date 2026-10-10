import { useQuery } from '@tanstack/react-query'
import {
  DescribeTableCommand, ListTablesCommand, type AttributeValue, type DynamoDBClient, type KeySchemaElement,
  type TableDescription,
} from '@aws-sdk/client-dynamodb'
import { useSettings } from './settings'

export type Item = Record<string, AttributeValue>

export const tableNamePattern = /^[A-Za-z0-9_.-]{3,255}$/

export async function listTables(ddb: DynamoDBClient): Promise<string[]> {
  const names: string[] = []
  let ExclusiveStartTableName: string | undefined
  do {
    const page = await ddb.send(new ListTablesCommand({ ExclusiveStartTableName }))
    names.push(...(page.TableNames ?? []))
    ExclusiveStartTableName = page.LastEvaluatedTableName
  } while (ExclusiveStartTableName)
  return names
}

/** Every table with its description. */
export function useTables() {
  const { clients } = useSettings()
  return useQuery({
    queryKey: ['dynamodb', 'tables'],
    queryFn: async () => {
      const names = await listTables(clients.dynamodb)
      return Promise.all(names.map(async (TableName) => (await clients.dynamodb.send(new DescribeTableCommand({ TableName }))).Table!))
    },
  })
}

export function useTable(name: string) {
  const { clients } = useSettings()
  return useQuery({
    queryKey: ['dynamodb', 'table', name],
    queryFn: async () => (await clients.dynamodb.send(new DescribeTableCommand({ TableName: name }))).Table!,
  })
}

export interface Keys {
  hash: string
  range?: string
}

export function keysOf(schema: KeySchemaElement[] | undefined): Keys {
  return {
    hash: schema?.find((k) => k.KeyType === 'HASH')?.AttributeName ?? '',
    range: schema?.find((k) => k.KeyType === 'RANGE')?.AttributeName,
  }
}

/** The declared type (S, N or B) of a key attribute. */
export function attrType(t: TableDescription | undefined, name: string | undefined): string {
  return t?.AttributeDefinitions?.find((d) => d.AttributeName === name)?.AttributeType ?? 'S'
}

export function typeLabel(t: string): string {
  return { S: 'String', N: 'Number', B: 'Binary' }[t] ?? t
}

/** A typed AttributeValue from text entered for a key attribute. */
export function keyValue(type: string, text: string): AttributeValue {
  if (type === 'N') return { N: text }
  if (type === 'B') return { B: new TextEncoder().encode(text) }
  return { S: text }
}

/** Extracts the primary key of an item. */
export function itemKey(item: Item, keys: Keys): Item {
  const k: Item = { [keys.hash]: item[keys.hash] }
  if (keys.range) k[keys.range] = item[keys.range]
  return k
}

export function itemKeyString(item: Item, keys: Keys): string {
  return JSON.stringify([avText(item[keys.hash]), keys.range ? avText(item[keys.range]) : null])
}

function bytesText(b: Uint8Array): string {
  let s = ''
  b.forEach((x) => (s += String.fromCharCode(x)))
  return btoa(s)
}

/** A compact, single-line rendering of a value for table cells. */
export function avText(v: AttributeValue | undefined): string {
  if (!v) return ''
  if (v.S !== undefined) return v.S
  if (v.N !== undefined) return v.N
  if (v.B !== undefined) return bytesText(v.B)
  if (v.BOOL !== undefined) return String(v.BOOL)
  if (v.NULL !== undefined) return 'null'
  if (v.SS) return `{${v.SS.map((s) => JSON.stringify(s)).join(', ')}}`
  if (v.NS) return `{${v.NS.join(', ')}}`
  if (v.BS) return `{${v.BS.map(bytesText).join(', ')}}`
  if (v.L) return `[${v.L.map(avText).join(', ')}]`
  if (v.M) return `{${Object.entries(v.M).map(([k, x]) => `${k}: ${avText(x)}`).join(', ')}}`
  return ''
}

export function avType(v: AttributeValue | undefined): string {
  return v ? Object.keys(v).find((k) => (v as unknown as Record<string, unknown>)[k] !== undefined) ?? '' : ''
}

/** DynamoDB JSON for editing: binary values become base64 strings, as on the wire. */
export function toWireJson(item: Item): string {
  return JSON.stringify(item, (_, v) => (v instanceof Uint8Array ? bytesText(v) : v), 2)
}

function fromBase64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}

/** Parses DynamoDB JSON typed by the user, decoding base64 binaries. */
export function fromWireJson(text: string): Item {
  const raw = JSON.parse(text)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('An item must be a JSON object')
  const fix = (v: unknown): unknown => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Every attribute must be an object such as {"S": "text"}')
    const o = v as Record<string, unknown>
    if ('B' in o) return { B: fromBase64(String(o.B)) }
    if ('BS' in o) return { BS: (o.BS as string[]).map(fromBase64) }
    if ('L' in o) return { L: (o.L as unknown[]).map(fix) }
    if ('M' in o) return { M: Object.fromEntries(Object.entries(o.M as object).map(([k, x]) => [k, fix(x)])) }
    return o
  }
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, fix(v)])) as Item
}

export function billingLabel(t: TableDescription): string {
  if (t.BillingModeSummary?.BillingMode === 'PAY_PER_REQUEST') return 'On-demand'
  const p = t.ProvisionedThroughput
  return `Provisioned (${p?.ReadCapacityUnits ?? 0} RCU / ${p?.WriteCapacityUnits ?? 0} WCU)`
}

export function isOnDemand(t: TableDescription | undefined): boolean {
  return t?.BillingModeSummary?.BillingMode === 'PAY_PER_REQUEST'
}
