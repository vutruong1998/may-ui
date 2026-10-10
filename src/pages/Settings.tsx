import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { useSettings, defaultSettings, type Settings as S } from '@/lib/settings'
import { Button, Field, Input, Option, PageHeader, Panel, Select } from '@/components/common'

const regions = ['us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'eu-west-1', 'eu-central-1', 'ap-southeast-1', 'ap-northeast-1']

export default function Settings() {
  const { settings, update } = useSettings()
  const [form, setForm] = useState<S>(settings)
  const set = (k: keyof S) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })

  const save = (e: FormEvent) => {
    e.preventDefault()
    update({ ...form, endpoint: form.endpoint.replace(/\/+$/, '') })
    toast.success('Settings saved')
  }

  return (
    <>
      <PageHeader title="Settings" description="Where the console connects and which credentials it signs with. Stored in this browser." />
      <form onSubmit={save} className="flex max-w-2xl flex-col gap-6">
        <Panel title="Connection">
          <div className="flex flex-col gap-5">
            <Field label="Endpoint" hint="The address may listens on.">
              <Input value={form.endpoint} onChange={set('endpoint')} placeholder="http://localhost:4566" required />
            </Field>
            <Field label="Region" hint="Used for new buckets and STS.">
              <Select className="w-full" value={form.region} onChange={set('region')}>
                {[...new Set([form.region, ...regions])].map((r) => <Option key={r} value={r}>{r}</Option>)}
              </Select>
            </Field>
          </div>
        </Panel>
        <Panel title="Credentials"
          description="may accepts any credentials, but STS reports the identity behind the access key: an IAM user's key or temporary credentials from AssumeRole.">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Access key ID">
              <Input className="font-mono" value={form.accessKeyId} onChange={set('accessKeyId')} required />
            </Field>
            <Field label="Secret access key">
              <Input className="font-mono" type="password" value={form.secretAccessKey} onChange={set('secretAccessKey')} required />
            </Field>
          </div>
        </Panel>
        <div className="flex gap-2">
          <Button variant="primary" type="submit">Save</Button>
          <Button variant="ghost" type="button" onClick={() => setForm(defaultSettings)}>Restore defaults</Button>
        </div>
      </form>
    </>
  )
}
