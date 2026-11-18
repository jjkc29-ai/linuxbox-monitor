import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { BoxStatus, Snapshot } from '../types'

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
    const hurt = s.overflow && d.name === s.healthName ? `<text x="72" y="${y + 11}" font-size="11">🩹</text>` : ''
    return `<text x="16" y="${y + 10}" fill="${C.text}" font-size="12">${esc(d.name)}</text>${hurt}
      <rect x="100" y="${y}" width="${bw}" height="13" rx="4" fill="${C.track}"/>
      <rect x="100" y="${y}" width="${(bw * used).toFixed(1)}" height="13" rx="4" fill="${color}" opacity="0.85"/>
      <rect x="${100 + bw + 1}" y="${y + 4}" width="3" height="5" rx="1" fill="${C.track}"/>
      <text x="${W - 16}" y="${y + 11}" text-anchor="end" fill="${color}" font-size="12" font-weight="700">${d.freeGB} GB</text>`
  }).join('')
  return card(30 + s.disks.length * row + 8, title(16, 22, 'Drives · free space') + rows)
}

// ---------- the encode as a film strip
function encode(s: BoxStatus): string | null {
  if (s.batches.length === 0) return null
  const jobs = s.jobs ?? []
  const cur = jobs.find(j => j.n !== null)
  const queued = jobs.filter(j => j.n === null)
  const queueTxt = queued.map(j => j.desc.replace(/\s*\(waits for [^)]*\)/, '').replace(/\s+QSV$/, '')).join(' → ')
  if (!cur) {
    return card(queued.length ? 80 : 64, title(16, 22, 'Encoding') +
      `<text x="16" y="46" fill="${C.dim}" font-size="12">⏳ Starting up…</text>` +
      (queued.length ? `<text x="16" y="66" fill="${C.dim}" font-size="10">Queued: ${esc(cut(queueTxt, 56))}</text>` : ''))
  }
  const n = cur.n as number, total = cur.total as number
  const m = [null, null, null, cur.name] as unknown as string[]
  const name = m[3].replace(/\s*\(\d{4}\)/, '').replace(/\s*\((?:480|576|720|1080|2160)p[^)]*\)/i, '').replace(/\.(mkv|mp4|avi)$/i, '')
  const x0 = 16, sw = W - 32, fw = sw / total
  const frames = Array.from({ length: total }, (_, i) => {
    const done = i < n - 1, cur = i === n - 1
    const fill = done ? C.blue : cur ? C.purple : C.track
    const anim = cur ? '<animate attributeName="opacity" values="1;0.35;1" dur="1.4s" repeatCount="indefinite"/>' : ''
    return `<rect x="${(x0 + i * fw + 0.6).toFixed(1)}" y="56" width="${Math.max(1, fw - 1.2).toFixed(1)}" height="18" rx="1.5" fill="${fill}">${anim}</rect>`
  }).join('')
  const holes = `<line x1="${x0}" y1="51" x2="${x0 + sw}" y2="51" stroke="${C.dim}" stroke-width="3" stroke-dasharray="3 4" opacity="0.5"/>
    <line x1="${x0}" y1="79" x2="${x0 + sw}" y2="79" stroke="${C.dim}" stroke-width="3" stroke-dasharray="3 4" opacity="0.5"/>`
  const others = queued.length ? ` · next: ${esc(cut(queueTxt, 40))}` : ''
  return card(112, `${title(16, 22, 'Encoding')}
    <text x="${W - 16}" y="22" text-anchor="end" fill="${C.purple}" font-size="12" font-weight="700">${n} / ${total}</text>
    <text x="16" y="40" fill="${C.text}" font-size="12">🎞 ${esc(cut(name, 50))}</text>
    <rect x="${x0 - 4}" y="46" width="${sw + 8}" height="38" rx="4" fill="#0d1018"/>${holes}${frames}
    <text x="16" y="102" fill="${C.dim}" font-size="10">${Math.round((100 * (n - 1)) / total)}% done${others}</text>`)
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

// ---------- overflow drive health, with a heartbeat
function overflow(s: BoxStatus): string | null {
  const o = s.overflow
  const alertRecent = !!s.overflowAlert && Date.now() / 1000 - s.overflowAlert < 2 * 86400
  if (!o) return null
  const hname = `${s.healthName ?? "drive"} health`
  const bad = o.new !== '0' || o.ext4Errors !== '0' || o.mount !== 'ok'
  const color = bad ? C.red : alertRecent ? C.amber : C.green
  const beat = bad ? '0.6s' : '1.6s'
  const status = bad ? 'Getting worse — check it' : alertRecent ? 'Stable · recent alert' : 'Stable'
  return card(76, `${title(16, 22, hname)}
    <g transform="translate(30,50)"><g><path d="M0 6 C-14 -6 -8 -18 0 -10 C8 -18 14 -6 0 6z" fill="${color}"/>
      <animateTransform attributeName="transform" type="scale" values="1;1.18;1;1.1;1" dur="${beat}" repeatCount="indefinite"/></g></g>
    <polyline points="56,48 90,48 98,36 106,60 114,44 120,48 ${W - 16},48" fill="none" stroke="${color}" stroke-width="2" opacity="0.6"/>
    <text x="56" y="30" fill="${color}" font-size="12" font-weight="700">${esc(status)}</text>
    <text x="56" y="66" fill="${C.dim}" font-size="10">${esc(o.badSectors)} bad sectors (${esc(o.new)} new) · ext4 errors ${esc(o.ext4Errors)} · checked ${esc(o.date.slice(5))}</text>`)
}

// ---------- status line
function short(s: BoxStatus): string {
  const cur = (s.jobs ?? []).find(j => j.n !== null)
  const enc = cur ? ` · 🎞 ${cur.n}/${cur.total}` : ''
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
    const hp = overflow(s)
    return (
      <Box flexDirection="column" gap={1}>
        <Svg source={header(s)} alt={`Load ${s.load[0]} on ${s.cores} cores, memory ${s.memAvailGB} of ${s.memTotalGB} GB free, swap ${s.swapUsedGB} GB`} width={W} isInteractive />
        {enc && <Svg source={enc} alt={`Encoding: ${s.batchStatus}`} width={W} isInteractive />}
        {px && <Svg source={px} alt={`Plex: ${s.watching.length} watching, ${s.plexJobs.length} background jobs`} width={W} isInteractive />}
        <Svg source={drives(s)} alt={s.disks.map(d => `${d.name} ${d.freeGB ?? 'not mounted'} GB free`).join(', ')} width={W} />
        {hp && <Svg source={hp} alt={`${s.healthName ?? "drive"} health: ${s.overflow?.badSectors ?? '?'} bad sectors, ${s.overflow?.new ?? '?'} new`} width={W} isInteractive />}
        <Text dimColor>
          {s.container ? `${s.container} ${s.containerStatus || "not running"} · ` : ""}box time {s.time}{ago !== null ? ` · updated ${ago}s ago` : ''}
          {snap.error ? ` · last check failed: ${snap.error}` : ''}
        </Text>
      </Box>
    )
  })
}
