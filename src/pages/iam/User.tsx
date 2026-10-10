import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  AddUserToGroupCommand, CreateAccessKeyCommand, DeleteAccessKeyCommand, GetUserCommand, ListAccessKeysCommand,
  ListGroupsCommand, ListGroupsForUserCommand, ListUserTagsCommand, RemoveUserFromGroupCommand, TagUserCommand,
  UntagUserCommand, UpdateAccessKeyCommand, type AccessKey,
} from '@aws-sdk/client-iam'
import { AlertTriangle, KeyRound, Plus, Trash2, UserMinus, Users } from 'lucide-react'
import { useSettings } from '@/lib/settings'
import { useAction } from '@/lib/hooks'
import { formatDate } from '@/lib/format'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { TagsEditor } from '@/components/TagsEditor'
import {
  Badge, Button, CodeBlock, Confirm, Empty, ErrorBox, IconButton, KeyValue, Modal, Mono, NameCell, Option, PageHeader,
  Panel, Select, Spinner, Table, Tabs,
} from '@/components/common'
import { PrincipalPolicies, replaceTags } from './shared'
import { deleteUserFully } from './Users'

type Tab = 'permissions' | 'groups' | 'credentials' | 'tags'

export default function UserPage() {
  const { name = '' } = useParams()
  const { clients } = useSettings()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) ?? 'permissions'
  const [deleting, setDeleting] = useState(false)

  const user = useQuery({
    queryKey: ['iam', 'user', name],
    queryFn: async () => (await clients.iam.send(new GetUserCommand({ UserName: name }))).User!,
  })
  const del = useAction(() => deleteUserFully(clients.iam, name), {
    invalidate: [['iam'], ['count']], success: `Deleted user ${name}`, onSuccess: () => navigate('/iam/users'),
  })

  const crumbs = [{ label: 'IAM' }, { label: 'Users', to: '/iam/users' }, { label: name }]
  if (user.isLoading) return <><PageHeader title={name} crumbs={crumbs} /><Spinner /></>
  if (user.isError) return <><PageHeader title={name} crumbs={crumbs} /><ErrorBox error={user.error} onRetry={() => user.refetch()} /></>
  const u = user.data!

  return (
    <>
      <PageHeader title={name} crumbs={crumbs}
        actions={<Button variant="danger" icon={<Trash2 />} onClick={() => setDeleting(true)}>Delete user</Button>} />
      <Panel title="Summary">
        <KeyValue items={[
          ['ARN', <Mono copy>{u.Arn}</Mono>],
          ['User ID', <Mono copy>{u.UserId}</Mono>],
          ['Path', <Mono>{u.Path}</Mono>],
          ['Created', formatDate(u.CreateDate)],
        ]} />
      </Panel>
      <div className="h-6" />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={[
        { id: 'permissions', label: 'Permissions' },
        { id: 'groups', label: 'Groups' },
        { id: 'credentials', label: 'Security credentials' },
        { id: 'tags', label: 'Tags' },
      ]} />
      {tab === 'permissions' && <PrincipalPolicies kind="user" name={name} />}
      {tab === 'groups' && <UserGroups name={name} />}
      {tab === 'credentials' && <AccessKeys name={name} />}
      {tab === 'tags' && <UserTags name={name} />}
      {deleting && (
        <Confirm title={`Delete user ${name}?`} confirmText={name} loading={del.isPending}
          onConfirm={() => del.mutate(undefined)} onClose={() => setDeleting(false)}>
          <p>The user's access keys are deleted, it leaves its groups, and its policies are detached or deleted.</p>
        </Confirm>
      )}
    </>
  )
}

function UserGroups({ name }: { name: string }) {
  const { clients } = useSettings()
  const key = ['iam', 'user', name, 'groups']
  const groups = useQuery({
    queryKey: key,
    queryFn: async () => (await clients.iam.send(new ListGroupsForUserCommand({ UserName: name }))).Groups ?? [],
  })
  const all = useQuery({
    queryKey: ['iam', 'groups'],
    queryFn: async () => (await clients.iam.send(new ListGroupsCommand({ MaxItems: 1000 }))).Groups ?? [],
  })
  const [adding, setAdding] = useState(false)
  const [choice, setChoice] = useState('')
  const add = useAction((GroupName: string) => clients.iam.send(new AddUserToGroupCommand({ UserName: name, GroupName })), {
    invalidate: [key, ['iam', 'group']], success: 'Added to group', onSuccess: () => { setAdding(false); setChoice('') },
  })
  const remove = useAction((GroupName: string) => clients.iam.send(new RemoveUserFromGroupCommand({ UserName: name, GroupName })), {
    invalidate: [key, ['iam', 'group']], success: 'Removed from group',
  })
  const member = new Set(groups.data?.map((g) => g.GroupName))
  const available = all.data?.filter((g) => !member.has(g.GroupName)) ?? []

  return (
    <Panel flush title="Groups" description="The user also gets every policy of its groups."
      actions={<Button icon={<Plus />} onClick={() => setAdding(true)}>Add to group</Button>}>
      <Table rows={groups.data} loading={groups.isLoading} error={groups.error} rowKey={(g) => g.GroupName!}
        empty={<Empty title="Not in any group" icon={<Users />} />}
        columns={[
          { header: 'Group', render: (g) => <NameCell icon={<Users />} to={`/iam/groups/${encodeURIComponent(g.GroupName!)}`}>{g.GroupName}</NameCell> },
          { header: 'ARN', render: (g) => <Mono>{g.Arn}</Mono> },
          { header: '', className: 'w-14 text-right', render: (g) => (
            <IconButton label="Remove from group" disabled={remove.isPending} onClick={() => remove.mutate(g.GroupName!)}><UserMinus /></IconButton>
          ) },
        ]} />
      {adding && (
        <Modal title="Add to group" onClose={() => setAdding(false)} footer={<>
          <Button variant="secondary" onClick={() => setAdding(false)}>Cancel</Button>
          <Button variant="primary" disabled={!choice} loading={add.isPending} onClick={() => add.mutate(choice)}>Add</Button>
        </>}>
          <Select className="w-full" value={choice} onChange={(e) => setChoice(e.target.value)}>
            <Option value="">{available.length ? 'Choose a group…' : 'No other groups: create one under IAM → Groups'}</Option>
            {available.map((g) => <Option key={g.GroupName} value={g.GroupName}>{g.GroupName}</Option>)}
          </Select>
        </Modal>
      )}
    </Panel>
  )
}

function AccessKeys({ name }: { name: string }) {
  const { clients, settings, update } = useSettings()
  const key = ['iam', 'user', name, 'keys']
  const keys = useQuery({
    queryKey: key,
    queryFn: async () => (await clients.iam.send(new ListAccessKeysCommand({ UserName: name }))).AccessKeyMetadata ?? [],
  })
  const [created, setCreated] = useState<AccessKey | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const create = useAction(() => clients.iam.send(new CreateAccessKeyCommand({ UserName: name })), {
    invalidate: [key], onSuccess: (r) => setCreated(r.AccessKey!),
  })
  const setStatus = useAction(
    ({ id, status }: { id: string; status: 'Active' | 'Inactive' }) =>
      clients.iam.send(new UpdateAccessKeyCommand({ UserName: name, AccessKeyId: id, Status: status })),
    { invalidate: [key], success: 'Access key updated' },
  )
  const del = useAction((id: string) => clients.iam.send(new DeleteAccessKeyCommand({ UserName: name, AccessKeyId: id })), {
    invalidate: [key], success: 'Access key deleted', onSuccess: () => setDeleting(null),
  })
  const atLimit = (keys.data?.length ?? 0) >= 2

  return (
    <Panel flush title="Access keys" description="Up to two keys per user. Requests signed with a key identify as this user."
      actions={<Button icon={<KeyRound />} disabled={atLimit} loading={create.isPending} onClick={() => create.mutate(undefined)}>
        Create access key
      </Button>}>
      <Table rows={keys.data} loading={keys.isLoading} error={keys.error} rowKey={(k) => k.AccessKeyId!}
        empty={<Empty title="No access keys" icon={<KeyRound />} />}
        columns={[
          { header: 'Access key ID', render: (k) => <Mono copy>{k.AccessKeyId}</Mono> },
          { header: 'Status', className: 'w-28', render: (k) => <Badge tone={k.Status === 'Active' ? 'green' : 'neutral'}>{k.Status}</Badge> },
          { header: 'Created', className: 'w-56', render: (k) => formatDate(k.CreateDate) },
          { header: '', className: 'w-48 text-right', render: (k) => (
            <span className="inline-flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={() => setStatus.mutate({ id: k.AccessKeyId!, status: k.Status === 'Active' ? 'Inactive' : 'Active' })}>
                {k.Status === 'Active' ? 'Deactivate' : 'Activate'}
              </Button>
              <IconButton label="Delete key" onClick={() => setDeleting(k.AccessKeyId!)}><Trash2 /></IconButton>
            </span>
          ) },
        ]} />

      {created && (
        <Modal wide title="Access key created" onClose={() => setCreated(null)} footer={<>
          <Button onClick={() => {
            update({ accessKeyId: created.AccessKeyId!, secretAccessKey: created.SecretAccessKey! })
            setCreated(null)
          }}>Sign this console in as {name}</Button>
          <Button variant="primary" onClick={() => setCreated(null)}>Done</Button>
        </>}>
          <div className="flex flex-col gap-4">
            <Alert>
              <AlertTriangle />
              <AlertDescription>This is the only time the secret access key is shown. Copy it now.</AlertDescription>
            </Alert>
            <KeyValue items={[
              ['Access key ID', <Mono copy>{created.AccessKeyId}</Mono>],
              ['Secret access key', <Mono copy>{created.SecretAccessKey}</Mono>],
            ]} />
            <CodeBlock>{`export AWS_ACCESS_KEY_ID=${created.AccessKeyId}
export AWS_SECRET_ACCESS_KEY=${created.SecretAccessKey}
aws --endpoint-url ${settings.endpoint} sts get-caller-identity`}</CodeBlock>
          </div>
        </Modal>
      )}
      {deleting && (
        <Confirm title="Delete access key?" loading={del.isPending} onConfirm={() => del.mutate(deleting)} onClose={() => setDeleting(null)}>
          <p>Applications using <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{deleting}</code> will no longer identify as {name}.</p>
        </Confirm>
      )}
    </Panel>
  )
}

function UserTags({ name }: { name: string }) {
  const { clients } = useSettings()
  const q = useQuery({
    queryKey: ['iam', 'user', name, 'tags'],
    queryFn: async () => (await clients.iam.send(new ListUserTagsCommand({ UserName: name }))).Tags ?? [],
  })
  const save = useAction(
    (tags: { Key: string; Value: string }[]) => replaceTags(q.data, tags,
      (Tags) => clients.iam.send(new TagUserCommand({ UserName: name, Tags })),
      (TagKeys) => clients.iam.send(new UntagUserCommand({ UserName: name, TagKeys }))),
    { invalidate: [['iam', 'user', name]], success: 'Tags saved' },
  )
  return (
    <Panel title="Tags">
      {q.isLoading ? <Spinner /> : q.isError ? <ErrorBox error={q.error} /> : (
        <TagsEditor tags={q.data} saving={save.isPending} onSave={(t) => save.mutate(t)} />
      )}
    </Panel>
  )
}
