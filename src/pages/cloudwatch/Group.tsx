import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  CreateLogStreamCommand, DeleteLogGroupCommand, DeleteLogStreamCommand, DeleteMetricFilterCommand,
  DeleteRetentionPolicyCommand, DescribeLogStreamsCommand, DescribeMetricFiltersCommand, FilterLogEventsCommand,
  ListTagsForResourceCommand, PutLogEventsCommand, PutMetricFilterCommand, PutRetentionPolicyCommand, TagResourceCommand,
  UntagResourceCommand, type FilteredLogEvent, type LogStream,
} from '@aws-sdk/client-cloudwatch-logs'
import { Pause, Play, Plus, Search, Send, Trash2 } from 'lucide-react'
import { useSettings } from '@/lib/settings'
import { useAction } from '@/lib/hooks'
import { formatBytes, formatDate } from '@/lib/format'
import { TagsEditor } from '@/components/TagsEditor'
import {
  Badge, Button, Confirm, Empty, ErrorBox, Field, IconButton, Input, KeyValue, Modal, Mono, NameCell, Option, PageHeader,
  Panel, RefreshButton, Select, Spinner, Table, Tabs,
} from '@/components/common'
import { retentionDays, retentionLabel, useLogGroups } from './Groups'

type Tab = 'events' | 'streams' | 'settings'

export default function Group() {
  const [params, setParams] = useSearchParams()
  const name = params.get('name') ?? ''
  const tab = (params.get('tab') as Tab) ?? 'events'
  const { clients } = useSettings()
  const navigate = useNavigate()
  const groups = useLogGroups()
  const group = groups.data?.find((g) => g.logGroupName === name)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const del = useAction(() => clients.logs.send(new DeleteLogGroupCommand({ logGroupName: name })), {
    invalidate: [['logs'], ['count']], success: `Deleted log group ${name}`, onSuccess: () => navigate('/logs'),
  })

  return (
    <>
      <PageHeader
        title={name}
        crumbs={[{ label: 'CloudWatch Logs', to: '/logs' }, { label: name }]}
        description={group && <>Retention: {retentionLabel(group.retentionInDays)} · {formatBytes(group.storedBytes)} stored</>}
        actions={<Button variant="danger" icon={<Trash2 />} onClick={() => setConfirmDelete(true)}>Delete</Button>}
      />
      {groups.isLoading ? <Spinner /> : !group ? <ErrorBox error={new Error(`Log group ${name} does not exist.`)} /> : (
        <>
          <Tabs value={tab} onChange={(t) => setParams(t === 'events' ? { name } : { name, tab: t })} tabs={[
            { id: 'events', label: 'Log events' }, { id: 'streams', label: 'Log streams' }, { id: 'settings', label: 'Settings' },
          ]} />
          {tab === 'events' ? <Events group={name} /> : tab === 'streams' ? <Streams group={name} /> : <Settings group={name} arn={group.logGroupArn!} />}
        </>
      )}
      {confirmDelete && (
        <Confirm title={`Delete log group ${name}?`} loading={del.isPending} onConfirm={() => del.mutate(undefined)} onClose={() => setConfirmDelete(false)}>
          <p>All streams and events in the group are deleted.</p>
        </Confirm>
      )}
    </>
  )
}

function useStreams(group: string) {
  const { clients } = useSettings()
  return useQuery({
    queryKey: ['logs', 'streams', group],
    queryFn: async () => {
      const out: LogStream[] = []
      let nextToken: string | undefined
      do {
        const page = await clients.logs.send(new DescribeLogStreamsCommand({ logGroupName: group, nextToken, orderBy: 'LastEventTime', descending: true }))
        out.push(...(page.logStreams ?? []))
        nextToken = page.nextToken
      } while (nextToken)
      return out
    },
  })
}

const ranges = [
  { id: '5m', label: 'Last 5 minutes', ms: 5 * 60_000 },
  { id: '1h', label: 'Last hour', ms: 3600_000 },
  { id: '24h', label: 'Last 24 hours', ms: 86400_000 },
  { id: '7d', label: 'Last 7 days', ms: 7 * 86400_000 },
  { id: 'all', label: 'All time', ms: 0 },
]

function Events({ group }: { group: string }) {
  const { clients } = useSettings()
  const streams = useStreams(group)
  const [stream, setStream] = useState('')
  const [pattern, setPattern] = useState('')
  const [range, setRange] = useState('1h')
  const [events, setEvents] = useState<FilteredLogEvent[]>([])
  const [nextToken, setNextToken] = useState<string | undefined>()
  const [tail, setTail] = useState(false)
  const seen = useRef(new Set<string>())

  const fetchEvents = async (token?: string, since?: number) => {
    const ms = ranges.find((r) => r.id === range)!.ms
    return clients.logs.send(new FilterLogEventsCommand({
      logGroupName: group, filterPattern: pattern || undefined, logStreamNames: stream ? [stream] : undefined,
      startTime: since ?? (ms ? Date.now() - ms : undefined), nextToken: token, limit: 200,
    }))
  }
  // Whether the running search continues the current results ("Load more").
  const more = useRef(false)
  const search = useAction((token: string | undefined) => {
    more.current = !!token
    return fetchEvents(token)
  }, {
    onSuccess: (res) => {
      const evs = res.events ?? []
      if (!more.current) {
        seen.current = new Set(evs.map((e) => e.eventId!))
        setEvents(evs)
      } else {
        evs.forEach((e) => seen.current.add(e.eventId!))
        setEvents((prev) => [...prev, ...evs])
      }
      setNextToken(res.nextToken)
    },
  })

  useEffect(() => {
    search.mutate(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group])

  // Live tail: poll for events newer than the last one shown.
  useEffect(() => {
    if (!tail) return
    const timer = setInterval(async () => {
      const last = events.length ? events[events.length - 1].timestamp! : Date.now() - 60_000
      try {
        const res = await fetchEvents(undefined, last)
        const fresh = (res.events ?? []).filter((e) => !seen.current.has(e.eventId!))
        if (fresh.length) {
          fresh.forEach((e) => seen.current.add(e.eventId!))
          setEvents((prev) => [...prev, ...fresh].slice(-2000))
        }
      } catch {
        // Keep tailing; transient errors show up on the next manual search.
      }
    }, 2000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tail, events, stream, pattern])

  return (
    <div className="flex flex-col gap-6">
      <Panel title="Search log events" actions={<>
        <Button icon={tail ? <Pause /> : <Play />} onClick={() => setTail(!tail)}>{tail ? 'Stop tail' : 'Live tail'}</Button>
        <Button variant="primary" icon={<Search />} loading={search.isPending && !more.current} onClick={() => search.mutate(undefined)}>Search</Button>
      </>}>
        <form className="grid gap-5 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); search.mutate(undefined) }}>
          <Field label="Stream">
            <Select className="w-full" value={stream} onChange={(e) => setStream(e.target.value)}>
              <Option value="">All streams</Option>
              {(streams.data ?? []).map((s) => <Option key={s.logStreamName} value={s.logStreamName}>{s.logStreamName}</Option>)}
            </Select>
          </Field>
          <div className="sm:col-span-2">
          <Field label="Filter pattern" hint={<>Terms (<code>ERROR -debug</code>), JSON (<code>{'{ $.level = "error" }'}</code>) or space-delimited (<code>[ip, user, status = 5*]</code>)</>}>
            <Input className="font-mono text-xs" value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="ERROR" />
          </Field>
          </div>
          <Field label="Time range">
            <Select className="w-full" value={range} onChange={(e) => setRange(e.target.value)}>
              {ranges.map((r) => <Option key={r.id} value={r.id}>{r.label}</Option>)}
            </Select>
          </Field>
        </form>
      </Panel>
      <Panel flush title={<span className="flex items-center gap-2">Events <Badge>{events.length}</Badge>{tail && <Badge tone="green">tailing</Badge>}</span>}>
        <Table
          rows={events}
          loading={search.isPending && !events.length}
          error={search.error}
          rowKey={(e) => e.eventId!}
          empty={<Empty title="No events">Nothing matches in this time range.</Empty>}
          columns={[
            { header: 'Time', className: 'w-52 align-top whitespace-nowrap', render: (e) => formatDate(new Date(e.timestamp ?? 0)) },
            { header: 'Stream', className: 'w-40 align-top text-muted-foreground', render: (e) => e.logStreamName },
            { header: 'Message', render: (e) => <pre className="font-mono text-xs break-all whitespace-pre-wrap">{e.message}</pre> },
          ]}
        />
        {nextToken && (
          <div className="flex justify-center border-t p-3">
            <Button loading={search.isPending && more.current} onClick={() => search.mutate(nextToken)}>Load more</Button>
          </div>
        )}
      </Panel>
      <PutEvent group={group} streams={(streams.data ?? []).map((s) => s.logStreamName!)} onSent={() => search.mutate(undefined)} />
    </div>
  )
}

function PutEvent({ group, streams, onSent }: { group: string; streams: string[]; onSent: () => void }) {
  const { clients } = useSettings()
  const [stream, setStream] = useState('')
  const [message, setMessage] = useState('')
  const target = stream || streams[0] || ''
  const put = useAction(
    () => clients.logs.send(new PutLogEventsCommand({ logGroupName: group, logStreamName: target, logEvents: [{ timestamp: Date.now(), message }] })),
    { success: 'Event sent', onSuccess: () => { setMessage(''); onSent() } },
  )
  return (
    <Panel title="Send a test event" actions={
      <Button icon={<Send />} disabled={!target || !message} loading={put.isPending} onClick={() => put.mutate(undefined)}>Send</Button>
    }>
      {streams.length === 0 ? <span className="text-sm text-muted-foreground">Create a log stream first.</span> : (
        <div className="grid gap-5 sm:grid-cols-[14rem_1fr]">
          <Field label="Stream">
            <Select className="w-full" value={target} onChange={(e) => setStream(e.target.value)}>
              {streams.map((s) => <Option key={s} value={s}>{s}</Option>)}
            </Select>
          </Field>
          <Field label="Message">
            <Input className="font-mono text-xs" value={message} onChange={(e) => setMessage(e.target.value)} placeholder='{"level":"error","msg":"db timeout"}'
              onKeyDown={(e) => e.key === 'Enter' && target && message && put.mutate(undefined)} />
          </Field>
        </div>
      )}
    </Panel>
  )
}

function Streams({ group }: { group: string }) {
  const { clients } = useSettings()
  const streams = useStreams(group)
  const [creating, setCreating] = useState<string | null>(null)
  const create = useAction((logStreamName: string) => clients.logs.send(new CreateLogStreamCommand({ logGroupName: group, logStreamName })), {
    invalidate: [['logs']], success: 'Log stream created', onSuccess: () => setCreating(null),
  })
  const del = useAction((logStreamName: string) => clients.logs.send(new DeleteLogStreamCommand({ logGroupName: group, logStreamName })), {
    invalidate: [['logs']], success: 'Log stream deleted',
  })
  return (
    <Panel flush title="Log streams" actions={<>
      <RefreshButton onClick={() => streams.refetch()} spinning={streams.isFetching} />
      <Button variant="primary" icon={<Plus />} onClick={() => setCreating('')}>Create stream</Button>
    </>}>
      <Table
        rows={streams.data}
        loading={streams.isLoading}
        error={streams.error}
        rowKey={(s) => s.logStreamName!}
        filterPlaceholder="Find streams"
        empty={<Empty title="No log streams" />}
        columns={[
          { header: 'Name', text: (s) => s.logStreamName!, render: (s) => <span className="font-mono text-xs">{s.logStreamName}</span> },
          { header: 'Last event', className: 'w-56', render: (s) => (s.lastEventTimestamp ? formatDate(new Date(s.lastEventTimestamp)) : '—') },
          { header: 'First event', className: 'w-56', render: (s) => (s.firstEventTimestamp ? formatDate(new Date(s.firstEventTimestamp)) : '—') },
          { header: 'Stored', className: 'w-24 tabular-nums', render: (s) => formatBytes(s.storedBytes) },
          { header: '', className: 'w-14 text-right', render: (s) => (
            <IconButton label="Delete stream" onClick={() => del.mutate(s.logStreamName!)}><Trash2 /></IconButton>
          ) },
        ]}
      />
      {creating !== null && (
        <Modal title="Create log stream" onClose={() => setCreating(null)} footer={<>
          <Button variant="secondary" onClick={() => setCreating(null)}>Cancel</Button>
          <Button variant="primary" disabled={!creating || /[:*]/.test(creating)} loading={create.isPending} onClick={() => create.mutate(creating)}>Create</Button>
        </>}>
          <Field label="Name"><Input autoFocus value={creating} onChange={(e) => setCreating(e.target.value)} /></Field>
        </Modal>
      )}
    </Panel>
  )
}

function Settings({ group, arn }: { group: string; arn: string }) {
  const { clients } = useSettings()
  const groups = useLogGroups()
  const info = groups.data?.find((g) => g.logGroupName === group)
  const setRetention = useAction(
    (days: string) => days
      ? clients.logs.send(new PutRetentionPolicyCommand({ logGroupName: group, retentionInDays: Number(days) }))
      : clients.logs.send(new DeleteRetentionPolicyCommand({ logGroupName: group })),
    { invalidate: [['logs']], success: 'Retention updated' },
  )
  const tags = useQuery({
    queryKey: ['logs', 'tags', arn],
    queryFn: async () => Object.entries((await clients.logs.send(new ListTagsForResourceCommand({ resourceArn: arn }))).tags ?? {}).map(([Key, Value]) => ({ Key, Value })),
  })
  const saveTags = useAction(
    async (next: { Key: string; Value: string }[]) => {
      const removed = (tags.data ?? []).map((t) => t.Key).filter((k) => !next.some((n) => n.Key === k))
      if (removed.length) await clients.logs.send(new UntagResourceCommand({ resourceArn: arn, tagKeys: removed }))
      if (next.length) await clients.logs.send(new TagResourceCommand({ resourceArn: arn, tags: Object.fromEntries(next.map((t) => [t.Key, t.Value])) }))
    },
    { invalidate: [['logs', 'tags', arn]], success: 'Tags saved' },
  )
  return (
    <div className="flex flex-col gap-6">
      <Panel title="Details">
        <KeyValue items={[
          ['ARN', <Mono copy>{arn}</Mono>],
          ['Created', formatDate(new Date(info?.creationTime ?? 0))],
          ['Stored', formatBytes(info?.storedBytes)],
          ['Class', info?.logGroupClass],
          ['Retention', (
            <Select value={String(info?.retentionInDays ?? '')} onChange={(e) => setRetention.mutate(e.target.value)}>
              <Option value="">Never expire</Option>
              {retentionDays.map((d) => <Option key={d} value={String(d)}>{retentionLabel(d)}</Option>)}
            </Select>
          )],
        ]} />
      </Panel>
      <MetricFilters group={group} />
      <Panel title="Tags">
        {tags.isLoading ? <Spinner /> : tags.isError ? <ErrorBox error={tags.error} /> : (
          <TagsEditor tags={tags.data} saving={saveTags.isPending} onSave={(t) => saveTags.mutate(t)} />
        )}
      </Panel>
    </div>
  )
}

function MetricFilters({ group }: { group: string }) {
  const { clients } = useSettings()
  const filters = useQuery({
    queryKey: ['logs', 'metric-filters', group],
    queryFn: async () => (await clients.logs.send(new DescribeMetricFiltersCommand({ logGroupName: group }))).metricFilters ?? [],
  })
  const [form, setForm] = useState<{ name: string; pattern: string; metric: string; namespace: string } | null>(null)
  const put = useAction(
    () => clients.logs.send(new PutMetricFilterCommand({
      logGroupName: group, filterName: form!.name, filterPattern: form!.pattern,
      metricTransformations: [{ metricName: form!.metric, metricNamespace: form!.namespace, metricValue: '1' }],
    })),
    { invalidate: [['logs']], success: 'Metric filter saved', onSuccess: () => setForm(null) },
  )
  const del = useAction((filterName: string) => clients.logs.send(new DeleteMetricFilterCommand({ logGroupName: group, filterName })), {
    invalidate: [['logs']], success: 'Metric filter deleted',
  })
  return (
    <Panel flush title="Metric filters" description="Stored and returned; may does not publish metrics."
      actions={<Button icon={<Plus />} onClick={() => setForm({ name: '', pattern: 'ERROR', metric: 'ErrorCount', namespace: 'App' })}>Add</Button>}>
      <Table
        rows={filters.data}
        loading={filters.isLoading}
        error={filters.error}
        rowKey={(f) => f.filterName!}
        empty={<Empty title="No metric filters" />}
        columns={[
          { header: 'Name', render: (f) => <NameCell>{f.filterName}</NameCell> },
          { header: 'Pattern', render: (f) => <code className="text-xs">{f.filterPattern || '(all events)'}</code> },
          { header: 'Metric', render: (f) => `${f.metricTransformations?.[0]?.metricNamespace}/${f.metricTransformations?.[0]?.metricName}` },
          { header: '', className: 'w-14 text-right', render: (f) => <IconButton label="Delete" onClick={() => del.mutate(f.filterName!)}><Trash2 /></IconButton> },
        ]}
      />
      {form && (
        <Modal title="Add metric filter" onClose={() => setForm(null)} footer={<>
          <Button variant="secondary" onClick={() => setForm(null)}>Cancel</Button>
          <Button variant="primary" disabled={!form.name || !form.metric || !form.namespace} loading={put.isPending} onClick={() => put.mutate(undefined)}>Save</Button>
        </>}>
          <div className="flex flex-col gap-5">
            <Field label="Filter name"><Input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Filter pattern"><Input className="font-mono text-xs" value={form.pattern} onChange={(e) => setForm({ ...form, pattern: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-5">
              <Field label="Metric namespace"><Input value={form.namespace} onChange={(e) => setForm({ ...form, namespace: e.target.value })} /></Field>
              <Field label="Metric name"><Input value={form.metric} onChange={(e) => setForm({ ...form, metric: e.target.value })} /></Field>
            </div>
          </div>
        </Modal>
      )}
    </Panel>
  )
}
