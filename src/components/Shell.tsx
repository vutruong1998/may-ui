import { Suspense } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTheme } from 'next-themes'
import {
  Camera, Cloud, Database, DatabaseZap, FileKey2, Globe, KeyRound, LayoutDashboard, Monitor, Moon, Server, Settings as SettingsIcon,
  Key, MessagesSquare, Network, ScrollText, Shield, ShieldCheck, SlidersHorizontal, Sun, Table2, User, Users, Waypoints,
} from 'lucide-react'
import { useSettings } from '@/lib/settings'
import { cn } from '@/lib/utils'
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail, SidebarTrigger,
} from '@/components/ui/sidebar'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/common'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const nav = [
  { section: 'Overview', items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard }] },
  {
    section: 'Compute (EC2)',
    items: [
      { to: '/ec2/instances', label: 'Instances', icon: Server },
      { to: '/ec2/network', label: 'VPC networking', icon: Network },
      { to: '/ec2/security-groups', label: 'Security groups', icon: Shield },
      { to: '/ec2/key-pairs', label: 'Key pairs', icon: Key },
    ],
  },
  { section: 'Storage', items: [{ to: '/s3', label: 'S3 buckets', icon: Database }] },
  {
    section: 'Database',
    items: [
      { to: '/rds/databases', label: 'RDS databases', icon: DatabaseZap },
      { to: '/rds/subnet-groups', label: 'Subnet groups', icon: Waypoints },
      { to: '/rds/parameter-groups', label: 'Parameter groups', icon: SlidersHorizontal },
      { to: '/rds/snapshots', label: 'Snapshots', icon: Camera },
      { to: '/dynamodb', label: 'DynamoDB tables', icon: Table2 },
    ],
  },
  { section: 'Messaging', items: [{ to: '/sqs', label: 'SQS queues', icon: MessagesSquare }] },
  { section: 'Monitoring', items: [{ to: '/logs', label: 'CloudWatch Logs', icon: ScrollText }] },
  {
    section: 'Identity (IAM)',
    items: [
      { to: '/iam/roles', label: 'Roles', icon: ShieldCheck },
      { to: '/iam/users', label: 'Users', icon: User },
      { to: '/iam/groups', label: 'Groups', icon: Users },
      { to: '/iam/policies', label: 'Policies', icon: FileKey2 },
      { to: '/iam/instance-profiles', label: 'Instance profiles', icon: Server },
    ],
  },
  { section: 'Security', items: [{ to: '/sts', label: 'STS credentials', icon: KeyRound }] },
]

export function useHealth() {
  const { clients, settings } = useSettings()
  return useQuery({
    queryKey: ['may', 'health', settings.endpoint],
    queryFn: () => clients.may.health(),
    refetchInterval: 10_000,
    retry: false,
  })
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Theme"><Icon /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light"><Sun /> Light</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark"><Moon /> Dark</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system"><Monitor /> System</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function isActive(pathname: string, to: string) {
  return to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(to + '/')
}

export default function Shell() {
  const { settings } = useSettings()
  const { pathname } = useLocation()
  const health = useHealth()
  const status = health.isSuccess ? 'online' : health.isError ? 'offline' : 'checking'

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <Link to="/">
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                    <Cloud className="size-4" />
                  </div>
                  <div className="grid flex-1 text-left leading-tight">
                    <span className="font-semibold">Mây</span>
                    <span className="text-xs text-muted-foreground">Local cloud console</span>
                  </div>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          {nav.map((group) => (
            <SidebarGroup key={group.section}>
              <SidebarGroupLabel>{group.section}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map(({ to, label, icon: Icon }) => (
                    <SidebarMenuItem key={to}>
                      <SidebarMenuButton asChild isActive={isActive(pathname, to)} tooltip={label}>
                        <NavLink to={to}><Icon /> <span>{label}</span></NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={pathname === '/settings'} tooltip="Settings">
                <NavLink to="/settings"><SettingsIcon /> <span>Settings</span></NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/90 px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span className={cn('size-2 shrink-0 rounded-full',
              status === 'online' && 'bg-emerald-500 shadow-[0_0_0_3px] shadow-emerald-500/20',
              status === 'offline' && 'bg-destructive shadow-[0_0_0_3px] shadow-destructive/20',
              status === 'checking' && 'bg-muted-foreground')} />
            <span className="truncate font-mono text-xs text-muted-foreground">{settings.endpoint.replace(/^https?:\/\//, '')}</span>
            {health.data && <Badge variant="outline" className="hidden sm:inline-flex">v{health.data.version}</Badge>}
          </div>
          <div className="flex-1" />
          <Badge variant="outline" className="hidden gap-1 md:inline-flex"><Globe /> {settings.region}</Badge>
          <Badge variant="outline" className="hidden font-mono md:inline-flex">000000000000</Badge>
          <ThemeToggle />
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 p-4 md:p-6">
          {health.isError && (
            <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              Cannot reach may at <code>{settings.endpoint}</code>. Start it with <code>may</code>, or change the endpoint
              in <Link className="font-medium underline" to="/settings">Settings</Link>.
            </div>
          )}
          <Suspense fallback={<Spinner />}>
            <Outlet />
          </Suspense>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
