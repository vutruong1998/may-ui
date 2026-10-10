import { useQuery } from '@tanstack/react-query'
import {
  DescribeImagesCommand, DescribeInstancesCommand, DescribeKeyPairsCommand, DescribeSecurityGroupsCommand,
  DescribeSubnetsCommand, DescribeVpcsCommand, type Instance, type Tag,
} from '@aws-sdk/client-ec2'
import { useSettings } from './settings'

export function nameTag(tags: Tag[] | undefined): string {
  return tags?.find((t) => t.Key === 'Name')?.Value ?? ''
}

export const stateTone = (s: string | undefined) =>
  s === 'running' ? 'green' : s === 'stopped' || s === 'terminated' ? 'neutral' : s === 'shutting-down' || s === 'stopping' ? 'amber' : 'blue'

export function useInstances() {
  const { clients } = useSettings()
  return useQuery({
    queryKey: ['ec2', 'instances'],
    queryFn: async (): Promise<Instance[]> => {
      const out: Instance[] = []
      let NextToken: string | undefined
      do {
        const page = await clients.ec2.send(new DescribeInstancesCommand({ NextToken, MaxResults: 1000 }))
        for (const r of page.Reservations ?? []) out.push(...(r.Instances ?? []))
        NextToken = page.NextToken
      } while (NextToken)
      return out.sort((a, b) => (b.LaunchTime?.getTime() ?? 0) - (a.LaunchTime?.getTime() ?? 0))
    },
    // Instances change state on their own (pending -> running ...).
    refetchInterval: (q) => (q.state.data?.some((i) => ['pending', 'stopping', 'shutting-down'].includes(i.State?.Name ?? '')) ? 1500 : 10_000),
  })
}

export function useVpcs() {
  const { clients } = useSettings()
  return useQuery({ queryKey: ['ec2', 'vpcs'], queryFn: async () => (await clients.ec2.send(new DescribeVpcsCommand({}))).Vpcs ?? [] })
}

export function useSubnets() {
  const { clients } = useSettings()
  return useQuery({ queryKey: ['ec2', 'subnets'], queryFn: async () => (await clients.ec2.send(new DescribeSubnetsCommand({}))).Subnets ?? [] })
}

export function useSecurityGroups() {
  const { clients } = useSettings()
  return useQuery({ queryKey: ['ec2', 'security-groups'], queryFn: async () => (await clients.ec2.send(new DescribeSecurityGroupsCommand({}))).SecurityGroups ?? [] })
}

export function useKeyPairs() {
  const { clients } = useSettings()
  return useQuery({ queryKey: ['ec2', 'key-pairs'], queryFn: async () => (await clients.ec2.send(new DescribeKeyPairsCommand({ IncludePublicKey: true }))).KeyPairs ?? [] })
}

export function useImages() {
  const { clients } = useSettings()
  return useQuery({
    queryKey: ['ec2', 'images'],
    queryFn: async () => (await clients.ec2.send(new DescribeImagesCommand({}))).Images ?? [],
    staleTime: Infinity, // a fixed catalog
  })
}

export function useInstanceEndpoints() {
  const { clients } = useSettings()
  return useQuery({ queryKey: ['ec2', 'endpoints'], queryFn: () => clients.may.instanceEndpoints(), refetchInterval: 5000 })
}

/** A file download of text, e.g. a new key pair's private key. */
export function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/x-pem-file' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

/** Base64 of a UTF-8 string (user data). */
export function toBase64(text: string): string {
  let bin = ''
  new TextEncoder().encode(text).forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin)
}

export function fromBase64(b64: string): string {
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
  } catch {
    return b64
  }
}
