import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  GetRoleCommand, ListInstanceProfilesForRoleCommand, ListRoleTagsCommand, TagRoleCommand, UntagRoleCommand,
  UpdateAssumeRolePolicyCommand, UpdateRoleCommand, type Role as IamRole,
} from '@aws-sdk/client-iam'
import { Server, Trash2 } from 'lucide-react'
import { useSettings } from '@/lib/settings'
import { useAction } from '@/lib/hooks'
import { decodePolicy } from '@/lib/aws'
import { formatDate, validJson } from '@/lib/format'
import { TagsEditor } from '@/components/TagsEditor'
import {
  Button, Confirm, Empty, ErrorBox, Field, Input, JsonEditor, KeyValue, Mono, NameCell, Option, PageHeader, Panel,
  Select, Spinner, Table, Tabs,
} from '@/components/common'
import { PrincipalPolicies, replaceTags } from './shared'
import { deleteRoleFully } from './Roles'

type Tab = 'permissions' | 'trust' | 'profiles' | 'tags'

export default function Role() {
  const { name = '' } = useParams()
  const { clients } = useSettings()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) ?? 'permissions'
  const [deleting, setDeleting] = useState(false)

  const role = useQuery({
    queryKey: ['iam', 'role', name],
    queryFn: async () => (await clients.iam.send(new GetRoleCommand({ RoleName: name }))).Role!,
  })
  const del = useAction(() => deleteRoleFully(clients.iam, name), {
    invalidate: [['iam'], ['count']], success: `Deleted role ${name}`, onSuccess: () => navigate('/iam/roles'),
  })

  const crumbs = [{ label: 'IAM' }, { label: 'Roles', to: '/iam/roles' }, { label: name }]
  if (role.isLoading) return <><PageHeader title={name} crumbs={crumbs} /><Spinner /></>
  if (role.isError) return <><PageHeader title={name} crumbs={crumbs} /><ErrorBox error={role.error} onRetry={() => role.refetch()} /></>
  const r = role.data!

  return (
    <>
      <PageHeader title={name} crumbs={crumbs}
        actions={<Button variant="danger" icon={<Trash2 />} onClick={() => setDeleting(true)}>Delete role</Button>} />
      <Summary role={r} />
      <div className="h-6" />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={[
        { id: 'permissions', label: 'Permissions' },
        { id: 'trust', label: 'Trust relationships' },
        { id: 'profiles', label: 'Instance profiles' },
        { id: 'tags', label: 'Tags' },
      ]} />
      {tab === 'permissions' && <PrincipalPolicies kind="role" name={name} />}
      {tab === 'trust' && <Trust name={name} doc={decodePolicy(r.AssumeRolePolicyDocument)} />}
      {tab === 'profiles' && <Profiles name={name} />}
      {tab === 'tags' && <Tags name={name} />}
      {deleting && (
        <Confirm title={`Delete role ${name}?`} confirmText={name} loading={del.isPending}
          onConfirm={() => del.mutate(undefined)} onClose={() => setDeleting(false)}>
          <p>The role is removed from its instance profiles, its policies are detached and its inline policies deleted.</p>
        </Confirm>
      )}
    </>
  )
}

function Summary({ role }: { role: IamRole }) {
  const { clients } = useSettings()
  const [editing, setEditing] = useState(false)
  const [description, setDescription] = useState(role.Description ?? '')
  const [maxSession, setMaxSession] = useState(role.MaxSessionDuration ?? 3600)
  useEffect(() => {
    setDescription(role.Description ?? '')
    setMaxSession(role.MaxSessionDuration ?? 3600)
  }, [role])
  const save = useAction(
    () => clients.iam.send(new UpdateRoleCommand({ RoleName: role.RoleName, Description: description, MaxSessionDuration: maxSession })),
    { invalidate: [['iam', 'role', role.RoleName], ['iam', 'roles']], success: 'Role updated', onSuccess: () => setEditing(false) },
  )

  return (
    <Panel title="Summary" actions={editing ? <>
      <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
      <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button>
    </> : <Button onClick={() => setEditing(true)}>Edit</Button>}>
      {editing ? (
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Description"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <Field label="Maximum session duration">
            <Select className="w-full" value={maxSession} onChange={(e) => setMaxSession(Number(e.target.value))}>
              {[...new Set([maxSession, 3600, 7200, 14400, 28800, 43200])].sort((a, b) => a - b).map((s) => (
                <Option key={s} value={s}>{s / 3600} hour{s === 3600 ? '' : 's'}</Option>
              ))}
            </Select>
          </Field>
        </div>
      ) : (
        <KeyValue items={[
          ['ARN', <Mono copy>{role.Arn}</Mono>],
          ['Role ID', <Mono copy>{role.RoleId}</Mono>],
          ['Path', <Mono>{role.Path}</Mono>],
          ['Created', formatDate(role.CreateDate)],
          ['Description', role.Description || '—'],
          ['Maximum session duration', `${(role.MaxSessionDuration ?? 3600) / 3600} hour(s)`],
        ]} />
      )}
    </Panel>
  )
}

function Trust({ name, doc }: { name: string; doc: string }) {
  const { clients } = useSettings()
  const [text, setText] = useState(doc)
  useEffect(() => setText(doc), [doc])
  const save = useAction(
    () => clients.iam.send(new UpdateAssumeRolePolicyCommand({ RoleName: name, PolicyDocument: text })),
    { invalidate: [['iam', 'role', name]], success: 'Trust policy updated' },
  )
  return (
    <Panel title="Trust policy" description="Which principals can assume this role with sts:AssumeRole.">
      <div className="flex flex-col gap-4">
        <JsonEditor value={text} onChange={setText} rows={16} />
        <div className="flex justify-end gap-2">
          {text !== doc && <Button variant="ghost" onClick={() => setText(doc)}>Discard</Button>}
          <Button variant="primary" loading={save.isPending} disabled={text === doc || !!validJson(text)} onClick={() => save.mutate(undefined)}>
            Update trust policy
          </Button>
        </div>
      </div>
    </Panel>
  )
}

function Profiles({ name }: { name: string }) {
  const { clients } = useSettings()
  const q = useQuery({
    queryKey: ['iam', 'role', name, 'profiles'],
    queryFn: async () => (await clients.iam.send(new ListInstanceProfilesForRoleCommand({ RoleName: name }))).InstanceProfiles ?? [],
  })
  return (
    <Panel flush title="Instance profiles" description="EC2 instances launched with these profiles receive this role.">
      <Table rows={q.data} loading={q.isLoading} error={q.error} rowKey={(p) => p.InstanceProfileName!}
        empty={<Empty title="Not in any instance profile" icon={<Server />} />}
        columns={[
          { header: 'Name', render: (p) => <NameCell icon={<Server />} to="/iam/instance-profiles">{p.InstanceProfileName}</NameCell> },
          { header: 'ARN', render: (p) => <Mono copy>{p.Arn}</Mono> },
          { header: 'Created', className: 'w-56', render: (p) => formatDate(p.CreateDate) },
        ]} />
    </Panel>
  )
}

function Tags({ name }: { name: string }) {
  const { clients } = useSettings()
  const q = useQuery({
    queryKey: ['iam', 'role', name, 'tags'],
    queryFn: async () => (await clients.iam.send(new ListRoleTagsCommand({ RoleName: name }))).Tags ?? [],
  })
  const save = useAction(
    (tags: { Key: string; Value: string }[]) => replaceTags(q.data, tags,
      (Tags) => clients.iam.send(new TagRoleCommand({ RoleName: name, Tags })),
      (TagKeys) => clients.iam.send(new UntagRoleCommand({ RoleName: name, TagKeys }))),
    { invalidate: [['iam', 'role', name]], success: 'Tags saved' },
  )
  return (
    <Panel title="Tags">
      {q.isLoading ? <Spinner /> : q.isError ? <ErrorBox error={q.error} /> : (
        <TagsEditor tags={q.data} saving={save.isPending} onSave={(t) => save.mutate(t)} />
      )}
    </Panel>
  )
}
