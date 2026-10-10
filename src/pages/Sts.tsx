import { useState, type FormEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ListRolesCommand } from '@aws-sdk/client-iam'
import { AssumeRoleCommand, GetSessionTokenCommand, type Credentials } from '@aws-sdk/client-sts'
import { KeyRound, LogIn } from 'lucide-react'
import { useSettings } from '@/lib/settings'
import { useAction } from '@/lib/hooks'
import { formatDate } from '@/lib/format'
import { Button, CodeBlock, Field, Input, KeyValue, Mono, Option, PageHeader, Panel, Select } from '@/components/common'

interface Issued {
  title: string
  creds: Credentials
  arn?: string
}

export default function Sts() {
  const { clients, settings, update } = useSettings()
  const roles = useQuery({
    queryKey: ['iam', 'roles'],
    queryFn: async () => (await clients.iam.send(new ListRolesCommand({ MaxItems: 1000 }))).Roles ?? [],
  })
  const [roleArn, setRoleArn] = useState('')
  const [session, setSession] = useState('console-session')
  const [duration, setDuration] = useState(3600)
  const [issued, setIssued] = useState<Issued | null>(null)

  const assume = useAction(
    () => clients.sts.send(new AssumeRoleCommand({ RoleArn: roleArn, RoleSessionName: session, DurationSeconds: duration })),
    { success: 'Role assumed', onSuccess: (r) => setIssued({ title: 'AssumeRole', creds: r.Credentials!, arn: r.AssumedRoleUser?.Arn }) },
  )
  const sessionToken = useAction(
    () => clients.sts.send(new GetSessionTokenCommand({ DurationSeconds: 3600 })),
    { success: 'Session token issued', onSuccess: (r) => setIssued({ title: 'GetSessionToken', creds: r.Credentials! }) },
  )

  const submit = (e: FormEvent) => {
    e.preventDefault()
    assume.mutate(undefined)
  }

  const details: [ReactNode, ReactNode][] = []
  if (issued?.arn) details.push(['Assumed role ARN', <Mono copy>{issued.arn}</Mono>])
  if (issued) {
    details.push(
      ['Access key ID', <Mono copy>{issued.creds.AccessKeyId}</Mono>],
      ['Secret access key', <Mono copy>{issued.creds.SecretAccessKey}</Mono>],
      ['Expires', formatDate(issued.creds.Expiration)],
    )
  }

  return (
    <>
      <PageHeader title="STS credentials" description="Issue temporary credentials. Requests signed with them identify as the assumed role." />
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Assume a role">
          <form className="flex flex-col gap-5" onSubmit={submit}>
            <Field label="Role">
              <Select className="w-full" value={roleArn} onChange={(e) => setRoleArn(e.target.value)} required>
                <Option value="">{roles.data?.length ? 'Choose a role…' : 'No roles yet: create one under IAM → Roles'}</Option>
                {roles.data?.map((r) => <Option key={r.Arn} value={r.Arn}>{r.RoleName}</Option>)}
              </Select>
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Session name">
                <Input value={session} onChange={(e) => setSession(e.target.value)} pattern="[\w+=,.@\-]{2,64}" required />
              </Field>
              <Field label="Duration (seconds)" hint="900 to 43,200">
                <Input type="number" min={900} max={43200} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
              </Field>
            </div>
            <div>
              <Button variant="primary" type="submit" icon={<LogIn />} loading={assume.isPending} disabled={!roleArn}>Assume role</Button>
            </div>
          </form>
        </Panel>
        <Panel title="Session token" description="Temporary credentials for the current identity.">
          <Button icon={<KeyRound />} loading={sessionToken.isPending} onClick={() => sessionToken.mutate(undefined)}>Get session token</Button>
        </Panel>
      </div>

      {issued && (
        <Panel title={`Credentials from ${issued.title}`} actions={
          <Button onClick={() => update({ accessKeyId: issued.creds.AccessKeyId!, secretAccessKey: issued.creds.SecretAccessKey! })}>
            Use in this console
          </Button>
        }>
          <div className="flex flex-col gap-4">
            <KeyValue items={details} />
            <CodeBlock>{`export AWS_ACCESS_KEY_ID=${issued.creds.AccessKeyId}
export AWS_SECRET_ACCESS_KEY=${issued.creds.SecretAccessKey}
export AWS_SESSION_TOKEN=${issued.creds.SessionToken}
aws --endpoint-url ${settings.endpoint} sts get-caller-identity`}</CodeBlock>
          </div>
        </Panel>
      )}
    </>
  )
}
