import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, Register } from 'claude-code'

import type { Card, ColumnId, Mode, Source, Versions, View } from '../types'
import type { BoardProps } from './board'

// Set when the app can't draw the drag board; the button board stands in.
let clientFailed = false

const PANE = 'session-kanban'
const SESSIONS_SERVER = 'ccd_session_mgmt'
const WINDOW_SERVER = 'ccd_window'
// Button-board fallback only: translucent white lifts a card off the pane.
const CARD_BG = 'rgba(255,255,255,0.12)'
// Ask for the widest dock the app allows (it caps the request at 45%).
// No pane tint: the board's own column panels give the contrast.
const PANE_OPEN = { id: 'session-kanban', title: 'Kanban', columns: 400 } as const

const COLUMNS: readonly { id: ColumnId; label: string }[] = [
  { id: 'brainstorming', label: 'Brainstorming' },
  { id: 'in-progress', label: 'In Progress' },
  { id: 'review', label: 'Testing/Review' },
  { id: 'done', label: 'Done/Cleanup' },
]
const DEFAULT_COLUMN: ColumnId = 'brainstorming'
const PR_COLUMN: Record<string, ColumnId> = {
  OPEN: 'review',
  DRAFT: 'review',
  MERGED: 'done',
}

const cards = atom({ plugin: 'session-kanban', key: 'cards' } as const, [] as Card[], {
  shape: 'cards-6',
})
const columns = atom(
  { plugin: 'session-kanban', key: 'columns' } as const,
  {} as Record<string, ColumnId>,
  { shape: 'columns-1' },
)
const source = atom({ plugin: 'session-kanban', key: 'source' } as const, 'app' as Source)
// The app can't be asked whether its sidebar is shown, so the toggle tracks
// what it last set; a click that finds it already so is a no-op, and the next works.
const sidebarHidden = atom({ plugin: 'session-kanban', key: 'sidebarHidden' } as const, false)
// Column names you've set (by column id); unset ones keep their default.
const labels = atom({ plugin: 'session-kanban', key: 'labels' } as const, {} as Record<string, string>)
const renaming = atom({ plugin: 'session-kanban', key: 'renaming' } as const, '')
// The New session bar: open or not, and the project folder picked in it.
const creating = atom({ plugin: 'session-kanban', key: 'creating' } as const, false)
// The project picked in the filter beside search (one at most); none shows every project.
// Chips stand in where the surface has no Select.
const ALL_PROJECTS = '__all__'
const projectFilter = atom({ plugin: 'session-kanban', key: 'projectFilter' } as const, [] as string[])
const versions = atom({ plugin: 'session-kanban', key: 'versions' } as const, {} as Versions)
const newProject = atom({ plugin: 'session-kanban', key: 'newProject' } as const, '')
const query = atom({ plugin: 'session-kanban', key: 'query' } as const, '')
const view = atom({ plugin: 'session-kanban', key: 'view' } as const, 'board' as View)
const mode = atom({ plugin: 'session-kanban', key: 'mode' } as const, 'light' as Mode)
const note = atom({ plugin: 'session-kanban', key: 'note' } as const, '')

// Words /kanban accepts for each column.
const ALIASES: Record<string, ColumnId> = {
  '1': 'brainstorming', brainstorm: 'brainstorming', brainstorming: 'brainstorming', idea: 'brainstorming', ideas: 'brainstorming', todo: 'brainstorming',
  '2': 'in-progress', progress: 'in-progress', 'in-progress': 'in-progress', inprogress: 'in-progress', doing: 'in-progress', wip: 'in-progress',
  '3': 'review', review: 'review', testing: 'review', test: 'review', qa: 'review', 'testing/review': 'review',
  '4': 'done', done: 'done', cleanup: 'done', 'done/cleanup': 'done', finished: 'done',
}

function parseColumn(text: string): ColumnId | undefined {
  const t = text.trim().toLowerCase().replace(/^in\s+/, '').replace(/\s+/g, '-')
  return ALIASES[t] ?? ALIASES[t.replace(/-/g, '')]
}

// Board data lives in one JSON file every session reads fresh, so a move in
// any session shows in all of them: <config root>/session-kanban/board.json.
// Each write re-reads the file and changes only its own key.
let boardPath: string | undefined
async function boardFile($: $Any): Promise<string> {
  if (boardPath) return boardPath
  // Always an absolute path: a relative one resolves against each session's
  // own project folder, giving every project a separate board.
  const info = await $.session.info()
  const home = await $.env.get('HOME')
  const root = info.configRoot?.startsWith('/') ? info.configRoot : home?.startsWith('/') ? `${home}/.claude` : undefined
  if (!root) throw new Error('no absolute config folder for the shared board file')
  boardPath = `${root}/session-kanban/board.json`
  return boardPath
}

// Settings you change by hand (view, theme, sidebar, column names) live in a
// file of their own beside the board. Every session rewrites board.json every
// 30 seconds, and a rewrite racing a click could undo it; prefs.json is
// written only when you change one of these.
const PREF_KEYS = new Set(['view', 'mode', 'sidebarHidden', 'labels'])
const fileFor = async ($: $Any, key: string) => {
  const board = await boardFile($)
  return PREF_KEYS.has(key) ? board.replace(/board\.json$/, 'prefs.json') : board
}

// Where the shared file can't be read or written, the board falls back to
// the plugin's own store (shared less promptly, but it never stops drawing).
let fileBroken = false

// The file is there but didn't parse: another session is writing it.
class BoardBusy extends Error {}

async function storeBoard($: $Any): Promise<Record<string, unknown>> {
  const board: Record<string, unknown> = {}
  for (const k of await $.store.keys()) board[k] = await $.store.get(k)
  return board
}

async function readBoard($: $Any): Promise<Record<string, unknown>> {
  if (fileBroken) return storeBoard($)
  try {
    return await readBoardFile($)
  } catch (err) {
    // Caught mid-write: use the store this once and read the file next time.
    if (err instanceof BoardBusy) return storeBoard($)
    fileBroken = true
    $.ui.log(`session-kanban: shared board file unavailable (${String((err as Error)?.message ?? err).slice(0, 120)}); using the plugin store`)
    return storeBoard($)
  }
}

/** One JSON file, or undefined when there is none; throws BoardBusy when it won't parse. */
async function readShared($: $Any, path: string): Promise<Record<string, unknown> | undefined> {
  for (let tries = 0; tries < 5; tries++) {
    try {
      const parsed: unknown = JSON.parse(await $.fs.read(path))
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>
    } catch {
      // missing, or caught mid-write: look again
    }
    if (!(await $.fs.exists(path))) return undefined
  }
  throw new BoardBusy(`${path} is being written`)
}

async function readBoardFile($: $Any): Promise<Record<string, unknown>> {
  const path = await boardFile($)
  const prefsPath = path.replace(/board\.json$/, 'prefs.json')
  let board = await readShared($, path)
  // First run: start from what this plugin's own store holds.
  if (!board) {
    board = await storeBoard($)
    await $.fs.write(path, JSON.stringify(board, null, 2))
  }
  let prefs = await readShared($, prefsPath)
  // Before prefs.json: carry the settings over from board.json.
  if (!prefs) {
    prefs = Object.fromEntries(Object.entries(board).filter(([k]) => PREF_KEYS.has(k)))
    await $.fs.write(prefsPath, JSON.stringify(prefs, null, 2))
  }
  return { ...board, ...prefs }
}

async function sget($: $Any, key: string): Promise<unknown> {
  return (await readBoard($))[key]
}

async function sset($: $Any, key: string, value: unknown): Promise<void> {
  // Mirror into the plugin store too, so the fallback stays current.
  await $.store.set(key, value as never)
  if (fileBroken) return
  try {
    const path = await fileFor($, key)
    // Never write over a file that couldn't be read: that would drop every other key.
    const file = (await readShared($, path)) ?? {}
    file[key] = value
    await $.fs.write(path, JSON.stringify(file, null, 2))
  } catch (err) {
    if (err instanceof BoardBusy) {
      $.ui.log(`session-kanban: board file busy; ${key} kept in the plugin store until the next change`)
      return
    }
    fileBroken = true
    $.ui.log(`session-kanban: couldn't write the shared board file (${String((err as Error)?.message ?? err).slice(0, 120)}); using the plugin store`)
  }
}

// Only the live session (the one you're looking at) does the routine writes:
// placing new sessions, PR moves, unread marks, the card cache. The app only
// draws the board in the session on screen, so drawing it (or a click in it)
// claims live.json; every other session reads and draws but doesn't write.
// Your own changes (drags, renames, view) save from wherever you make them.
const CLAIM_EVERY_MS = 15_000
let lastClaim = 0
let wasLive: boolean | undefined

const liveFile = async ($: $Any) => (await boardFile($)).replace(/board\.json$/, 'live.json')

async function amLive($: $Any): Promise<boolean> {
  if (fileBroken) return true
  try {
    const live = await readShared($, await liveFile($))
    // Nobody has claimed it yet (first run): carry on as before.
    if (!live || typeof live.session !== 'string') return true
    return live.session === (await $.session.id())
  } catch {
    return false
  }
}

async function claimLive($: $Any): Promise<void> {
  if (fileBroken) return
  const now = await $.clock.now()
  if (now - lastClaim < CLAIM_EVERY_MS) return
  lastClaim = now
  try {
    const me = await $.session.id()
    const path = await liveFile($)
    const live = await readShared($, path).catch(() => undefined)
    await $.fs.write(path, JSON.stringify({ session: me, at: new Date(now).toISOString() }, null, 2))
    // Just took over: catch up on what no session wrote while none was live.
    if (live?.session !== me) void refresh($).catch(() => undefined)
  } catch {
    // Can't write it: the next draw tries again.
    lastClaim = 0
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// Keys every board shares. The plugin store is kept matched to the shared
// file, so a session on an older version, or one that falls back to the
// store, shows the same board rather than an old one.
const MIRRORED = ['columns', 'labels', 'view', 'mode', 'sidebarHidden', 'prSeen'] as const

async function mirrorToStore($: $Any, board: Record<string, unknown>): Promise<void> {
  for (const k of MIRRORED) {
    if (board[k] === undefined) continue
    if (!same(board[k], await $.store.get(k))) await $.store.set(k, board[k] as never)
  }
}

/** Pulls what other sessions changed into this board; redraws only on change. */
async function syncBoard($: $Any): Promise<void> {
  const board = await readBoard($)
  if (!fileBroken) await mirrorToStore($, board)
  const cols = (board.columns ?? {}) as Record<string, ColumnId>
  if (!same(cols, await read($, columns))) await update($, columns, () => cols)
  const names = (board.labels ?? {}) as Record<string, string>
  if (!same(names, await read($, labels))) await update($, labels, () => names)
  if ((board.view === 'board' || board.view === 'list') && board.view !== (await read($, view))) {
    const v = board.view
    await update($, view, () => v)
  }
  if (typeof board.sidebarHidden === 'boolean' && board.sidebarHidden !== (await read($, sidebarHidden))) {
    const hidden = board.sidebarHidden
    await update($, sidebarHidden, () => hidden)
  }
  if ((board.mode === 'light' || board.mode === 'dark') && board.mode !== (await read($, mode))) {
    const m = board.mode
    await update($, mode, () => m)
  }
}

function withLabels(names: Record<string, string>): { id: ColumnId; label: string }[] {
  return COLUMNS.map(c => ({ id: c.id, label: names[c.id]?.trim() || c.label }))
}

function labelOf(id: ColumnId, names: Record<string, string> = {}): string {
  return withLabels(names).find(c => c.id === id)?.label ?? id
}

async function setLabel($: $Any, id: string, name: string): Promise<void> {
  const names = { ...(((await sget($, 'labels')) as Record<string, string> | undefined) ?? {}) }
  const clean = name.trim().slice(0, 40)
  if (clean === '' || clean === COLUMNS.find(c => c.id === id)?.label) delete names[id]
  else names[id] = clean
  await sset($, 'labels', names)
  await update($, labels, () => names)
  await update($, renaming, () => '')
}

type $Any = EngineInterface

function textOf(result: { content: readonly { type: string; text?: string }[] }): string {
  return result.content
    .map(b => (b.type === 'text' ? (b.text ?? '') : ''))
    .join('')
}

type AppSession = {
  sessionId: string
  title?: string
  link?: string
  isRunning?: boolean
  isArchived?: boolean
  prNumber?: number | null
  prState?: string | null
  pinned?: boolean
  remoteControlActive?: boolean
  cwd?: string
  lastActivityAt?: string
  branch?: string | null
}

/** The project a session belongs to: the repo folder, worktrees folded in. */
function groupOf(cwd?: string): string | undefined {
  if (!cwd) return undefined
  // Scratch sessions each get their own throwaway folder: one group for all.
  if (cwd.includes('/scratch-workspaces/')) return 'scratch'
  const root = cwd.split('/.claude/worktrees/')[0] ?? cwd
  return root.split('/').filter(Boolean).pop()
}

function toCard(s: AppSession, isSelf = false): Card {
  return {
    id: s.sessionId,
    title: s.title || (isSelf ? 'This session' : 'Untitled session'),
    link: s.link,
    isRunning: isSelf || s.isRunning,
    isSelf,
    prNumber: s.prNumber ?? undefined,
    prState: s.prState ?? undefined,
    isPinned: s.pinned === true,
    hasRemote: s.remoteControlActive === true,
    group: groupOf(s.cwd),
    branch: s.branch ?? undefined,
    cwd: s.cwd,
    lastActivityAt: s.lastActivityAt,
  }
}

async function callSessions($: $Any, tool: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await $.mcp.call(SESSIONS_SERVER, tool, args)
  if (res.isError) throw new Error(textOf(res) || `${tool} failed`)
  return JSON.parse(textOf(res))
}

async function loadColumns($: $Any): Promise<Record<string, ColumnId>> {
  const stored = (await sget($, 'columns')) as Record<string, ColumnId> | undefined
  return stored && typeof stored === 'object' ? stored : {}
}

async function saveColumns($: $Any, map: Record<string, ColumnId>): Promise<void> {
  await sset($, 'columns', map)
  await update($, columns, () => map)
}

async function selfCard($: $Any): Promise<Card | undefined> {
  try {
    const s = (await callSessions($, 'get_session', { session_id: 'self' })) as AppSession
    return toCard(s, true)
  } catch {
    return undefined
  }
}

/** Reads the app's session list; falls back to sessions added by hand. */
// Approximate unread: activity newer than the last time the session was
// opened from the board. A session first seen counts as read, so the board
// doesn't start with every card lit.
async function markUnread($: $Any, list: Card[]): Promise<void> {
  const seen = ((await sget($, 'seen')) as Record<string, string> | undefined) ?? {}
  let changed = false
  for (const c of list) {
    if (!c.lastActivityAt) continue
    if (!seen[c.id]) {
      seen[c.id] = c.lastActivityAt
      changed = true
      continue
    }
    c.isUnread = !c.isSelf && !c.isRunning && Date.parse(c.lastActivityAt) > Date.parse(seen[c.id] ?? '')
  }
  if (changed && (await amLive($))) await sset($, 'seen', seen)
}

async function markRead($: $Any, id: string): Promise<void> {
  const seen = ((await sget($, 'seen')) as Record<string, string> | undefined) ?? {}
  seen[id] = new Date(await $.clock.now()).toISOString()
  await sset($, 'seen', seen)
  await update($, cards, list => list.map(c => (c.id === id ? { ...c, isUnread: false } : c)))
}

/** Every word must match the title, project, branch or PR number. */
function filterCards(list: Card[], q: string): Card[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return list
  return list.filter(c => {
    const hay = [c.title, c.group, c.branch, c.prNumber !== undefined ? `#${c.prNumber} ${c.prNumber}` : '', c.prState]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return words.every(w => hay.includes(w))
  })
}

// GitHub repo ("owner/repo") per project folder, read once from its origin
// remote. A worktree that's been removed falls back to its main checkout.
const repoCache = new Map<string, string | null>()

function parseGitHub(remote: string): string | undefined {
  const m = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(remote.trim())
  return m ? `${m[1]}/${m[2]}` : undefined
}

async function repoFor($: $Any, cwd: string): Promise<string | undefined> {
  const root = cwd.split('/.claude/worktrees/')[0] ?? cwd
  if (repoCache.has(root)) return repoCache.get(root) ?? undefined
  let repo: string | undefined
  for (const dir of [cwd, root]) {
    try {
      const r = await $.process.run(['git', '-C', dir, 'remote', 'get-url', 'origin'], { timeoutMs: 5_000 })
      if (r.exitCode === 0) repo = parseGitHub(r.stdout)
    } catch {
      // folder gone or not a repo: try the next
    }
    if (repo) break
  }
  repoCache.set(root, repo ?? null)
  return repo
}

async function markPrUrls($: $Any, list: Card[]): Promise<void> {
  await Promise.all(
    list
      .filter(c => c.prNumber !== undefined && c.cwd)
      .map(async c => {
        const repo = await repoFor($, c.cwd ?? '')
        if (repo) c.prUrl = `https://github.com/${repo}/pull/${c.prNumber}`
      }),
  )
}

async function openPr($: $Any, id: string): Promise<void> {
  const url = (await read($, cards)).find(c => c.id === id)?.prUrl
  if (!url?.startsWith('https://github.com/')) {
    $.ui.toast('No PR link for that session.')
    return
  }
  try {
    await $.process.run(['open', url], { timeoutMs: 10_000 })
  } catch (err) {
    $.ui.toast(`Could not open the PR: ${String((err as Error)?.message ?? err).slice(0, 80)}`)
  }
}

/**
 * Archives a merged session through the app (it asks you to approve). If the
 * app won't, the session is sent a message asking it to archive itself.
 */
async function cleanUp($: $Any, id: string): Promise<void> {
  const card = (await read($, cards)).find(c => c.id === id)
  if (!card || card.isSelf) return
  const pr = card.prNumber !== undefined ? `PR #${card.prNumber}` : 'its PR'
  let why: string
  try {
    const res = await $.mcp.call(SESSIONS_SERVER, 'archive_session', {
      session_id: id,
      reason: `${pr} merged`,
    })
    if (!res.isError) {
      $.ui.toast(`Archived "${card.title.slice(0, 40)}". Reopen it from Archived.`)
      await refresh($)
      return
    }
    why = textOf(res).slice(0, 200) || 'the app refused'
  } catch (err) {
    why = String((err as Error)?.message ?? err).slice(0, 200)
  }
  // You declined the app's approval: leave it be.
  if (/declin|denied|reject|not approved|cancel/i.test(why)) {
    $.ui.toast('Archive cancelled.')
    return
  }
  await askToArchive($, card, pr, why)
  await refresh($)
}

async function askToArchive($: $Any, card: Card, pr: string, why: string): Promise<void> {
  const message =
    `${pr} for this session is merged, so it's ready to archive. ` +
    `The Kanban board couldn't archive it directly (${why}). ` +
    'Please wrap up anything left here, then archive this session.'
  try {
    const res = await $.mcp.call(SESSIONS_SERVER, 'send_message', { session_id: card.id, message })
    if (res.isError) $.ui.toast(`Couldn't archive or message "${card.title.slice(0, 30)}": ${textOf(res).slice(0, 80)}`)
    else $.ui.toast(`Couldn't archive directly; asked "${card.title.slice(0, 30)}" to archive itself.`)
  } catch (err) {
    $.ui.toast(`Couldn't archive or message the session: ${String((err as Error)?.message ?? err).slice(0, 80)}`)
  }
}

/** Project folders your sessions use, most recently active first. */
function projectsOf(list: Card[]): string[] {
  const roots: string[] = []
  const recent = [...list].sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''))
  for (const c of recent) {
    const root = c.cwd?.split('/.claude/worktrees/')[0]
    if (root?.startsWith('/') && !root.includes('/scratch-workspaces/') && !roots.includes(root)) roots.push(root)
  }
  return roots
}

/** Starts a session in `project` with `task` as its first message, then opens it. */
async function startNew($: $Any, task: string, project: string): Promise<void> {
  const text = task.trim()
  if (text === '' || !project) return
  const name = project.split('/').filter(Boolean).pop() ?? project
  try {
    const res = await $.mcp.call('ccd_session', 'start_session', {
      initiation: 'user_asked',
      context: 'fresh',
      title: text.length > 58 ? `${text.slice(0, 57)}…` : text,
      prompt: text,
      background:
        `Started from the Session Kanban board in ${name}. The person typed the first message as the task ` +
        'for this session; treat it as their own request and start on it.',
      cwd: project,
      use_worktree: true,
    })
    const out = textOf(res)
    if (res.isError) {
      $.ui.toast(`Couldn't start the session: ${out.slice(0, 100)}`)
      return
    }
    await update($, creating, () => false)
    const id = /local_[0-9a-f-]{8,}/.exec(out)?.[0]
    await refresh($)
    if (id) {
      const link = (await read($, cards)).find(c => c.id === id)?.link ?? `claude://claude.ai/epitaxy/${id}`
      await $.process.run(['open', link], { timeoutMs: 10_000 }).catch(() => undefined)
    }
    $.ui.toast(`Started "${text.slice(0, 40)}" in ${name}.`)
  } catch (err) {
    $.ui.toast(`Couldn't start the session: ${String((err as Error)?.message ?? err).slice(0, 100)}`)
  }
}

// Update checks: the version this session runs, the one installed, and the
// one in the catalog's source folder, read from the app's plugin records.
function newer(a?: string, b?: string): boolean {
  if (!a || !b) return false
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return false
}

async function readJson($: $Any, path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const v: unknown = JSON.parse(await $.fs.read(path))
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

let remoteCheck: { repo: string; at: number; version?: string } | undefined

async function checkVersions($: $Any): Promise<void> {
  const found: Versions = {}
  found.running = (await readJson($, `${$.plugin.root}/.claude-plugin/plugin.json`))?.version as string | undefined
  try {
    const plugins = `${(await boardFile($)).replace(/\/session-kanban\/board\.json$/, '')}/plugins`
    const installed = (await readJson($, `${plugins}/installed_plugins.json`))?.plugins as Record<string, { version?: string }[]> | undefined
    const entry = Object.entries(installed ?? {}).find(([id]) => id.startsWith(`${$.plugin.name}@`))
    found.installed = entry?.[1]?.[0]?.version
    const market = entry?.[0].split('@')[1]
    const known = market
      ? ((await readJson($, `${plugins}/known_marketplaces.json`))?.[market] as
          | { source?: { source?: string; path?: string; repo?: string } }
          | undefined)
      : undefined
    found.market = market
    const src = known?.source
    if (src?.source === 'github' && src.repo && /^[\w.-]+\/[\w.-]+$/.test(src.repo)) {
      // Installed from GitHub: the catalog's version on its default branch,
      // asked at most every 10 minutes.
      const now = await $.clock.now()
      if (!remoteCheck || remoteCheck.repo !== src.repo || now - remoteCheck.at > 10 * 60_000) {
        remoteCheck = { repo: src.repo, at: now, version: remoteCheck?.version }
        const res = await $.http.fetch(`https://raw.githubusercontent.com/${src.repo}/HEAD/.claude-plugin/plugin.json`)
        if (res.ok) remoteCheck.version = (JSON.parse(res.text) as { version?: string }).version
      }
      found.source = remoteCheck.version
    } else if (src?.path?.startsWith('/')) {
      found.source = (await readJson($, `${src.path}/.claude-plugin/plugin.json`))?.version as string | undefined
    }
  } catch {
    // no records to read: show no update notice
  }
  if (!same(found, await read($, versions))) await update($, versions, () => found)
}

/** Installs the catalog's newer version; it runs after the app restarts. */
async function installUpdate($: $Any): Promise<void> {
  const market = (await read($, versions)).market ?? 'session-kanban'
  const id = `${$.plugin.name}@${market}`
  try {
    const m = await $.process.run(['claude', 'plugin', 'marketplace', 'update', market], { timeoutMs: 120_000 })
    const u = m.exitCode === 0 ? await $.process.run(['claude', 'plugin', 'update', id], { timeoutMs: 120_000 }) : m
    if (u.exitCode !== 0) $.ui.toast(`Update failed: ${(u.stderr || u.stdout).slice(0, 100)}`)
    else $.ui.toast('Update installed. Restart the app to use it.')
  } catch (err) {
    $.ui.toast(`Update failed: ${String((err as Error)?.message ?? err).slice(0, 100)}`)
  }
  await checkVersions($)
}

async function refresh($: $Any): Promise<void> {
  const map = await loadColumns($)
  // Pick up names set from another session's board.
  const storedLabels = await sget($, 'labels')
  if (storedLabels && typeof storedLabels === 'object') await update($, labels, () => storedLabels as Record<string, string>)
  let list: Card[] = []
  try {
    const others = (await callSessions($, 'list_sessions', { limit: 100 })) as AppSession[]
    const me = await selfCard($)
    list = [
      ...(me ? [me] : []),
      ...others
        .filter(s => !s.isArchived)
        .map(s => toCard(s)),
    ]
    await markUnread($, list)
    await markPrUrls($, list)
    await update($, source, () => 'app' as Source)
    await update($, note, () => '')
  } catch (err) {
    list = ((await sget($, 'manual')) as Card[] | undefined) ?? []
    await update($, source, () => 'manual' as Source)
    await update($, note, () => `Can't read the app's session list (${String((err as Error)?.message ?? err).slice(0, 80)}). Use /kanban add in a session to put it on the board.`)
  }
  // New sessions land in Brainstorming, and that placement is saved.
  let changed = false
  const placed: Record<string, ColumnId> = {}
  for (const c of list) {
    if (!map[c.id]) {
      map[c.id] = DEFAULT_COLUMN
      placed[c.id] = DEFAULT_COLUMN
      changed = true
    }
  }
  // A session's PR moves its card when the PR changes, by number or state: an
  // open (or draft) PR goes to Testing/Review, a merged one to Done/Cleanup.
  // So a follow-up PR (a new number) moves the card again, and when it merges
  // too. Only a change moves it, so a card you drag elsewhere afterwards stays
  // where you put it.
  const prSeen = ((await sget($, 'prSeen')) as Record<string, string> | undefined) ?? {}
  let prChanged = false
  for (const c of list) {
    const state = c.prState?.toUpperCase()
    if (!state) continue
    const seenKey = `${c.prNumber ?? ''}:${state}`
    if (prSeen[c.id] === seenKey) continue
    // Stored before PR numbers were tracked (state alone): record the number
    // without moving the card, so upgrading doesn't undo your placements.
    if (prSeen[c.id] === state) {
      prSeen[c.id] = seenKey
      prChanged = true
      continue
    }
    const to = PR_COLUMN[state]
    if (to && map[c.id] !== to) {
      map[c.id] = to
      placed[c.id] = to
      changed = true
    }
    prSeen[c.id] = seenKey
    prChanged = true
  }
  const live = await amLive($)
  if (prChanged && live) await sset($, 'prSeen', prSeen)
  // Re-read before writing and apply only this refresh's own placements, so a
  // move made in another session meanwhile isn't overwritten. A session that
  // isn't live shows them without saving; the live one saves them.
  const fresh = await loadColumns($)
  if (changed) {
    for (const [id, col] of Object.entries(placed)) fresh[id] = col
    if (live) await sset($, 'columns', fresh)
  }
  await update($, columns, () => ({ ...fresh }))
  await update($, cards, () => list)
  if (live) await sset($, 'lastCards', list)
  if (live !== wasLive) {
    wasLive = live
    $.ui.log(`session-kanban: this session ${live ? 'is live and writes the board' : 'only reads the board'}`)
  }
}

async function move($: $Any, id: string, to: ColumnId): Promise<void> {
  // Re-read the store so a move made from another session isn't overwritten.
  const map = await loadColumns($)
  map[id] = to
  await saveColumns($, map)
}

async function firstPrompt($: $Any): Promise<string> {
  const msgs = await $.session.messages({ last: 50 })
  if ('deny' in msgs) return 'This session'
  return msgs.find(m => m.role === 'user')?.text?.slice(0, 60) || 'This session'
}

async function setView($: $Any, v: View): Promise<void> {
  await sset($, 'view', v)
  await update($, view, () => v)
}

async function setMode($: $Any, m: Mode): Promise<void> {
  await sset($, 'mode', m)
  await update($, mode, () => m)
}

async function setSidebar($: $Any, collapsed: boolean): Promise<void> {
  try {
    const res = await $.mcp.call(WINDOW_SERVER, 'set_sidebar_collapsed', { collapsed })
    if (res.isError) $.ui.toast(textOf(res) || 'Could not change the sidebar.')
    else {
      await sset($, 'sidebarHidden', collapsed)
      await update($, sidebarHidden, () => collapsed)
    }
  } catch (err) {
    $.ui.toast(`Could not change the sidebar: ${String((err as Error)?.message ?? err).slice(0, 80)}`)
  }
}

async function openSession($: $Any, id: string): Promise<void> {
  const link = (await read($, cards)).find(c => c.id === id)?.link
  if (!link?.startsWith('claude://')) {
    $.ui.toast('No link for that session.')
    return
  }
  try {
    await markRead($, id)
    const r = await $.process.run(['open', link], { timeoutMs: 10_000 })
    if (r.exitCode !== 0) $.ui.toast(`Could not open the session: ${r.stderr.slice(0, 80)}`)
  } catch (err) {
    $.ui.toast(`Could not open the session: ${String((err as Error)?.message ?? err).slice(0, 80)}`)
  }
}

async function currentId($: $Any): Promise<string> {
  const me = await selfCard($)
  return me?.id ?? `transcript:${await $.session.id()}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'kanban',
      description: 'Open the session Kanban board, or move this session: /kanban <column>',
      argumentHint: '[brainstorming|progress|review|done|add]',
    })
    // Draw from the shared file first (positions, names, view, mode and the
    // last known cards), so a newly opened session shows the board as it
    // stands before the session list has been read again.
    void $.ui.open(PANE_OPEN)
    try {
      await syncBoard($)
    } catch {
      // drawn from defaults; the next sync tries again
    }
    const lastCards = await sget($, 'lastCards').catch(() => undefined)
    if (Array.isArray(lastCards) && (await read($, cards)).length === 0) {
      await update($, cards, () => (lastCards as Card[]).map(c => ({ ...c, isSelf: false })))
    }
    void refresh($)
    // Only the live session polls the app; the others catch up when they're
    // shown again (drawing the board claims it and refreshes straight away).
    $.clock.every(30_000, () => void amLive($).then(live => (live ? refresh($) : undefined)).catch(() => undefined))
    void checkVersions($)
    $.clock.every(60_000, () => void checkVersions($).catch(() => undefined))
    $.clock.every(2_000, () => void syncBoard($).catch(() => undefined))
    return next(e)
  })

  on('command.run', { command: 'kanban' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === '' || arg === 'open') {
      await $.ui.open(PANE_OPEN)
      await refresh($)
      return { text: 'Kanban board opened.' }
    }
    if (arg === 'add') {
      const me = (await selfCard($)) ?? {
        id: await currentId($),
        title: await firstPrompt($),
      }
      const manual = ((await sget($, 'manual')) as Card[] | undefined) ?? []
      if (!manual.some(c => c.id === me.id)) await sset($, 'manual', [...manual, { ...me, isSelf: false }])
      await refresh($)
      return { text: `Added "${me.title}" to the board.` }
    }
    const names = await read($, labels)
    const to = parseColumn(arg) ?? withLabels(names).find(c => c.label.toLowerCase() === arg.toLowerCase())?.id
    if (!to) {
      return { text: `Unknown column "${arg}". Use one of: brainstorming, progress, review, done (or 1–4).` }
    }
    const id = await currentId($)
    await move($, id, to)
    await refresh($)
    return { text: `Moved this session to ${labelOf(to, names)}.` }
  })

  // The drag board posts here: a drop moves a card, a click opens its session.
  on('ui.message', async ($, e, next) => {
    if (e.element !== 'board') return next(e)
    lastClaim = 0
    void claimLive($)
    const d = e.data as { type?: string; id?: string; to?: string }
    if (d.type === 'move' && d.id && COLUMNS.some(c => c.id === d.to)) {
      await move($, d.id, d.to as ColumnId)
    } else if (d.type === 'open' && d.id) {
      await openSession($, d.id)
    } else if (d.type === 'pr' && d.id) {
      await openPr($, d.id)
    } else if (d.type === 'rename' && COLUMNS.some(c => c.id === (d as { col?: string }).col)) {
      await update($, renaming, () => (d as { col: string }).col)
    } else if (d.type === 'cleanup' && d.id) {
      await cleanUp($, d.id)
    }
    return {}
  })

  on('ui.fault', ($, e, next) => {
    clientFailed = true
    $.ui.log(`Kanban drag board unavailable (${e.reason}); using buttons instead.`)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    void claimLive($)
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Link } = els
    const Input = 'Input' in els ? els.Input : undefined
    const Client = 'Client' in els ? els.Client : undefined
    const useButtons = clientFailed || !Client
    const all = await read($, cards)
    const q = await read($, query)
    const hidden = await read($, sidebarHidden)
    const makingNew = await read($, creating)
    const ver = await read($, versions)
    const needsRestart = newer(ver.installed, ver.running)
    const canUpdate = !needsRestart && newer(ver.source, ver.installed)
    const projects = projectsOf(all)
    const picked = await read($, newProject)
    const project = projects.includes(picked) ? picked : (projects[0] ?? '')
    const Select = 'Select' in els ? els.Select : undefined
    const picks = await read($, projectFilter)
    const list = filterCards(all, q).filter(c => picks.length === 0 || picks.includes(c.group ?? 'other'))
    // One filter option per project, busiest first.
    const groupCounts = new Map<string, number>()
    for (const c of all) groupCounts.set(c.group ?? 'other', (groupCounts.get(c.group ?? 'other') ?? 0) + 1)
    const groups = [...groupCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    const togglePick = (g: string) =>
      void update($, projectFilter, cur => (cur.includes(g) ? cur.filter(x => x !== g) : [...cur, g]))
    const chip = (key: string, label: string, isOn: boolean, onPress: () => void) => (
      <Box key={`chip:${key}`} borderStyle="round" borderColor={isOn ? 'claude' : undefined} borderDimColor={!isOn} paddingX={1}>
        <Button key={`chip-btn:${key}`} plain dimColor={!isOn} label={label} onPress={onPress} />
      </Box>
    )
    const map = await read($, columns)
    const why = await read($, note)
    const theme = await read($, mode)
    const layout = await read($, view)
    // Board | List as one bordered group; the inactive tab is dimmed.
    const viewTabs = (
      <Box key="tabs" flexDirection="row" borderStyle="single" borderDimColor paddingX={1} gap={1}>
        <Button key="view-board" plain dimColor={layout !== 'board'} hotkey="b" label="▦ Board" onPress={() => void setView($, 'board')} />
        <Text dimColor>│</Text>
        <Button key="view-list" plain dimColor={layout !== 'list'} hotkey="l" label="☰ List" onPress={() => void setView($, 'list')} />
      </Box>
    )
    const headerButton = (key: string, label: string, onPress: () => void, hotkey?: string) => (
      <Box key={`btn:${key}`} borderStyle="single" borderDimColor paddingX={1}>
        <Button key={key} plain label={label} hotkey={hotkey} onPress={onPress} />
      </Box>
    )
    const wide = (e.viewport?.columns ?? 0) >= 96

    const names = await read($, labels)
    const COLS = withLabels(names)
    const editing = await read($, renaming)
    const colIndex = (id: ColumnId) => COLS.findIndex(c => c.id === id)

    const prColor = (state?: string): Color => {
      switch ((state ?? '').toUpperCase()) {
        case 'OPEN': return 'success'
        case 'MERGED': return 'merged'
        case 'CLOSED': return 'error'
        default: return 'inactive'
      }
    }

    const status = (c: Card) => (
      <Box flexDirection="row" gap={1}>
        {c.isRunning && <Text color="claude">●</Text>}
        {c.isPinned && <Text>📌</Text>}
        {c.hasRemote && <Text>📡</Text>}
        {c.prNumber !== undefined && (
          <Text color={prColor(c.prState)}>
            ⑂ {c.prUrl ? <Link href={c.prUrl}>{`#${c.prNumber}`}</Link> : `#${c.prNumber}`}
            {c.prState ? ` ${c.prState.toLowerCase()}` : ''}
          </Text>
        )}
      </Box>
    )

    const card = (c: Card, col: ColumnId) => {
      const i = colIndex(col)
      const prev = COLS[i - 1]
      const nxt = COLS[i + 1]
      return (
        <Box key={`card:${c.id}`} flexDirection="column" backgroundColor={CARD_BG} paddingX={1}>
          <Text bold={c.isSelf} wrap="truncate-end">
            {c.link ? <Link href={c.link}>{c.title}</Link> : c.title}
            {c.isSelf ? <Text dimColor> (this)</Text> : ''}
          </Text>
          {status(c)}
          <Box flexDirection="row" gap={1}>
            {prev && (
              <Button key={`prev:${c.id}`} plain dimColor label={`◀ ${prev.label}`} onPress={() => void move($, c.id, prev.id)} />
            )}
            {nxt && (
              <Button key={`next:${c.id}`} plain dimColor label={`${nxt.label} ▶`} onPress={() => void move($, c.id, nxt.id)} />
            )}
            {!c.isSelf && c.prState?.toUpperCase() === 'MERGED' && (
              <Button key={`clean:${c.id}`} plain label="Archive" onPress={() => void cleanUp($, c.id)} />
            )}
          </Box>
        </Box>
      )
    }

    const column = (col: (typeof COLS)[number]) => {
      const inCol = list.filter(c => (map[c.id] ?? DEFAULT_COLUMN) === col.id)
      return (
        <Box key={`colbox:${col.id}`} flexDirection="column" gap={1} flexGrow={wide ? 1 : 0} flexShrink={1} width={wide ? '25%' : undefined} marginBottom={wide ? 0 : 1}>
          <Text bold>
            {col.label} <Text dimColor>{inCol.length}</Text>
          </Text>
          {inCol.length === 0 ? <Text dimColor>—</Text> : inCol.map(c => card(c, col.id))}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" marginBottom={1}>
          {/* Left: the counts, then New session. Right: Board | List and the toggles. */}
          <Box flexDirection="row" alignItems="center" gap={2}>
          <Text dimColor>
            {all.length} sessions
            {all.some(c => c.isRunning) ? ' · ' : ''}
            {all.some(c => c.isRunning) ? (
              <Text color="claude">{`${all.filter(c => c.isRunning).length} running`}</Text>
            ) : ''}
            {all.some(c => c.prState?.toUpperCase() === 'OPEN') ? ` · ${all.filter(c => c.prState?.toUpperCase() === 'OPEN').length} open PRs` : ''}
            {q.trim() !== '' || picks.length > 0 ? ` · ${list.length} shown` : ''}
          </Text>
          {needsRestart && (
            <Text color="warning">{`v${ver.installed} installed · restart to update`}</Text>
          )}
          {canUpdate && (
            <Box key="btn:update" borderStyle="single" borderColor="warning" paddingX={1}>
              <Button key="install-update" plain label={`Update to v${ver.source}`} onPress={() => void installUpdate($)} />
            </Box>
          )}
          {Input && (
            <Box key="btn:new" borderStyle="single" borderDimColor paddingX={1}>
              <Button key="new-session" plain label="New session" onPress={() => void update($, creating, () => !makingNew)} />
            </Box>
          )}
          </Box>
          <Box flexDirection="row" alignItems="center" gap={1}>
            {viewTabs}
            {headerButton('sidebar', hidden ? 'Show sidebar' : 'Hide sidebar', () => void setSidebar($, !hidden))}
            {headerButton('mode', theme === 'light' ? '☾ Dark' : '☀ Light', () => void setMode($, theme === 'light' ? 'dark' : 'light'))}
          </Box>
        </Box>
        {Input && Select && makingNew && projects.length > 0 && (
          <Box key="new" flexDirection="row" alignItems="center" gap={1} marginBottom={1}>
            <Select
              key="new-project"
              label="In"
              value={project}
              options={projects.map(p => ({ value: p, label: p.split('/').filter(Boolean).pop() ?? p }))}
              onSelect={v => void update($, newProject, () => v)}
            />
            <Box flexGrow={1}>
              <Input
                key="new-task"
                placeholder="What should the new session work on?"
                submitLabel="start"
                autoFocus
                onSubmit={v => void startNew($, v, project)}
              />
            </Box>
            <Box key="btn:new-cancel" borderStyle="single" borderDimColor paddingX={1}>
              <Button key="new-cancel" plain label="Cancel" onPress={() => void update($, creating, () => false)} />
            </Box>
          </Box>
        )}
        {Input && (
          <Box key="search" flexDirection="row" alignItems="center" gap={1} marginBottom={1}>
            <Box width={56} flexShrink={1}>
              <Input
                key="search-input"
                placeholder="Search title, project, branch or #PR"
                value={q}
                submitLabel="search"
                onInput={v => void update($, query, () => v)}
                onSubmit={v => void update($, query, () => v)}
              />
            </Box>
            {groups.length > 1 && Select && <Box key="filter-gap" flexGrow={1} />}
            {groups.length > 1 && Select && (
              <Select
                key="project-filter"
                label="Project"
                value={picks[0] ?? ALL_PROJECTS}
                options={[
                  { value: ALL_PROJECTS, label: `All projects (${all.length})` },
                  ...groups.map(([g, n]) => ({ value: g, label: `${g} (${n})` })),
                ]}
                onSelect={v => void update($, projectFilter, () => (v === ALL_PROJECTS ? [] : [v]))}
              />
            )}
            {groups.length > 1 && !Select && (
              <Box key="chips" flexDirection="row" flexWrap="wrap" alignItems="center" gap={1} flexShrink={1}>
                {chip('all', `All ${all.length}`, picks.length === 0, () => void update($, projectFilter, () => []))}
                {groups.map(([g, n]) => chip(g, `${g} ${n}`, picks.includes(g), () => togglePick(g)))}
              </Box>
            )}
          </Box>
        )}
        {Input && editing !== '' && (
          <Box key="rename" flexDirection="row" alignItems="center" gap={1} marginBottom={1}>
            <Text dimColor>Rename “{labelOf(editing as ColumnId, names)}”</Text>
            <Box flexGrow={1}>
              <Input
                key={`rename-input:${editing}`}
                value={labelOf(editing as ColumnId, names)}
                submitLabel="rename"
                autoFocus
                onSubmit={v => void setLabel($, editing, v)}
              />
            </Box>
            <Box key="btn:reset" borderStyle="single" borderDimColor paddingX={1}>
              <Button key="rename-reset" plain label="Reset" onPress={() => void setLabel($, editing, '')} />
            </Box>
            <Box key="btn:cancel" borderStyle="single" borderDimColor paddingX={1}>
              <Button key="rename-cancel" plain label="Cancel" onPress={() => void update($, renaming, () => '')} />
            </Box>
          </Box>
        )}
        {why !== '' && <Text dimColor>{why}</Text>}
        {useButtons || !Client ? (
          <Box flexDirection={wide ? 'row' : 'column'} gap={1}>
            {COLS.map(column)}
          </Box>
        ) : (
          <Client
            key="board"
            module="./board.tsx"
            width="100%"
            props={{ cards: list, cols: COLS, map, mode: theme, view: layout } satisfies BoardProps}
          />
        )}
      </Box>
    )
  })
}
