import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  DeleteBucketCorsCommand, DeleteBucketPolicyCommand, GetBucketCorsCommand, GetBucketEncryptionCommand,
  GetBucketLocationCommand, GetBucketPolicyCommand, GetBucketTaggingCommand, GetBucketVersioningCommand,
  PutBucketCorsCommand, PutBucketEncryptionCommand, PutBucketPolicyCommand, PutBucketTaggingCommand,
  DeleteBucketTaggingCommand, PutBucketVersioningCommand, type CORSRule, type ServerSideEncryption,
} from '@aws-sdk/client-s3'
import { useSettings } from '@/lib/settings'
import { useAction } from '@/lib/hooks'
import { formatDate, isNotFound, validJson } from '@/lib/format'
import { prettyJson } from '@/lib/aws'
import { TagsEditor } from '@/components/TagsEditor'
import { Badge, Button, ErrorBox, Field, Input, JsonEditor, KeyValue, Mono, Option, Panel, Select, Spinner } from '@/components/common'
import { useBuckets } from './Buckets'

/** Runs a "get config" call, mapping S3's "not configured" 404s to null. */
async function optional<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

export default function BucketProperties({ bucket }: { bucket: string }) {
  const { clients } = useSettings()
  const s3 = clients.s3
  const buckets = useBuckets()
  const info = buckets.data?.find((b) => b.Name === bucket)
  const location = useQuery({
    queryKey: ['s3', 'location', bucket],
    queryFn: async () => (await s3.send(new GetBucketLocationCommand({ Bucket: bucket }))).LocationConstraint || 'us-east-1',
  })

  return (
    <div className="flex flex-col gap-6">
      <Panel title="Overview">
        <KeyValue items={[
          ['Name', <Mono copy>{bucket}</Mono>],
          ['Region', location.data ?? '…'],
          ['ARN', <Mono copy>{`arn:aws:s3:::${bucket}`}</Mono>],
          ['Created', formatDate(info?.CreationDate)],
        ]} />
      </Panel>
      <div className="grid gap-6 lg:grid-cols-2">
        <Versioning bucket={bucket} />
        <Encryption bucket={bucket} />
      </div>
      <Tags bucket={bucket} />
      <Policy bucket={bucket} />
      <Cors bucket={bucket} />
    </div>
  )
}

function Versioning({ bucket }: { bucket: string }) {
  const { clients } = useSettings()
  const q = useQuery({
    queryKey: ['s3', 'versioning', bucket],
    queryFn: async () => (await clients.s3.send(new GetBucketVersioningCommand({ Bucket: bucket }))).Status ?? 'Disabled',
  })
  const set = useAction(
    (Status: 'Enabled' | 'Suspended') => clients.s3.send(new PutBucketVersioningCommand({ Bucket: bucket, VersioningConfiguration: { Status } })),
    { invalidate: [['s3', 'versioning', bucket]], success: 'Versioning updated' },
  )
  const enabled = q.data === 'Enabled'
  return (
    <Panel title="Versioning" description="may records the status; only the latest version of each object is kept."
      actions={q.isSuccess && (
        <Button loading={set.isPending} onClick={() => set.mutate(enabled ? 'Suspended' : 'Enabled')}>{enabled ? 'Suspend' : 'Enable'}</Button>
      )}>
      {q.isLoading ? <Spinner /> : q.isError ? <ErrorBox error={q.error} /> : (
        <Badge tone={enabled ? 'green' : q.data === 'Suspended' ? 'amber' : 'neutral'}>{q.data}</Badge>
      )}
    </Panel>
  )
}

function Encryption({ bucket }: { bucket: string }) {
  const { clients } = useSettings()
  const q = useQuery({
    queryKey: ['s3', 'encryption', bucket],
    queryFn: async () => {
      const res = await optional(() => clients.s3.send(new GetBucketEncryptionCommand({ Bucket: bucket })))
      return res?.ServerSideEncryptionConfiguration?.Rules?.[0]?.ApplyServerSideEncryptionByDefault ?? null
    },
  })
  const [alg, setAlg] = useState<ServerSideEncryption>('AES256')
  const [kmsKey, setKmsKey] = useState('')
  useEffect(() => {
    if (q.data) {
      setAlg(q.data.SSEAlgorithm ?? 'AES256')
      setKmsKey(q.data.KMSMasterKeyID ?? '')
    }
  }, [q.data])
  const save = useAction(
    () => clients.s3.send(new PutBucketEncryptionCommand({
      Bucket: bucket,
      ServerSideEncryptionConfiguration: { Rules: [{ ApplyServerSideEncryptionByDefault: {
        SSEAlgorithm: alg, KMSMasterKeyID: alg === 'AES256' ? undefined : kmsKey || undefined,
      } }] },
    })),
    { invalidate: [['s3', 'encryption', bucket]], success: 'Encryption updated' },
  )
  return (
    <Panel title="Default encryption" description="Stored and reported; objects are not actually encrypted.">
      {q.isLoading ? <Spinner /> : q.isError ? <ErrorBox error={q.error} /> : (
        <div className="flex flex-col gap-4">
          <Field label="Encryption type">
            <Select className="w-full" value={alg} onChange={(e) => setAlg(e.target.value as ServerSideEncryption)}>
              <Option value="AES256">SSE-S3 (AES256)</Option>
              <Option value="aws:kms">SSE-KMS (aws:kms)</Option>
            </Select>
          </Field>
          {alg !== 'AES256' && (
            <Field label="KMS key ID" hint="Optional.">
              <Input className="font-mono" value={kmsKey} onChange={(e) => setKmsKey(e.target.value)} />
            </Field>
          )}
          <div>
            <Button variant="primary" loading={save.isPending}
              disabled={alg === (q.data?.SSEAlgorithm ?? 'AES256') && kmsKey === (q.data?.KMSMasterKeyID ?? '')}
              onClick={() => save.mutate(undefined)}>Save</Button>
          </div>
        </div>
      )}
    </Panel>
  )
}

function Tags({ bucket }: { bucket: string }) {
  const { clients } = useSettings()
  const q = useQuery({
    queryKey: ['s3', 'bucket-tags', bucket],
    queryFn: async () => (await optional(() => clients.s3.send(new GetBucketTaggingCommand({ Bucket: bucket }))))?.TagSet ?? [],
  })
  const save = useAction(
    (TagSet: { Key: string; Value: string }[]) => TagSet.length
      ? clients.s3.send(new PutBucketTaggingCommand({ Bucket: bucket, Tagging: { TagSet } }))
      : clients.s3.send(new DeleteBucketTaggingCommand({ Bucket: bucket })),
    { invalidate: [['s3', 'bucket-tags', bucket]], success: 'Tags saved' },
  )
  return (
    <Panel title="Tags">
      {q.isLoading ? <Spinner /> : q.isError ? <ErrorBox error={q.error} /> : (
        <TagsEditor tags={q.data} saving={save.isPending} onSave={(t) => save.mutate(t)} />
      )}
    </Panel>
  )
}

/** A JSON document panel with save and delete, shared by bucket policy and CORS. */
function JsonConfig({ title, description, load, save, remove, queryKey, template }: {
  title: string
  description: string
  queryKey: string[]
  load: () => Promise<string | null>
  save: (doc: string) => Promise<unknown>
  remove: () => Promise<unknown>
  template: string
}) {
  const q = useQuery({ queryKey, queryFn: load })
  const [text, setText] = useState('')
  useEffect(() => setText(q.data ?? ''), [q.data])
  const put = useAction(save, { invalidate: [queryKey], success: `${title} saved` })
  const del = useAction(remove, { invalidate: [queryKey], success: `${title} deleted` })
  const configured = q.data != null

  return (
    <Panel title={title} description={description} actions={configured
      ? <Badge tone="green">Configured</Badge>
      : q.isSuccess && <Badge>Not configured</Badge>}>
      {q.isLoading ? <Spinner /> : q.isError ? <ErrorBox error={q.error} /> : (
        <div className="flex flex-col gap-4">
          {!configured && !text ? (
            <div><Button onClick={() => setText(template)}>Start from a template</Button></div>
          ) : (
            <JsonEditor value={text} onChange={setText} />
          )}
          <div className="flex flex-wrap items-center gap-2">
            {configured && <Button variant="danger" loading={del.isPending} onClick={() => del.mutate(undefined)}>Delete</Button>}
            <div className="flex-1" />
            {text !== (q.data ?? '') && <Button variant="ghost" onClick={() => setText(q.data ?? '')}>Discard</Button>}
            <Button variant="primary" loading={put.isPending} disabled={!text.trim() || !!validJson(text) || text === (q.data ?? '')}
              onClick={() => put.mutate(text)}>Save</Button>
          </div>
        </div>
      )}
    </Panel>
  )
}

function Policy({ bucket }: { bucket: string }) {
  const { clients } = useSettings()
  const s3 = clients.s3
  return (
    <JsonConfig
      title="Bucket policy"
      description="Stored and returned, but not enforced by may."
      queryKey={['s3', 'policy', bucket]}
      load={async () => {
        const res = await optional(() => s3.send(new GetBucketPolicyCommand({ Bucket: bucket })))
        return res?.Policy ? prettyJson(res.Policy) : null
      }}
      save={(Policy) => s3.send(new PutBucketPolicyCommand({ Bucket: bucket, Policy }))}
      remove={() => s3.send(new DeleteBucketPolicyCommand({ Bucket: bucket }))}
      template={prettyJson(JSON.stringify({
        Version: '2012-10-17',
        Statement: [{ Sid: 'PublicRead', Effect: 'Allow', Principal: '*', Action: 's3:GetObject', Resource: `arn:aws:s3:::${bucket}/*` }],
      }))}
    />
  )
}

function Cors({ bucket }: { bucket: string }) {
  const { clients } = useSettings()
  const s3 = clients.s3
  return (
    <JsonConfig
      title="CORS"
      description="A JSON array of CORS rules, in the same shape as the S3 API."
      queryKey={['s3', 'cors', bucket]}
      load={async () => {
        const res = await optional(() => s3.send(new GetBucketCorsCommand({ Bucket: bucket })))
        return res?.CORSRules ? JSON.stringify(res.CORSRules, null, 2) : null
      }}
      save={(doc) => s3.send(new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: JSON.parse(doc) as CORSRule[] } }))}
      remove={() => s3.send(new DeleteBucketCorsCommand({ Bucket: bucket }))}
      template={JSON.stringify([{ AllowedMethods: ['GET', 'PUT'], AllowedOrigins: ['*'], AllowedHeaders: ['*'], MaxAgeSeconds: 3000 }], null, 2)}
    />
  )
}
