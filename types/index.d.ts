export type Disk = { name: string; freeGB: number | null; usedPct: number | null }
export type Watching = { title: string; user: string; state: string; transcode: string }
export type PlexJob = { type: string; title: string; item: string; progress: number | null }
export type Overflow = { date: string; badSectors: string; new: string; ext4Errors: string; mount: string } | null
export type Health = { name: string; date: string; kv: Record<string, string>; alert: number | null }
export type BoxStatus = {
  health?: Health[]
  load: number[]; cores: number; memAvailGB: number; memTotalGB: number; swapUsedGB: number
  disks: Disk[]; batches: string[]; batchStatus: string
  watching: Watching[]; plexJobs: PlexJob[]; plexUp: boolean
  jobs?: Job[]; name?: string; plexConfigured?: boolean; healthName?: string; container?: string
  overflow: Overflow; overflowAlert: number | null; containerStatus?: string; time: string
}
export type Job = {
  unit: string; desc: string; n: number | null; total: number | null; name: string
  label?: string; state?: 'running' | 'waiting'; waitsFor?: string; done?: number | null; failed?: number; current?: boolean
  skipped?: number; itemPct?: number; itemEtaMin?: number
}
export type Snapshot = { status: BoxStatus | null; error: string; checkedAt: number }

declare module 'claude-code' {
  interface PluginState {
    'linuxbox-monitor': { snapshot: Shaped<Snapshot> }
  }
}
