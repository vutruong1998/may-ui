import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { CreateQueueCommand, DeleteQueueCommand } from '@aws-sdk/client-sqs'
import { MessagesSquare, Plus, Trash2 } from 'lucide-react'
import { useSettings } from '@/lib/settings'
import { useAction } from '@/lib/hooks'
import { formatDate } from '@/lib/format'
import { formatSeconds, queueNamePattern, useQueues, type QueueInfo } from '@/lib/sqs'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Badge, Button, Confirm, Empty, Field, IconButton, Input, Modal, NameCell, Option, PageHeader, Panel, RefreshButton,
  Select, Table,
} from '@/components/common'

export default function Queues() {
  const { clients } = useSettings()
  const queues = useQueues()
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<QueueInfo | null>(null)

  const del = useAction(
    async (q: QueueInfo) => {
      await clients.sqs.send(new DeleteQueueCommand({ QueueUrl: q.url }))
      return q.name
    },
    { invalidate: [['sqs'], ['count']], success: (n) => `Deleted queue ${n}`, onSuccess: () => setDeleting(null) },
  )

  return (
    <>
      <PageHeader
        title="SQS queues"
        description="Message queues compatible with the Amazon SQS API: standard and FIFO, with dead-letter queues."
        actions={<>
          <RefreshButton onClick={() => queues.refetch()} spinning={queues.isFetching} />
          <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>Create queue</Button>
        </>}
      />
      <Panel flush>
        <Table
          rows={queues.data}
          loading={queues.isLoading}
          error={queues.error}
          onRetry={() => queues.refetch()}
          rowKey={(q) => q.url}
          filterPlaceholder="Find queues by name"
          empty={<Empty title="No queues" icon={<MessagesSquare />}>Create a queue to start sending messages.</Empty>}
          columns={[
            { header: 'Name', text: (q) => q.name, render: (q) => (
              <NameCell icon={<MessagesSquare />} to={`/sqs/${encodeURIComponent(q.name)}`}>{q.name}</NameCell>
            ) },
            { header: 'Type', className: 'w-28', render: (q) => <Badge tone={q.fifo ? 'blue' : 'neutral'}>{q.fifo ? 'FIFO' : 'Standard'}</Badge> },
            { header: 'Available', className: 'w-24 tabular-nums', render: (q) => q.attributes.ApproximateNumberOfMessages },
            { header: 'In flight', className: 'w-24 tabular-nums', render: (q) => q.attributes.ApproximateNumberOfMessagesNotVisible },
            { header: 'Delayed', className: 'w-24 tabular-nums', render: (q) => q.attributes.ApproximateNumberOfMessagesDelayed },
            { header: 'Visibility timeout', className: 'w-36', render: (q) => formatSeconds(q.attributes.VisibilityTimeout) },
            { header: 'Created', className: 'w-56', render: (q) => formatDate(new Date(Number(q.attributes.CreatedTimestamp) * 1000)) },
            { header: '', className: 'w-14 text-right', render: (q) => (
              <IconButton label={`Delete ${q.name}`} onClick={() => setDeleting(q)}><Trash2 /></IconButton>
            ) },
          ]}
        />
      </Panel>
      {creating && <CreateQueue queues={queues.data ?? []} onClose={() => setCreating(false)} />}
      {deleting && (
        <Confirm title={`Delete queue ${deleting.name}?`} confirmText={deleting.name} loading={del.isPending}
          onConfirm={() => del.mutate(deleting)} onClose={() => setDeleting(null)}>
          <p>The queue and all of its messages are deleted. This cannot be undone.</p>
        </Confirm>
      )}
    </>
  )
}

function CreateQueue({ queues, onClose }: { queues: QueueInfo[]; onClose: () => void }) {
  const { clients } = useSettings()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [fifo, setFifo] = useState(false)
  const [contentDedup, setContentDedup] = useState(false)
  const [visibility, setVisibility] = useState('30')
  const [delay, setDelay] = useState('0')
  const [retention, setRetention] = useState('345600')
  const [wait, setWait] = useState('0')
  const [dlq, setDlq] = useState('')
  const [maxReceives, setMaxReceives] = useState('5')

  const fullName = fifo ? `${name.replace(/\.fifo$/, '')}.fifo` : name
  const valid = queueNamePattern.test(name.replace(/\.fifo$/, '')) && fullName.length <= 80
  const dlqCandidates = queues.filter((q) => q.fifo === fifo)

  const create = useAction(
    () => {
      const Attributes: Record<string, string> = {
        VisibilityTimeout: visibility, DelaySeconds: delay, MessageRetentionPeriod: retention, ReceiveMessageWaitTimeSeconds: wait,
      }
      if (fifo) {
        Attributes.FifoQueue = 'true'
        Attributes.ContentBasedDeduplication = String(contentDedup)
      }
      if (dlq) {
        const arn = queues.find((q) => q.url === dlq)?.attributes.QueueArn
        Attributes.RedrivePolicy = JSON.stringify({ deadLetterTargetArn: arn, maxReceiveCount: Number(maxReceives) })
      }
      return clients.sqs.send(new CreateQueueCommand({ QueueName: fullName, Attributes }))
    },
    { invalidate: [['sqs'], ['count']], success: `Created queue ${fullName}`, onSuccess: () => navigate(`/sqs/${encodeURIComponent(fullName)}`) },
  )
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (valid) create.mutate(undefined)
  }

  return (
    <Modal title="Create queue" wide onClose={onClose} footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button variant="primary" type="submit" form="create-queue" disabled={!valid} loading={create.isPending}>Create queue</Button>
    </>}>
      <form id="create-queue" className="flex flex-col gap-5" onSubmit={submit}>
        <div className="grid gap-5 sm:grid-cols-[1fr_12rem]">
          <Field label="Name" hint={fifo ? <>Saved as <code>{fullName || 'name.fifo'}</code></> : undefined}
            error={name && !valid ? 'Up to 80 characters: letters, numbers, hyphens and underscores.' : null}>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="orders" />
          </Field>
          <Field label="Type">
            <Select className="w-full" value={fifo ? 'fifo' : 'standard'} onChange={(e) => { setFifo(e.target.value === 'fifo'); setDlq('') }}>
              <Option value="standard">Standard</Option>
              <Option value="fifo">FIFO</Option>
            </Select>
          </Field>
        </div>
        {fifo && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={contentDedup} onCheckedChange={(v) => setContentDedup(v === true)} />
            Content-based deduplication (deduplicate by a SHA-256 of the body)
          </label>
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Visibility timeout (seconds)" hint="0 to 43,200">
            <Input type="number" min={0} max={43200} value={visibility} onChange={(e) => setVisibility(e.target.value)} />
          </Field>
          <Field label="Delivery delay (seconds)" hint="0 to 900">
            <Input type="number" min={0} max={900} value={delay} onChange={(e) => setDelay(e.target.value)} />
          </Field>
          <Field label="Message retention (seconds)" hint={`${formatSeconds(retention)}; 60 to 1,209,600`}>
            <Input type="number" min={60} max={1209600} value={retention} onChange={(e) => setRetention(e.target.value)} />
          </Field>
          <Field label="Receive wait time (seconds)" hint="Long polling: 0 to 20">
            <Input type="number" min={0} max={20} value={wait} onChange={(e) => setWait(e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-5 sm:grid-cols-[1fr_12rem]">
          <Field label="Dead-letter queue" hint={dlqCandidates.length ? 'Messages received too many times move here.' : `Create a ${fifo ? 'FIFO' : 'standard'} queue first to use it as a dead-letter queue.`}>
            <Select className="w-full" value={dlq} onChange={(e) => setDlq(e.target.value)} disabled={!dlqCandidates.length}>
              <Option value="">None</Option>
              {dlqCandidates.map((q) => <Option key={q.url} value={q.url}>{q.name}</Option>)}
            </Select>
          </Field>
          <Field label="Maximum receives">
            <Input type="number" min={1} max={1000} value={maxReceives} disabled={!dlq} onChange={(e) => setMaxReceives(e.target.value)} />
          </Field>
        </div>
      </form>
    </Modal>
  )
}
