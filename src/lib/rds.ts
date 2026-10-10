import { useQuery } from '@tanstack/react-query'
import {
  DescribeDBEngineVersionsCommand, DescribeDBInstancesCommand, DescribeDBParameterGroupsCommand, DescribeDBParametersCommand,
  DescribeDBSnapshotsCommand, DescribeDBSubnetGroupsCommand, type DBInstance, type DBSnapshot,
} from '@aws-sdk/client-rds'
import { useSettings } from './settings'

export const engineLabels: Record<string, string> = { postgres: 'PostgreSQL', mysql: 'MySQL', mariadb: 'MariaDB' }

const busy = ['creating', 'modifying', 'stopping', 'starting', 'rebooting', 'deleting', 'backing-up', 'renaming']

export const dbStatusTone = (s: string | undefined) =>
  s === 'available' ? 'green'
    : s === 'stopped' ? 'neutral'
      : s === 'failed' || s === 'incompatible-parameters' ? 'red'
        : s === 'deleting' || s === 'stopping' ? 'amber' : 'blue'

export const snapshotTone = (s: string | undefined) => (s === 'available' ? 'green' : s === 'creating' ? 'blue' : 'neutral')

export function useDBInstances() {
  const { clients } = useSettings()
  return useQuery({
    queryKey: ['rds', 'instances'],
    queryFn: async (): Promise<DBInstance[]> => {
      const out: DBInstance[] = []
      let Marker: string | undefined
      do {
        const page = await clients.rds.send(new DescribeDBInstancesCommand({ Marker }))
        out.push(...(page.DBInstances ?? []))
        Marker = page.Marker
      } while (Marker)
      return out
    },
    // Instances change status on their own (creating -> available ...).
    refetchInterval: (q) => (q.state.data?.some((d) => busy.includes(d.DBInstanceStatus ?? '')) ? 1500 : 10_000),
  })
}

export function useSnapshots() {
  const { clients } = useSettings()
  return useQuery({
    queryKey: ['rds', 'snapshots'],
    queryFn: async (): Promise<DBSnapshot[]> => {
      const out: DBSnapshot[] = []
      let Marker: string | undefined
      do {
        const page = await clients.rds.send(new DescribeDBSnapshotsCommand({ Marker }))
        out.push(...(page.DBSnapshots ?? []))
        Marker = page.Marker
      } while (Marker)
      return out.sort((a, b) => (b.SnapshotCreateTime?.getTime() ?? Infinity) - (a.SnapshotCreateTime?.getTime() ?? Infinity))
    },
    refetchInterval: (q) => (q.state.data?.some((s) => s.Status === 'creating') ? 1500 : 15_000),
  })
}

export function useSubnetGroups() {
  const { clients } = useSettings()
  return useQuery({
    queryKey: ['rds', 'subnet-groups'],
    queryFn: async () => (await clients.rds.send(new DescribeDBSubnetGroupsCommand({}))).DBSubnetGroups ?? [],
  })
}

export function useParameterGroups() {
  const { clients } = useSettings()
  return useQuery({
    queryKey: ['rds', 'parameter-groups'],
    queryFn: async () => (await clients.rds.send(new DescribeDBParameterGroupsCommand({}))).DBParameterGroups ?? [],
  })
}

export function useParameters(name: string) {
  const { clients } = useSettings()
  return useQuery({
    queryKey: ['rds', 'parameters', name],
    queryFn: async () => (await clients.rds.send(new DescribeDBParametersCommand({ DBParameterGroupName: name, Source: 'user' }))).Parameters ?? [],
  })
}

export function useEngineVersions() {
  const { clients } = useSettings()
  return useQuery({
    queryKey: ['rds', 'engine-versions'],
    queryFn: async () => (await clients.rds.send(new DescribeDBEngineVersionsCommand({}))).DBEngineVersions ?? [],
    staleTime: Infinity, // a fixed catalog
  })
}

export function useDatabaseEndpoints() {
  const { clients } = useSettings()
  return useQuery({ queryKey: ['rds', 'endpoints'], queryFn: () => clients.may.databaseEndpoints(), refetchInterval: 5000 })
}

export const instanceClasses = [
  'db.t3.micro', 'db.t3.small', 'db.t3.medium', 'db.t4g.micro', 'db.t4g.small', 'db.t4g.medium',
  'db.m7g.large', 'db.m7g.xlarge', 'db.r7g.large',
]

/** A connection URL for an instance, as most drivers accept it. */
export function connectionUrl(db: DBInstance, port = db.Endpoint?.Port): string {
  const scheme = db.Engine === 'postgres' ? 'postgresql' : 'mysql'
  const name = db.DBName ?? (db.Engine === 'postgres' ? 'postgres' : '')
  return `${scheme}://${db.MasterUsername}@${db.Endpoint?.Address ?? 'localhost'}:${port}/${name}`
}
