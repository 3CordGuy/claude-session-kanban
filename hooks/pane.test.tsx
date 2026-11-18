import { expect, test } from 'claude-code/testing'

// Draws the pane the way the app does and checks the tree is accepted, with
// one running session so the header's running count is drawn too.
const PANE = {
  plugin: 'session-kanban',
  component: 'Pane',
  requestId: 'session-kanban',
  props: {
    title: 'Kanban',
    isFocused: false,
    bodyColumns: 120,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const SESSIONS = [
  { sessionId: 'local_a', title: 'Running one', isRunning: true, cwd: '/x/repo', branch: 'b', lastActivityAt: '2026-01-01T00:00:00Z' },
  { sessionId: 'local_b', title: 'Merged one', isRunning: false, prNumber: 7, prState: 'MERGED', cwd: '/x/repo', branch: 'c', lastActivityAt: '2026-01-01T00:00:00Z' },
]

test('the pane draws, with the running count in the header (2: this one and local_a)', async ($, on) => {
  const files = new Map<string, string>()
  on('command.register', () => ({ value: { command: 'kanban' } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.info', () => ({ value: { transcriptPath: '/home/.claude/projects/p/t.jsonl', configRoot: '/home/.claude' } }))
  on('session.id', () => ({ value: 'sess-me' }))
  on('mcp.call', (_, e) => {
    const tool = (e as { tool?: string }).tool
    const body =
      tool === 'list_sessions'
        ? SESSIONS
        : tool === 'get_session'
          ? { sessionId: 'local_self', title: 'This one', link: 'claude://x' }
          : {}
    return { value: { content: [{ type: 'text', text: JSON.stringify(body) }], isError: false } }
  })
  on('fs.read', (_, e) => {
    const text = files.get((e as { path: string }).path)
    if (text === undefined) throw new Error('missing')
    return { value: text }
  })
  on('fs.exists', (_, e) => ({ value: files.has((e as { path: string }).path) }))
  on('fs.write', (_, e) => {
    const w = e as { path: string; text: string }
    files.set(w.path, w.text)
    return { value: undefined }
  })
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  const store = new Map<string, unknown>()
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.get', (_, e) => ({ value: store.get((e as { key: string }).key) }))
  on('store.set', (_, e) => {
    const w = e as { key: string; value: unknown }
    store.set(w.key, w.value)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('env.get', (_, e) => ({ value: (e as { name: string }).name === 'HOME' ? '/home' : undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.now', () => ({ value: Date.parse('2026-01-02T00:00:00Z') }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // Let the first session-list refresh (started, not awaited) finish.
  await $.command.run({ command: 'kanban', args: '' } as Parameters<typeof $.command.run>[0])

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const running = await ui.find({ type: 'Text', text: /2 running/ })
  expect(running?.text).toContain('2 running')
  await ui.unmount()
})

test('a session that starts later shows cards where the shared file put them', async ($, on) => {
  const BOARD = '/home/.claude/session-kanban/board.json'
  const files = new Map<string, string>([
    [BOARD, JSON.stringify({ columns: { local_a: 'in-progress', local_b: 'done' }, view: 'board', mode: 'dark' })],
  ])
  const store = new Map<string, unknown>()
  on('command.register', () => ({ value: { command: 'kanban' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  // As desktop sessions report it: no config root, so the path comes from HOME.
  on('session.info', () => ({ value: { transcriptPath: 't.jsonl' } }))
  on('session.id', () => ({ value: 'sess-me' }))
  on('mcp.call', (_, e) => {
    const tool = (e as { tool?: string }).tool
    const body =
      tool === 'list_sessions' ? SESSIONS : tool === 'get_session' ? { sessionId: 'local_self', title: 'This one', link: 'claude://x' } : {}
    return { value: { content: [{ type: 'text', text: JSON.stringify(body) }], isError: false } }
  })
  on('fs.read', (_, e) => {
    const text = files.get((e as { path: string }).path)
    if (text === undefined) throw new Error('missing')
    return { value: text }
  })
  on('fs.exists', (_, e) => ({ value: files.has((e as { path: string }).path) }))
  on('fs.write', (_, e) => {
    const w = e as { path: string; text: string }
    files.set(w.path, w.text)
    return { value: undefined }
  })
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.get', (_, e) => ({ value: store.get((e as { key: string }).key) }))
  on('store.set', (_, e) => {
    const w = e as { key: string; value: unknown }
    store.set(w.key, w.value)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('env.get', (_, e) => ({ value: (e as { name: string }).name === 'HOME' ? '/home' : undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.now', () => ({ value: Date.parse('2026-01-02T00:00:00Z') }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'kanban', args: '' } as Parameters<typeof $.command.run>[0])

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // The board draws columns left to right: each card's title follows its column's.
  const texts = (await ui.findAll({ type: 'Text', in: 'board' })).map(t => t.text ?? '')
  const at = (re: RegExp) => texts.findIndex(t => re.test(t))
  expect(at(/Running one/)).toBeGreaterThan(at(/^In Progress/))
  expect(at(/Running one/)).toBeLessThan(at(/^Testing\/Review/))
  expect(at(/Merged one/)).toBeGreaterThan(at(/^Done\/Cleanup/))
  // Every write went to the shared files, never into a project folder.
  const PREFS = '/home/.claude/session-kanban/prefs.json'
  expect([...files.keys()].sort()).toEqual([BOARD, '/home/.claude/session-kanban/live.json', PREFS])
  // The settings were carried over into prefs.json.
  expect(JSON.parse(files.get(PREFS)!)).toEqual({ view: 'board', mode: 'dark' })

  // Switching to List writes prefs.json only, so the 30-second board.json
  // rewrites in other sessions can't undo it.
  await ui.press({ key: 'view-list' })
  expect(JSON.parse(files.get(PREFS)!).view).toBe('list')
  expect(JSON.parse(files.get(BOARD)!).view).toBe('board')

  await ui.unmount()
})

test('only the live session writes the board; drawing it makes this one live', async ($, on) => {
  const BOARD = '/home/.claude/session-kanban/board.json'
  const files = new Map<string, string>([
    [BOARD, JSON.stringify({ columns: { local_a: 'in-progress' } })],
    ['/home/.claude/session-kanban/prefs.json', JSON.stringify({ view: 'board' })],
    ['/home/.claude/session-kanban/live.json', JSON.stringify({ session: 'someone-else' })],
  ])
  const store = new Map<string, unknown>()
  on('command.register', () => ({ value: { command: 'kanban' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  // As desktop sessions report it: no config root, so the path comes from HOME.
  on('session.info', () => ({ value: { transcriptPath: 't.jsonl' } }))
  on('session.id', () => ({ value: 'sess-me' }))
  on('mcp.call', (_, e) => {
    const tool = (e as { tool?: string }).tool
    const body =
      tool === 'list_sessions' ? SESSIONS : tool === 'get_session' ? { sessionId: 'local_self', title: 'This one', link: 'claude://x' } : {}
    return { value: { content: [{ type: 'text', text: JSON.stringify(body) }], isError: false } }
  })
  on('fs.read', (_, e) => {
    const text = files.get((e as { path: string }).path)
    if (text === undefined) throw new Error('missing')
    return { value: text }
  })
  on('fs.exists', (_, e) => ({ value: files.has((e as { path: string }).path) }))
  on('fs.write', (_, e) => {
    const w = e as { path: string; text: string }
    files.set(w.path, w.text)
    return { value: undefined }
  })
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.get', (_, e) => ({ value: store.get((e as { key: string }).key) }))
  on('store.set', (_, e) => {
    const w = e as { key: string; value: unknown }
    store.set(w.key, w.value)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('env.get', (_, e) => ({ value: (e as { name: string }).name === 'HOME' ? '/home' : undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.now', () => ({ value: Date.parse('2026-01-02T00:00:00Z') }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'kanban', args: '' } as Parameters<typeof $.command.run>[0])
  // Another session is live: this one placed nothing and cached nothing.
  expect(JSON.parse(files.get(BOARD)!)).toEqual({ columns: { local_a: 'in-progress' } })

  // Drawing the board here claims it, and this session catches the board up.
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  for (let i = 0; i < 20 && !JSON.parse(files.get(BOARD)!).lastCards; i++) await new Promise(r => setTimeout(r, 25))
  expect(JSON.parse(files.get('/home/.claude/session-kanban/live.json')!).session).not.toBe('someone-else')
  const board = JSON.parse(files.get(BOARD)!)
  expect(board.lastCards.length).toBeGreaterThan(0)
  expect(board.columns.local_b).toBe('done')
  await ui.unmount()
})

test('a board.json caught mid-write is never written over with a fragment', async ($, on) => {
  const BOARD = '/home/.claude/session-kanban/board.json'
  const files = new Map<string, string>([
    [BOARD, '{"columns": {"local_a"'],
    ['/home/.claude/session-kanban/prefs.json', JSON.stringify({ view: 'list', mode: 'dark' })],
  ])
  const store = new Map<string, unknown>()
  on('command.register', () => ({ value: { command: 'kanban' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  // As desktop sessions report it: no config root, so the path comes from HOME.
  on('session.info', () => ({ value: { transcriptPath: 't.jsonl' } }))
  on('session.id', () => ({ value: 'sess-me' }))
  on('mcp.call', (_, e) => {
    const tool = (e as { tool?: string }).tool
    const body =
      tool === 'list_sessions' ? SESSIONS : tool === 'get_session' ? { sessionId: 'local_self', title: 'This one', link: 'claude://x' } : {}
    return { value: { content: [{ type: 'text', text: JSON.stringify(body) }], isError: false } }
  })
  on('fs.read', (_, e) => {
    const text = files.get((e as { path: string }).path)
    if (text === undefined) throw new Error('missing')
    return { value: text }
  })
  on('fs.exists', (_, e) => ({ value: files.has((e as { path: string }).path) }))
  on('fs.write', (_, e) => {
    const w = e as { path: string; text: string }
    files.set(w.path, w.text)
    return { value: undefined }
  })
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.get', (_, e) => ({ value: store.get((e as { key: string }).key) }))
  on('store.set', (_, e) => {
    const w = e as { key: string; value: unknown }
    store.set(w.key, w.value)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('env.get', (_, e) => ({ value: (e as { name: string }).name === 'HOME' ? '/home' : undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.now', () => ({ value: Date.parse('2026-01-02T00:00:00Z') }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'kanban', args: '' } as Parameters<typeof $.command.run>[0])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // Refreshes and the view toggle all ran with the file unreadable.
  await ui.press({ key: 'view-board' })
  expect(files.get(BOARD)).toBe('{"columns": {"local_a"')
  expect(JSON.parse(files.get('/home/.claude/session-kanban/prefs.json')!).view).toBe('board')
  await ui.unmount()
})

test("this session's card has a gold ring, the others a grey one", async ($, on) => {
  on('command.register', () => ({ value: { command: 'kanban' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.info', () => ({ value: { transcriptPath: 't.jsonl' } }))
  on('session.id', () => ({ value: 'sess-me' }))
  on('env.get', () => ({ value: '/home' }))
  on('mcp.call', (_, e) => {
    const tool = (e as { tool?: string }).tool
    const body =
      tool === 'list_sessions'
        ? [{ sessionId: 'local_other', title: 'Other one', isRunning: false }]
        : tool === 'get_session'
          ? { sessionId: 'local_self', title: 'This one' }
          : {}
    return { value: { content: [{ type: 'text', text: JSON.stringify(body) }], isError: false } }
  })
  const files = new Map<string, string>()
  on('fs.read', (_, e) => {
    const text = files.get((e as { path: string }).path)
    if (text === undefined) throw new Error('missing')
    return { value: text }
  })
  on('fs.exists', (_, e) => ({ value: files.has((e as { path: string }).path) }))
  on('fs.write', (_, e) => {
    const w = e as { path: string; text: string }
    files.set(w.path, w.text)
    return { value: undefined }
  })
  const store = new Map<string, unknown>()
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.get', (_, e) => ({ value: store.get((e as { key: string }).key) }))
  on('store.set', (_, e) => {
    const w = e as { key: string; value: unknown }
    store.set(w.key, w.value)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 0 }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'kanban', args: '' } as Parameters<typeof $.command.run>[0])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const card = await ui.find({ type: 'Box', key: 'card:local_self', in: 'board' })
  const props = (card as unknown as { props?: Record<string, unknown> })?.props ?? {}
  expect(props.borderStyle).toBe('round')
  expect(props.borderColor).toBe('#A06A00')
  // Every other card has a grey rounded edge.
  const other = await ui.find({ type: 'Box', key: 'card:local_other', in: 'board' })
  const otherProps = (other as unknown as { props?: Record<string, unknown> })?.props ?? {}
  expect(otherProps.borderStyle).toBe('round')
  expect(otherProps.borderColor).toBe('#D6D3CB')
  await ui.unmount()
})

test('list rows get the same rounded edges as board cards', async ($, on) => {
  const BOARD = '/home/.claude/session-kanban/board.json'
  const files = new Map<string, string>([[BOARD, JSON.stringify({ view: 'list' })]])
  on('command.register', () => ({ value: { command: 'kanban' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.info', () => ({ value: { transcriptPath: 't.jsonl' } }))
  on('session.id', () => ({ value: 'sess-me' }))
  on('env.get', () => ({ value: '/home' }))
  on('mcp.call', (_, e) => {
    const tool = (e as { tool?: string }).tool
    const body =
      tool === 'list_sessions'
        ? [{ sessionId: 'local_other', title: 'Other one', isRunning: false }]
        : tool === 'get_session'
          ? { sessionId: 'local_self', title: 'This one' }
          : {}
    return { value: { content: [{ type: 'text', text: JSON.stringify(body) }], isError: false } }
  })
  on('fs.read', (_, e) => {
    const text = files.get((e as { path: string }).path)
    if (text === undefined) throw new Error('missing')
    return { value: text }
  })
  on('fs.exists', (_, e) => ({ value: files.has((e as { path: string }).path) }))
  on('fs.write', (_, e) => {
    const w = e as { path: string; text: string }
    files.set(w.path, w.text)
    return { value: undefined }
  })
  const store = new Map<string, unknown>()
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.get', (_, e) => ({ value: store.get((e as { key: string }).key) }))
  on('store.set', (_, e) => {
    const w = e as { key: string; value: unknown }
    store.set(w.key, w.value)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 0 }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'kanban', args: '' } as Parameters<typeof $.command.run>[0])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const propsOf = async (key: string) =>
    ((await ui.find({ type: 'Box', key, in: 'board' })) as unknown as { props?: Record<string, unknown> })?.props ?? {}
  const self = await propsOf('row:local_self')
  expect(self.borderStyle).toBe('round')
  expect(self.borderColor).toBe('#A06A00')
  const other = await propsOf('row:local_other')
  expect(other.borderStyle).toBe('round')
  expect(other.borderColor).toBe('#D6D3CB')
  await ui.unmount()
})

test('New session starts a session in the picked project with the typed task', async ($, on) => {
  const started: Record<string, unknown>[] = []
  on('command.register', () => ({ value: { command: 'kanban' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.info', () => ({ value: { transcriptPath: 't.jsonl' } }))
  on('session.id', () => ({ value: 'sess-me' }))
  on('env.get', () => ({ value: '/home' }))
  on('mcp.call', (_, e) => {
    const call = e as { server?: string; tool?: string; args?: Record<string, unknown> }
    if (call.tool === 'start_session') {
      started.push(call.args ?? {})
      return { value: { content: [{ type: 'text', text: 'Started local_12345678-aaaa (fresh)' }], isError: false } }
    }
    const body =
      call.tool === 'list_sessions'
        ? [
            { sessionId: 'local_a', title: 'A', cwd: '/w/app/.claude/worktrees/x', lastActivityAt: '2026-01-02T00:00:00Z' },
            { sessionId: 'local_b', title: 'B', cwd: '/w/site', lastActivityAt: '2026-01-01T00:00:00Z' },
          ]
        : call.tool === 'get_session'
          ? { sessionId: 'local_self', title: 'This one' }
          : {}
    return { value: { content: [{ type: 'text', text: JSON.stringify(body) }], isError: false } }
  })
  const files = new Map<string, string>()
  on('fs.read', (_, e) => {
    const text = files.get((e as { path: string }).path)
    if (text === undefined) throw new Error('missing')
    return { value: text }
  })
  on('fs.exists', (_, e) => ({ value: files.has((e as { path: string }).path) }))
  on('fs.write', (_, e) => {
    const w = e as { path: string; text: string }
    files.set(w.path, w.text)
    return { value: undefined }
  })
  const store = new Map<string, unknown>()
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.get', (_, e) => ({ value: store.get((e as { key: string }).key) }))
  on('store.set', (_, e) => {
    const w = e as { key: string; value: unknown }
    store.set(w.key, w.value)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 0 }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'kanban', args: '' } as Parameters<typeof $.command.run>[0])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // No Clear button any more.
  expect(await ui.find({ type: 'Button', key: 'clear-search' })).toBeUndefined()
  await ui.press({ key: 'new-session' })
  await ui.select({ key: 'new-project', value: '/w/site' })
  await ui.input({ key: 'new-task', text: 'Fix the footer links' })
  expect(started.length).toBe(1)
  expect(started[0]?.cwd).toBe('/w/site')
  expect(started[0]?.prompt).toBe('Fix the footer links')
  expect(started[0]?.initiation).toBe('user_asked')
  await ui.unmount()
})

test('the project dropdown filters the board to the picked project', async ($, on) => {
  on('command.register', () => ({ value: { command: 'kanban' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.info', () => ({ value: { transcriptPath: 't.jsonl' } }))
  on('session.id', () => ({ value: 'sess-me' }))
  on('env.get', () => ({ value: '/home' }))
  on('mcp.call', (_, e) => {
    const tool = (e as { tool?: string }).tool
    const body =
      tool === 'list_sessions'
        ? [
            { sessionId: 'local_a', title: 'App work', cwd: '/w/app/.claude/worktrees/x' },
            { sessionId: 'local_b', title: 'Site work', cwd: '/w/site' },
          ]
        : tool === 'get_session'
          ? { sessionId: 'local_self', title: 'This one', cwd: '/w/app' }
          : {}
    return { value: { content: [{ type: 'text', text: JSON.stringify(body) }], isError: false } }
  })
  const files = new Map<string, string>()
  on('fs.read', (_, e) => {
    const text = files.get((e as { path: string }).path)
    if (text === undefined) throw new Error('missing')
    return { value: text }
  })
  on('fs.exists', (_, e) => ({ value: files.has((e as { path: string }).path) }))
  on('fs.write', (_, e) => {
    const w = e as { path: string; text: string }
    files.set(w.path, w.text)
    return { value: undefined }
  })
  const store = new Map<string, unknown>()
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.get', (_, e) => ({ value: store.get((e as { key: string }).key) }))
  on('store.set', (_, e) => {
    const w = e as { key: string; value: unknown }
    store.set(w.key, w.value)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 0 }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'kanban', args: '' } as Parameters<typeof $.command.run>[0])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const shown = async () => (await ui.findAll({ type: 'Text', in: 'board' })).map(t => t.text ?? '').join(' | ')
  expect(await shown()).toContain('Site work')
  await ui.select({ key: 'project-filter', value: 'app' })
  expect(await shown()).toContain('App work')
  expect(await shown()).not.toContain('Site work')
  await ui.select({ key: 'project-filter', value: '__all__' })
  expect(await shown()).toContain('Site work')
  await ui.unmount()
})

test('the header says when a newer version is installed or available', async ($, on) => {
  const json = (v: unknown) => JSON.stringify(v)
  let installed = '0.6.0'
  const read = (path: string): string | undefined => {
    if (path === '/src/.claude-plugin/plugin.json') return json({ version: '0.7.0' })
    if (path.endsWith('/.claude-plugin/plugin.json')) return json({ version: '0.5.0' }) // the running copy
    if (path === '/home/.claude/plugins/installed_plugins.json')
      return json({ plugins: { 'session-kanban@session-kanban': [{ version: installed }] } })
    if (path === '/home/.claude/plugins/known_marketplaces.json')
      return json({ 'session-kanban': { source: { source: 'directory', path: '/src' } } })
    return undefined
  }
  on('command.register', () => ({ value: { command: 'kanban' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.info', () => ({ value: { transcriptPath: 't.jsonl' } }))
  on('session.id', () => ({ value: 'sess-me' }))
  on('env.get', () => ({ value: '/home' }))
  on('mcp.call', (_, e) => {
    const tool = (e as { tool?: string }).tool
    const body = tool === 'list_sessions' ? [] : tool === 'get_session' ? { sessionId: 'local_self', title: 'This one' } : {}
    return { value: { content: [{ type: 'text', text: JSON.stringify(body) }], isError: false } }
  })
  on('fs.read', (_, e) => {
    const text = read((e as { path: string }).path)
    if (text === undefined) throw new Error('missing')
    return { value: text }
  })
  on('fs.exists', () => ({ value: false }))
  on('fs.write', () => ({ value: undefined }))
  const store = new Map<string, unknown>()
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.get', (_, e) => ({ value: store.get((e as { key: string }).key) }))
  on('store.set', (_, e) => {
    const w = e as { key: string; value: unknown }
    store.set(w.key, w.value)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 0 }))
  on('process.run', () => {
    installed = '0.7.0'
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'kanban', args: '' } as Parameters<typeof $.command.run>[0])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // Running 0.5.0 with 0.6.0 installed: restart to get it.
  expect((await ui.find({ type: 'Text', text: /restart to update/ }))?.text).toBe('v0.6.0 installed · restart to update')
  await ui.unmount()
})

test('an install from GitHub checks the repo for a newer version', async ($, on) => {
  const json = (v: unknown) => JSON.stringify(v)
  const read = (path: string): string | undefined => {
    if (path.endsWith('/.claude-plugin/plugin.json')) return json({ version: '0.6.0' })
    if (path === '/home/.claude/plugins/installed_plugins.json')
      return json({ plugins: { 'session-kanban@kanban-gh': [{ version: '0.6.0' }] } })
    if (path === '/home/.claude/plugins/known_marketplaces.json')
      return json({ 'kanban-gh': { source: { source: 'github', repo: 'someone/session-kanban' } } })
    return undefined
  }
  const fetched: string[] = []
  on('http.fetch', (_, e) => {
    fetched.push((e as { url: string }).url)
    return { value: { status: 200, ok: true, headers: {}, text: json({ version: '0.7.0' }) } }
  })
  on('command.register', () => ({ value: { command: 'kanban' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.info', () => ({ value: { transcriptPath: 't.jsonl' } }))
  on('session.id', () => ({ value: 'sess-me' }))
  on('env.get', () => ({ value: '/home' }))
  on('mcp.call', (_, e) => {
    const tool = (e as { tool?: string }).tool
    const body = tool === 'list_sessions' ? [] : tool === 'get_session' ? { sessionId: 'local_self', title: 'This one' } : {}
    return { value: { content: [{ type: 'text', text: JSON.stringify(body) }], isError: false } }
  })
  on('fs.read', (_, e) => {
    const text = read((e as { path: string }).path)
    if (text === undefined) throw new Error('missing')
    return { value: text }
  })
  on('fs.exists', () => ({ value: false }))
  on('fs.write', () => ({ value: undefined }))
  const store = new Map<string, unknown>()
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.get', (_, e) => ({ value: store.get((e as { key: string }).key) }))
  on('store.set', (_, e) => {
    const w = e as { key: string; value: unknown }
    store.set(w.key, w.value)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 0 }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'kanban', args: '' } as Parameters<typeof $.command.run>[0])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(fetched).toEqual(['https://raw.githubusercontent.com/someone/session-kanban/HEAD/.claude-plugin/plugin.json'])
  expect(await ui.find({ type: 'Button', key: 'install-update' })).toBeDefined()
  await ui.unmount()
})
