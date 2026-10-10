import { S3Client } from '@aws-sdk/client-s3'
import { IAMClient } from '@aws-sdk/client-iam'
import { STSClient } from '@aws-sdk/client-sts'
import { SQSClient } from '@aws-sdk/client-sqs'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { EC2Client } from '@aws-sdk/client-ec2'
import { CloudWatchLogsClient } from '@aws-sdk/client-cloudwatch-logs'
import { RDSClient } from '@aws-sdk/client-rds'
import type { Settings } from './settings'

export interface Clients {
  s3: S3Client
  iam: IAMClient
  sts: STSClient
  sqs: SQSClient
  dynamodb: DynamoDBClient
  ec2: EC2Client
  logs: CloudWatchLogsClient
  rds: RDSClient
  may: MayApi
}

export function makeClients(s: Settings): Clients {
  const common = {
    endpoint: s.endpoint,
    region: s.region,
    credentials: { accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey },
    maxAttempts: 1,
  }
  return {
    // Path-style keeps every request on the configured host, which avoids
    // needing wildcard DNS for bucket.localhost in the browser.
    s3: new S3Client({ ...common, forcePathStyle: true }),
    // IAM is global; real AWS signs it for us-east-1.
    iam: new IAMClient({ ...common, region: 'us-east-1' }),
    sts: new STSClient(common),
    // The SDK verifies message MD5s, which also checks may's checksums.
    sqs: new SQSClient(common),
    dynamodb: new DynamoDBClient(common),
    ec2: new EC2Client(common),
    logs: new CloudWatchLogsClient(common),
    rds: new RDSClient(common),
    may: new MayApi(s.endpoint),
  }
}

export interface InstanceEndpoint {
  instanceId: string
  region: string
  container: string
  image: string
  defaultUser: string
  ssh?: string
  ports: Record<string, number>
  exec: string
}

export interface DatabaseEndpoint {
  dbInstanceIdentifier: string
  region: string
  engine: string
  container: string
  image: string
  host: string
  port: number
  masterUsername: string
  connect: string
}

export interface Health {
  services: Record<string, string>
  version: string
  edition?: string
}

/** The emulator's own utility endpoints (/_may/...). */
export class MayApi {
  private endpoint: string

  constructor(endpoint: string) {
    this.endpoint = endpoint
  }

  async health(): Promise<Health> {
    const res = await fetch(`${this.endpoint}/_may/health`)
    if (!res.ok) throw new Error(`Health check failed: HTTP ${res.status}`)
    return res.json()
  }

  /** In EC2 real mode (may -docker): how to reach each instance. Empty otherwise. */
  async instanceEndpoints(): Promise<InstanceEndpoint[]> {
    const res = await fetch(`${this.endpoint}/_may/ec2/instances`)
    if (!res.ok) return []
    return (await res.json()) ?? []
  }

  /** In RDS real mode (may -docker): how to connect to each database. Empty otherwise. */
  async databaseEndpoints(): Promise<DatabaseEndpoint[]> {
    const res = await fetch(`${this.endpoint}/_may/rds/instances`)
    if (!res.ok) return []
    return (await res.json()) ?? []
  }

  async reset(): Promise<void> {
    const res = await fetch(`${this.endpoint}/_may/reset`, { method: 'POST' })
    if (!res.ok) throw new Error(`Reset failed: HTTP ${res.status}`)
  }
}

/** IAM returns policy documents URL-encoded; the JS SDK leaves them that way. */
export function decodePolicy(doc: string | undefined): string {
  if (!doc) return ''
  let text = doc
  try {
    text = decodeURIComponent(doc.replace(/\+/g, ' '))
  } catch {
    // Already decoded.
  }
  return prettyJson(text)
}

export function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}
