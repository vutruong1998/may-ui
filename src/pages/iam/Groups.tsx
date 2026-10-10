import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  CreateGroupCommand, DeleteGroupCommand, GetGroupCommand, ListGroupsCommand, RemoveUserFromGroupCommand, type IAMClient,
} from '@aws-sdk/client-iam'
import { Plus, Trash2, Users } from 'lucide-react'
import { useSettings } from '@/lib/settings'
import { useAction } from '@/lib/hooks'
import { formatDate } from '@/lib/format'
import {
  Button, Confirm, Empty, Field, IconButton, Input, Modal, NameCell, PageHeader, Panel, RefreshButton, Table,
} from '@/components/common'
import { clearPolicies } from './shared'

export async function deleteGroupFully(iam: IAMClient, name: string) {
  for (const u of (await iam.send(new GetGroupCommand({ GroupName: name }))).Users ?? []) {
    await iam.send(new RemoveUserFromGroupCommand({ GroupName: name, UserName: u.UserName }))
  }
  await clearPolicies(iam, 'group', name)
  await iam.send(new DeleteGroupCommand({ GroupName: name }))
}

export default function Groups() {
  const { clients } = useSettings()
  const groups = useQuery({
    queryKey: ['iam', 'groups'],
    queryFn: async () => (await clients.iam.send(new ListGroupsCommand({ MaxItems: 1000 }))).Groups ?? [],
  })
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const del = useAction((name: string) => deleteGroupFully(clients.iam, name), {
    invalidate: [['iam'], ['count']], success: `Deleted group ${deleting}`, onSuccess: () => setDeleting(null),
  })

  return (
    <>
      <PageHeader title="Groups" description="Collections of users that share permissions."
        actions={<>
          <RefreshButton onClick={() => groups.refetch()} spinning={groups.isFetching} />
          <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>Create group</Button>
        </>} />
      <Panel flush>
        <Table
          rows={groups.data}
          loading={groups.isLoading}
          error={groups.error}
          onRetry={() => groups.refetch()}
          rowKey={(g) => g.GroupName!}
          filterPlaceholder="Find groups"
          empty={<Empty title="No groups" icon={<Users />} />}
          columns={[
            { header: 'Group name', text: (g) => g.GroupName!,
              render: (g) => <NameCell icon={<Users />} to={`/iam/groups/${encodeURIComponent(g.GroupName!)}`}>{g.GroupName}</NameCell> },
            { header: 'Path', className: 'w-28 font-mono text-xs', render: (g) => g.Path },
            { header: 'Created', className: 'w-56', render: (g) => formatDate(g.CreateDate) },
            { header: '', className: 'w-14 text-right', render: (g) => (
              <IconButton label={`Delete ${g.GroupName}`} onClick={() => setDeleting(g.GroupName!)}><Trash2 /></IconButton>
            ) },
          ]}
        />
      </Panel>
      {creating && <CreateGroup onClose={() => setCreating(false)} />}
      {deleting && (
        <Confirm title={`Delete group ${deleting}?`} confirmText={deleting} loading={del.isPending}
          onConfirm={() => del.mutate(deleting)} onClose={() => setDeleting(null)}>
          <p>Members are removed from the group and its policies are detached or deleted. The users themselves are kept.</p>
        </Confirm>
      )}
    </>
  )
}

function CreateGroup({ onClose }: { onClose: () => void }) {
  const { clients } = useSettings()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const create = useAction(() => clients.iam.send(new CreateGroupCommand({ GroupName: name })), {
    invalidate: [['iam', 'groups'], ['count']], success: `Created group ${name}`,
    onSuccess: () => navigate(`/iam/groups/${encodeURIComponent(name)}`),
  })
  const nameError = name && !/^[\w+=,.@-]{1,128}$/.test(name) ? 'Up to 128 letters, numbers and +=,.@_-' : null

  return (
    <Modal title="Create group" onClose={onClose} footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button variant="primary" loading={create.isPending} disabled={!name || !!nameError} onClick={() => create.mutate(undefined)}>
        Create group
      </Button>
    </>}>
      <Field label="Group name" error={nameError}>
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="developers"
          onKeyDown={(e) => e.key === 'Enter' && name && !nameError && create.mutate(undefined)} />
      </Field>
    </Modal>
  )
}
