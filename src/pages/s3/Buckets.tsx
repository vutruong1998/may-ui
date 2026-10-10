import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CreateBucketCommand, DeleteBucketCommand, ListBucketsCommand, type Bucket, type BucketLocationConstraint } from '@aws-sdk/client-s3'
import { Database, Plus, Trash2 } from 'lucide-react'
import { useSettings } from '@/lib/settings'
import { useAction } from '@/lib/hooks'
import { formatDate } from '@/lib/format'
import { bucketNamePattern, deleteKeys, listAllKeys } from '@/lib/s3'
import {
  Badge, Button, Confirm, Empty, Field, IconButton, Input, Modal, NameCell, PageHeader, Panel, RefreshButton, Table,
} from '@/components/common'

type BucketRow = Bucket & { BucketRegion?: string }

export function useBuckets() {
  const { clients } = useSettings()
  return useQuery({
    queryKey: ['s3', 'buckets'],
    queryFn: async () => ((await clients.s3.send(new ListBucketsCommand({}))).Buckets ?? []) as BucketRow[],
  })
}

export default function Buckets() {
  const { clients } = useSettings()
  const buckets = useBuckets()
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const del = useAction(
    async (name: string) => {
      await deleteKeys(clients.s3, name, await listAllKeys(clients.s3, name))
      await clients.s3.send(new DeleteBucketCommand({ Bucket: name }))
      return name
    },
    { invalidate: [['s3'], ['count']], success: (n) => `Deleted bucket ${n}`, onSuccess: () => setDeleting(null) },
  )

  return (
    <>
      <PageHeader
        title="S3 buckets"
        description="Object storage compatible with the Amazon S3 API."
        actions={<>
          <RefreshButton onClick={() => buckets.refetch()} spinning={buckets.isFetching} />
          <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>Create bucket</Button>
        </>}
      />
      <Panel flush>
        <Table
          rows={buckets.data}
          loading={buckets.isLoading}
          error={buckets.error}
          onRetry={() => buckets.refetch()}
          rowKey={(b) => b.Name!}
          filterPlaceholder="Find buckets by name"
          empty={<Empty title="No buckets" icon={<Database />}>Create a bucket to start storing objects.</Empty>}
          columns={[
            { header: 'Name', text: (b) => b.Name!, render: (b) => <NameCell icon={<Database />} to={`/s3/${b.Name}`}>{b.Name}</NameCell> },
            { header: 'Region', className: 'w-40', render: (b) => <Badge>{b.BucketRegion ?? '—'}</Badge> },
            { header: 'Created', className: 'w-56', render: (b) => formatDate(b.CreationDate) },
            { header: '', className: 'w-14 text-right', render: (b) => (
              <IconButton label={`Delete ${b.Name}`} onClick={() => setDeleting(b.Name!)}><Trash2 /></IconButton>
            ) },
          ]}
        />
      </Panel>
      {creating && <CreateBucket onClose={() => setCreating(false)} />}
      {deleting && (
        <Confirm title={`Delete bucket ${deleting}?`} confirmText={deleting} loading={del.isPending}
          onConfirm={() => del.mutate(deleting)} onClose={() => setDeleting(null)}>
          <p>All objects in the bucket are deleted first. This cannot be undone.</p>
        </Confirm>
      )}
    </>
  )
}

function CreateBucket({ onClose }: { onClose: () => void }) {
  const { clients, settings } = useSettings()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [region, setRegion] = useState(settings.region)
  const valid = bucketNamePattern.test(name)

  const create = useAction(
    () => clients.s3.send(new CreateBucketCommand({
      Bucket: name,
      CreateBucketConfiguration: region === 'us-east-1' ? undefined : { LocationConstraint: region as BucketLocationConstraint },
    })),
    { invalidate: [['s3'], ['count']], success: `Created bucket ${name}`, onSuccess: () => navigate(`/s3/${name}`) },
  )
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (valid) create.mutate(undefined)
  }

  return (
    <Modal title="Create bucket" description="Bucket names are global and can't be changed later." onClose={onClose} footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button variant="primary" type="submit" form="create-bucket" disabled={!valid} loading={create.isPending}>Create bucket</Button>
    </>}>
      <form id="create-bucket" className="flex flex-col gap-5" onSubmit={submit}>
        <Field label="Bucket name"
          error={name && !valid ? '3–63 characters: lowercase letters, numbers, dots and hyphens; must start and end with a letter or number.' : null}>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder="my-bucket" />
        </Field>
        <Field label="Region">
          <Input value={region} onChange={(e) => setRegion(e.target.value)} />
        </Field>
      </form>
    </Modal>
  )
}
