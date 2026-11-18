export type ColumnId = 'brainstorming' | 'in-progress' | 'review' | 'done'

export type Card = {
  id: string
  title: string
  link?: string
  isRunning?: boolean
  isSelf?: boolean
  prNumber?: number
  prState?: string
  isPinned?: boolean
  hasRemote?: boolean
  group?: string
  branch?: string
  isUnread?: boolean
  prUrl?: string
  cwd?: string
  lastActivityAt?: string
}

export type Mode = 'light' | 'dark'

export type View = 'board' | 'list'

export type Versions = { running?: string; installed?: string; source?: string; market?: string }

export type Source = 'app' | 'manual'

declare module 'claude-code' {
  interface PluginState {
    'session-kanban': {
      cards: Shaped<Card[]>
      columns: Shaped<Record<string, ColumnId>>
      source: Source
      note: string
      mode: Mode
      view: View
      query: string
      sidebarHidden: boolean
      labels: Record<string, string>
      renaming: string
      creating: boolean
      newProject: string
      projectFilter: string[]
      versions: Versions
    }
  }
}
