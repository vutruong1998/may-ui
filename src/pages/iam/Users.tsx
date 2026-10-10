import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  CreateUserCommand, DeleteAccessKeyCommand, DeleteUserCommand, ListAccessKeysCommand, ListGroupsForUserCommand,
  ListUsersCommand, RemoveUserFromGroupCommand, type IAMClient,
} from '@aws-sdk/client-iam'
import { Plus, Trash2, User } from 'lucide-react'
import { useSettings } from '@/lib/settings'
import { useAction } from '@/lib/hooks'
import { formatDate } from '@/lib/format'
import {
  Button, Confirm, Empty, Field, IconButton, Input, Modal, NameCell, PageHeader, Panel, RefreshButton, Table,
} from '@/components/common'
import { clearPolicies, iamNamePattern } from './shared'

/** Removes everything IAM requires gone before DeleteUser succeeds. */
export async function deleteUserFully(iam: IAMClient, name: string) {
  for (const k of (await iam.send(new ListAccessKeysCommand({ UserName: name }))).AccessKeyMetadata ?? []) {
    await iam.send(new DeleteAccessKeyCommand({ UserName: name, AccessKeyId: k.AccessKeyId }))
  }
  for (const g of (await iam.send(new ListGroupsForUserCommand({ UserName: name }))).Groups ?? []) {
    await iam.send(new RemoveUserFromGroupCommand({ UserName: name, GroupName: g.GroupName }))
  }
  await clearPolicies(iam, 'user', name)
  await iam.send(new DeleteUserCommand({ UserName: name }))
}

export default function Users() {
  const { clients } = useSettings()
  const users = useQuery({
    queryKey: ['iam', 'users'],
    queryFn: async () => (await clients.iam.send(new ListUsersCommand({ MaxItems: 1000 }))).Users ?? [],
  })
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const del = useAction((name: string) => deleteUserFully(clients.iam, name), {
    invalidate: [['iam'], ['count']], success: `Deleted user ${deleting}`, onSuccess: () => setDeleting(null),
  })

  return (
    <>
      <PageHeader title="Users" description="Long-term identities with access keys."
        actions={<>
          <RefreshButton onClick={() => users.refetch()} spinning={users.isFetching} />
          <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>Create user</Button>
        </>} />
      <Panel flush>
        <Table
          rows={users.data}
          loading={users.isLoading}
          error={users.error}
          onRetry={() => users.refetch()}
          rowKey={(u) => u.UserName!}
          filterPlaceholder="Find users"
          empty={<Empty title="No users" icon={<User />}>Create a user to issue access keys for CI or local tools.</Empty>}
          columns={[
            { header: 'User name', text: (u) => u.UserName!,
              render: (u) => <NameCell icon={<User />} to={`/iam/users/${encodeURIComponent(u.UserName!)}`}>{u.UserName}</NameCell> },
            { header: 'Path', className: 'w-28 font-mono text-xs', render: (u) => u.Path },
            { header: 'User ID', className: 'font-mono text-xs text-muted-foreground', render: (u) => u.UserId },
            { header: 'Created', className: 'w-56', render: (u) => formatDate(u.CreateDate) },
            { header: '', className: 'w-14 text-right', render: (u) => (
              <IconButton label={`Delete ${u.UserName}`} onClick={() => setDeleting(u.UserName!)}><Trash2 /></IconButton>
            ) },
          ]}
        />
      </Panel>
      {creating && <CreateUser onClose={() => setCreating(false)} />}
      {deleting && (
        <Confirm title={`Delete user ${deleting}?`} confirmText={deleting} loading={del.isPending}
          onConfirm={() => del.mutate(deleting)} onClose={() => setDeleting(null)}>
          <p>The user's access keys are deleted, it leaves its groups, and its policies are detached or deleted.</p>
        </Confirm>
      )}
    </>
  )
}

function CreateUser({ onClose }: { onClose: () => void }) {
  const { clients } = useSettings()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [path, setPath] = useState('/')
  const create = useAction(() => clients.iam.send(new CreateUserCommand({ UserName: name, Path: path })), {
    invalidate: [['iam', 'users'], ['count']], success: `Created user ${name}`,
    onSuccess: () => navigate(`/iam/users/${encodeURIComponent(name)}?tab=credentials`),
  })
  const nameError = name && !iamNamePattern.test(name) ? 'Up to 64 letters, numbers and +=,.@_-' : null
  const pathError = !/^\/([\w+=,.@-]+\/)*$/.test(path) ? 'Must begin and end with /' : null

  return (
    <Modal title="Create user" onClose={onClose} footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button variant="primary" loading={create.isPending} disabled={!name || !!nameError || !!pathError}
        onClick={() => create.mutate(undefined)}>Create user</Button>
    </>}>
      <div className="flex flex-col gap-5">
        <Field label="User name" error={nameError}>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="ci-deployer"
            onKeyDown={(e) => e.key === 'Enter' && name && !nameError && create.mutate(undefined)} />
        </Field>
        <Field label="Path" error={pathError}>
          <Input className="font-mono" value={path} onChange={(e) => setPath(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
