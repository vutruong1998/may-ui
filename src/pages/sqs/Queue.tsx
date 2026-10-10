import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  DeleteQueueCommand, GetQueueUrlCommand, ListDeadLetterSourceQueuesCommand, ListMessageMoveTasksCommand,
  ListQueueTagsCommand, PurgeQueueCommand, SetQueueAttributesCommand, StartMessageMoveTaskCommand, TagQueueCommand,
  UntagQueueCommand,
} from '@aws-sdk/client-sqs'
import { Eraser, Trash2, Undo2 } from 'lucide-react'
import { useSettings } from '@/lib/settings'
import { useAction } from '@/lib/hooks'
import { formatBytes, formatDate } from '@/lib/format'
import { prettyJson } from '@/lib/aws'
import { arnName, formatSeconds, parseRedrive, queueAttributes, queueName, useQueues } from '@/lib/sqs'
import { TagsEditor } from '@/components/TagsEditor'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Badge, Button, Confirm, Empty, ErrorBox, Field, Input, JsonEditor, KeyValue, Mono, NameCell, Option, PageHeader, Panel,
  RefreshButton, Select, Spinner, Table, Tabs,
} from '@/components/common'
import Messages from './Messages'

type Tab = 'messages' | 'configuration' | 'dead-letter' | 'tags'

export default function Queue() {
  const { name = '' } = useParams()
  const { clients } = useSettings()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) ?? 'messages'
  const [confirm, setConfirm] = useState<'purge' | 'delete' | null>(null)

  const url = useQuery({
    queryKey: ['sqs', 'url', name],
    queryFn: async () => (await clients.sqs.send(new GetQueueUrlCommand({ QueueName: name }))).QueueUrl!,
  })
  const attrs = useQuery({
    queryKey: ['sqs', 'attributes', name],
    queryFn: () => queueAttributes(clients.sqs, url.data!),
    enabled: !!url.data,
    refetchInterval: 5_000,
  })

  const purge = useAction(() => clients.sqs.send(new PurgeQueueCommand({ QueueUrl: url.data })), {
    invalidate: [['sqs']], success: 'Queue purged', onSuccess: () => setConfirm(null),
  })
  const del = useAction(() => clients.sqs.send(new DeleteQueueCommand({ QueueUrl: url.data })), {
    invalidate: [['count']], success: `Deleted queue ${name}`, onSuccess: () => navigate('/sqs'),
  })

  const a = attrs.data
  const fifo = a?.FifoQueue === 'true'
  return (
    <>
      <PageHeader
        title={name}
        crumbs={[{ label: 'SQS', to: '/sqs' }, { label: name }]}
        description={a && <span className="inline-flex items-center gap-2">
          <Badge tone={fifo ? 'blue' : 'neutral'}>{fifo ? 'FIFO' : 'Standard'}</Badge>
          {a.ApproximateNumberOfMessages} available · {a.ApproximateNumberOfMessagesNotVisible} in flight · {a.ApproximateNumberOfMessagesDelayed} delayed
        </span>}
        actions={url.isSuccess && <>
          <RefreshButton onClick={() => attrs.refetch()} spinning={attrs.isFetching} />
          <Button icon={<Eraser />} onClick={() => setConfirm('purge')}>Purge</Button>
          <Button variant="danger" icon={<Trash2 />} onClick={() => setConfirm('delete')}>Delete</Button>
        </>}
      />
      {url.isLoading ? <Spinner /> : url.isError ? <ErrorBox error={url.error} onRetry={() => url.refetch()} /> : (
        <>
          <Tabs value={tab} onChange={(t) => setParams(t === 'messages' ? {} : { tab: t })} tabs={[
            { id: 'messages', label: 'Send and receive' }, { id: 'configuration', label: 'Configuration' },
            { id: 'dead-letter', label: 'Dead-letter queue' }, { id: 'tags', label: 'Tags' },
          ]} />
          {!a ? (attrs.isError ? <ErrorBox error={attrs.error} /> : <Spinner />)
            : tab === 'messages' ? <Messages url={url.data!} name={name} attributes={a} />
            : tab === 'configuration' ? <Configuration url={url.data!} attributes={a} />
            : tab === 'dead-letter' ? <DeadLetter url={url.data!} name={name} attributes={a} />
            : <Tags url={url.data!} />}
        </>
      )}
      {confirm === 'purge' && (
        <Confirm title={`Purge ${name}?`} confirmLabel="Purge" loading={purge.isPending}
          onConfirm={() => purge.mutate(undefined)} onClose={() => setConfirm(null)}>
          <p>Every message in the queue, including messages in flight, is deleted.</p>
        </Confirm>
      )}
      {confirm === 'delete' && (
        <Confirm title={`Delete queue ${name}?`} confirmText={name} loading={del.isPending}
          onConfirm={() => del.mutate(undefined)} onClose={() => setConfirm(null)}>
          <p>The queue and all of its messages are deleted. This cannot be undone.</p>
        </Confirm>
      )}
    </>
  )
}

const editable = [
  { key: 'VisibilityTimeout', label: 'Visibility timeout (seconds)', hint: '0 to 43,200', min: 0, max: 43200 },
  { key: 'DelaySeconds', label: 'Delivery delay (seconds)', hint: '0 to 900', min: 0, max: 900 },
  { key: 'MessageRetentionPeriod', label: 'Message retention (seconds)', hint: '60 to 1,209,600', min: 60, max: 1209600 },
  { key: 'MaximumMessageSize', label: 'Maximum message size (bytes)', hint: '1,024 to 1,048,576', min: 1024, max: 1048576 },
  { key: 'ReceiveMessageWaitTimeSeconds', label: 'Receive wait time (seconds)', hint: 'Long polling: 0 to 20', min: 0, max: 20 },
]

function Configuration({ url, attributes: a }: { url: string; attributes: Record<string, string> }) {
  const { clients } = useSettings()
  const fifo = a.FifoQueue === 'true'
  const [form, setForm] = useState<Record<string, string>>({})
  const [policy, setPolicy] = useState('')
  const reset = () => {
    setForm(Object.fromEntries([...editable.map((f) => [f.key, a[f.key] ?? '']), ['ContentBasedDeduplication', a.ContentBasedDeduplication ?? 'false']]))
    setPolicy(a.Policy ? prettyJson(a.Policy) : '')
  }
  // Re-seed the form when the queue's stored values change, not on every poll.
  const stored = JSON.stringify([editable.map((f) => a[f.key]), a.ContentBasedDeduplication, a.Policy])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reset, [stored])

  const changed = Object.entries(form).filter(([k, v]) => (a[k] ?? (k === 'ContentBasedDeduplication' ? 'false' : '')) !== v)
  const save = useAction(
    (Attributes: Record<string, string>) => clients.sqs.send(new SetQueueAttributesCommand({ QueueUrl: url, Attributes })),
    { invalidate: [['sqs']], success: 'Queue updated' },
  )
  const policyDirty = (a.Policy ? prettyJson(a.Policy) : '') !== policy

  return (
    <div className="flex flex-col gap-6">
      <Panel title="Details">
        <KeyValue items={[
          ['URL', <Mono copy>{url}</Mono>],
          ['ARN', <Mono copy>{a.QueueArn}</Mono>],
          ['Type', fifo ? 'FIFO' : 'Standard'],
          ['Created', formatDate(new Date(Number(a.CreatedTimestamp) * 1000))],
          ['Last updated', formatDate(new Date(Number(a.LastModifiedTimestamp) * 1000))],
          ['Maximum message size', formatBytes(Number(a.MaximumMessageSize))],
          ['Message retention', formatSeconds(a.MessageRetentionPeriod)],
          ['Encryption', a.KmsMasterKeyId ? `KMS (${a.KmsMasterKeyId})` : a.SqsManagedSseEnabled === 'true' ? 'SQS-managed (SSE-SQS)' : 'Disabled'],
          ...(fifo ? [
            ['Deduplication scope', a.DeduplicationScope],
            ['Throughput limit', a.FifoThroughputLimit],
          ] as [string, string][] : []),
        ]} />
      </Panel>
      <Panel title="Settings" actions={changed.length > 0 && <>
        <Button variant="ghost" onClick={reset}>Discard</Button>
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(Object.fromEntries(changed))}>Save</Button>
      </>}>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {editable.map((f) => (
            <Field key={f.key} label={f.label} hint={f.key === 'MessageRetentionPeriod' ? `${formatSeconds(form[f.key])}; ${f.hint}` : f.hint}>
              <Input type="number" min={f.min} max={f.max} value={form[f.key] ?? ''}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
            </Field>
          ))}
        </div>
        {fifo && (
          <label className="mt-5 flex items-center gap-2 text-sm">
            <Checkbox checked={form.ContentBasedDeduplication === 'true'}
              onCheckedChange={(v) => setForm({ ...form, ContentBasedDeduplication: String(v === true) })} />
            Content-based deduplication
          </label>
        )}
      </Panel>
      <Panel title="Access policy" description="Stored and returned like SQS; may does not enforce it."
        actions={policyDirty && <>
          <Button variant="ghost" onClick={() => setPolicy(a.Policy ? prettyJson(a.Policy) : '')}>Discard</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate({ Policy: policy.trim() ? JSON.stringify(JSON.parse(policy)) : '' })}>
            {policy.trim() ? 'Save policy' : 'Remove policy'}
          </Button>
        </>}>
        <JsonEditor value={policy} onChange={setPolicy} rows={10} />
      </Panel>
    </div>
  )
}

function DeadLetter({ url, name, attributes: a }: { url: string; name: string; attributes: Record<string, string> }) {
  const { clients } = useSettings()
  const queues = useQueues()
  const fifo = a.FifoQueue === 'true'
  const current = parseRedrive(a.RedrivePolicy)
  const [target, setTarget] = useState(current?.deadLetterTargetArn ?? '')
  const [max, setMax] = useState(String(current?.maxReceiveCount ?? 5))
  useEffect(() => {
    setTarget(current?.deadLetterTargetArn ?? '')
    setMax(String(current?.maxReceiveCount ?? 5))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.RedrivePolicy])

  const sources = useQuery({
    queryKey: ['sqs', 'dlq-sources', name],
    queryFn: async () => (await clients.sqs.send(new ListDeadLetterSourceQueuesCommand({ QueueUrl: url }))).queueUrls ?? [],
  })
  const tasks = useQuery({
    queryKey: ['sqs', 'move-tasks', name],
    queryFn: async () => (await clients.sqs.send(new ListMessageMoveTasksCommand({ SourceArn: a.QueueArn }))).Results ?? [],
    enabled: (sources.data?.length ?? 0) > 0,
  })
  const setRedrive = useAction(
    (RedrivePolicy: string) => clients.sqs.send(new SetQueueAttributesCommand({ QueueUrl: url, Attributes: { RedrivePolicy } })),
    { invalidate: [['sqs']], success: 'Dead-letter queue updated' },
  )
  const redrive = useAction(
    () => clients.sqs.send(new StartMessageMoveTaskCommand({ SourceArn: a.QueueArn })),
    { invalidate: [['sqs']], success: 'Messages moved back to their source queues' },
  )
  const candidates = (queues.data ?? []).filter((q) => q.fifo === fifo && q.name !== name)
  const dirty = target !== (current?.deadLetterTargetArn ?? '') || (!!target && Number(max) !== current?.maxReceiveCount)

  return (
    <div className="flex flex-col gap-6">
      <Panel title="Dead-letter queue" description="Messages received more than the maximum number of times are moved to this queue."
        actions={<>
          {current && <Button variant="ghost" loading={setRedrive.isPending} onClick={() => setRedrive.mutate('')}>Remove</Button>}
          <Button variant="primary" disabled={!dirty || !target} loading={setRedrive.isPending}
            onClick={() => setRedrive.mutate(JSON.stringify({ deadLetterTargetArn: target, maxReceiveCount: Number(max) }))}>Save</Button>
        </>}>
        <div className="grid gap-5 sm:grid-cols-[1fr_12rem]">
          <Field label="Queue" hint={candidates.length ? undefined : `No other ${fifo ? 'FIFO' : 'standard'} queues exist.`}>
            <Select className="w-full" value={target} onChange={(e) => setTarget(e.target.value)}>
              <Option value="">None</Option>
              {candidates.map((q) => <Option key={q.url} value={q.attributes.QueueArn}>{q.name}</Option>)}
            </Select>
          </Field>
          <Field label="Maximum receives" hint="1 to 1,000">
            <Input type="number" min={1} max={1000} value={max} disabled={!target} onChange={(e) => setMax(e.target.value)} />
          </Field>
        </div>
      </Panel>

      <Panel title="Source queues" description="Queues that send their failed messages here."
        actions={(sources.data?.length ?? 0) > 0 && (
          <Button icon={<Undo2 />} loading={redrive.isPending} disabled={a.ApproximateNumberOfMessages === '0'}
            onClick={() => redrive.mutate(undefined)}>Redrive to source</Button>
        )} flush>
        <Table
          rows={sources.data}
          loading={sources.isLoading}
          error={sources.error}
          rowKey={(u) => u}
          empty={<Empty title="Not a dead-letter queue">No queue uses {name} as its dead-letter queue.</Empty>}
          columns={[{ header: 'Queue', render: (u) => <NameCell to={`/sqs/${encodeURIComponent(queueName(u))}`}>{queueName(u)}</NameCell> }]}
        />
      </Panel>

      {(tasks.data?.length ?? 0) > 0 && (
        <Panel title="Redrive history" flush>
          <Table
            rows={tasks.data}
            rowKey={(t) => String(t.StartedTimestamp) + t.DestinationArn}
            columns={[
              { header: 'Started', render: (t) => formatDate(new Date(t.StartedTimestamp ?? 0)) },
              { header: 'Destination', render: (t) => t.DestinationArn ? arnName(t.DestinationArn) : 'Source queues' },
              { header: 'Moved', className: 'tabular-nums', render: (t) => t.ApproximateNumberOfMessagesMoved },
              { header: 'Status', render: (t) => <Badge tone={t.Status === 'COMPLETED' ? 'green' : 'amber'}>{t.Status}</Badge> },
            ]}
          />
        </Panel>
      )}
    </div>
  )
}

function Tags({ url }: { url: string }) {
  const { clients } = useSettings()
  const tags = useQuery({
    queryKey: ['sqs', 'tags', url],
    queryFn: async () => Object.entries((await clients.sqs.send(new ListQueueTagsCommand({ QueueUrl: url }))).Tags ?? {})
      .map(([Key, Value]) => ({ Key, Value })),
  })
  const save = useAction(
    async (next: { Key: string; Value: string }[]) => {
      const removed = (tags.data ?? []).map((t) => t.Key).filter((k) => !next.some((n) => n.Key === k))
      if (removed.length) await clients.sqs.send(new UntagQueueCommand({ QueueUrl: url, TagKeys: removed }))
      if (next.length) await clients.sqs.send(new TagQueueCommand({ QueueUrl: url, Tags: Object.fromEntries(next.map((t) => [t.Key, t.Value])) }))
    },
    { invalidate: [['sqs', 'tags', url]], success: 'Tags saved' },
  )
  return (
    <Panel title="Tags">
      {tags.isLoading ? <Spinner /> : tags.isError ? <ErrorBox error={tags.error} /> : (
        <TagsEditor tags={tags.data} saving={save.isPending} onSave={(t) => save.mutate(t)} />
      )}
    </Panel>
  )
}
