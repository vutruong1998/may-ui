import { useState } from 'react'
import { CreateKeyPairCommand, DeleteKeyPairCommand, ImportKeyPairCommand, type KeyType } from '@aws-sdk/client-ec2'
import { Download, KeyRound, Plus, Trash2, Upload } from 'lucide-react'
import { useSettings } from '@/lib/settings'
import { useAction } from '@/lib/hooks'
import { formatDate } from '@/lib/format'
import { downloadText, useKeyPairs } from '@/lib/ec2'
import {
  Badge, Button, CodeBlock, Confirm, Empty, Field, IconButton, Input, Modal, Option, PageHeader, Panel, RefreshButton, Select,
  Table, Textarea,
} from '@/components/common'

export default function KeyPairs() {
  const { clients } = useSettings()
  const keys = useKeyPairs()
  const [mode, setMode] = useState<'create' | 'import' | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const del = useAction((KeyName: string) => clients.ec2.send(new DeleteKeyPairCommand({ KeyName })), {
    invalidate: [['ec2']], success: 'Key pair deleted', onSuccess: () => setDeleting(null),
  })
  return (
    <>
      <PageHeader
        title="Key pairs"
        description="SSH key pairs. In EC2 real mode, instances launched with a key accept SSH logins for it."
        actions={<>
          <RefreshButton onClick={() => keys.refetch()} spinning={keys.isFetching} />
          <Button icon={<Upload />} onClick={() => setMode('import')}>Import</Button>
          <Button variant="primary" icon={<Plus />} onClick={() => setMode('create')}>Create key pair</Button>
        </>}
      />
      <Panel flush>
        <Table
          rows={keys.data}
          loading={keys.isLoading}
          error={keys.error}
          rowKey={(k) => k.KeyPairId!}
          filterPlaceholder="Find key pairs"
          empty={<Empty title="No key pairs" icon={<KeyRound />} />}
          columns={[
            { header: 'Name', text: (k) => k.KeyName!, render: (k) => <span className="font-medium">{k.KeyName}</span> },
            { header: 'Type', className: 'w-24', render: (k) => <Badge>{k.KeyType}</Badge> },
            { header: 'Fingerprint', className: 'font-mono text-xs', render: (k) => k.KeyFingerprint },
            { header: 'ID', className: 'font-mono text-xs', render: (k) => k.KeyPairId },
            { header: 'Created', className: 'w-52', render: (k) => formatDate(k.CreateTime) },
            { header: '', className: 'w-14 text-right', render: (k) => <IconButton label="Delete" onClick={() => setDeleting(k.KeyName!)}><Trash2 /></IconButton> },
          ]}
        />
      </Panel>
      {mode === 'create' && <CreateKey onClose={() => setMode(null)} />}
      {mode === 'import' && <ImportKey onClose={() => setMode(null)} />}
      {deleting && (
        <Confirm title={`Delete key pair ${deleting}?`} loading={del.isPending} onConfirm={() => del.mutate(deleting)} onClose={() => setDeleting(null)}>
          <p>Running instances keep the key they were launched with.</p>
        </Confirm>
      )}
    </>
  )
}

function CreateKey({ onClose }: { onClose: () => void }) {
  const { clients } = useSettings()
  const [name, setName] = useState('')
  const [type, setType] = useState<KeyType>('ed25519')
  const [material, setMaterial] = useState<string | null>(null)
  const create = useAction(() => clients.ec2.send(new CreateKeyPairCommand({ KeyName: name, KeyType: type })), {
    invalidate: [['ec2']], success: `Created key pair ${name}`,
    onSuccess: (r) => {
      setMaterial(r.KeyMaterial!)
      downloadText(`${name}.pem`, r.KeyMaterial! + '\n')
    },
  })
  if (material) {
    return (
      <Modal title={`Key pair ${name}`} description="The private key was downloaded. It is shown only once." onClose={onClose}
        footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
        <div className="flex flex-col gap-4 text-sm">
          <Button icon={<Download />} onClick={() => downloadText(`${name}.pem`, material + '\n')}>Download again</Button>
          <CodeBlock>{`mv ~/Downloads/${name}.pem ~/.ssh/ && chmod 600 ~/.ssh/${name}.pem`}</CodeBlock>
        </div>
      </Modal>
    )
  }
  return (
    <Modal title="Create key pair" onClose={onClose} footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button variant="primary" disabled={!name} loading={create.isPending} onClick={() => create.mutate(undefined)}>Create and download</Button>
    </>}>
      <div className="flex flex-col gap-5">
        <Field label="Name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="dev" /></Field>
        <Field label="Type">
          <Select className="w-full" value={type} onChange={(e) => setType(e.target.value as KeyType)}>
            <Option value="ed25519">ED25519</Option>
            <Option value="rsa">RSA 2048</Option>
          </Select>
        </Field>
      </div>
    </Modal>
  )
}

function ImportKey({ onClose }: { onClose: () => void }) {
  const { clients } = useSettings()
  const [name, setName] = useState('')
  const [pub, setPub] = useState('')
  const imp = useAction(
    () => clients.ec2.send(new ImportKeyPairCommand({ KeyName: name, PublicKeyMaterial: new TextEncoder().encode(pub.trim()) })),
    { invalidate: [['ec2']], success: `Imported key pair ${name}`, onSuccess: onClose },
  )
  return (
    <Modal title="Import key pair" onClose={onClose} footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button variant="primary" disabled={!name || !pub.trim()} loading={imp.isPending} onClick={() => imp.mutate(undefined)}>Import</Button>
    </>}>
      <div className="flex flex-col gap-5">
        <Field label="Name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Public key" hint="The contents of e.g. ~/.ssh/id_ed25519.pub">
          <Textarea className="min-h-24 font-mono text-xs" value={pub} onChange={(e) => setPub(e.target.value)} placeholder="ssh-ed25519 AAAA... you@laptop" />
        </Field>
      </div>
    </Modal>
  )
}
