import { useState } from 'react'
import { DeleteDBSnapshotCommand } from '@aws-sdk/client-rds'
import { Camera, Trash2 } from 'lucide-react'
import { useSettings } from '@/lib/settings'
import { useAction } from '@/lib/hooks'
import { formatDate } from '@/lib/format'
import { engineLabels, snapshotTone, useDBInstances, useSnapshots } from '@/lib/rds'
import { Badge, Button, Confirm, Empty, NameCell, PageHeader, Panel, RefreshButton, Table } from '@/components/common'

export default function Snapshots() {
  const { clients } = useSettings()
  const snapshots = useSnapshots()
  const dbs = useDBInstances()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const ids = [...selected]
  const exists = (id: string | undefined) => dbs.data?.some((d) => d.DBInstanceIdentifier === id)
  const del = useAction(
    async () => { for (const id of ids) await clients.rds.send(new DeleteDBSnapshotCommand({ DBSnapshotIdentifier: id })) },
    {
      invalidate: [['rds']], success: `Deleted ${ids.length} snapshot${ids.length === 1 ? '' : 's'}`,
      onSuccess: () => { setDeleting(false); setSelected(new Set()) },
    },
  )
  return (
    <>
      <PageHeader
        title="DB snapshots"
        description="Manual snapshots, including final snapshots taken on delete. may records them but copies no data and cannot restore them yet."
        actions={<RefreshButton onClick={() => snapshots.refetch()} spinning={snapshots.isFetching} />}
      />
      <Panel flush>
        <Table
          rows={snapshots.data}
          loading={snapshots.isLoading}
          error={snapshots.error}
          onRetry={() => snapshots.refetch()}
          rowKey={(s) => s.DBSnapshotIdentifier!}
          selectable
          selected={selected}
          onSelect={setSelected}
          filterPlaceholder="Find snapshots by name or database"
          toolbar={<Button variant="danger" icon={<Trash2 />} disabled={!ids.length} onClick={() => setDeleting(true)}>Delete</Button>}
          empty={<Empty title="No snapshots" icon={<Camera />}>Take one from a database's Snapshots tab.</Empty>}
          columns={[
            { header: 'Snapshot', text: (s) => `${s.DBSnapshotIdentifier} ${s.DBInstanceIdentifier}`, render: (s) => (
              <span className="inline-flex items-center gap-2 font-medium"><Camera className="size-4 text-muted-foreground" />{s.DBSnapshotIdentifier}</span>
            ) },
            { header: 'Database', render: (s) => exists(s.DBInstanceIdentifier)
              ? <NameCell to={`/rds/databases/${s.DBInstanceIdentifier}?tab=snapshots`}>{s.DBInstanceIdentifier}</NameCell>
              : <span className="text-muted-foreground">{s.DBInstanceIdentifier} (deleted)</span> },
            { header: 'Status', className: 'w-32', render: (s) => <Badge tone={snapshotTone(s.Status)}>{s.Status}</Badge> },
            { header: 'Engine', className: 'w-40', render: (s) => `${engineLabels[s.Engine ?? ''] ?? s.Engine} ${s.EngineVersion}` },
            { header: 'Size', className: 'w-24', render: (s) => `${s.AllocatedStorage} GiB` },
            { header: 'Created', className: 'w-52', render: (s) => formatDate(s.SnapshotCreateTime) },
          ]}
        />
      </Panel>
      {deleting && (
        <Confirm title={`Delete ${ids.length === 1 ? ids[0] : `${ids.length} snapshots`}?`} loading={del.isPending}
          onConfirm={() => del.mutate(undefined)} onClose={() => setDeleting(false)}>
          <p>This cannot be undone.</p>
        </Confirm>
      )}
    </>
  )
}
