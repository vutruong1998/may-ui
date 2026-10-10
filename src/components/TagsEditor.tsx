import { useEffect, useState } from 'react'
import { Plus, Tag as TagIcon, Trash2 } from 'lucide-react'
import { Button, Empty, IconButton, Input } from './common'

export interface Tag {
  Key?: string
  Value?: string
}

/** Edits a list of key/value tags and saves them all at once. */
export function TagsEditor({ tags, onSave, saving, max = 50 }: {
  tags: Tag[] | undefined
  onSave: (tags: { Key: string; Value: string }[]) => void
  saving?: boolean
  max?: number
}) {
  const [rows, setRows] = useState<{ Key: string; Value: string }[]>([])
  useEffect(() => {
    setRows((tags ?? []).map((t) => ({ Key: t.Key ?? '', Value: t.Value ?? '' })))
  }, [tags])

  const original = JSON.stringify((tags ?? []).map((t) => ({ Key: t.Key ?? '', Value: t.Value ?? '' })))
  const dirty = JSON.stringify(rows) !== original
  const keys = rows.map((r) => r.Key.trim())
  const duplicate = keys.find((k, i) => k && keys.indexOf(k) !== i)
  const invalid = rows.some((r) => !r.Key.trim()) || !!duplicate
  const set = (i: number, field: 'Key' | 'Value', v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [field]: v } : r)))

  return (
    <div className="flex flex-col gap-4">
      {rows.length === 0 ? (
        <Empty title="No tags" icon={<TagIcon />}>Tags are key/value pairs that help you organize resources.</Empty>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-[1fr_1fr_2rem] gap-2 text-xs text-muted-foreground"><span>Key</span><span>Value</span></div>
          {rows.map((r, i) => (
            <div className="grid grid-cols-[1fr_1fr_2rem] items-center gap-2" key={i}>
              <Input value={r.Key} placeholder="Key" aria-invalid={!r.Key.trim() || r.Key.trim() === duplicate}
                onChange={(e) => set(i, 'Key', e.target.value)} />
              <Input value={r.Value} placeholder="Value" onChange={(e) => set(i, 'Value', e.target.value)} />
              <IconButton label="Remove tag" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 /></IconButton>
            </div>
          ))}
        </div>
      )}
      {duplicate && <span className="text-sm text-destructive">Duplicate key “{duplicate}”.</span>}
      <div className="flex flex-wrap items-center gap-2">
        <Button icon={<Plus />} disabled={rows.length >= max} onClick={() => setRows([...rows, { Key: '', Value: '' }])}>Add tag</Button>
        <div className="flex-1" />
        {dirty && <Button variant="ghost" onClick={() => setRows(JSON.parse(original))}>Discard</Button>}
        <Button variant="primary" disabled={!dirty || invalid} loading={saving}
          onClick={() => onSave(rows.map((r) => ({ Key: r.Key.trim(), Value: r.Value })))}>Save tags</Button>
      </div>
    </div>
  )
}
