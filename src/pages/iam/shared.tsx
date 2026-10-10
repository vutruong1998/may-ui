import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AttachGroupPolicyCommand, AttachRolePolicyCommand, AttachUserPolicyCommand, DeleteGroupPolicyCommand,
  DeleteRolePolicyCommand, DeleteUserPolicyCommand, DetachGroupPolicyCommand, DetachRolePolicyCommand,
  DetachUserPolicyCommand, GetGroupPolicyCommand, GetRolePolicyCommand, GetUserPolicyCommand,
  ListAttachedGroupPoliciesCommand, ListAttachedRolePoliciesCommand, ListAttachedUserPoliciesCommand,
  ListGroupPoliciesCommand, ListPoliciesCommand, ListRolePoliciesCommand, ListUserPoliciesCommand, PutGroupPolicyCommand,
  PutRolePolicyCommand, PutUserPolicyCommand, type IAMClient,
  type Policy as IamPolicy,
} from '@aws-sdk/client-iam'
import { FileKey2, Link2, Pencil, Plus, Trash2, Unlink } from 'lucide-react'
import { useSettings } from '@/lib/settings'
import { useAction } from '@/lib/hooks'
import { decodePolicy, prettyJson } from '@/lib/aws'
import { validJson } from '@/lib/format'
import {
  Badge, Button, Confirm, Empty, Field, IconButton, Input, JsonEditor, Modal, NameCell, Panel, Table,
} from '@/components/common'

export type Kind = 'role' | 'user' | 'group'

export const iamNamePattern = /^[\w+=,.@-]{1,64}$/

export const policyTemplate = prettyJson(JSON.stringify({
  Version: '2012-10-17',
  Statement: [{ Effect: 'Allow', Action: ['s3:GetObject', 's3:ListBucket'], Resource: '*' }],
}))

export const trustTemplates: Record<string, string> = {
  'EC2 instances': trust({ Service: 'ec2.amazonaws.com' }),
  'Lambda functions': trust({ Service: 'lambda.amazonaws.com' }),
  'ECS tasks': trust({ Service: 'ecs-tasks.amazonaws.com' }),
  'This account': trust({ AWS: 'arn:aws:iam::000000000000:root' }),
}

function trust(principal: Record<string, string>) {
  return prettyJson(JSON.stringify({
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Principal: principal, Action: 'sts:AssumeRole' }],
  }))
}

/** Lists every policy (paging through Marker), for pickers and the Policies page. */
export async function listAllPolicies(iam: IAMClient, scope: 'All' | 'AWS' | 'Local' = 'All'): Promise<IamPolicy[]> {
  const out: IamPolicy[] = []
  let marker: string | undefined
  do {
    const page = await iam.send(new ListPoliciesCommand({ Scope: scope, Marker: marker, MaxItems: 1000 }))
    out.push(...(page.Policies ?? []))
    marker = page.IsTruncated ? page.Marker : undefined
  } while (marker)
  return out
}

export function isAwsManaged(arn: string | undefined) {
  return !!arn?.startsWith('arn:aws:iam::aws:policy/')
}

export function policyLink(arn: string) {
  return `/iam/policies/view?arn=${encodeURIComponent(arn)}`
}

// Per-kind SDK calls for attached and inline policies, which IAM keeps
// separate for roles, users and groups.

function ops(iam: IAMClient, kind: Kind, name: string) {
  switch (kind) {
    case 'role':
      return {
        listAttached: () => iam.send(new ListAttachedRolePoliciesCommand({ RoleName: name })),
        attach: (PolicyArn: string) => iam.send(new AttachRolePolicyCommand({ RoleName: name, PolicyArn })),
        detach: (PolicyArn: string) => iam.send(new DetachRolePolicyCommand({ RoleName: name, PolicyArn })),
        listInline: () => iam.send(new ListRolePoliciesCommand({ RoleName: name })),
        getInline: (PolicyName: string) => iam.send(new GetRolePolicyCommand({ RoleName: name, PolicyName })),
        putInline: (PolicyName: string, PolicyDocument: string) =>
          iam.send(new PutRolePolicyCommand({ RoleName: name, PolicyName, PolicyDocument })),
        deleteInline: (PolicyName: string) => iam.send(new DeleteRolePolicyCommand({ RoleName: name, PolicyName })),
      }
    case 'user':
      return {
        listAttached: () => iam.send(new ListAttachedUserPoliciesCommand({ UserName: name })),
        attach: (PolicyArn: string) => iam.send(new AttachUserPolicyCommand({ UserName: name, PolicyArn })),
        detach: (PolicyArn: string) => iam.send(new DetachUserPolicyCommand({ UserName: name, PolicyArn })),
        listInline: () => iam.send(new ListUserPoliciesCommand({ UserName: name })),
        getInline: (PolicyName: string) => iam.send(new GetUserPolicyCommand({ UserName: name, PolicyName })),
        putInline: (PolicyName: string, PolicyDocument: string) =>
          iam.send(new PutUserPolicyCommand({ UserName: name, PolicyName, PolicyDocument })),
        deleteInline: (PolicyName: string) => iam.send(new DeleteUserPolicyCommand({ UserName: name, PolicyName })),
      }
    case 'group':
      return {
        listAttached: () => iam.send(new ListAttachedGroupPoliciesCommand({ GroupName: name })),
        attach: (PolicyArn: string) => iam.send(new AttachGroupPolicyCommand({ GroupName: name, PolicyArn })),
        detach: (PolicyArn: string) => iam.send(new DetachGroupPolicyCommand({ GroupName: name, PolicyArn })),
        listInline: () => iam.send(new ListGroupPoliciesCommand({ GroupName: name })),
        getInline: (PolicyName: string) => iam.send(new GetGroupPolicyCommand({ GroupName: name, PolicyName })),
        putInline: (PolicyName: string, PolicyDocument: string) =>
          iam.send(new PutGroupPolicyCommand({ GroupName: name, PolicyName, PolicyDocument })),
        deleteInline: (PolicyName: string) => iam.send(new DeleteGroupPolicyCommand({ GroupName: name, PolicyName })),
      }
  }
}

/**
 * Detaches every managed policy and deletes every inline policy, which IAM
 * requires before a role, user or group can be deleted.
 */
export async function clearPolicies(iam: IAMClient, kind: Kind, name: string) {
  const o = ops(iam, kind, name)
  for (const p of (await o.listAttached()).AttachedPolicies ?? []) await o.detach(p.PolicyArn!)
  for (const n of (await o.listInline()).PolicyNames ?? []) await o.deleteInline(n)
}

/** Attached managed policies and inline policies of a role, user or group. */
export function PrincipalPolicies({ kind, name }: { kind: Kind; name: string }) {
  const { clients } = useSettings()
  const o = ops(clients.iam, kind, name)
  const attachedKey = ['iam', kind, name, 'attached']
  const inlineKey = ['iam', kind, name, 'inline']
  const attached = useQuery({ queryKey: attachedKey, queryFn: async () => (await o.listAttached()).AttachedPolicies ?? [] })
  const inline = useQuery({ queryKey: inlineKey, queryFn: async () => (await o.listInline()).PolicyNames ?? [] })
  const [attaching, setAttaching] = useState(false)
  const [detaching, setDetaching] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ name: string; isNew: boolean } | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const detach = useAction((arn: string) => o.detach(arn), {
    invalidate: [attachedKey, ['iam', 'policies']], success: 'Policy detached', onSuccess: () => setDetaching(null),
  })
  const removeInline = useAction((n: string) => o.deleteInline(n), {
    invalidate: [inlineKey], success: 'Inline policy deleted', onSuccess: () => setDeleting(null),
  })

  return (
    <div className="flex flex-col gap-6">
      <Panel flush title="Managed policies" description="Reusable policies attached by ARN."
        actions={<Button icon={<Link2 />} onClick={() => setAttaching(true)}>Attach policies</Button>}>
        <Table
          rows={attached.data}
          loading={attached.isLoading}
          error={attached.error}
          rowKey={(p) => p.PolicyArn!}
          empty={<Empty title="No managed policies attached" icon={<FileKey2 />} />}
          columns={[
            { header: 'Policy', render: (p) => <NameCell icon={<FileKey2 />} to={policyLink(p.PolicyArn!)}>{p.PolicyName}</NameCell> },
            { header: 'Type', className: 'w-40', render: (p) => isAwsManaged(p.PolicyArn)
              ? <Badge tone="amber">AWS managed</Badge> : <Badge tone="blue">Customer managed</Badge> },
            { header: '', className: 'w-14 text-right', render: (p) => (
              <IconButton label="Detach" onClick={() => setDetaching(p.PolicyArn!)}><Unlink /></IconButton>
            ) },
          ]}
        />
      </Panel>

      <Panel flush title="Inline policies" description={`Embedded in this ${kind}; deleted with it.`}
        actions={<Button icon={<Plus />} onClick={() => setEditing({ name: '', isNew: true })}>Add inline policy</Button>}>
        <Table
          rows={inline.data}
          loading={inline.isLoading}
          error={inline.error}
          rowKey={(n) => n}
          empty={<Empty title="No inline policies" icon={<FileKey2 />} />}
          columns={[
            { header: 'Name', render: (n) => <NameCell icon={<FileKey2 />} onClick={() => setEditing({ name: n, isNew: false })}>{n}</NameCell> },
            { header: '', className: 'w-24 text-right', render: (n) => (
              <span className="inline-flex">
                <IconButton label="Edit" onClick={() => setEditing({ name: n, isNew: false })}><Pencil /></IconButton>
                <IconButton label="Delete" onClick={() => setDeleting(n)}><Trash2 /></IconButton>
              </span>
            ) },
          ]}
        />
      </Panel>

      {attaching && (
        <AttachPolicies already={new Set(attached.data?.map((p) => p.PolicyArn!))} onClose={() => setAttaching(false)}
          attach={async (arns) => { for (const a of arns) await o.attach(a) }} invalidate={[attachedKey, ['iam', 'policies']]} />
      )}
      {detaching && (
        <Confirm title="Detach policy?" confirmLabel="Detach" loading={detach.isPending}
          onConfirm={() => detach.mutate(detaching)} onClose={() => setDetaching(null)}>
          <p><code className="rounded bg-muted px-1.5 py-0.5 text-xs">{detaching}</code> will be detached from {kind} <strong>{name}</strong>.</p>
        </Confirm>
      )}
      {editing && (
        <InlinePolicyEditor initialName={editing.name} isNew={editing.isNew} existing={inline.data ?? []}
          load={(n) => o.getInline(n).then((r) => decodePolicy(r.PolicyDocument))}
          save={(n, doc) => o.putInline(n, doc)} invalidate={inlineKey} onClose={() => setEditing(null)} />
      )}
      {deleting && (
        <Confirm title={`Delete inline policy ${deleting}?`} loading={removeInline.isPending}
          onConfirm={() => removeInline.mutate(deleting)} onClose={() => setDeleting(null)}>
          <p>The policy is removed from {kind} <strong>{name}</strong>. This cannot be undone.</p>
        </Confirm>
      )}
    </div>
  )
}

function AttachPolicies({ already, attach, invalidate, onClose }: {
  already: Set<string>
  attach: (arns: string[]) => Promise<void>
  invalidate: string[][]
  onClose: () => void
}) {
  const { clients } = useSettings()
  const policies = useQuery({ queryKey: ['iam', 'policies', 'All'], queryFn: () => listAllPolicies(clients.iam) })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const run = useAction(() => attach([...selected]), {
    invalidate, success: `Attached ${selected.size} polic${selected.size === 1 ? 'y' : 'ies'}`, onSuccess: onClose,
  })
  const available = policies.data?.filter((p) => !already.has(p.Arn!))

  return (
    <Modal wide title="Attach policies" onClose={onClose} footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button variant="primary" disabled={!selected.size} loading={run.isPending} onClick={() => run.mutate(undefined)}>
        Attach {selected.size || ''} polic{selected.size === 1 ? 'y' : 'ies'}
      </Button>
    </>}>
      <div className="-mx-4 max-h-[55vh] overflow-y-auto border-y">
        <Table
          rows={available}
          loading={policies.isLoading}
          error={policies.error}
          rowKey={(p) => p.Arn!}
          selectable
          selected={selected}
          onSelect={setSelected}
          filterPlaceholder="Filter policies"
          columns={[
            { header: 'Policy', text: (p) => p.PolicyName!, render: (p) => <span className="font-medium">{p.PolicyName}</span> },
            { header: 'Type', className: 'w-40', render: (p) => isAwsManaged(p.Arn)
              ? <Badge tone="amber">AWS managed</Badge> : <Badge tone="blue">Customer managed</Badge> },
          ]}
        />
      </div>
    </Modal>
  )
}

function InlinePolicyEditor({ initialName, isNew, existing, load, save, invalidate, onClose }: {
  initialName: string
  isNew: boolean
  existing: string[]
  load: (name: string) => Promise<string>
  save: (name: string, doc: string) => Promise<unknown>
  invalidate: string[]
  onClose: () => void
}) {
  const [name, setName] = useState(initialName)
  const [doc, setDoc] = useState(isNew ? policyTemplate : '')
  const current = useQuery({
    queryKey: [...invalidate, initialName],
    queryFn: () => load(initialName),
    enabled: !isNew,
    gcTime: 0,
  })
  useEffect(() => {
    if (current.data !== undefined) setDoc(current.data)
  }, [current.data])
  const run = useAction(() => save(name, doc), { invalidate: [invalidate], success: 'Inline policy saved', onSuccess: onClose })
  const nameError = isNew && name && (!iamNamePattern.test(name) ? 'Use letters, numbers and +=,.@_-' : existing.includes(name) ? 'A policy with this name exists' : null)

  return (
    <Modal wide title={isNew ? 'Add inline policy' : `Edit ${initialName}`} onClose={onClose} footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button variant="primary" loading={run.isPending} disabled={!name || !!nameError || !!validJson(doc) || current.isLoading}
        onClick={() => run.mutate(undefined)}>Save</Button>
    </>}>
      <div className="flex flex-col gap-5">
        {isNew && (
          <Field label="Policy name" error={nameError || null}>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="read-data" />
          </Field>
        )}
        <Field label="Policy document">
          <JsonEditor value={doc} onChange={setDoc} rows={16} />
        </Field>
      </div>
    </Modal>
  )
}

/** Saves a full tag set using Tag/Untag calls, as IAM has no "replace tags". */
export async function replaceTags(
  oldTags: { Key?: string }[] | undefined,
  newTags: { Key: string; Value: string }[],
  tag: (tags: { Key: string; Value: string }[]) => Promise<unknown>,
  untag: (keys: string[]) => Promise<unknown>,
) {
  const keep = new Set(newTags.map((t) => t.Key))
  const removed = (oldTags ?? []).map((t) => t.Key!).filter((k) => !keep.has(k))
  if (removed.length) await untag(removed)
  if (newTags.length) await tag(newTags)
}
