import {
  DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, type _Object, type S3Client,
} from '@aws-sdk/client-s3'

export interface Listing {
  folders: string[]
  objects: _Object[]
}

/** Lists one "directory" level under prefix, following every page. */
export async function listLevel(s3: S3Client, bucket: string, prefix: string): Promise<Listing> {
  const out: Listing = { folders: [], objects: [] }
  let token: string | undefined
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, Delimiter: '/', ContinuationToken: token }))
    out.folders.push(...(page.CommonPrefixes ?? []).map((p) => p.Prefix!))
    // A "folder marker" object equal to the prefix itself is not shown.
    out.objects.push(...(page.Contents ?? []).filter((o) => o.Key !== prefix))
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)
  return out
}

export async function listAllKeys(s3: S3Client, bucket: string, prefix = ''): Promise<string[]> {
  const keys: string[] = []
  let token: string | undefined
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }))
    keys.push(...(page.Contents ?? []).map((o) => o.Key!))
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)
  return keys
}

/** Deletes keys in batches of 1000 and returns how many were deleted. */
export async function deleteKeys(s3: S3Client, bucket: string, keys: string[]): Promise<number> {
  let deleted = 0
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000)
    const res = await s3.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
    }))
    if (res.Errors?.length) throw new Error(`Failed to delete ${res.Errors[0].Key}: ${res.Errors[0].Message}`)
    deleted += batch.length
  }
  return deleted
}

export async function downloadObject(s3: S3Client, bucket: string, key: string) {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  const bytes = await res.Body!.transformToByteArray()
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: res.ContentType ?? 'application/octet-stream' }))
  const a = document.createElement('a')
  a.href = url
  a.download = key.split('/').pop() || 'download'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function baseName(key: string): string {
  const trimmed = key.endsWith('/') ? key.slice(0, -1) : key
  return trimmed.slice(trimmed.lastIndexOf('/') + 1) + (key.endsWith('/') ? '/' : '')
}

export const bucketNamePattern = /^(?!\d+\.\d+\.\d+\.\d+$)(?!.*\.\.)[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/
