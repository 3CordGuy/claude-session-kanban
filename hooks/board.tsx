import type { ClientModule, ClientPointerEvent } from 'claude-code'

import type { Card, ColumnId, Mode, View } from '../types'

// Drawn on the surface, in cells. The board lays itself out on a fixed grid
// so a pointer position maps straight to a column and a card.
export type BoardProps = {
  cards: Card[]
  cols: { id: ColumnId; label: string }[]
  map: Record<string, ColumnId>
  mode: Mode
  view: View
}

type Drag = { id: string; from: ColumnId; x: number; y: number; ox: number; oy: number; moved: boolean }
type State = { drag?: Drag; sel?: string }

// A cell grid takes opaque colors only, so each mode has its own palette.
// Text is set per palette too, so it reads whatever the app's own mode is.
const PALETTE: Record<Mode, { panel: string; card: string; ghost: string; text: string; dim: string; rule: string; gold: string; edge: string }> = {
  light: { panel: '#F1F0EC', card: '#FFFFFF', ghost: '#FBF3EE', text: '#1F1E1D', dim: '#8A8780', rule: '#E4E2DC', gold: '#A06A00', edge: '#D6D3CB' },
  dark: { panel: '#232227', card: '#32313A', ghost: '#3D3A44', text: '#F2F1EE', dim: '#A9A7B0', rule: '#46444D', gold: '#E8B931', edge: '#4B4954' },
}

// Vertical grid: panel padding, header, gap, then cards of CARD_H rows each
// followed by a one-row gap.
const PAD = 1
const HEADER = PAD + 1 + 1
const CARD_PAD_Y = 1 // the app draws a ring as a hairline that takes no cells
const CARD_H = 3 + CARD_PAD_Y * 2 // padding, project line, title, status line, padding
const STRIDE = CARD_H + 1
const COL_GAP = 1
// List view: sections stacked top to bottom, one row per session, a one-row
// gap between sections. Section = padding, header, gap, rows, padding.
const LIST_ROWS_AT = PAD + 1 + 1
const SECTION_GAP = 1
// Each list row: one line of text with ROW_PAD_Y blank lines above and below,
// rows ROW_GAP apart.
const ROW_PAD_Y = 1
const ROW_H = 1 + ROW_PAD_Y * 2
const ROW_GAP = 1
const ROW_STRIDE = ROW_H + ROW_GAP
// Fixed widths for the list's right-hand columns, so they line up down the page.
const ICONS_W = 5
const BADGE_W = 8
// The Archive button: on merged sessions (not this one), right-aligned on
// the card's status line, or in its own fixed column in the list.
const CLEAN_LABEL = ' Archive '
const CLEAN_W = CLEAN_LABEL.length
const canClean = (c: Card) => !c.isSelf && (c.prState ?? '').toUpperCase() === 'MERGED'
// The unread dot at a card's top right (a fixed column at a list row's end).
const DOT_W = 2 // ● draws wider than one cell in the app's font
const rowsHeight = (n: number) => (n === 0 ? 1 : n * ROW_STRIDE - ROW_GAP)

// The sidebar's unread blue.
const UNREAD = '#3B82F6'

const prBadge = (state?: string): string => {
  switch ((state ?? '').toUpperCase()) {
    case 'OPEN': return 'success'
    case 'MERGED': return 'merged'
    case 'CLOSED': return 'error'
    default: return 'inactive'
  }
}

const Board: ClientModule<BoardProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const st: State = surface.state ?? {}
  const pal = PALETTE[props.mode] ?? PALETTE.light
  const cols = props.cols
  const colW = Math.max(12, Math.floor((surface.columns || 80) / cols.length))
  const innerW = colW - COL_GAP - PAD * 2
  const first = cols[0]?.id ?? 'brainstorming'
  const colOf = (c: Card): ColumnId => props.map[c.id] ?? first
  const inCol = (id: ColumnId) => props.cards.filter(c => colOf(c) === id)
  const colIdxAt = (x: number) => Math.min(cols.length - 1, Math.max(0, Math.floor(x / colW)))
  const colAt = (x: number): ColumnId => cols[colIdxAt(x)]?.id ?? first

  const isList = props.view === 'list'
  const fullW = Math.max(20, surface.columns || 80)
  const sections = (() => {
    let y = 0
    return cols.map(col => {
      const n = inCol(col.id).length
      const h = LIST_ROWS_AT + rowsHeight(n) + PAD
      const sec = { col: col.id, y, h, n }
      y += h + SECTION_GAP
      return sec
    })
  })()
  const sectionAt = (y: number) =>
    sections.find(sec => y < sec.y + sec.h + SECTION_GAP) ?? sections[sections.length - 1]
  const dropAt = (x: number, y: number): ColumnId => (isList ? (sectionAt(y)?.col ?? first) : colAt(x))

  const hitList = (x: number, y: number): { card: Card; ox: number; oy: number } | undefined => {
    const sec = sectionAt(y)
    if (!sec) return undefined
    const rel = y - (sec.y + LIST_ROWS_AT)
    if (rel < 0 || rel % ROW_STRIDE >= ROW_H) return undefined
    const card = inCol(sec.col)[Math.floor(rel / ROW_STRIDE)]
    return card ? { card, ox: x - PAD, oy: rel % ROW_STRIDE } : undefined
  }

  // The PR badge sits right-aligned on a card's second line (the line under
  // the top padding or ring), inset by the card's side padding.
  // A ring marks this session (gold, as its "This session" label) or an
  // unread one (blue, as the sidebar's dot).
  const ringColor = (c: Card): string | undefined => (c.isSelf ? pal.gold : c.isUnread ? UNREAD : undefined)

  const onBadge = (c: Card, ox: number, oy: number): boolean => {
    if (c.prNumber === undefined || !c.prUrl || oy !== 1) return false
    const w = isList ? fullW - PAD * 2 : innerW
    const inset = (isList ? 1 : 2) + (isList || c.isUnread ? DOT_W + 1 : 0)
    const bw = `#${c.prNumber}`.length + 2
    return ox >= w - inset - bw && ox < w - inset
  }

  const onClean = (c: Card, ox: number, oy: number): boolean => {
    if (!canClean(c)) return false
    if (isList) {
      const right = fullW - PAD * 2 - 1 - DOT_W - 1 - BADGE_W - 1
      return oy === 1 && ox >= right - CLEAN_W && ox < right
    }
    return oy === 1 + 2 && ox >= innerW - 2 - CLEAN_W && ox < innerW - 2
  }

  const headerAt = (x: number, y: number): ColumnId | undefined => {
    if (isList) {
      const sec = sectionAt(y)
      return sec && y === sec.y + PAD ? sec.col : undefined
    }
    return y === PAD ? colAt(x) : undefined
  }

  const hit = (x: number, y: number): { card: Card; ox: number; oy: number } | undefined => {
    if (isList) return hitList(x, y)
    const rel = y - HEADER
    if (rel < 0 || rel % STRIDE >= CARD_H) return undefined
    const card = inCol(colAt(x))[Math.floor(rel / STRIDE)]
    if (!card) return undefined
    return { card, ox: x - colIdxAt(x) * colW - PAD, oy: rel % STRIDE }
  }

  // Re-set on every draw (a later call replaces the earlier listener), so the
  // hit test always reads this draw's props.
  surface.onPointer((e: ClientPointerEvent) => {
    const s: State = surface.state ?? {}
    if (e.type === 'down' && e.button === 'left') {
      const h = hit(e.x, e.y)
      if (!h) {
        // A click on a column (or section) title renames it.
        const col = headerAt(e.x, e.y)
        if (col) surface.post({ type: 'rename', col })
        return
      }
      surface.setState({ ...s, sel: h.card.id, drag: { id: h.card.id, from: colOf(h.card), x: e.x, y: e.y, ox: h.ox, oy: h.oy, moved: false } })
    } else if (e.type === 'move' && s.drag) {
      const moved = s.drag.moved || Math.abs(e.x - s.drag.x) + Math.abs(e.y - s.drag.y) > 0
      surface.setState({ ...s, drag: { ...s.drag, x: e.x, y: e.y, moved } })
    } else if (e.type === 'up' && s.drag) {
      const d = s.drag
      surface.setState({ ...s, drag: undefined })
      if (!d.moved) {
        const card = props.cards.find(c => c.id === d.id)
        const type = !card ? 'open' : onClean(card, d.ox, d.oy) ? 'cleanup' : onBadge(card, d.ox, d.oy) ? 'pr' : 'open'
        surface.post({ type, id: d.id })
      }
      else {
        const to = dropAt(e.x, e.y)
        if (to !== d.from) surface.post({ type: 'move', id: d.id, to })
      }
    }
  })
  surface.onKey(k => {
    const s: State = surface.state ?? {}
    const all = cols.flatMap(c => inCol(c.id))
    const cur = all.find(c => c.id === s.sel) ?? all[0]
    if (!cur) return
    const col = colOf(cur)
    const list = inCol(col)
    const i = list.findIndex(c => c.id === cur.id)
    const ci = cols.findIndex(c => c.id === col)
    const up = list[i - 1]
    const down = list[i + 1]
    const left = cols[ci - 1]
    const right = cols[ci + 1]
    if (k.key === 'up' && up) surface.setState({ ...s, sel: up.id })
    else if (k.key === 'down' && down) surface.setState({ ...s, sel: down.id })
    else if (k.key === 'left' && left) surface.post({ type: 'move', id: cur.id, to: left.id })
    else if (k.key === 'right' && right) surface.post({ type: 'move', id: cur.id, to: right.id })
    else if (k.key === 'return') surface.post({ type: 'open', id: cur.id })
    else if (!s.sel) surface.setState({ ...s, sel: cur.id })
  })

  const drag = st.drag?.moved ? st.drag : undefined
  const target = drag ? dropAt(drag.x, drag.y) : undefined
  const dragged = drag ? props.cards.find(c => c.id === drag.id) : undefined

  // A pill: half-circle caps in the badge color around the filled number.
  const badge = (c: Card) => {
    const color = prBadge(c.prState)
    return (
      <Text size="caption" wrap="clip">
        <Text color={color}>◖</Text>
        <Text backgroundColor={color} color="inverseText">{`#${c.prNumber}`}</Text>
        <Text color={color}>◗</Text>
      </Text>
    )
  }

  const cardView = (c: Card, ghost = false) => {
    const isSel = st.sel === c.id && !ghost
    const isLifted = !ghost && drag?.id === c.id
    return (
      <Box
        key={`${ghost ? 'ghost' : 'card'}:${c.id}`}
        flexDirection="column"
        width={innerW}
        height={CARD_H}
        paddingX={2}
        paddingY={CARD_PAD_Y}
        borderStyle="round"
        borderColor={ringColor(c) ?? pal.edge}
        backgroundColor={ghost ? pal.ghost : pal.card}
      >
        {/* Every row is pinned to one line: whatever doesn't fit is cut,
            never wrapped, so a narrow column can't push the card taller. */}
        <Box flexDirection="row" height={1} overflow="hidden" gap={1}>
          <Box flexGrow={1} flexShrink={1} height={1} overflow="hidden">
            <Text color={pal.dim} size="caption" wrap="truncate-end">
              {c.group ?? ' '}
            </Text>
          </Box>
          {c.prNumber !== undefined && (
            <Box flexShrink={0} height={1}>
              {badge(c)}
            </Box>
          )}
          {c.isUnread && (
            <Box flexShrink={0} width={DOT_W} height={1}>
              <Text color={UNREAD}>●</Text>
            </Box>
          )}
        </Box>
        <Box height={1} overflow="hidden">
          <Text bold={isSel || c.isSelf} color={isLifted ? pal.dim : pal.text} wrap="truncate-end">
            {`${isSel ? '› ' : ''}${c.title}`}
          </Text>
        </Box>
        <Box flexDirection="row" height={1} overflow="hidden" gap={1}>
          {c.isRunning && (
            <Box flexShrink={0} height={1}>
              <Text color="claude" wrap="clip">● Running</Text>
            </Box>
          )}
          {c.isSelf && (
            <Box flexShrink={0} height={1}>
              <Text color={pal.gold} bold wrap="clip">This session</Text>
            </Box>
          )}
          <Box flexGrow={1} flexShrink={1} height={1} overflow="hidden">
            <Text color={pal.dim} wrap="truncate-end">
              {[
                c.isPinned ? '📌' : '',
                c.hasRemote ? '📡' : '',
                c.prState ? c.prState.toLowerCase() : '',
                c.branch ? `⎇ ${c.branch}` : '',
              ]
                .filter(Boolean)
                .join('  ') || ' '}
            </Text>
          </Box>
          {canClean(c) && !ghost && (
            <Box flexShrink={0} height={1}>
              <Text backgroundColor={pal.rule} color={pal.text} wrap="clip">{CLEAN_LABEL}</Text>
            </Box>
          )}
        </Box>
      </Box>
    )
  }

  const rowW = fullW - PAD * 2
  const projectW = Math.max(10, Math.min(26, Math.floor(rowW * 0.22)))
  // A row: a padding line, the text line and a padding line, inside the same
  // rounded edge as a board card (gold for this session, blue when unread,
  // grey otherwise), rows a line apart.
  const rowView = (c: Card, ghost = false) => {
    const isSel = st.sel === c.id && !ghost
    const isLifted = !ghost && drag?.id === c.id
    return (
      <Box
        key={`${ghost ? 'lghost' : 'row'}:${c.id}`}
        flexDirection="column"
        width={rowW}
        height={ROW_H}
        overflow="hidden"
        paddingTop={ROW_PAD_Y}
        borderStyle="round"
        borderColor={ringColor(c) ?? pal.edge}
        backgroundColor={ghost ? pal.ghost : pal.card}
      >
      <Box flexDirection="row" height={1} overflow="hidden" paddingX={1} gap={1}>
        {/* Fixed-width cells: status dot, title (takes the rest), icons,
            project, PR badge. */}
        <Box flexShrink={0} width={1} height={1}>
          <Text color="claude">{c.isRunning ? '●' : ' '}</Text>
        </Box>
        <Box flexGrow={1} flexShrink={1} height={1} overflow="hidden">
          <Text bold={isSel || c.isSelf} color={isLifted ? pal.dim : pal.text} wrap="truncate-end">
            {`${isSel ? '› ' : ''}${c.title}`}
          </Text>
        </Box>
        {c.isSelf && (
          <Box flexShrink={0} height={1}>
            <Text color={pal.gold} bold wrap="clip">This session</Text>
          </Box>
        )}
        <Box flexShrink={0} width={ICONS_W} height={1} overflow="hidden" justifyContent="flex-end">
          <Text wrap="clip">{[c.isPinned ? '📌' : '', c.hasRemote ? '📡' : ''].filter(Boolean).join('') || ' '}</Text>
        </Box>
        <Box flexShrink={0} width={projectW} height={1} overflow="hidden">
          <Text color={pal.dim} size="caption" wrap="truncate-end">
            {c.group ?? ' '}
          </Text>
        </Box>
        <Box flexShrink={0} width={CLEAN_W} height={1} overflow="hidden">
          {canClean(c) && !ghost ? (
            <Text backgroundColor={pal.rule} color={pal.text} wrap="clip">{CLEAN_LABEL}</Text>
          ) : (
            <Text> </Text>
          )}
        </Box>
        <Box flexShrink={0} width={BADGE_W} height={1} overflow="hidden" justifyContent="flex-end">
          {c.prNumber !== undefined ? badge(c) : <Text> </Text>}
        </Box>
        <Box flexShrink={0} width={DOT_W} height={1}>
          <Text color={UNREAD}>{c.isUnread ? '●' : ' '}</Text>
        </Box>
      </Box>
      </Box>
    )
  }

  if (isList) {
    const last = sections[sections.length - 1]
    const listH = last ? last.y + last.h : 1
    return (
      <Box position="relative" flexDirection="column" width="100%" height={listH} gap={SECTION_GAP}>
        {cols.map(col => {
          const items = inCol(col.id)
          const isTarget = target === col.id && drag?.from !== col.id
          return (
            <Box key={`sec:${col.id}`} flexDirection="column" width="100%" padding={PAD} backgroundColor={pal.panel}>
              <Text bold wrap="truncate-end" color={isTarget ? 'claude' : pal.text}>
                {col.label}
                {items.length > 0 ? <Text color={pal.dim}> ({items.length})</Text> : ''}
                {isTarget ? <Text color="claude">  ▸ Drop here</Text> : ''}
              </Text>
              <Box height={1} />
              {items.length === 0 ? (
                <Box height={1} paddingX={1}>
                  <Text color={pal.dim}>—</Text>
                </Box>
              ) : (
                <Box flexDirection="column" gap={ROW_GAP}>
                  {items.map(c => rowView(c))}
                </Box>
              )}
            </Box>
          )
        })}
        {drag && dragged && (
          <Box position="absolute" left={Math.max(0, drag.x - drag.ox)} top={Math.max(0, drag.y - drag.oy)}>
            {rowView(dragged, true)}
          </Box>
        )}
      </Box>
    )
  }

  const maxCards = Math.max(1, ...cols.map(c => inCol(c.id).length))
  const height = HEADER + (maxCards + (drag ? 1 : 0)) * STRIDE + PAD

  return (
    <Box position="relative" flexDirection="row" width="100%" height={height}>
      {cols.map(col => {
        const items = inCol(col.id)
        const isTarget = target === col.id && drag?.from !== col.id
        return (
          <Box key={`colwrap:${col.id}`} width={colW} height={height} paddingRight={COL_GAP}>
            <Box
              key={`col:${col.id}`}
              flexDirection="column"
              width={colW - COL_GAP}
              height={height}
              padding={PAD}
              gap={1}
              backgroundColor={pal.panel}
            >
              <Text bold wrap="truncate-end" color={isTarget ? 'claude' : pal.text}>
                {col.label}
                {items.length > 0 ? <Text color={pal.dim}> ({items.length})</Text> : ''}
              </Text>
              {items.map(c => cardView(c))}
              {isTarget && (
                <Box width={innerW} height={CARD_H} paddingX={2} justifyContent="center" flexDirection="column">
                  <Text color="claude">▸ Drop here</Text>
                </Box>
              )}
            </Box>
          </Box>
        )
      })}
      {drag && dragged && (
        <Box position="absolute" left={Math.max(0, drag.x - drag.ox)} top={Math.max(0, drag.y - drag.oy)}>
          {cardView(dragged, true)}
        </Box>
      )}
    </Box>
  )
}

export default Board
