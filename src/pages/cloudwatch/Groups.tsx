import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CreateLogGroupCommand, DeleteLogGroupCommand, DescribeLogGroupsCommand, PutRetentionPolicyCommand, type LogGroup } from '@aws-sdk/client-cloudwatch-logs'
import { Plus, ScrollText, Trash2 } from 'lucide-react'
import { useSettings } from '@/lib/settings'
import { useAction } from '@/lib/hooks'
import { formatBytes, formatDate } from '@/lib/format'
import {
  Button, Confirm, Empty, Field, IconButton, Input, Modal, NameCell, Option, PageHeader, Panel, RefreshButton, Select, Table,
} from '@/components/common'

export const retentionDays = [1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653]

export function retentionLabel(days: number | undefined): string {
  if (!days) return 'Never expire'
  if (days % 365 === 0) return `${days / 365} year${days === 365 ? '' : 's'}`
  return `${days} day${days === 1 ? '' : 's'}`
}

export async function listGroups(logs: ReturnType<typeof useSettings>['clients']['logs']): Promise<LogGroup[]> {
  const out: LogGroup[] = []
  let nextToken: string | undefined
  do {
    const page = await logs.send(new DescribeLogGroupsCommand({ nextToken }))
    out.push(...(page.logGroups ?? []))
    nextToken = page.nextToken
  } while (nextToken)
  return out
}

export function useLogGroups() {
  const { clients } = useSettings()
  return useQuery({ queryKey: ['logs', 'groups'], queryFn: () => listGroups(clients.logs) })
}

export default function Groups() {
  const { clients } = useSettings()
  const groups = useLogGroups()
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const del = useAction(
    async (logGroupName: string) => {
      await clients.logs.send(new DeleteLogGroupCommand({ logGroupName }))
      return logGroupName
    },
    { invalidate: [['logs'], ['count']], success: (n) => `Deleted log group ${n}`, onSuccess: () => setDeleting(null) },
  )

  return (
    <>
      <PageHeader
        title="CloudWatch log groups"
        description="Log groups and streams compatible with the CloudWatch Logs API, with the filter pattern language."
        actions={<>
          <RefreshButton onClick={() => groups.refetch()} spinning={groups.isFetching} />
          <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>Create log group</Button>
        </>}
      />
      <Panel flush>
        <Table
          rows={groups.data}
          loading={groups.isLoading}
          error={groups.error}
          onRetry={() => groups.refetch()}
          rowKey={(g) => g.logGroupName!}
          filterPlaceholder="Find log groups by name"
          empty={<Empty title="No log groups" icon={<ScrollText />}>Create a log group, or send logs from an application.</Empty>}
          columns={[
            { header: 'Name', text: (g) => g.logGroupName!, render: (g) => (
              <NameCell icon={<ScrollText />} to={`/logs/group?name=${encodeURIComponent(g.logGroupName!)}`}>{g.logGroupName}</NameCell>
            ) },
            { header: 'Retention', className: 'w-36', render: (g) => retentionLabel(g.retentionInDays) },
            { header: 'Metric filters', className: 'w-28 tabular-nums', render: (g) => g.metricFilterCount },
            { header: 'Stored', className: 'w-24 tabular-nums', render: (g) => formatBytes(g.storedBytes) },
            { header: 'Created', className: 'w-56', render: (g) => formatDate(new Date(g.creationTime ?? 0)) },
            { header: '', className: 'w-14 text-right', render: (g) => (
              <IconButton label={`Delete ${g.logGroupName}`} onClick={() => setDeleting(g.logGroupName!)}><Trash2 /></IconButton>
            ) },
          ]}
        />
      </Panel>
      {creating && <CreateGroup onClose={() => setCreating(false)} />}
      {deleting && (
        <Confirm title={`Delete log group ${deleting}?`} loading={del.isPending}
          onConfirm={() => del.mutate(deleting)} onClose={() => setDeleting(null)}>
          <p>All streams and events in the group are deleted.</p>
        </Confirm>
      )}
    </>
  )
}

function CreateGroup({ onClose }: { onClose: () => void }) {
  const { clients } = useSettings()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [retention, setRetention] = useState('')
  const valid = /^[.\-_/#A-Za-z0-9]{1,512}$/.test(name)
  const create = useAction(
    async () => {
      await clients.logs.send(new CreateLogGroupCommand({ logGroupName: name }))
      if (retention) await clients.logs.send(new PutRetentionPolicyCommand({ logGroupName: name, retentionInDays: Number(retention) }))
    },
    { invalidate: [['logs'], ['count']], success: `Created log group ${name}`, onSuccess: () => navigate(`/logs/group?name=${encodeURIComponent(name)}`) },
  )
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (valid) create.mutate(undefined)
  }
  return (
    <Modal title="Create log group" onClose={onClose} footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button variant="primary" type="submit" form="create-group" disabled={!valid} loading={create.isPending}>Create</Button>
    </>}>
      <form id="create-group" className="flex flex-col gap-5" onSubmit={submit}>
        <Field label="Name" error={name && !valid ? 'Letters, numbers and . - _ / # only.' : null}>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="/app/web" />
        </Field>
        <Field label="Retention">
          <Select className="w-full" value={retention} onChange={(e) => setRetention(e.target.value)}>
            <Option value="">Never expire</Option>
            {retentionDays.map((d) => <Option key={d} value={String(d)}>{retentionLabel(d)}</Option>)}
          </Select>
        </Field>
      </form>
    </Modal>
  )
}
