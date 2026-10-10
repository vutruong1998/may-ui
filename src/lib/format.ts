export function formatBytes(n: number | undefined): string {
  if (n === undefined) return '—'
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' })

export function formatDate(d: Date | string | undefined): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  return Number.isNaN(date.getTime()) ? '—' : dateFormat.format(date)
}

export function relativeTime(d: Date | undefined): string {
  if (!d) return '—'
  const s = Math.round((Date.now() - d.getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return formatDate(d)
}

/** Turns SDK and fetch errors into one readable line. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const name = err.name && err.name !== 'Error' ? err.name : ''
    if (err.message === 'Failed to fetch' || err.name === 'TypeError') {
      return 'Cannot reach the endpoint. Is may running, and is the endpoint in Settings correct?'
    }
    if (name && err.message && err.message !== 'UnknownError') return `${name}: ${err.message}`
    return name || err.message
  }
  return String(err)
}

export function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } }
  return e?.$metadata?.httpStatusCode === 404 || e?.name === 'NoSuchEntity' || e?.name === 'NotFound'
}

export function validJson(text: string): string | null {
  try {
    JSON.parse(text)
    return null
  } catch (e) {
    return (e as Error).message
  }
}
