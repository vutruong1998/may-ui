import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CreatePolicyCommand, DeletePolicyCommand, DeletePolicyVersionCommand, ListPolicyVersionsCommand, type IAMClient } from '@aws-sdk/client-iam'
import { FileKey2, Plus, Trash2 } from 'lucide-react'
import { useSettings } from '@/lib/settings'
import { useAction } from '@/lib/hooks'
import { formatDate, validJson } from '@/lib/format'
import {
  Badge, Button, Confirm, Empty, Field, IconButton, Input, JsonEditor, Modal, NameCell, Option, PageHeader, Panel,
  RefreshButton, Select, Table,
} from '@/components/common'
import { iamNamePattern, isAwsManaged, listAllPolicies, policyLink, policyTemplate } from './shared'

type Scope = 'All' | 'AWS' | 'Local'

/** Deletes non-default versions first, as IAM requires. */
export async function deletePolicyFully(iam: IAMClient, arn: string) {
  const versions = (await iam.send(new ListPolicyVersionsCommand({ PolicyArn: arn }))).Versions ?? []
  for (const v of versions) {
    if (!v.IsDefaultVersion) await iam.send(new DeletePolicyVersionCommand({ PolicyArn: arn, VersionId: v.VersionId }))
  }
  await iam.send(new DeletePolicyCommand({ PolicyArn: arn }))
}

export default function Policies() {
  const { clients } = useSettings()
  const [scope, setScope] = useState<Scope>('All')
  const policies = useQuery({ queryKey: ['iam', 'policies', scope], queryFn: () => listAllPolicies(clients.iam, scope) })
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<{ arn: string; name: string; attachments: number } | null>(null)
  const del = useAction((arn: string) => deletePolicyFully(clients.iam, arn), {
    invalidate: [['iam', 'policies'], ['count']], success: `Deleted policy ${deleting?.name}`, onSuccess: () => setDeleting(null),
  })

  return (
    <>
      <PageHeader title="Policies" description="Managed permission documents that you attach to roles, users and groups."
        actions={<>
          <RefreshButton onClick={() => policies.refetch()} spinning={policies.isFetching} />
          <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>Create policy</Button>
        </>} />
      <Panel flush>
        <Table
          rows={policies.data}
          loading={policies.isLoading}
          error={policies.error}
          onRetry={() => policies.refetch()}
          rowKey={(p) => p.Arn!}
          filterPlaceholder="Find policies"
          toolbar={
            <Select value={scope} onChange={(e) => setScope(e.target.value as Scope)} aria-label="Policy type">
              <Option value="All">All types</Option>
              <Option value="Local">Customer managed</Option>
              <Option value="AWS">AWS managed</Option>
            </Select>
          }
          empty={<Empty title="No policies" icon={<FileKey2 />} />}
          columns={[
            { header: 'Policy name', text: (p) => p.PolicyName!,
              render: (p) => <NameCell icon={<FileKey2 />} to={policyLink(p.Arn!)}>{p.PolicyName}</NameCell> },
            { header: 'Type', className: 'w-40', render: (p) => isAwsManaged(p.Arn)
              ? <Badge tone="amber">AWS managed</Badge> : <Badge tone="blue">Customer managed</Badge> },
            { header: 'Attached to', className: 'w-28 tabular-nums', render: (p) => p.AttachmentCount ?? 0 },
            { header: 'Default version', className: 'w-32 font-mono text-xs', render: (p) => p.DefaultVersionId },
            { header: 'Updated', className: 'w-56', render: (p) => formatDate(p.UpdateDate) },
            { header: '', className: 'w-14 text-right', render: (p) => isAwsManaged(p.Arn) ? null : (
              <IconButton label={`Delete ${p.PolicyName}`}
                onClick={() => setDeleting({ arn: p.Arn!, name: p.PolicyName!, attachments: p.AttachmentCount ?? 0 })}><Trash2 /></IconButton>
            ) },
          ]}
        />
      </Panel>
      {creating && <CreatePolicy onClose={() => setCreating(false)} />}
      {deleting && (
        <Confirm title={`Delete policy ${deleting.name}?`} confirmText={deleting.name} loading={del.isPending}
          onConfirm={() => del.mutate(deleting.arn)} onClose={() => setDeleting(null)}>
          {deleting.attachments > 0
            ? <p className="text-destructive">This policy is attached to {deleting.attachments} entit{deleting.attachments === 1 ? 'y' : 'ies'}. Detach it first, or IAM will refuse the delete.</p>
            : <p>All versions of the policy are deleted.</p>}
        </Confirm>
      )}
    </>
  )
}

function CreatePolicy({ onClose }: { onClose: () => void }) {
  const { clients } = useSettings()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [doc, setDoc] = useState(policyTemplate)
  const create = useAction(
    () => clients.iam.send(new CreatePolicyCommand({ PolicyName: name, PolicyDocument: doc, Description: description || undefined })),
    { invalidate: [['iam', 'policies'], ['count']], success: `Created policy ${name}`, onSuccess: (r) => navigate(policyLink(r.Policy!.Arn!)) },
  )
  const nameError = name && !iamNamePattern.test(name) ? 'Letters, numbers and +=,.@_-' : null

  return (
    <Modal wide title="Create policy" onClose={onClose} footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button variant="primary" loading={create.isPending} disabled={!name || !!nameError || !!validJson(doc)}
        onClick={() => create.mutate(undefined)}>Create policy</Button>
    </>}>
      <div className="flex flex-col gap-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Policy name" error={nameError}>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="read-reports" />
          </Field>
          <Field label="Description">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
          </Field>
        </div>
        <Field label="Policy document" hint="Stored and returned exactly; may does not enforce it.">
          <JsonEditor value={doc} onChange={setDoc} rows={16} />
        </Field>
      </div>
    </Modal>
  )
}
