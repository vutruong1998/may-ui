import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AddRoleToInstanceProfileCommand, CreateInstanceProfileCommand, DeleteInstanceProfileCommand, ListInstanceProfilesCommand,
  ListRolesCommand, RemoveRoleFromInstanceProfileCommand, type InstanceProfile,
} from '@aws-sdk/client-iam'
import { Pencil, Plus, Server, ShieldCheck, Trash2 } from 'lucide-react'
import { useSettings } from '@/lib/settings'
import { useAction } from '@/lib/hooks'
import { formatDate } from '@/lib/format'
import {
  Button, Confirm, Empty, Field, IconButton, Input, Modal, Mono, NameCell, Option, PageHeader, Panel, RefreshButton, Select, Table,
} from '@/components/common'
import { iamNamePattern } from './shared'

export default function InstanceProfiles() {
  const { clients } = useSettings()
  const profiles = useQuery({
    queryKey: ['iam', 'profiles'],
    queryFn: async () => (await clients.iam.send(new ListInstanceProfilesCommand({ MaxItems: 1000 }))).InstanceProfiles ?? [],
  })
  const [editing, setEditing] = useState<InstanceProfile | 'new' | null>(null)
  const [deleting, setDeleting] = useState<InstanceProfile | null>(null)
  const del = useAction(async (p: InstanceProfile) => {
    for (const r of p.Roles ?? []) {
      await clients.iam.send(new RemoveRoleFromInstanceProfileCommand({ InstanceProfileName: p.InstanceProfileName, RoleName: r.RoleName }))
    }
    await clients.iam.send(new DeleteInstanceProfileCommand({ InstanceProfileName: p.InstanceProfileName }))
  }, { invalidate: [['iam']], success: 'Instance profile deleted', onSuccess: () => setDeleting(null) })

  return (
    <>
      <PageHeader title="Instance profiles" description="Containers that pass one role to EC2 instances."
        actions={<>
          <RefreshButton onClick={() => profiles.refetch()} spinning={profiles.isFetching} />
          <Button variant="primary" icon={<Plus />} onClick={() => setEditing('new')}>Create instance profile</Button>
        </>} />
      <Panel flush>
        <Table
          rows={profiles.data}
          loading={profiles.isLoading}
          error={profiles.error}
          onRetry={() => profiles.refetch()}
          rowKey={(p) => p.InstanceProfileName!}
          filterPlaceholder="Find instance profiles"
          empty={<Empty title="No instance profiles" icon={<Server />} />}
          columns={[
            { header: 'Name', text: (p) => p.InstanceProfileName!, render: (p) => (
              <span className="inline-flex items-center gap-2 font-medium"><Server className="size-4 text-muted-foreground" />{p.InstanceProfileName}</span>
            ) },
            { header: 'Role', render: (p) => p.Roles?.[0]
              ? <NameCell icon={<ShieldCheck />} to={`/iam/roles/${encodeURIComponent(p.Roles[0].RoleName!)}`}>{p.Roles[0].RoleName}</NameCell>
              : <span className="text-muted-foreground">No role</span> },
            { header: 'ARN', render: (p) => <Mono copy>{p.Arn}</Mono> },
            { header: 'Created', className: 'w-56', render: (p) => formatDate(p.CreateDate) },
            { header: '', className: 'w-24 text-right', render: (p) => (
              <span className="inline-flex">
                <IconButton label="Change role" onClick={() => setEditing(p)}><Pencil /></IconButton>
                <IconButton label="Delete" onClick={() => setDeleting(p)}><Trash2 /></IconButton>
              </span>
            ) },
          ]}
        />
      </Panel>
      {editing && <ProfileModal profile={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {deleting && (
        <Confirm title={`Delete ${deleting.InstanceProfileName}?`} loading={del.isPending}
          onConfirm={() => del.mutate(deleting)} onClose={() => setDeleting(null)}>
          <p>The role is removed from the profile first. The role itself is kept.</p>
        </Confirm>
      )}
    </>
  )
}

function ProfileModal({ profile, onClose }: { profile: InstanceProfile | null; onClose: () => void }) {
  const { clients } = useSettings()
  const roles = useQuery({
    queryKey: ['iam', 'roles'],
    queryFn: async () => (await clients.iam.send(new ListRolesCommand({ MaxItems: 1000 }))).Roles ?? [],
  })
  const current = profile?.Roles?.[0]?.RoleName ?? ''
  const [name, setName] = useState(profile?.InstanceProfileName ?? '')
  const [role, setRole] = useState(current)

  const save = useAction(async () => {
    if (!profile) await clients.iam.send(new CreateInstanceProfileCommand({ InstanceProfileName: name }))
    if (current && current !== role) {
      await clients.iam.send(new RemoveRoleFromInstanceProfileCommand({ InstanceProfileName: name, RoleName: current }))
    }
    if (role && role !== current) {
      await clients.iam.send(new AddRoleToInstanceProfileCommand({ InstanceProfileName: name, RoleName: role }))
    }
  }, { invalidate: [['iam']], success: profile ? 'Instance profile updated' : `Created ${name}`, onSuccess: onClose })
  const nameError = name && !iamNamePattern.test(name) ? 'Letters, numbers and +=,.@_-' : null

  return (
    <Modal title={profile ? `Edit ${profile.InstanceProfileName}` : 'Create instance profile'} onClose={onClose} footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button variant="primary" loading={save.isPending} disabled={!name || !!nameError || (!!profile && role === current)}
        onClick={() => save.mutate(undefined)}>{profile ? 'Save' : 'Create'}</Button>
    </>}>
      <div className="flex flex-col gap-5">
        {!profile && (
          <Field label="Name" error={nameError}>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="web-server" />
          </Field>
        )}
        <Field label="Role" hint="An instance profile holds at most one role.">
          <Select className="w-full" value={role} onChange={(e) => setRole(e.target.value)}>
            <Option value="">No role</Option>
            {roles.data?.map((r) => <Option key={r.RoleName} value={r.RoleName}>{r.RoleName}</Option>)}
          </Select>
        </Field>
      </div>
    </Modal>
  )
}
