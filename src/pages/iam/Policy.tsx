import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  CreatePolicyVersionCommand, DeletePolicyVersionCommand, GetPolicyCommand, GetPolicyVersionCommand,
  ListEntitiesForPolicyCommand, ListPolicyTagsCommand, ListPolicyVersionsCommand, SetDefaultPolicyVersionCommand,
  TagPolicyCommand, UntagPolicyCommand,
} from '@aws-sdk/client-iam'
import { Eye, ShieldCheck, Trash2, User, Users } from 'lucide-react'
import { useSettings } from '@/lib/settings'
import { useAction } from '@/lib/hooks'
import { decodePolicy } from '@/lib/aws'
import { formatDate, validJson } from '@/lib/format'
import { TagsEditor } from '@/components/TagsEditor'
import {
  Badge, Button, CodeBlock, Confirm, Empty, ErrorBox, IconButton, JsonEditor, KeyValue, Modal, Mono, NameCell, PageHeader,
  Panel, Spinner, Table, Tabs,
} from '@/components/common'
import { isAwsManaged, replaceTags } from './shared'
import { deletePolicyFully } from './Policies'

type Tab = 'document' | 'versions' | 'entities' | 'tags'

export default function Policy() {
  const { clients } = useSettings()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const arn = params.get('arn') ?? ''
  const tab = (params.get('tab') as Tab) ?? 'document'
  const [deleting, setDeleting] = useState(false)
  const key = ['iam', 'policy', arn]

  const policy = useQuery({ queryKey: key, queryFn: async () => (await clients.iam.send(new GetPolicyCommand({ PolicyArn: arn }))).Policy! })
  const del = useAction(() => deletePolicyFully(clients.iam, arn), {
    invalidate: [['iam', 'policies'], ['count']], success: 'Policy deleted', onSuccess: () => navigate('/iam/policies'),
  })

  const name = arn.split('/').pop() ?? arn
  const crumbs = [{ label: 'IAM' }, { label: 'Policies', to: '/iam/policies' }, { label: name }]
  if (policy.isLoading) return <><PageHeader title={name} crumbs={crumbs} /><Spinner /></>
  if (policy.isError) return <><PageHeader title={name} crumbs={crumbs} /><ErrorBox error={policy.error} onRetry={() => policy.refetch()} /></>
  const p = policy.data!
  const aws = isAwsManaged(arn)
  const setTab = (t: Tab) => setParams({ arn, tab: t })

  return (
    <>
      <PageHeader title={p.PolicyName} crumbs={crumbs} description={p.Description}
        actions={!aws && <Button variant="danger" icon={<Trash2 />} onClick={() => setDeleting(true)}>Delete policy</Button>} />
      <Panel title="Summary" actions={aws ? <Badge tone="amber">AWS managed</Badge> : <Badge tone="blue">Customer managed</Badge>}>
        <KeyValue items={[
          ['ARN', <Mono copy>{p.Arn}</Mono>],
          ['Policy ID', <Mono copy>{p.PolicyId}</Mono>],
          ['Default version', p.DefaultVersionId],
          ['Attached to', `${p.AttachmentCount ?? 0} entit${p.AttachmentCount === 1 ? 'y' : 'ies'}`],
          ['Created', formatDate(p.CreateDate)],
          ['Updated', formatDate(p.UpdateDate)],
        ]} />
      </Panel>
      <div className="h-6" />
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'document', label: 'Permissions' },
        { id: 'versions', label: 'Versions' },
        { id: 'entities', label: 'Entities attached' },
        ...(aws ? [] : [{ id: 'tags' as const, label: 'Tags' }]),
      ]} />
      {tab === 'document' && <Document arn={arn} version={p.DefaultVersionId!} readOnly={aws} />}
      {tab === 'versions' && <Versions arn={arn} readOnly={aws} />}
      {tab === 'entities' && <Entities arn={arn} />}
      {tab === 'tags' && <PolicyTags arn={arn} />}
      {deleting && (
        <Confirm title={`Delete policy ${p.PolicyName}?`} confirmText={p.PolicyName} loading={del.isPending}
          onConfirm={() => del.mutate(undefined)} onClose={() => setDeleting(false)}>
          {(p.AttachmentCount ?? 0) > 0
            ? <p className="text-destructive">This policy is attached to {p.AttachmentCount} entities. Detach it first, or IAM will refuse the delete.</p>
            : <p>All versions of the policy are deleted.</p>}
        </Confirm>
      )}
    </>
  )
}

function useVersionDoc(arn: string, version: string) {
  const { clients } = useSettings()
  return useQuery({
    queryKey: ['iam', 'policy', arn, 'version', version],
    queryFn: async () => decodePolicy((await clients.iam.send(new GetPolicyVersionCommand({ PolicyArn: arn, VersionId: version }))).PolicyVersion?.Document),
  })
}

/** The default version's document. Saving creates a new default version. */
function Document({ arn, version, readOnly }: { arn: string; version: string; readOnly: boolean }) {
  const { clients } = useSettings()
  const doc = useVersionDoc(arn, version)
  const [text, setText] = useState('')
  useEffect(() => setText(doc.data ?? ''), [doc.data])

  const save = useAction(async () => {
    // IAM allows five versions; make room by deleting the oldest non-default one.
    const versions = (await clients.iam.send(new ListPolicyVersionsCommand({ PolicyArn: arn }))).Versions ?? []
    if (versions.length >= 5) {
      const oldest = versions.filter((v) => !v.IsDefaultVersion).sort((a, b) => +a.CreateDate! - +b.CreateDate!)[0]
      if (oldest) await clients.iam.send(new DeletePolicyVersionCommand({ PolicyArn: arn, VersionId: oldest.VersionId }))
    }
    return clients.iam.send(new CreatePolicyVersionCommand({ PolicyArn: arn, PolicyDocument: text, SetAsDefault: true }))
  }, { invalidate: [['iam', 'policy', arn], ['iam', 'policies']], success: (r) => `Saved as version ${r.PolicyVersion?.VersionId}` })

  return (
    <Panel title={`Policy document (${version})`}
      description={readOnly ? 'AWS managed policies cannot be edited.' : 'Saving creates a new version and makes it the default.'}>
      {doc.isLoading ? <Spinner /> : doc.isError ? <ErrorBox error={doc.error} /> : readOnly ? <CodeBlock>{doc.data ?? ''}</CodeBlock> : (
        <div className="flex flex-col gap-4">
          <JsonEditor value={text} onChange={setText} rows={18} />
          <div className="flex justify-end gap-2">
            {text !== doc.data && <Button variant="ghost" onClick={() => setText(doc.data ?? '')}>Discard</Button>}
            <Button variant="primary" loading={save.isPending} disabled={text === doc.data || !!validJson(text)} onClick={() => save.mutate(undefined)}>
              Save as new version
            </Button>
          </div>
        </div>
      )}
    </Panel>
  )
}

function Versions({ arn, readOnly }: { arn: string; readOnly: boolean }) {
  const { clients } = useSettings()
  const key = ['iam', 'policy', arn, 'versions']
  const versions = useQuery({
    queryKey: key,
    queryFn: async () => (await clients.iam.send(new ListPolicyVersionsCommand({ PolicyArn: arn }))).Versions ?? [],
  })
  const [viewing, setViewing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const setDefault = useAction(
    (VersionId: string) => clients.iam.send(new SetDefaultPolicyVersionCommand({ PolicyArn: arn, VersionId })),
    { invalidate: [['iam', 'policy', arn], ['iam', 'policies']], success: 'Default version changed' },
  )
  const del = useAction(
    (VersionId: string) => clients.iam.send(new DeletePolicyVersionCommand({ PolicyArn: arn, VersionId })),
    { invalidate: [key], success: 'Version deleted', onSuccess: () => setDeleting(null) },
  )

  return (
    <Panel flush title="Versions" description="A managed policy keeps up to five versions; exactly one is the default.">
      <Table rows={versions.data} loading={versions.isLoading} error={versions.error} rowKey={(v) => v.VersionId!}
        columns={[
          { header: 'Version', render: (v) => (
            <span className="inline-flex items-center gap-2 font-mono">{v.VersionId}{v.IsDefaultVersion && <Badge tone="green">Default</Badge>}</span>
          ) },
          { header: 'Created', className: 'w-56', render: (v) => formatDate(v.CreateDate) },
          { header: '', className: 'w-56 text-right', render: (v) => (
            <span className="inline-flex items-center gap-1">
              <IconButton label="View document" onClick={() => setViewing(v.VersionId!)}><Eye /></IconButton>
              {!readOnly && !v.IsDefaultVersion && <>
                <Button variant="ghost" size="sm" disabled={setDefault.isPending} onClick={() => setDefault.mutate(v.VersionId!)}>Set as default</Button>
                <IconButton label="Delete version" onClick={() => setDeleting(v.VersionId!)}><Trash2 /></IconButton>
              </>}
            </span>
          ) },
        ]} />
      {viewing && <VersionModal arn={arn} version={viewing} onClose={() => setViewing(null)} />}
      {deleting && (
        <Confirm title={`Delete version ${deleting}?`} loading={del.isPending} onConfirm={() => del.mutate(deleting)} onClose={() => setDeleting(null)}>
          <p>This version's document is permanently deleted.</p>
        </Confirm>
      )}
    </Panel>
  )
}

function VersionModal({ arn, version, onClose }: { arn: string; version: string; onClose: () => void }) {
  const doc = useVersionDoc(arn, version)
  return (
    <Modal wide title={`Version ${version}`} onClose={onClose}>
      {doc.isLoading ? <Spinner /> : doc.isError ? <ErrorBox error={doc.error} /> : <CodeBlock>{doc.data ?? ''}</CodeBlock>}
    </Modal>
  )
}

function Entities({ arn }: { arn: string }) {
  const { clients } = useSettings()
  const q = useQuery({
    queryKey: ['iam', 'policy', arn, 'entities'],
    queryFn: () => clients.iam.send(new ListEntitiesForPolicyCommand({ PolicyArn: arn })),
  })
  type Row = { type: 'Role' | 'User' | 'Group'; name: string }
  const rows: Row[] | undefined = q.data && [
    ...(q.data.PolicyRoles ?? []).map((r): Row => ({ type: 'Role', name: r.RoleName! })),
    ...(q.data.PolicyUsers ?? []).map((u): Row => ({ type: 'User', name: u.UserName! })),
    ...(q.data.PolicyGroups ?? []).map((g): Row => ({ type: 'Group', name: g.GroupName! })),
  ]
  const icon = { Role: <ShieldCheck />, User: <User />, Group: <Users /> }
  const path = { Role: 'roles', User: 'users', Group: 'groups' }
  return (
    <Panel flush title="Entities attached">
      <Table rows={rows} loading={q.isLoading} error={q.error} rowKey={(r) => r.type + r.name}
        empty={<Empty title="Not attached to anything" />}
        columns={[
          { header: 'Name', render: (r) => <NameCell icon={icon[r.type]} to={`/iam/${path[r.type]}/${encodeURIComponent(r.name)}`}>{r.name}</NameCell> },
          { header: 'Type', className: 'w-32', render: (r) => <Badge>{r.type}</Badge> },
        ]} />
    </Panel>
  )
}

function PolicyTags({ arn }: { arn: string }) {
  const { clients } = useSettings()
  const q = useQuery({
    queryKey: ['iam', 'policy', arn, 'tags'],
    queryFn: async () => (await clients.iam.send(new ListPolicyTagsCommand({ PolicyArn: arn }))).Tags ?? [],
  })
  const save = useAction(
    (tags: { Key: string; Value: string }[]) => replaceTags(q.data, tags,
      (Tags) => clients.iam.send(new TagPolicyCommand({ PolicyArn: arn, Tags })),
      (TagKeys) => clients.iam.send(new UntagPolicyCommand({ PolicyArn: arn, TagKeys }))),
    { invalidate: [['iam', 'policy', arn, 'tags']], success: 'Tags saved' },
  )
  return (
    <Panel title="Tags">
      {q.isLoading ? <Spinner /> : q.isError ? <ErrorBox error={q.error} /> : (
        <TagsEditor tags={q.data} saving={save.isPending} onSave={(t) => save.mutate(t)} />
      )}
    </Panel>
  )
}
