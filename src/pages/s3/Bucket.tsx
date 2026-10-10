import { useRef, useState, type DragEvent } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { Upload as Uploader } from '@aws-sdk/lib-storage'
import { Download, File, Folder, FolderPlus, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useSettings } from '@/lib/settings'
import { useAction } from '@/lib/hooks'
import { errorMessage, formatBytes, formatDate } from '@/lib/format'
import { baseName, deleteKeys, downloadObject, listAllKeys, listLevel } from '@/lib/s3'
import { Progress } from '@/components/ui/progress'
import {
  Button, Confirm, Empty, Field, Input, Modal, NameCell, PageHeader, Panel, RefreshButton, Table, Tabs,
} from '@/components/common'
import ObjectDrawer from './ObjectDrawer'
import BucketProperties from './BucketProperties'

type Row = { kind: 'folder'; key: string } | { kind: 'object'; key: string; size?: number; modified?: Date; storageClass?: string }

interface UploadState {
  name: string
  loaded: number
  total: number
  status: 'uploading' | 'done' | 'failed'
  error?: string
}

export default function Bucket() {
  const { bucket = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as 'objects' | 'properties') ?? 'objects'
  const prefix = params.get('prefix') ?? ''

  const crumbs = [{ label: 'S3', to: '/s3' }, { label: bucket, to: prefix ? `/s3/${bucket}` : undefined }]
  const parts = prefix.split('/').filter(Boolean)
  parts.forEach((p, i) => {
    const to = parts.slice(0, i + 1).join('/') + '/'
    crumbs.push({ label: p, to: i < parts.length - 1 ? `/s3/${bucket}?prefix=${encodeURIComponent(to)}` : undefined })
  })

  return (
    <>
      <PageHeader title={bucket} crumbs={crumbs} />
      <Tabs value={tab} onChange={(t) => setParams(t === 'objects' ? {} : { tab: t })}
        tabs={[{ id: 'objects', label: 'Objects' }, { id: 'properties', label: 'Properties' }]} />
      {tab === 'objects' ? <Objects bucket={bucket} prefix={prefix} /> : <BucketProperties bucket={bucket} />}
    </>
  )
}

function Objects({ bucket, prefix }: { bucket: string; prefix: string }) {
  const { clients } = useSettings()
  const [, setParams] = useSearchParams()
  const listing = useQuery({
    queryKey: ['s3', 'objects', bucket, prefix],
    queryFn: () => listLevel(clients.s3, bucket, prefix),
  })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [newFolder, setNewFolder] = useState<string | null>(null)
  const [uploads, setUploads] = useState<UploadState[]>([])
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const rows: Row[] = [
    ...(listing.data?.folders ?? []).map((key): Row => ({ kind: 'folder', key })),
    ...(listing.data?.objects ?? []).map((o): Row => ({
      kind: 'object', key: o.Key!, size: o.Size, modified: o.LastModified, storageClass: o.StorageClass,
    })),
  ]
  const goTo = (p: string) => {
    setSelected(new Set())
    setParams(p ? { prefix: p } : {})
  }

  const upload = async (files: File[]) => {
    if (!files.length) return
    const start = uploads.length
    setUploads((u) => [...u, ...files.map((f) => ({ name: prefix + f.name, loaded: 0, total: f.size, status: 'uploading' as const }))])
    const patch = (i: number, p: Partial<UploadState>) => setUploads((u) => u.map((x, j) => (j === start + i ? { ...x, ...p } : x)))
    await Promise.all(files.map(async (file, i) => {
      // lib-storage switches to multipart above 5 MB, exercising may's multipart API.
      const up = new Uploader({
        client: clients.s3,
        params: { Bucket: bucket, Key: prefix + file.name, Body: file, ContentType: file.type || undefined },
        queueSize: 4,
      })
      up.on('httpUploadProgress', (p) => patch(i, { loaded: p.loaded ?? 0 }))
      try {
        await up.done()
        patch(i, { status: 'done', loaded: file.size })
      } catch (err) {
        patch(i, { status: 'failed', error: errorMessage(err) })
      }
    }))
    await listing.refetch()
  }

  const remove = useAction(
    async (keys: string[]) => {
      const all: string[] = []
      for (const k of keys) {
        if (k.endsWith('/')) all.push(...(await listAllKeys(clients.s3, bucket, k)))
        else all.push(k)
      }
      return deleteKeys(clients.s3, bucket, all)
    },
    {
      invalidate: [['s3', 'objects', bucket]],
      success: (n) => `Deleted ${n} object${n === 1 ? '' : 's'}`,
      onSuccess: () => {
        setSelected(new Set())
        setConfirmDelete(false)
      },
    },
  )

  const createFolder = useAction(
    (name: string) => clients.s3.send(new PutObjectCommand({ Bucket: bucket, Key: `${prefix}${name.replace(/\/+$/, '')}/`, Body: '' })),
    { invalidate: [['s3', 'objects', bucket]], success: 'Folder created', onSuccess: () => setNewFolder(null) },
  )

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    void upload([...e.dataTransfer.files])
  }

  const selectedObjects = [...selected].filter((k) => !k.endsWith('/'))
  const folderSelected = [...selected].some((k) => k.endsWith('/'))

  return (
    <div className="relative flex flex-col gap-6"
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false) }}
      onDrop={onDrop}>
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-xl border-2 border-dashed border-primary bg-primary/10 text-lg font-semibold text-primary">
          Drop files to upload to {prefix || 'the bucket root'}
        </div>
      )}
      <Panel flush>
        <Table
          rows={listing.isSuccess ? rows : undefined}
          loading={listing.isLoading}
          error={listing.error}
          onRetry={() => listing.refetch()}
          rowKey={(r) => r.key}
          selectable
          selected={selected}
          onSelect={setSelected}
          filterPlaceholder="Filter by name in this folder"
          toolbar={<>
            <RefreshButton onClick={() => listing.refetch()} spinning={listing.isFetching} />
            <Button icon={<Download />} disabled={selectedObjects.length !== 1}
              onClick={() => downloadObject(clients.s3, bucket, selectedObjects[0]).catch((e) => toast.error(errorMessage(e)))}>
              Download
            </Button>
            <Button variant="danger" icon={<Trash2 />} disabled={!selected.size} onClick={() => setConfirmDelete(true)}>Delete</Button>
            <Button icon={<FolderPlus />} onClick={() => setNewFolder('')}>Create folder</Button>
            <Button variant="primary" icon={<Upload />} onClick={() => fileInput.current?.click()}>Upload</Button>
          </>}
          empty={
            <Empty title={prefix ? 'This folder is empty' : 'No objects'} icon={<Upload />}>
              Drag files here or use Upload.
            </Empty>
          }
          columns={[
            { header: 'Name', text: (r) => baseName(r.key), render: (r) => r.kind === 'folder'
              ? <NameCell icon={<Folder />} onClick={() => goTo(r.key)}>{baseName(r.key)}</NameCell>
              : <NameCell icon={<File />} onClick={() => setOpen(r.key)}>{baseName(r.key)}</NameCell> },
            { header: 'Type', className: 'w-24 text-muted-foreground', render: (r) => r.kind === 'folder'
              ? 'Folder' : (baseName(r.key).includes('.') ? r.key.split('.').pop()!.toLowerCase() : '—') },
            { header: 'Last modified', className: 'w-56', render: (r) => (r.kind === 'object' ? formatDate(r.modified) : '—') },
            { header: 'Size', className: 'w-24 tabular-nums', render: (r) => (r.kind === 'object' ? formatBytes(r.size) : '—') },
            { header: 'Storage class', className: 'w-32 text-muted-foreground', render: (r) => (r.kind === 'object' ? r.storageClass : '—') },
          ]}
        />
      </Panel>
      <input ref={fileInput} type="file" multiple hidden onChange={(e) => {
        void upload([...(e.target.files ?? [])])
        e.target.value = ''
      }} />

      {uploads.length > 0 && (
        <Panel title="Uploads" actions={
          <Button variant="ghost" size="sm" disabled={uploads.some((u) => u.status === 'uploading')} onClick={() => setUploads([])}>Clear</Button>
        }>
          <div className="flex flex-col gap-3">
            {uploads.map((u, i) => (
              <div className="flex flex-col gap-1.5 text-sm" key={i}>
                <div className="flex justify-between gap-4">
                  <span className="truncate font-medium">{u.name}</span>
                  <span className={cn('shrink-0 text-xs', u.status === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>
                    {u.status === 'failed' ? u.error : u.status === 'done' ? `Done · ${formatBytes(u.total)}` : `${formatBytes(u.loaded)} / ${formatBytes(u.total)}`}
                  </span>
                </div>
                <Progress value={u.total ? Math.min(100, (u.loaded / u.total) * 100) : 100}
                  className={cn(u.status === 'done' && '[&_[data-slot=progress-indicator]]:bg-emerald-500', u.status === 'failed' && '[&_[data-slot=progress-indicator]]:bg-destructive')} />
              </div>
            ))}
          </div>
        </Panel>
      )}

      {open && <ObjectDrawer bucket={bucket} objectKey={open} onClose={() => setOpen(null)} />}
      {confirmDelete && (
        <Confirm title={`Delete ${selected.size} item${selected.size === 1 ? '' : 's'}?`} loading={remove.isPending}
          confirmText={folderSelected ? 'delete' : undefined}
          onConfirm={() => remove.mutate([...selected])} onClose={() => setConfirmDelete(false)}>
          {folderSelected && <p>Folders are deleted with everything inside them.</p>}
          <ul className="flex flex-col gap-1">
            {[...selected].slice(0, 8).map((k) => <li key={k}><code className="rounded bg-muted px-1.5 py-0.5 text-xs">{k}</code></li>)}
          </ul>
          {selected.size > 8 && <p className="text-muted-foreground">…and {selected.size - 8} more</p>}
        </Confirm>
      )}
      {newFolder !== null && (
        <Modal title="Create folder" onClose={() => setNewFolder(null)} footer={<>
          <Button variant="secondary" onClick={() => setNewFolder(null)}>Cancel</Button>
          <Button variant="primary" disabled={!newFolder.trim() || newFolder.includes('/')} loading={createFolder.isPending}
            onClick={() => createFolder.mutate(newFolder.trim())}>Create</Button>
        </>}>
          <Field label="Folder name" hint={<>Creates an empty object <code>{prefix}{newFolder || 'name'}/</code></>}>
            <Input autoFocus value={newFolder} onChange={(e) => setNewFolder(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && newFolder.trim() && createFolder.mutate(newFolder.trim())} />
          </Field>
        </Modal>
      )}
    </div>
  )
}
