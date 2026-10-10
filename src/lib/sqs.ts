import { useQuery } from '@tanstack/react-query'
import { GetQueueAttributesCommand, ListQueuesCommand, type SQSClient } from '@aws-sdk/client-sqs'
import { useSettings } from './settings'

export const queueNamePattern = /^[A-Za-z0-9_-]{1,80}$/

/** The queue name is the last segment of its URL. */
export function queueName(url: string): string {
  return url.slice(url.lastIndexOf('/') + 1)
}

export interface QueueInfo {
  url: string
  name: string
  fifo: boolean
  attributes: Record<string, string>
}

export async function listQueues(sqs: SQSClient): Promise<string[]> {
  const urls: string[] = []
  let NextToken: string | undefined
  do {
    const page = await sqs.send(new ListQueuesCommand({ MaxResults: 1000, NextToken }))
    urls.push(...(page.QueueUrls ?? []))
    NextToken = page.NextToken
  } while (NextToken)
  return urls
}

export async function queueAttributes(sqs: SQSClient, url: string): Promise<Record<string, string>> {
  return (await sqs.send(new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ['All'] }))).Attributes ?? {}
}

/** Every queue with its attributes. */
export function useQueues() {
  const { clients } = useSettings()
  return useQuery({
    queryKey: ['sqs', 'queues'],
    queryFn: async (): Promise<QueueInfo[]> => {
      const urls = await listQueues(clients.sqs)
      return Promise.all(urls.map(async (url) => {
        const attributes = await queueAttributes(clients.sqs, url)
        return { url, name: queueName(url), fifo: attributes.FifoQueue === 'true', attributes }
      }))
    },
  })
}

/** Formats a duration in seconds the way the AWS console does ("4 days", "30 s"). */
export function formatSeconds(v: string | number | undefined): string {
  if (v === undefined || v === '') return '—'
  const s = Number(v)
  if (s === 0) return '0 s'
  const units: [number, string][] = [[86400, 'day'], [3600, 'hour'], [60, 'min']]
  for (const [n, label] of units) {
    if (s >= n && s % n === 0) {
      const k = s / n
      return label === 'min' ? `${k} min` : `${k} ${label}${k === 1 ? '' : 's'}`
    }
  }
  return `${s} s`
}

export interface RedrivePolicy {
  deadLetterTargetArn: string
  maxReceiveCount: number
}

export function parseRedrive(text: string | undefined): RedrivePolicy | null {
  if (!text) return null
  try {
    const p = JSON.parse(text)
    return { deadLetterTargetArn: p.deadLetterTargetArn, maxReceiveCount: Number(p.maxReceiveCount) }
  } catch {
    return null
  }
}

/** Name of the queue an SQS ARN refers to. */
export function arnName(arn: string | undefined): string {
  return arn ? arn.slice(arn.lastIndexOf(':') + 1) : ''
}
