import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { BoxStatus, Health, Job, Snapshot } from '../types'

const PANE = 'linuxbox'
const EVERY_MS = 60_000
const snapshot = atom({ plugin: 'linuxbox-monitor', key: 'snapshot' } as const,
  { status: null, error: '', checkedAt: 0 } as Snapshot, { shape: 'snapshot-1' })

let HOST = "linuxbox"
let SCRIPT = "~/bin/box-status.sh"

// ---------- palette (cards carry their own dark background, so they read in light and dark themes)
const C = {
  card: '#161b26', edge: '#2a3142', text: '#e6e9ef', dim: '#8b93a7', track: '#2a3142',
  green: '#3ddc84', amber: '#ffb74d', red: '#ff5c6c', blue: '#5aa9ff', purple: '#b388ff', teal: '#4dd0e1',
}
const W = 360

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
function cut(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}
function card(h: number, inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" font-family="Segoe UI, system-ui, sans-serif">` +
    `<rect x="1" y="1" width="${W - 2}" height="${h - 2}" rx="14" fill="${C.card}" stroke="${C.edge}"/>${inner}</svg>`
}
function title(x: number, y: number, t: string): string {
  return `<text x="${x}" y="${y}" fill="${C.dim}" font-size="11" font-weight="600" letter-spacing="1.2">${esc(t.toUpperCase())}</text>`
}

// ---------- header: the box mascot plus two gauges
function mood(r: number): { face: string; label: string; color: string } {
  if (r < 0.75) return { face: 'calm', label: 'Chilling', color: C.green }
  if (r < 1.5) return { face: 'busy', label: 'Busy', color: C.teal }
  if (r < 3) return { face: 'hard', label: 'Working hard', color: C.amber }
  return { face: 'cook', label: 'Absolutely cooking', color: C.red }
}
function mascot(r: number, m: { face: string; color: string }): string {
  const fan = Math.max(0.12, 2.4 / (r + 0.2)).toFixed(2)
  const mouth = m.face === 'calm' ? '<path d="M44 66 q12 10 24 0" stroke="#1b1f2a" stroke-width="3" fill="none" stroke-linecap="round"/>'
    : m.face === 'busy' ? '<path d="M46 68 h20" stroke="#1b1f2a" stroke-width="3" stroke-linecap="round"/>'
    : m.face === 'hard' ? '<path d="M45 70 q11 -7 22 0" stroke="#1b1f2a" stroke-width="3" fill="none" stroke-linecap="round"/>'
    : '<ellipse cx="56" cy="69" rx="6" ry="5" fill="#1b1f2a"/>'
  const eyes = m.face === 'calm'
    ? '<path d="M38 52 q6 -6 12 0 M62 52 q6 -6 12 0" stroke="#1b1f2a" stroke-width="3" fill="none" stroke-linecap="round"/>'
    : '<ellipse cx="44" cy="52" rx="4" ry="4" fill="#1b1f2a"><animate attributeName="ry" values="4;4;4;0.5;4" dur="4s" repeatCount="indefinite"/></ellipse>' +
      '<ellipse cx="68" cy="52" rx="4" ry="4" fill="#1b1f2a"><animate attributeName="ry" values="4;4;4;0.5;4" dur="4s" repeatCount="indefinite"/></ellipse>'
  const sweat = r >= 1.5
    ? `<path d="M86 40 q4 7 0 10 q-4 -3 0 -10z" fill="${C.blue}"><animateTransform attributeName="transform" type="translate" values="0 0;0 10;0 0" dur="1.6s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;0;1" dur="1.6s" repeatCount="indefinite"/></path>`
    : ''
  const steam = r >= 3
    ? [30, 56, 82].map((x, i) => `<path d="M${x} 22 q-5 -7 0 -14 q5 -7 0 -14" stroke="${C.dim}" stroke-width="2" fill="none" opacity="0.7"><animateTransform attributeName="transform" type="translate" values="0 6;0 -4" dur="${1.2 + i * 0.3}s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.8;0" dur="${1.2 + i * 0.3}s" repeatCount="indefinite"/></path>`).join('')
    : ''
  return `<g transform="translate(14,14)">${steam}
    <rect x="16" y="28" width="80" height="62" rx="12" fill="${m.color}"/>
    <rect x="16" y="78" width="80" height="12" rx="6" fill="#000" opacity="0.15"/>
    ${eyes}${mouth}${sweat}
    <circle cx="86" cy="82" r="3" fill="#fff"><animate attributeName="opacity" values="1;0.2;1" dur="${(Number(fan) * 2).toFixed(2)}s" repeatCount="indefinite"/></circle>
    <g transform="translate(28,82)"><circle r="6" fill="#00000033"/>
      <g><path d="M0 0 L0 -5 M0 0 L4.3 2.5 M0 0 L-4.3 2.5" stroke="#1b1f2a" stroke-width="2"/>
      <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="${fan}s" repeatCount="indefinite"/></g></g>
  </g>`
}
function ring(cx: number, cy: number, frac: number, color: string, big: string, small: string): string {
  const r = 27, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, frac))
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.track}" stroke-width="8"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round"
      stroke-dasharray="${(c * f).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>
    <text x="${cx}" y="${cy + 2}" text-anchor="middle" fill="${C.text}" font-size="15" font-weight="700">${esc(big)}</text>
    <text x="${cx}" y="${cy + 16}" text-anchor="middle" fill="${C.dim}" font-size="9">${esc(small)}</text>`
}
function header(s: BoxStatus): string {
  const r = s.load[0] / s.cores
  const m = mood(r)
  const loadColor = r > 2.5 ? C.red : r > 1 ? C.amber : C.green
  const memUsed = 1 - s.memAvailGB / s.memTotalGB
  const memColor = memUsed > 0.85 ? C.red : memUsed > 0.65 ? C.amber : C.green
  return card(132, `${mascot(r, m)}
    <text x="20" y="122" fill="${m.color}" font-size="12" font-weight="700">${esc(m.label)}</text>
    <text x="128" y="24" fill="${C.text}" font-size="13" font-weight="700">${esc(s.name || "Linux box")}</text>
    ${ring(166, 72, r / 4, loadColor, String(s.load[0]), `load / ${s.cores} cores`)}
    ${ring(254, 72, memUsed, memColor, `${Math.round(memUsed * 100)}%`, 'memory')}
    <text x="300" y="58" fill="${C.dim}" font-size="9">swap</text>
    <text x="300" y="74" fill="${s.swapUsedGB > 1.5 ? C.amber : C.text}" font-size="13" font-weight="700">${s.swapUsedGB}G</text>
    <text x="300" y="94" fill="${C.dim}" font-size="9">5/15 min</text>
    <text x="300" y="108" fill="${C.text}" font-size="11">${s.load[1]} · ${s.load[2]}</text>`)
}

// ---------- drives as little batteries
function drives(s: BoxStatus): string {
  const row = 30
  const rows = s.disks.map((d, i) => {
    const y = 34 + i * row
    if (d.freeGB === null) {
      return `<text x="16" y="${y + 10}" fill="${C.text}" font-size="12">${esc(d.name)}</text>
        <text x="100" y="${y + 10}" fill="${C.red}" font-size="12" font-weight="700">not mounted</text>`
    }
    const color = d.freeGB < 30 ? C.red : d.freeGB < 100 ? C.amber : C.green
    const used = (d.usedPct ?? 0) / 100
    const bw = 170
    const hurt = healthList(s).some(h => h.name === d.name) ? `<text x="72" y="${y + 11}" font-size="11">🩹</text>` : ''
    return `<text x="16" y="${y + 10}" fill="${C.text}" font-size="12">${esc(d.name)}</text>${hurt}
      <rect x="100" y="${y}" width="${bw}" height="13" rx="4" fill="${C.track}"/>
      <rect x="100" y="${y}" width="${(bw * used).toFixed(1)}" height="13" rx="4" fill="${color}" opacity="0.85"/>
      <rect x="${100 + bw + 1}" y="${y + 4}" width="3" height="5" rx="1" fill="${C.track}"/>
      <text x="${W - 16}" y="${y + 11}" text-anchor="end" fill="${color}" font-size="12" font-weight="700">${d.freeGB} GB</text>`
  }).join('')
  return card(30 + s.disks.length * row + 8, title(16, 22, 'Drives · free space') + rows)
}

// ---------- every batch: one row each, running first, then waiting
function jobLabel(j: Job): string {
  const l = j.label ?? j.desc.replace(/\s*\(waits for [^)]*\)/, '')
  return (l === j.unit ? l.replace(/^tv-import-/, 'TV import · ').replace(/^hb-/, '') : l).replace(/\s+QSV$/, '')
}
function itemName(n: string): string {
  return n.replace(/\s*\(\d{4}\)/, '').replace(/\s*\((?:480|576|720|1080|2160)p[^)]*\)/i, '').replace(/\.(mkv|mp4|avi|m4v)$/i, '')
}
// how many items are finished, from the journal's "[n/total]" (n is the one in progress) or the log's count
function jobDone(j: Job): number | null {
  return j.n !== null ? j.n - 1 : j.done ?? null
}
function encode(s: BoxStatus): string | null {
  if (s.batches.length === 0) return null
  const jobs = s.jobs ?? s.batches.map(u => ({ unit: u, desc: u, n: null, total: null, name: '' }) as Job)
  const rowH = 72
  const rows = jobs.map((j, i) => {
    const y = 50 + i * rowH
    const waiting = j.state === 'waiting'
    const done = jobDone(j), total = j.total
    const color = waiting ? C.dim : j.unit.startsWith('tv-import') ? C.teal : C.purple
    const icon = waiting ? '⏳' : j.unit.startsWith('tv-import') ? '📥' : '🎞'
    const right = waiting ? 'waiting'
      : j.n !== null && total ? `${j.n} / ${total}`
      : done !== null && total ? `${done} / ${total}`
      : done !== null ? `${done} done` : 'starting…'
    const failTxt = j.failed ? `${j.failed} failed · ` : ''
    const sub = waiting ? `${total ? total + ' items · ' : ''}after ${(j.waitsFor || 'another job').replace(/\bhb-/g, '').replace(/\btv-import-/g, 'import ')}`
      : failTxt + (j.name ? `${j.current === false ? 'last: ' : 'now: '}${itemName(j.name)}` : '')
        + (j.itemPct != null ? ` · ${j.itemPct}%${j.itemEtaMin != null ? `, ~${j.itemEtaMin} min left` : ''}` : '')
    const bw = W - 32
    const frac = total && done !== null ? Math.min(1, (done + (j.itemPct ?? 0) / 100) / total) : null
    const by = y + 11, bh = 9
    const bar = waiting ? `<rect x="16" y="${by}" width="${bw}" height="${bh}" rx="4" fill="${C.track}" opacity="0.5"/>`
      : frac !== null ? `<rect x="16" y="${by}" width="${bw}" height="${bh}" rx="4" fill="${C.track}"/>
          <rect x="16" y="${by}" width="${Math.max(4, bw * frac).toFixed(1)}" height="${bh}" rx="4" fill="${color}"/>
          <rect x="${(16 + bw * frac).toFixed(1)}" y="${by}" width="${Math.max(3, bw / (total as number)).toFixed(1)}" height="${bh}" rx="2" fill="${color}"><animate attributeName="opacity" values="1;0.25;1" dur="1.4s" repeatCount="indefinite"/></rect>`
      : `<rect x="16" y="${by}" width="${bw}" height="${bh}" rx="4" fill="${C.track}"/><rect x="16" y="${by}" width="44" height="${bh}" rx="4" fill="${color}"><animate attributeName="x" values="16;${W - 60};16" dur="2.4s" repeatCount="indefinite"/></rect>`
    return `<text x="16" y="${y}" font-size="16">${icon}</text>
      <text x="40" y="${y}" fill="${waiting ? C.dim : C.text}" font-size="16" font-weight="700">${esc(cut(jobLabel(j), 24))}</text>
      <text x="${W - 16}" y="${y}" text-anchor="end" fill="${color}" font-size="16" font-weight="700">${esc(right)}</text>${bar}
      <text x="16" y="${y + 40}" fill="${C.dim}" font-size="14">${esc(cut(sub, 40))}</text>`
  }).join('')
  const running = jobs.filter(j => j.state !== 'waiting').length
  return card(30 + jobs.length * rowH, `<text x="16" y="24" fill="${C.dim}" font-size="14" font-weight="700" letter-spacing="1">BATCHES · ${running} RUNNING · ${jobs.length - running} WAITING</text>` + rows)
}

// ---------- Plex: watching versus analysis
const JOB_ICON: Record<string, string> = {
  loudness: '🔊', intros: '⏭', credits: '🎬', 'voice.activity': '🗣', 'chapter.thumbs': '🖼', thumbnails: '🖼',
}
function plex(s: BoxStatus): string | null {
  if (s.plexConfigured === false) return null
  if (!s.plexUp) return card(64, title(16, 22, 'Plex') + `<text x="16" y="46" fill="${C.red}" font-size="13" font-weight="700">⚠ Plex isn't responding</text>`)
  let y = 44
  let body = ''
  if (s.watching.length === 0) {
    body += `<text x="16" y="${y}" fill="${C.dim}" font-size="12">😴 Nobody watching</text>`
    y += 22
  }
  for (const w of s.watching) {
    const tc = w.transcode === 'direct' ? 'direct play' : `transcode (${w.transcode})`
    body += `<path d="M18 ${y - 10} l10 6 l-10 6z" fill="${C.green}"><animate attributeName="opacity" values="1;0.4;1" dur="1.2s" repeatCount="indefinite"/></path>
      <text x="34" y="${y}" fill="${C.text}" font-size="12" font-weight="600">${esc(cut(w.title, 38))}</text>
      <text x="34" y="${y + 14}" fill="${C.dim}" font-size="10">${esc(w.user)} · ${esc(w.state)} · ${esc(tc)}</text>`
    y += 34
  }
  if (s.plexJobs.length) {
    body += `<text x="16" y="${y}" fill="${C.dim}" font-size="10" font-style="italic">background analysis — not playback</text>`
    y += 18
    for (const j of s.plexJobs) {
      const icon = JOB_ICON[j.type] ?? '🔍'
      const p = j.progress ?? -1
      const bar = p >= 0
        ? `<rect x="230" y="${y - 9}" width="${W - 246}" height="8" rx="4" fill="${C.track}"/><rect x="230" y="${y - 9}" width="${(((W - 246) * p) / 100).toFixed(1)}" height="8" rx="4" fill="${C.teal}"/>`
        : `<rect x="230" y="${y - 9}" width="${W - 246}" height="8" rx="4" fill="${C.track}"/><rect x="230" y="${y - 9}" width="30" height="8" rx="4" fill="${C.teal}"><animate attributeName="x" values="230;${W - 46};230" dur="2.4s" repeatCount="indefinite"/></rect>`
      body += `<text x="16" y="${y}" font-size="12">${icon}</text>
        <text x="36" y="${y}" fill="${C.text}" font-size="11">${esc(cut(j.item || j.title, 30))}</text>${bar}`
      y += 20
    }
  }
  return card(y + 4, title(16, 22, 'Plex') + body)
}

// ---------- drive health, one heartbeat per monitored drive
function healthList(s: BoxStatus): Health[] {
  if (s.health) return s.health
  const o = s.overflow // older box-status.sh: a single drive
  if (!o) return []
  return [{ name: s.healthName ?? 'drive', date: o.date, alert: s.overflowAlert,
    kv: { total_bad_sectors: o.badSectors, new_bad_sectors: o.new, ext4_errors: o.ext4Errors, mount: o.mount } }]
}
function verdict(h: Health): { level: 'bad' | 'warn' | 'ok'; status: string; detail: string } {
  const k = h.kv
  const n = (key: string) => Number(k[key] ?? 0) || 0
  const alertRecent = !!h.alert && Date.now() / 1000 - h.alert < 2 * 86400
  const parts: string[] = []
  if (k.total_bad_sectors !== undefined) parts.push(`${k.total_bad_sectors} bad sectors (${k.new_bad_sectors ?? 0} new)`)
  if (k.ext4_errors !== undefined) parts.push(`ext4 errors ${k.ext4_errors}`)
  if (k.io_errors !== undefined) parts.push(`read errors ${k.io_errors}`)
  if (k.usb_resets !== undefined && (n('usb_resets') > 0 || k.total_bad_sectors === undefined)) parts.push(`USB drop-outs ${k.usb_resets}`)
  if (k.fs_errors !== undefined && n('fs_errors') > 0) parts.push(`fs errors ${k.fs_errors}`)
  parts.push(`checked ${h.date.slice(5)}`)
  const mountBad = k.mount !== undefined && k.mount !== 'ok'
  const worse = n('new_bad_sectors') > 0 || n('ext4_errors') > 0 || n('fs_errors') > 0
  if (mountBad) return { level: 'bad', status: k.mount === 'missing' ? 'Not connected' : 'Not mounted', detail: parts.join(' · ') }
  if (worse) return { level: 'bad', status: 'Getting worse — check it', detail: parts.join(' · ') }
  if (n('io_errors') > 0) return { level: 'warn', status: `Dropping out · ${n('io_errors')} failed reads in 24h`, detail: parts.join(' · ') }
  if (n('usb_resets') > 0) return { level: 'warn', status: `Shaky connection · ${n('usb_resets')} drop-outs in 24h`, detail: parts.join(' · ') }
  if (alertRecent) return { level: 'warn', status: 'Stable · recent alert', detail: parts.join(' · ') }
  return { level: 'ok', status: 'Stable', detail: parts.join(' · ') }
}
function health(s: BoxStatus): string | null {
  const list = healthList(s)
  if (!list.length) return null
  const rowH = 52
  const rows = list.map((h, i) => {
    const v = verdict(h)
    const color = v.level === 'bad' ? C.red : v.level === 'warn' ? C.amber : C.green
    const beat = v.level === 'bad' ? '0.6s' : v.level === 'warn' ? '1.0s' : '1.6s'
    const y = 34 + i * rowH
    const spike = v.level === 'ok' ? '98,8 106,26 114,12' : '96,0 102,30 108,4 114,24'
    return `<g transform="translate(0,${y})">
      <g transform="translate(30,22)"><g><path d="M0 6 C-14 -6 -8 -18 0 -10 C8 -18 14 -6 0 6z" fill="${color}"/>
        <animateTransform attributeName="transform" type="scale" values="1;1.18;1;1.1;1" dur="${beat}" repeatCount="indefinite"/></g></g>
      <text x="56" y="8" fill="${C.text}" font-size="12" font-weight="700">${esc(h.name)}</text>
      <text x="${W - 16}" y="8" text-anchor="end" fill="${color}" font-size="11" font-weight="700">${esc(cut(v.status, 42))}</text>
      <polyline points="56,18 90,18 ${spike} 120,18 ${W - 16},18" fill="none" stroke="${color}" stroke-width="2" opacity="0.6"/>
      <text x="56" y="36" fill="${C.dim}" font-size="10">${esc(cut(v.detail, 72))}</text></g>`
  }).join('')
  return card(34 + list.length * rowH, title(16, 22, 'Drive health') + rows)
}

// ---------- status line
function short(s: BoxStatus): string {
  const live = (s.jobs ?? []).filter(j => j.state !== 'waiting')
  const enc = live.length ? ' · ' + live.map(j => {
    const d = jobDone(j)
    return `${j.unit.startsWith('tv-import') ? '📥' : '🎞'}${j.n !== null ? j.n : d ?? '…'}${j.total ? '/' + j.total : ''}`
  }).join(' ') : ''
  const plexTxt = !s.plexUp ? ' · Plex DOWN'
    : s.watching.length ? ` · ▶ ${s.watching.length} watching`
    : s.plexJobs.length ? ' · Plex analysing' : ''
  const face = mood(s.load[0] / s.cores).face
  const emoji = face === 'calm' ? '😎' : face === 'busy' ? '🙂' : face === 'hard' ? '😅' : '🥵'
  return `${emoji} box load ${s.load[0]}${enc}${plexTxt}`
}

let busy = false
async function refresh($: any): Promise<void> {
  if (busy) return
  busy = true
  try {
    const r = await $.process.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", HOST, SCRIPT], { timeoutMs: 40_000 })
    if (r.exitCode !== 0) throw new Error((r.stderr || 'ssh failed').trim().split('\n').pop())
    const status = JSON.parse(r.stdout) as BoxStatus
    await update($, snapshot, () => ({ status, error: '', checkedAt: Date.now() }))
    $.ui.status(short(status))
  } catch (err) {
    const msg = String((err as Error)?.message ?? err).slice(0, 160)
    await update($, snapshot, s => ({ ...s, error: msg, checkedAt: Date.now() }))
    $.ui.status('📡 box unreachable')
  } finally {
    busy = false
  }
}

export const register: Register = (on, options) => {
  const opt = (options ?? {}) as Record<string, unknown>
  if (typeof opt.host === "string" && opt.host) HOST = opt.host
  if (typeof opt.script === "string" && opt.script) SCRIPT = opt.script
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'box', description: 'Open the linuxbox monitor pane and refresh it now' })
    void $.ui.open({ id: PANE, title: 'linuxbox' })
    void refresh($)
    $.clock.every(EVERY_MS, () => refresh($))
    return next(e)
  })

  on('command.run', { command: 'box' }, async $ => {
    await $.ui.open({ id: PANE, title: 'linuxbox' })
    await refresh($)
    return { text: 'linuxbox pane opened and refreshed.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Svg } = $.ui.resolve(e) as any
    const snap = await read($, snapshot)
    const s = snap.status
    const ago = snap.checkedAt ? Math.round((Date.now() - snap.checkedAt) / 1000) : null
    if (!s) return (
      <Box flexDirection="column">
        <Text dimColor>{snap.error ? `📡 Can't reach the box: ${snap.error}` : '📡 Checking the box…'}</Text>
      </Box>
    )
    const enc = encode(s)
    const px = plex(s)
    const hp = health(s)
    return (
      <Box flexDirection="column" gap={1}>
        <Svg source={header(s)} alt={`Load ${s.load[0]} on ${s.cores} cores, memory ${s.memAvailGB} of ${s.memTotalGB} GB free, swap ${s.swapUsedGB} GB`} width={W} isInteractive />
        {enc && <Svg source={enc} alt={`Batches: ${(s.jobs ?? []).map(j => `${jobLabel(j)} ${j.state === 'waiting' ? 'waiting' : `${jobDone(j) ?? '?'}${j.total ? ' of ' + j.total : ''} done`}`).join('; ')}`} width={W} isInteractive />}
        {px && <Svg source={px} alt={`Plex: ${s.watching.length} watching, ${s.plexJobs.length} background jobs`} width={W} isInteractive />}
        <Svg source={drives(s)} alt={s.disks.map(d => `${d.name} ${d.freeGB ?? 'not mounted'} GB free`).join(', ')} width={W} />
        {hp && <Svg source={hp} alt={healthList(s).map(h => { const v = verdict(h); return `${h.name}: ${v.status}, ${v.detail}` }).join('; ')} width={W} isInteractive />}
        <Text dimColor>
          {s.container ? `${s.container} ${s.containerStatus || "not running"} · ` : ""}box time {s.time}{ago !== null ? ` · updated ${ago}s ago` : ''}
          {snap.error ? ` · last check failed: ${snap.error}` : ''}
        </Text>
      </Box>
    )
  })
}
