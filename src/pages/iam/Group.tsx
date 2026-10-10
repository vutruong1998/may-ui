import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AddUserToGroupCommand, GetGroupCommand, ListUsersCommand, RemoveUserFromGroupCommand } from '@aws-sdk/client-iam'
import { Trash2, User, UserMinus, UserPlus } from 'lucide-react'
import { useSettings } from '@/lib/settings'
import { useAction } from '@/lib/hooks'
import { formatDate } from '@/lib/format'
import {
  Button, Confirm, Empty, ErrorBox, IconButton, KeyValue, Modal, Mono, NameCell, Option, PageHeader, Panel, Select,
  Spinner, Table, Tabs,
} from '@/components/common'
import { PrincipalPolicies } from './shared'
import { deleteGroupFully } from './Groups'

type Tab = 'users' | 'permissions'

export default function Group() {
  const { name = '' } = useParams()
  const { clients } = useSettings()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) ?? 'users'
  const [deleting, setDeleting] = useState(false)
  const [adding, setAdding] = useState(false)
  const [choice, setChoice] = useState('')

  const key = ['iam', 'group', name]
  const group = useQuery({ queryKey: key, queryFn: () => clients.iam.send(new GetGroupCommand({ GroupName: name })) })
  const allUsers = useQuery({
    queryKey: ['iam', 'users'],
    queryFn: async () => (await clients.iam.send(new ListUsersCommand({ MaxItems: 1000 }))).Users ?? [],
    enabled: adding,
  })
  const add = useAction((UserName: string) => clients.iam.send(new AddUserToGroupCommand({ GroupName: name, UserName })), {
    invalidate: [key, ['iam', 'user']], success: 'User added', onSuccess: () => { setAdding(false); setChoice('') },
  })
  const remove = useAction((UserName: string) => clients.iam.send(new RemoveUserFromGroupCommand({ GroupName: name, UserName })), {
    invalidate: [key, ['iam', 'user']], success: 'User removed',
  })
  const del = useAction(() => deleteGroupFully(clients.iam, name), {
    invalidate: [['iam'], ['count']], success: `Deleted group ${name}`, onSuccess: () => navigate('/iam/groups'),
  })

  const crumbs = [{ label: 'IAM' }, { label: 'Groups', to: '/iam/groups' }, { label: name }]
  if (group.isLoading) return <><PageHeader title={name} crumbs={crumbs} /><Spinner /></>
  if (group.isError) return <><PageHeader title={name} crumbs={crumbs} /><ErrorBox error={group.error} onRetry={() => group.refetch()} /></>
  const g = group.data!.Group!
  const members = group.data!.Users ?? []
  const memberNames = new Set(members.map((u) => u.UserName))
  const available = allUsers.data?.filter((u) => !memberNames.has(u.UserName)) ?? []

  return (
    <>
      <PageHeader title={name} crumbs={crumbs}
        actions={<Button variant="danger" icon={<Trash2 />} onClick={() => setDeleting(true)}>Delete group</Button>} />
      <Panel title="Summary">
        <KeyValue items={[
          ['ARN', <Mono copy>{g.Arn}</Mono>],
          ['Group ID', <Mono copy>{g.GroupId}</Mono>],
          ['Path', <Mono>{g.Path}</Mono>],
          ['Created', formatDate(g.CreateDate)],
        ]} />
      </Panel>
      <div className="h-6" />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={[
        { id: 'users', label: `Users (${members.length})` },
        { id: 'permissions', label: 'Permissions' },
      ]} />
      {tab === 'users' ? (
        <Panel flush title="Members" actions={<Button icon={<UserPlus />} onClick={() => setAdding(true)}>Add users</Button>}>
          <Table rows={members} rowKey={(u) => u.UserName!} empty={<Empty title="No members" icon={<User />} />}
            columns={[
              { header: 'User', render: (u) => <NameCell icon={<User />} to={`/iam/users/${encodeURIComponent(u.UserName!)}`}>{u.UserName}</NameCell> },
              { header: 'ARN', render: (u) => <Mono>{u.Arn}</Mono> },
              { header: '', className: 'w-14 text-right', render: (u) => (
                <IconButton label="Remove from group" disabled={remove.isPending} onClick={() => remove.mutate(u.UserName!)}><UserMinus /></IconButton>
              ) },
            ]} />
        </Panel>
      ) : <PrincipalPolicies kind="group" name={name} />}

      {adding && (
        <Modal title="Add user to group" onClose={() => setAdding(false)} footer={<>
          <Button variant="secondary" onClick={() => setAdding(false)}>Cancel</Button>
          <Button variant="primary" disabled={!choice} loading={add.isPending} onClick={() => add.mutate(choice)}>Add</Button>
        </>}>
          {allUsers.isLoading ? <Spinner /> : (
            <Select className="w-full" value={choice} onChange={(e) => setChoice(e.target.value)}>
              <Option value="">{available.length ? 'Choose a user…' : 'No users to add'}</Option>
              {available.map((u) => <Option key={u.UserName} value={u.UserName}>{u.UserName}</Option>)}
            </Select>
          )}
        </Modal>
      )}
      {deleting && (
        <Confirm title={`Delete group ${name}?`} confirmText={name} loading={del.isPending}
          onConfirm={() => del.mutate(undefined)} onClose={() => setDeleting(false)}>
          <p>Members are removed from the group and its policies are detached or deleted. The users themselves are kept.</p>
        </Confirm>
      )}
    </>
  )
}
