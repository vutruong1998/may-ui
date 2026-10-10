import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  DeleteObjectCommand, GetObjectCommand, GetObjectTaggingCommand, HeadObjectCommand, PutObjectTaggingCommand,
} from '@aws-sdk/client-s3'
import { Download, Eye, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useSettings } from '@/lib/settings'
import { useAction } from '@/lib/hooks'
import { errorMessage, formatBytes, formatDate } from '@/lib/format'
import { baseName, downloadObject } from '@/lib/s3'
import { TagsEditor } from '@/components/TagsEditor'
import { Button, CodeBlock, Confirm, Drawer, Empty, ErrorBox, KeyValue, Mono, Spinner, Tabs } from '@/components/common'

const PREVIEW_LIMIT = 1024 * 1024

function previewKind(contentType: string | undefined, key: string): 'text' | 'image' | null {
  const ct = contentType ?? ''
  if (ct.startsWith('image/')) return 'image'
  if (ct.startsWith('text/') || /json|xml|yaml|javascript/.test(ct)) return 'text'
  if (/\.(txt|md|json|ya?ml|xml|csv|log|tf|go|py|ts|tsx|js|html|css|sh|toml|ini)$/i.test(key)) return 'text'
  return null
}

export default function ObjectDrawer({ bucket, objectKey, onClose }: { bucket: string; objectKey: string; onClose: () => void }) {
  const { clients } = useSettings()
  const [tab, setTab] = useState<'details' | 'preview' | 'tags'>('details')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const head = useQuery({
    queryKey: ['s3', 'head', bucket, objectKey],
    queryFn: () => clients.s3.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey })),
  })
  const tags = useQuery({
    queryKey: ['s3', 'object-tags', bucket, objectKey],
    queryFn: async () => (await clients.s3.send(new GetObjectTaggingCommand({ Bucket: bucket, Key: objectKey }))).TagSet ?? [],
    enabled: tab === 'tags',
  })
  const kind = previewKind(head.data?.ContentType, objectKey)
  const previewable = !!kind && (head.data?.ContentLength ?? 0) <= PREVIEW_LIMIT
  const preview = useQuery({
    queryKey: ['s3', 'preview', bucket, objectKey, head.data?.ETag],
    enabled: tab === 'preview' && previewable,
    queryFn: async () => {
      const res = await clients.s3.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }))
      if (kind === 'image') {
        const bytes = await res.Body!.transformToByteArray()
        return URL.createObjectURL(new Blob([bytes as BlobPart], { type: res.ContentType }))
      }
      return res.Body!.transformToString()
    },
  })

  const saveTags = useAction(
    (TagSet: { Key: string; Value: string }[]) =>
      clients.s3.send(new PutObjectTaggingCommand({ Bucket: bucket, Key: objectKey, Tagging: { TagSet } })),
    { invalidate: [['s3', 'object-tags', bucket, objectKey]], success: 'Tags saved' },
  )
  const remove = useAction(
    () => clients.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey })),
    { invalidate: [['s3', 'objects', bucket]], success: `Deleted ${baseName(objectKey)}`, onSuccess: onClose },
  )

  const h = head.data
  const uri = `s3://${bucket}/${objectKey}`
  const extra = ([
    ['Cache-Control', h?.CacheControl], ['Content-Disposition', h?.ContentDisposition],
    ['Content-Encoding', h?.ContentEncoding], ['Content-Language', h?.ContentLanguage],
  ] as [string, string | undefined][]).filter(([, v]) => v)

  return (
    <>
      <Drawer title={baseName(objectKey)} description={uri} onClose={onClose}>
        <div className="mb-4 flex gap-2">
          <Button icon={<Download />}
            onClick={() => downloadObject(clients.s3, bucket, objectKey).catch((e) => toast.error(errorMessage(e)))}>Download</Button>
          <Button variant="danger" icon={<Trash2 />} onClick={() => setConfirmDelete(true)}>Delete</Button>
        </div>
        <Tabs value={tab} onChange={setTab} tabs={[
          { id: 'details', label: 'Details' }, { id: 'preview', label: 'Preview' }, { id: 'tags', label: 'Tags' },
        ]} />

        {head.isLoading ? <Spinner /> : head.isError ? <ErrorBox error={head.error} /> : tab === 'details' ? (
          <div className="flex flex-col gap-6">
            <KeyValue items={[
              ['Key', <Mono copy>{objectKey}</Mono>],
              ['S3 URI', <Mono copy>{uri}</Mono>],
              ['Size', `${formatBytes(h?.ContentLength)} (${h?.ContentLength?.toLocaleString()} bytes)`],
              ['Last modified', formatDate(h?.LastModified)],
              ['ETag', <Mono copy>{h?.ETag}</Mono>],
              ['Content type', h?.ContentType],
              ['Storage class', h?.StorageClass ?? 'STANDARD'],
              ['Encryption', h?.ServerSideEncryption],
              ...extra,
            ]} />
            <div>
              <h3 className="mb-2 text-sm font-medium">User metadata</h3>
              {Object.keys(h?.Metadata ?? {}).length ? (
                <KeyValue items={Object.entries(h!.Metadata!).map(([k, v]) => [`x-amz-meta-${k}`, v])} />
              ) : <span className="text-sm text-muted-foreground">None</span>}
            </div>
          </div>
        ) : tab === 'preview' ? (
          !kind ? <Empty title="No preview" icon={<Eye />}>Preview is available for text and image files.</Empty>
            : !previewable ? <Empty title="Too large to preview" icon={<Eye />}>Files up to {formatBytes(PREVIEW_LIMIT)} can be previewed.</Empty>
            : preview.isLoading ? <Spinner />
            : preview.isError ? <ErrorBox error={preview.error} />
            : kind === 'image' ? <img className="max-w-full rounded-lg border" src={preview.data} alt={objectKey} />
            : <CodeBlock>{preview.data ?? ''}</CodeBlock>
        ) : tags.isLoading ? <Spinner /> : tags.isError ? <ErrorBox error={tags.error} /> : (
          <TagsEditor tags={tags.data} max={10} saving={saveTags.isPending} onSave={(t) => saveTags.mutate(t)} />
        )}
      </Drawer>
      {confirmDelete && (
        <Confirm title="Delete object?" loading={remove.isPending} onConfirm={() => remove.mutate(undefined)} onClose={() => setConfirmDelete(false)}>
          <p><code className="rounded bg-muted px-1.5 py-0.5 text-xs">{uri}</code> will be permanently deleted.</p>
        </Confirm>
      )}
    </>
  )
}
