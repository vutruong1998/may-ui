/**
 * Console building blocks composed from shadcn/ui primitives
 * (src/components/ui). Pages use these instead of raw primitives so that
 * tables, dialogs and states look the same everywhere.
 */
import { Fragment, useMemo, useState, type ComponentProps, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Check, Copy, Inbox, RefreshCw, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { errorMessage, validJson } from '@/lib/format'
import { prettyJson } from '@/lib/aws'
import { Button as UIButton } from '@/components/ui/button'
import { Badge as UIBadge } from '@/components/ui/badge'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Checkbox } from '@/components/ui/checkbox'
import { Spinner as UISpinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Tabs as UITabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Empty as UIEmpty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Field as UIField, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { Table as UITable, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export { Input, Textarea }
export { NativeSelect as Select, NativeSelectOption as Option } from '@/components/ui/native-select'

// Buttons

type ButtonProps = Omit<ComponentProps<typeof UIButton>, 'variant'> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'link'
  icon?: ReactNode
  loading?: boolean
}

const variantMap = {
  primary: 'default',
  secondary: 'outline',
  danger: 'destructive',
  ghost: 'ghost',
  link: 'link',
} as const

export function Button({ variant = 'secondary', icon, loading, children, disabled, ...rest }: ButtonProps) {
  return (
    <UIButton variant={variantMap[variant]} disabled={disabled || loading} {...rest}>
      {loading ? <UISpinner /> : icon}
      {children}
    </UIButton>
  )
}

export function IconButton({ label, children, ...rest }: ComponentProps<typeof UIButton> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <UIButton variant="ghost" size="icon-sm" aria-label={label} {...rest}>{children}</UIButton>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function RefreshButton({ onClick, spinning }: { onClick: () => void; spinning?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <UIButton variant="outline" size="icon" onClick={onClick} aria-label="Refresh">
          <RefreshCw className={spinning ? 'animate-spin' : ''} />
        </UIButton>
      </TooltipTrigger>
      <TooltipContent>Refresh</TooltipContent>
    </Tooltip>
  )
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <IconButton label={done ? 'Copied' : label} onClick={() => {
      void navigator.clipboard.writeText(text)
      setDone(true)
      setTimeout(() => setDone(false), 1200)
    }}>
      {done ? <Check /> : <Copy />}
    </IconButton>
  )
}

// Layout

export function PageHeader({ title, description, actions, crumbs }: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  crumbs?: { label: string; to?: string }[]
}) {
  return (
    <div className="mb-6 flex flex-col gap-2">
      {crumbs && (
        <Breadcrumb>
          <BreadcrumbList>
            {crumbs.map((c, i) => (
              <Fragment key={i}>
                <BreadcrumbItem>
                  {c.to
                    ? <BreadcrumbLink asChild><Link to={c.to}>{c.label}</Link></BreadcrumbLink>
                    : <BreadcrumbPage>{c.label}</BreadcrumbPage>}
                </BreadcrumbItem>
                {i < crumbs.length - 1 && <BreadcrumbSeparator />}
              </Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}

export function Panel({ title, actions, children, flush, description, className }: {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  flush?: boolean
  description?: ReactNode
  className?: string
}) {
  return (
    <Card className={cn('gap-0 overflow-hidden py-0', className)}>
      {(title || actions) && (
        <CardHeader className="border-b py-4">
          {title && <CardTitle>{title}</CardTitle>}
          {description && <CardDescription>{description}</CardDescription>}
          {actions && <CardAction className="flex items-center gap-2">{actions}</CardAction>}
        </CardHeader>
      )}
      <CardContent className={flush ? 'p-0' : 'py-4'}>{children}</CardContent>
    </Card>
  )
}

export function KeyValue({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-6 gap-y-4">
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="mb-0.5 text-xs text-muted-foreground">{k}</dt>
          <dd className="text-sm break-all">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Mono({ children, copy }: { children: string | undefined; copy?: boolean }) {
  if (!children) return <>—</>
  return (
    <span className="inline-flex max-w-full items-center gap-1">
      <code className="truncate rounded bg-muted px-1.5 py-0.5 text-xs">{children}</code>
      {copy && <CopyButton text={children} />}
    </span>
  )
}

const tones = {
  neutral: '',
  blue: 'bg-primary/10 text-primary',
  green: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  red: 'bg-destructive/10 text-destructive',
  amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: keyof typeof tones }) {
  return <UIBadge variant={tone === 'neutral' ? 'outline' : 'secondary'} className={tones[tone]}>{children}</UIBadge>
}

export function Tabs<T extends string>({ tabs, value, onChange }: {
  tabs: { id: T; label: ReactNode }[]
  value: T
  onChange: (id: T) => void
}) {
  return (
    <UITabs value={value} onValueChange={(v) => onChange(v as T)} className="mb-4">
      <TabsList variant="line">
        {tabs.map((t) => <TabsTrigger key={t.id} value={t.id}>{t.label}</TabsTrigger>)}
      </TabsList>
    </UITabs>
  )
}

// States

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
      <UISpinner /> {label}
    </div>
  )
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertTriangle />
      <AlertDescription className="flex items-center justify-between gap-4">
        <span>{errorMessage(error)}</span>
        {onRetry && <UIButton variant="outline" size="sm" onClick={onRetry}>Retry</UIButton>}
      </AlertDescription>
    </Alert>
  )
}

export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <UIEmpty className="py-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon ?? <Inbox />}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {children && <EmptyDescription>{children}</EmptyDescription>}
      </EmptyHeader>
    </UIEmpty>
  )
}

// Data table

export interface Column<T> {
  header: ReactNode
  render: (row: T) => ReactNode
  className?: string
  /** Text matched by the filter box. */
  text?: (row: T) => string
}

export function Table<T>({ rows, columns, rowKey, loading, error, onRetry, empty, selectable, selected, onSelect, filterPlaceholder, toolbar }: {
  rows: T[] | undefined
  columns: Column<T>[]
  rowKey: (row: T) => string
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  empty?: ReactNode
  selectable?: boolean
  selected?: Set<string>
  onSelect?: (keys: Set<string>) => void
  filterPlaceholder?: string
  toolbar?: ReactNode
}) {
  const [filter, setFilter] = useState('')
  const visible = useMemo(() => {
    if (!rows) return []
    const q = filter.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => columns.some((c) => c.text?.(r).toLowerCase().includes(q)))
  }, [rows, filter, columns])
  const sel = selected ?? new Set<string>()
  const allSelected = visible.length > 0 && visible.every((r) => sel.has(rowKey(r)))
  const someSelected = !allSelected && visible.some((r) => sel.has(rowKey(r)))
  const toggle = (k: string) => {
    const next = new Set(sel)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    onSelect?.(next)
  }

  return (
    <div>
      {(filterPlaceholder || toolbar) && (
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          {filterPlaceholder && (
            <InputGroup className="w-full max-w-sm">
              <InputGroupAddon><Search /></InputGroupAddon>
              <InputGroupInput value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={filterPlaceholder} />
              {filter && (
                <InputGroupAddon align="inline-end">
                  <InputGroupButton size="icon-xs" aria-label="Clear filter" onClick={() => setFilter('')}><X /></InputGroupButton>
                </InputGroupAddon>
              )}
            </InputGroup>
          )}
          <div className="flex-1" />
          <div className="flex flex-wrap items-center gap-2">{toolbar}</div>
        </div>
      )}
      {error ? (
        <div className="p-4"><ErrorBox error={error} onRetry={onRetry} /></div>
      ) : loading && !rows ? (
        <Spinner />
      ) : visible.length === 0 ? (
        filter ? <Empty title="No matches">Nothing matches “{filter}”.</Empty> : (empty ?? <Empty title="Nothing here yet" />)
      ) : (
        <UITable>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              {selectable && (
                <TableHead className="w-10 pl-4">
                  <Checkbox aria-label="Select all" checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                    onCheckedChange={() => onSelect?.(allSelected ? new Set() : new Set(visible.map(rowKey)))} />
                </TableHead>
              )}
              {columns.map((c, i) => (
                <TableHead key={i} className={cn(i === 0 && !selectable && 'pl-4', c.className)}>{c.header}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((r) => {
              const k = rowKey(r)
              return (
                <TableRow key={k} data-state={sel.has(k) ? 'selected' : undefined}>
                  {selectable && (
                    <TableCell className="pl-4">
                      <Checkbox aria-label="Select row" checked={sel.has(k)} onCheckedChange={() => toggle(k)} />
                    </TableCell>
                  )}
                  {columns.map((c, i) => (
                    <TableCell key={i} className={cn(i === 0 && !selectable && 'pl-4', c.className)}>{c.render(r)}</TableCell>
                  ))}
                </TableRow>
              )
            })}
          </TableBody>
        </UITable>
      )}
    </div>
  )
}

/** The name cell of a table row: an icon plus a link or button. */
export function NameCell({ icon, to, onClick, children }: { icon?: ReactNode; to?: string; onClick?: () => void; children: ReactNode }) {
  const cls = 'inline-flex items-center gap-2 font-medium text-primary hover:underline [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground'
  if (to) return <Link className={cls} to={to}>{icon}{children}</Link>
  return <button type="button" className={cls} onClick={onClick}>{icon}{children}</button>
}

// Dialogs

export function Modal({ title, description, onClose, children, footer, wide }: {
  title: ReactNode
  description?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={cn('max-h-[calc(100vh-4rem)] overflow-y-auto', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className={description ? undefined : 'sr-only'}>{description ?? title}</DialogDescription>
        </DialogHeader>
        {children}
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  )
}

/** A destructive confirmation. With confirmText, the user must type it to proceed. */
export function Confirm({ title, children, confirmLabel = 'Delete', confirmText, onConfirm, onClose, loading }: {
  title: string
  children: ReactNode
  confirmLabel?: string
  confirmText?: string
  onConfirm: () => void
  onClose: () => void
  loading?: boolean
}) {
  const [typed, setTyped] = useState('')
  const ok = !confirmText || typed === confirmText
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <UIButton className="bg-destructive text-white hover:bg-destructive/90" disabled={!ok || loading} onClick={onConfirm}>
        {loading && <UISpinner />}{confirmLabel}
      </UIButton>
    </>}>
      <div className="flex flex-col gap-4 text-sm">
        {children}
        {confirmText && (
          <Field label={<>To confirm, type <code className="rounded bg-muted px-1">{confirmText}</code></>}>
            <Input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} />
          </Field>
        )}
      </div>
    </Modal>
  )
}

export function Drawer({ title, description, onClose, children }: {
  title: ReactNode
  description?: ReactNode
  onClose: () => void
  children: ReactNode
}) {
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle className="pr-8 break-all">{title}</SheetTitle>
          <SheetDescription className={description ? undefined : 'sr-only'}>{description ?? title}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </SheetContent>
    </Sheet>
  )
}

// Forms

export function Field({ label, hint, error, children }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <UIField data-invalid={!!error || undefined}>
      <FieldLabel>{label}</FieldLabel>
      {children}
      {error ? <FieldError>{error}</FieldError> : hint && <FieldDescription>{hint}</FieldDescription>}
    </UIField>
  )
}

/** A JSON textarea with live validation and a Format button. */
export function JsonEditor({ value, onChange, rows = 14, readOnly }: {
  value: string
  onChange?: (v: string) => void
  rows?: number
  readOnly?: boolean
}) {
  const error = value.trim() ? validJson(value) : null
  return (
    <div className="flex flex-col gap-1.5">
      <Textarea className="field-sizing-fixed min-h-0 font-mono text-xs leading-relaxed" rows={rows} spellCheck={false}
        value={value} readOnly={readOnly} aria-invalid={!!error} onChange={(e) => onChange?.(e.target.value)} />
      <div className="flex min-h-8 items-center gap-2 text-xs">
        {error
          ? <span className="text-destructive">Invalid JSON: {error}</span>
          : <span className="text-muted-foreground">{value.trim() ? 'Valid JSON' : ''}</span>}
        <div className="flex-1" />
        {!readOnly && <UIButton variant="ghost" size="sm" disabled={!!error} onClick={() => onChange?.(prettyJson(value))}>Format</UIButton>}
        <CopyButton text={value} />
      </div>
    </div>
  )
}

export function CodeBlock({ children }: { children: string }) {
  return (
    <div className="relative">
      <pre className="max-h-[28rem] overflow-auto rounded-lg border bg-muted/50 p-3 pr-10 font-mono text-xs leading-relaxed">{children}</pre>
      <div className="absolute top-1.5 right-1.5"><CopyButton text={children} /></div>
    </div>
  )
}
