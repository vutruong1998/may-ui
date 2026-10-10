import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  CreateRoleCommand, DeleteRoleCommand, ListInstanceProfilesForRoleCommand, ListRolesCommand,
  RemoveRoleFromInstanceProfileCommand, type IAMClient,
} from '@aws-sdk/client-iam'
import { Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { useSettings } from '@/lib/settings'
import { useAction } from '@/lib/hooks'
import { formatDate, validJson } from '@/lib/format'
import {
  Button, Confirm, Empty, Field, IconButton, Input, JsonEditor, Modal, NameCell, Option, PageHeader, Panel, RefreshButton,
  Select, Table,
} from '@/components/common'
import { clearPolicies, iamNamePattern, trustTemplates } from './shared'

export async function deleteRoleFully(iam: IAMClient, name: string) {
  const profiles = (await iam.send(new ListInstanceProfilesForRoleCommand({ RoleName: name }))).InstanceProfiles ?? []
  for (const p of profiles) {
    await iam.send(new RemoveRoleFromInstanceProfileCommand({ InstanceProfileName: p.InstanceProfileName, RoleName: name }))
  }
  await clearPolicies(iam, 'role', name)
  await iam.send(new DeleteRoleCommand({ RoleName: name }))
}

export default function Roles() {
  const { clients } = useSettings()
  const roles = useQuery({
    queryKey: ['iam', 'roles'],
    queryFn: async () => (await clients.iam.send(new ListRolesCommand({ MaxItems: 1000 }))).Roles ?? [],
  })
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const del = useAction((name: string) => deleteRoleFully(clients.iam, name), {
    invalidate: [['iam'], ['count']], success: `Deleted role ${deleting}`, onSuccess: () => setDeleting(null),
  })

  return (
    <>
      <PageHeader title="Roles" description="Identities with permissions that trusted principals can assume."
        actions={<>
          <RefreshButton onClick={() => roles.refetch()} spinning={roles.isFetching} />
          <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>Create role</Button>
        </>} />
      <Panel flush>
        <Table
          rows={roles.data}
          loading={roles.isLoading}
          error={roles.error}
          onRetry={() => roles.refetch()}
          rowKey={(r) => r.RoleName!}
          filterPlaceholder="Find roles"
          empty={<Empty title="No roles" icon={<ShieldCheck />}>Create a role for your workloads to assume.</Empty>}
          columns={[
            { header: 'Role name', text: (r) => `${r.RoleName} ${r.Description ?? ''}`,
              render: (r) => <NameCell icon={<ShieldCheck />} to={`/iam/roles/${encodeURIComponent(r.RoleName!)}`}>{r.RoleName}</NameCell> },
            { header: 'Description', className: 'text-muted-foreground', render: (r) => r.Description || '—' },
            { header: 'Path', className: 'w-28 font-mono text-xs', render: (r) => r.Path },
            { header: 'Created', className: 'w-56', render: (r) => formatDate(r.CreateDate) },
            { header: '', className: 'w-14 text-right', render: (r) => (
              <IconButton label={`Delete ${r.RoleName}`} onClick={() => setDeleting(r.RoleName!)}><Trash2 /></IconButton>
            ) },
          ]}
        />
      </Panel>
      {creating && <CreateRole onClose={() => setCreating(false)} />}
      {deleting && (
        <Confirm title={`Delete role ${deleting}?`} confirmText={deleting} loading={del.isPending}
          onConfirm={() => del.mutate(deleting)} onClose={() => setDeleting(null)}>
          <p>The role is removed from its instance profiles, its policies are detached and its inline policies deleted.</p>
        </Confirm>
      )}
    </>
  )
}

function CreateRole({ onClose }: { onClose: () => void }) {
  const { clients } = useSettings()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [path, setPath] = useState('/')
  const [template, setTemplate] = useState(Object.keys(trustTemplates)[0])
  const [doc, setDoc] = useState(trustTemplates[template])
  const [maxSession, setMaxSession] = useState(3600)

  const create = useAction(
    () => clients.iam.send(new CreateRoleCommand({
      RoleName: name, Path: path, Description: description || undefined, AssumeRolePolicyDocument: doc, MaxSessionDuration: maxSession,
    })),
    { invalidate: [['iam', 'roles'], ['count']], success: `Created role ${name}`, onSuccess: () => navigate(`/iam/roles/${encodeURIComponent(name)}`) },
  )
  const nameError = name && !iamNamePattern.test(name) ? 'Up to 64 letters, numbers and +=,.@_-' : null
  const pathError = !/^\/([\w+=,.@-]+\/)*$/.test(path) ? 'Must begin and end with /' : null

  return (
    <Modal wide title="Create role" onClose={onClose} footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button variant="primary" loading={create.isPending} disabled={!name || !!nameError || !!pathError || !!validJson(doc)}
        onClick={() => create.mutate(undefined)}>Create role</Button>
    </>}>
      <div className="flex flex-col gap-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Role name" error={nameError}>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="app-server" />
          </Field>
          <Field label="Path" error={pathError}>
            <Input className="font-mono" value={path} onChange={(e) => setPath(e.target.value)} />
          </Field>
        </div>
        <Field label="Description">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Trusted entity" hint="Fills in the trust policy below.">
            <Select className="w-full" value={template} onChange={(e) => {
              setTemplate(e.target.value)
              setDoc(trustTemplates[e.target.value])
            }}>
              {Object.keys(trustTemplates).map((t) => <Option key={t} value={t}>{t}</Option>)}
            </Select>
          </Field>
          <Field label="Maximum session duration">
            <Select className="w-full" value={maxSession} onChange={(e) => setMaxSession(Number(e.target.value))}>
              {[1, 2, 4, 8, 12].map((h) => <Option key={h} value={h * 3600}>{h} hour{h > 1 ? 's' : ''}</Option>)}
            </Select>
          </Field>
        </div>
        <Field label="Trust policy">
          <JsonEditor value={doc} onChange={setDoc} rows={12} />
        </Field>
      </div>
    </Modal>
  )
}
