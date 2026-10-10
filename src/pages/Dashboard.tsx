import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ListBucketsCommand } from '@aws-sdk/client-s3'
import { ListGroupsCommand, ListPoliciesCommand, ListRolesCommand, ListUsersCommand } from '@aws-sdk/client-iam'
import { GetCallerIdentityCommand } from '@aws-sdk/client-sts'
import { ArrowUpRight, DatabaseZap, ScrollText, Server, Database, FileKey2, MessagesSquare, RotateCcw, ShieldCheck, Table2, User, Users } from 'lucide-react'
import { listQueues } from '@/lib/sqs'
import { listTables } from '@/lib/dynamodb'
import { DescribeInstancesCommand } from '@aws-sdk/client-ec2'
import { DescribeDBInstancesCommand } from '@aws-sdk/client-rds'
import { listGroups } from './cloudwatch/Groups'
import { useSettings } from '@/lib/settings'
import { useAction } from '@/lib/hooks'
import { useHealth } from '@/components/Shell'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge, Button, CodeBlock, Confirm, ErrorBox, KeyValue, Mono, PageHeader, Panel, Spinner } from '@/components/common'

export default function Dashboard() {
  const { clients, settings } = useSettings()
  const health = useHealth()
  const identity = useQuery({ queryKey: ['sts', 'identity'], queryFn: () => clients.sts.send(new GetCallerIdentityCommand({})) })
  const [confirmReset, setConfirmReset] = useState(false)

  const counts = [
    { label: 'S3 buckets', to: '/s3', icon: Database,
      q: useQuery({ queryKey: ['count', 'buckets'], queryFn: async () => (await clients.s3.send(new ListBucketsCommand({}))).Buckets?.length ?? 0 }) },
    { label: 'EC2 instances', to: '/ec2/instances', icon: Server,
      q: useQuery({ queryKey: ['count', 'instances'], queryFn: async () => (await clients.ec2.send(new DescribeInstancesCommand({ Filters: [{ Name: 'instance-state-name', Values: ['pending', 'running', 'stopping', 'stopped'] }] }))).Reservations?.reduce((n, r) => n + (r.Instances?.length ?? 0), 0) ?? 0 }) },
    { label: 'RDS databases', to: '/rds/databases', icon: DatabaseZap,
      q: useQuery({ queryKey: ['count', 'databases'], queryFn: async () => (await clients.rds.send(new DescribeDBInstancesCommand({}))).DBInstances?.length ?? 0 }) },
    { label: 'Log groups', to: '/logs', icon: ScrollText,
      q: useQuery({ queryKey: ['count', 'log-groups'], queryFn: async () => (await listGroups(clients.logs)).length }) },
    { label: 'DynamoDB tables', to: '/dynamodb', icon: Table2,
      q: useQuery({ queryKey: ['count', 'tables'], queryFn: async () => (await listTables(clients.dynamodb)).length }) },
    { label: 'SQS queues', to: '/sqs', icon: MessagesSquare,
      q: useQuery({ queryKey: ['count', 'queues'], queryFn: async () => (await listQueues(clients.sqs)).length }) },
    { label: 'IAM roles', to: '/iam/roles', icon: ShieldCheck,
      q: useQuery({ queryKey: ['count', 'roles'], queryFn: async () => (await clients.iam.send(new ListRolesCommand({ MaxItems: 1000 }))).Roles?.length ?? 0 }) },
    { label: 'IAM users', to: '/iam/users', icon: User,
      q: useQuery({ queryKey: ['count', 'users'], queryFn: async () => (await clients.iam.send(new ListUsersCommand({ MaxItems: 1000 }))).Users?.length ?? 0 }) },
    { label: 'IAM groups', to: '/iam/groups', icon: Users,
      q: useQuery({ queryKey: ['count', 'groups'], queryFn: async () => (await clients.iam.send(new ListGroupsCommand({ MaxItems: 1000 }))).Groups?.length ?? 0 }) },
    { label: 'Customer policies', to: '/iam/policies', icon: FileKey2,
      q: useQuery({ queryKey: ['count', 'policies'], queryFn: async () => (await clients.iam.send(new ListPoliciesCommand({ Scope: 'Local', MaxItems: 1000 }))).Policies?.length ?? 0 }) },
  ]

  const reset = useAction(() => clients.may.reset(), {
    invalidate: [['count'], ['s3'], ['iam'], ['sts'], ['sqs'], ['dynamodb'], ['ec2'], ['rds'], ['logs']],
    success: 'All state was wiped',
    onSuccess: () => setConfirmReset(false),
  })

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Overview of your local cloud."
        actions={<Button variant="danger" icon={<RotateCcw />} onClick={() => setConfirmReset(true)}>Reset all state</Button>}
      />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {counts.map(({ label, to, icon: Icon, q }) => (
          <Link key={label} to={to} className="group">
            <Card className="gap-2 py-4 transition-colors group-hover:border-primary/50">
              <CardHeader className="px-4">
                <CardDescription className="flex items-center gap-2"><Icon className="size-4" /> {label}
                  <ArrowUpRight className="ml-auto size-4 opacity-0 transition-opacity group-hover:opacity-100" />
                </CardDescription>
                <CardTitle className="text-3xl font-semibold tabular-nums">
                  {q.isLoading ? <Skeleton className="h-9 w-12" /> : q.isError ? '—' : q.data}
                </CardTitle>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Emulator">
          {health.isLoading ? <Spinner /> : health.isError ? <ErrorBox error={health.error} onRetry={() => health.refetch()} /> : (
            <KeyValue items={[
              ['Status', <Badge tone="green">Running</Badge>],
              ['Version', health.data?.version],
              ['Endpoint', <Mono copy>{settings.endpoint}</Mono>],
              ['Services', (
                <span className="flex flex-wrap gap-1">
                  {Object.entries(health.data?.services ?? {}).sort().map(([name, st]) => (
                    <Badge key={name} tone={st === 'running' ? 'blue' : 'neutral'}>{name}</Badge>
                  ))}
                </span>
              )],
            ]} />
          )}
        </Panel>

        <Panel title="Caller identity" description="Who requests from this console are signed as.">
          {identity.isLoading ? <Spinner /> : identity.isError ? <ErrorBox error={identity.error} /> : (
            <KeyValue items={[
              ['Account', <Mono copy>{identity.data?.Account}</Mono>],
              ['User ID', <Mono copy>{identity.data?.UserId}</Mono>],
              ['ARN', <Mono copy>{identity.data?.Arn}</Mono>],
              ['Access key', <Mono>{settings.accessKeyId}</Mono>],
            ]} />
          )}
        </Panel>
      </div>

      <Panel title="Connect your tools" description="Any AWS SDK or CLI works; credentials are not checked.">
        <CodeBlock>{`export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=${settings.region}
aws --endpoint-url ${settings.endpoint} s3 ls
aws --endpoint-url ${settings.endpoint} dynamodb list-tables
aws --endpoint-url ${settings.endpoint} sqs list-queues
aws --endpoint-url ${settings.endpoint} rds describe-db-instances

# boto3
boto3.client("s3", endpoint_url="${settings.endpoint}")
boto3.resource("dynamodb", endpoint_url="${settings.endpoint}")`}</CodeBlock>
      </Panel>

      {confirmReset && (
        <Confirm title="Reset all state?" confirmLabel="Reset" confirmText="reset" loading={reset.isPending}
          onConfirm={() => reset.mutate(undefined)} onClose={() => setConfirmReset(false)}>
          <p>This deletes every bucket, object, table, queue, log group, EC2 resource (and instance container), RDS database (and its container and data), IAM entity and session in the emulator. It cannot be undone.</p>
        </Confirm>
      )}
    </>
  )
}
