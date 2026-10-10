import { useState, type ReactNode } from 'react'
import {
  ChangeMessageVisibilityCommand, DeleteMessageCommand, ReceiveMessageCommand, SendMessageCommand,
  type Message, type MessageAttributeValue,
} from '@aws-sdk/client-sqs'
import { Download, Mail, Plus, Send, Trash2, Undo2 } from 'lucide-react'
import { useSettings } from '@/lib/settings'
import { useAction } from '@/lib/hooks'
import { formatDate } from '@/lib/format'
import { prettyJson } from '@/lib/aws'
import {
  Badge, Button, CodeBlock, Drawer, Empty, Field, IconButton, Input, KeyValue, Mono, NameCell, Option, Panel, Select,
  Table, Textarea,
} from '@/components/common'

interface AttrRow {
  name: string
  type: 'String' | 'Number' | 'Binary'
  value: string
}

/** A received message, with the time its receipt handle stops being valid. */
interface Received extends Message {
  receivedAt: number
  visibleUntil: number
}

export default function Messages({ url, name, attributes: a }: { url: string; name: string; attributes: Record<string, string> }) {
  const fifo = a.FifoQueue === 'true'
  return (
    <div className="flex flex-col gap-6">
      <SendPanel url={url} fifo={fifo} contentDedup={a.ContentBasedDeduplication === 'true'} />
      <ReceivePanel url={url} name={name} visibility={Number(a.VisibilityTimeout)} />
    </div>
  )
}

function SendPanel({ url, fifo, contentDedup }: { url: string; fifo: boolean; contentDedup: boolean }) {
  const { clients } = useSettings()
  const [body, setBody] = useState('')
  const [group, setGroup] = useState('')
  const [dedup, setDedup] = useState('')
  const [delay, setDelay] = useState('')
  const [attrs, setAttrs] = useState<AttrRow[]>([])

  const attrError = attrs.find((r) => !r.name.trim() || !r.value || (r.type === 'Number' && Number.isNaN(Number(r.value))))
  const valid = !!body && (!fifo || (!!group && (contentDedup || !!dedup))) && !attrError

  const send = useAction(
    () => {
      const MessageAttributes: Record<string, MessageAttributeValue> = {}
      for (const r of attrs) {
        MessageAttributes[r.name.trim()] = r.type === 'Binary'
          ? { DataType: 'Binary', BinaryValue: new TextEncoder().encode(r.value) }
          : { DataType: r.type, StringValue: r.value }
      }
      return clients.sqs.send(new SendMessageCommand({
        QueueUrl: url,
        MessageBody: body,
        MessageAttributes: attrs.length ? MessageAttributes : undefined,
        MessageGroupId: fifo ? group : undefined,
        MessageDeduplicationId: fifo && dedup ? dedup : undefined,
        DelaySeconds: !fifo && delay ? Number(delay) : undefined,
      }))
    },
    {
      invalidate: [['sqs']],
      success: (r) => `Sent message ${r.MessageId}${r.SequenceNumber ? ` (sequence ${r.SequenceNumber})` : ''}`,
      onSuccess: () => setDedup(''),
    },
  )
  const setAttr = (i: number, patch: Partial<AttrRow>) => setAttrs(attrs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  return (
    <Panel title="Send message" actions={
      <Button variant="primary" icon={<Send />} disabled={!valid} loading={send.isPending} onClick={() => send.mutate(undefined)}>Send</Button>
    }>
      <div className="flex flex-col gap-5">
        <Field label="Body">
          <Textarea className="min-h-28 font-mono text-xs" value={body} onChange={(e) => setBody(e.target.value)}
            placeholder='{"orderId": 42}' spellCheck={false} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-3">
          {fifo ? <>
            <Field label="Message group ID" hint="Messages in a group are delivered in order.">
              <Input value={group} onChange={(e) => setGroup(e.target.value)} placeholder="customer-7" />
            </Field>
            <Field label="Deduplication ID" hint={contentDedup ? 'Optional: content-based deduplication is on.' : 'Required: repeats within 5 minutes are dropped.'}>
              <Input value={dedup} onChange={(e) => setDedup(e.target.value)} />
            </Field>
          </> : (
            <Field label="Delay (seconds)" hint="Overrides the queue's delivery delay; 0 to 900.">
              <Input type="number" min={0} max={900} value={delay} onChange={(e) => setDelay(e.target.value)} />
            </Field>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Message attributes</span>
          {attrs.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_8rem_1fr_2rem] items-center gap-2">
              <Input value={r.name} placeholder="Name" aria-invalid={!r.name.trim()} onChange={(e) => setAttr(i, { name: e.target.value })} />
              <Select className="w-full" value={r.type} onChange={(e) => setAttr(i, { type: e.target.value as AttrRow['type'] })}>
                <Option value="String">String</Option>
                <Option value="Number">Number</Option>
                <Option value="Binary">Binary</Option>
              </Select>
              <Input value={r.value} placeholder={r.type === 'Binary' ? 'Text, sent as UTF-8 bytes' : 'Value'}
                aria-invalid={!r.value || (r.type === 'Number' && Number.isNaN(Number(r.value)))}
                onChange={(e) => setAttr(i, { value: e.target.value })} />
              <IconButton label="Remove attribute" onClick={() => setAttrs(attrs.filter((_, j) => j !== i))}><Trash2 /></IconButton>
            </div>
          ))}
          <div>
            <Button icon={<Plus />} disabled={attrs.length >= 10} onClick={() => setAttrs([...attrs, { name: '', type: 'String', value: '' }])}>
              Add attribute
            </Button>
          </div>
        </div>
      </div>
    </Panel>
  )
}

function ReceivePanel({ url, name, visibility }: { url: string; name: string; visibility: number }) {
  const { clients } = useSettings()
  const [max, setMax] = useState('10')
  const [wait, setWait] = useState('5')
  const [timeout, setTimeoutValue] = useState('')
  const [messages, setMessages] = useState<Received[]>([])
  const [open, setOpen] = useState<Received | null>(null)

  const poll = useAction(
    async () => {
      const vis = timeout ? Number(timeout) : visibility
      const res = await clients.sqs.send(new ReceiveMessageCommand({
        QueueUrl: url,
        MaxNumberOfMessages: Number(max),
        WaitTimeSeconds: Number(wait),
        VisibilityTimeout: timeout ? vis : undefined,
        MessageAttributeNames: ['All'],
        MessageSystemAttributeNames: ['All'],
      }))
      const now = Date.now()
      return (res.Messages ?? []).map((m): Received => ({ ...m, receivedAt: now, visibleUntil: now + vis * 1000 }))
    },
    {
      invalidate: [['sqs', 'attributes', name]],
      success: (got) => (got.length ? `Received ${got.length} message${got.length === 1 ? '' : 's'}` : 'No messages available'),
      onSuccess: (got) => setMessages((prev) => [...got, ...prev.filter((p) => !got.some((g) => g.MessageId === p.MessageId))]),
    },
  )
  const drop = (m: Received) => setMessages((prev) => prev.filter((p) => p.MessageId !== m.MessageId))
  const del = useAction(
    async (m: Received) => {
      await clients.sqs.send(new DeleteMessageCommand({ QueueUrl: url, ReceiptHandle: m.ReceiptHandle }))
      return m
    },
    { invalidate: [['sqs']], success: 'Message deleted', onSuccess: (m) => { drop(m); setOpen(null) } },
  )
  const release = useAction(
    async (m: Received) => {
      await clients.sqs.send(new ChangeMessageVisibilityCommand({ QueueUrl: url, ReceiptHandle: m.ReceiptHandle, VisibilityTimeout: 0 }))
      return m
    },
    { invalidate: [['sqs']], success: 'Message returned to the queue', onSuccess: (m) => { drop(m); setOpen(null) } },
  )

  return (
    <Panel title="Receive messages" description="Received messages stay hidden from other consumers until their visibility timeout ends."
      flush actions={<>
        {messages.length > 0 && <Button variant="ghost" onClick={() => setMessages([])}>Clear list</Button>}
        <Button variant="primary" icon={<Download />} loading={poll.isPending} onClick={() => poll.mutate(undefined)}>Poll for messages</Button>
      </>}>
      <div className="grid gap-5 border-b p-4 sm:grid-cols-3">
        <Field label="Maximum messages">
          <Select className="w-full" value={max} onChange={(e) => setMax(e.target.value)}>
            {Array.from({ length: 10 }, (_, i) => <Option key={i} value={String(i + 1)}>{i + 1}</Option>)}
          </Select>
        </Field>
        <Field label="Wait time (seconds)" hint="Long polling: 0 to 20">
          <Input type="number" min={0} max={20} value={wait} onChange={(e) => setWait(e.target.value)} />
        </Field>
        <Field label="Visibility timeout (seconds)" hint={`Queue default: ${visibility}`}>
          <Input type="number" min={0} max={43200} value={timeout} placeholder={String(visibility)} onChange={(e) => setTimeoutValue(e.target.value)} />
        </Field>
      </div>
      <Table
        rows={messages}
        rowKey={(m) => m.MessageId!}
        empty={<Empty title="No messages received yet" icon={<Mail />}>Poll the queue to receive messages.</Empty>}
        columns={[
          { header: 'Message ID', render: (m) => <NameCell icon={<Mail />} onClick={() => setOpen(m)}>{m.MessageId!.slice(0, 8)}…</NameCell> },
          { header: 'Body', render: (m) => <span className="line-clamp-1 max-w-md font-mono text-xs break-all">{m.Body}</span> },
          { header: 'Group', className: 'w-28', render: (m) => m.Attributes?.MessageGroupId ?? '—' },
          { header: 'Receives', className: 'w-24 tabular-nums', render: (m) => m.Attributes?.ApproximateReceiveCount },
          { header: 'Sent', className: 'w-48', render: (m) => formatDate(new Date(Number(m.Attributes?.SentTimestamp))) },
          { header: '', className: 'w-24 text-right', render: (m) => (
            <span className="inline-flex">
              <IconButton label="Return to queue" onClick={() => release.mutate(m)}><Undo2 /></IconButton>
              <IconButton label="Delete" onClick={() => del.mutate(m)}><Trash2 /></IconButton>
            </span>
          ) },
        ]}
      />
      {open && (
        <Drawer title={`Message ${open.MessageId}`} description={visibleText(open)} onClose={() => setOpen(null)}>
          <div className="mb-4 flex gap-2">
            <Button icon={<Undo2 />} loading={release.isPending} onClick={() => release.mutate(open)}>Return to queue</Button>
            <Button variant="danger" icon={<Trash2 />} loading={del.isPending} onClick={() => del.mutate(open)}>Delete</Button>
          </div>
          <div className="flex flex-col gap-6">
            <div>
              <h3 className="mb-2 text-sm font-medium">Body</h3>
              <CodeBlock>{prettyJson(open.Body ?? '')}</CodeBlock>
            </div>
            <KeyValue items={[
              ['Message ID', <Mono copy>{open.MessageId}</Mono>],
              ['MD5 of body', <Mono>{open.MD5OfBody}</Mono>],
              ...Object.entries(open.Attributes ?? {}).sort().map(([k, v]): [string, ReactNode] => [k, /Timestamp$/.test(k) ? formatDate(new Date(Number(v))) : v]),
            ]} />
            <div>
              <h3 className="mb-2 text-sm font-medium">Message attributes</h3>
              {Object.keys(open.MessageAttributes ?? {}).length ? (
                <KeyValue items={Object.entries(open.MessageAttributes!).map(([k, v]) => [
                  <span className="inline-flex items-center gap-1">{k} <Badge>{v.DataType}</Badge></span>,
                  v.BinaryValue ? `${v.BinaryValue.length} bytes` : v.StringValue,
                ])} />
              ) : <span className="text-sm text-muted-foreground">None</span>}
            </div>
            <div>
              <h3 className="mb-2 text-sm font-medium">Receipt handle</h3>
              <Mono copy>{open.ReceiptHandle}</Mono>
            </div>
          </div>
        </Drawer>
      )}
    </Panel>
  )
}

function visibleText(m: Received): string {
  const left = Math.round((m.visibleUntil - Date.now()) / 1000)
  return left > 0 ? `Hidden from other consumers for about ${left} more seconds.` : 'Visible again; this receipt handle may be stale.'
}
