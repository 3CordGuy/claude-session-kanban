# session-kanban

A Kanban pane beside the chat in the Claude desktop app. Your Code sessions appear as cards in four columns: Brainstorming, In Progress, Testing/Review and Done/Cleanup.

- Drag a card to another column to move it. Click a card (without dragging) to open that session via its `claude://` link.
- Keyboard: click the board to focus it, then ↑/↓ select a card, ←/→ move it a column, Enter opens it.
- Where the app can't draw the drag board, each card shows ◀ / ▶ buttons instead.
- New sessions start in Brainstorming. Each session's column is saved in the mod's store, so it survives restarts and shows the same in every session.
- `/kanban` opens the board. `/kanban <column>` moves the current session (brainstorming, progress, review, done, or 1–4).
- `/kanban add` is the fallback when the app's session list can't be read: it adds the current session by hand.
- The session list refreshes every 30 seconds. Positions, column names, board/list, light/dark and the sidebar toggle are shared by every session through `~/.claude/session-kanban/board.json`, checked every 2 seconds.

## Install

Works in the Claude desktop app's Code tab (it lists your sessions through the app's own session tools).

From a terminal:

```bash
claude plugin install session-kanban --marketplace 3CordGuy/claude-session-kanban
```

At the prompt of a terminal session: `/plugin install session-kanban --marketplace 3CordGuy/claude-session-kanban`.

In the desktop app: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `3CordGuy/claude-session-kanban`, then add **session-kanban**.

Restart the app (or start a new session) and the board opens beside the chat; `/kanban` opens it if the window is narrow.

## Updating

When a newer version is published, the board's header shows **Update to vX**; click it, then restart. Or from a terminal:

```bash
claude plugin marketplace update session-kanban
claude plugin update session-kanban@session-kanban
```

## Where your board is kept

Positions, column names and view settings are saved on your machine in `~/.claude/session-kanban/board.json`, shared by every session there.
