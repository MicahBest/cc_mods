import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { DiffBase, DiffFile, DiffMode, DiffSnapshot } from '../types'

// A live pane of what the agents are changing in the session's git project:
// every file that differs from where the session started (or from HEAD), with
// lines added and deleted, and which agent or subagent changed it last.
//
// git runs against a private index of the mod's own (GIT_INDEX_FILE), so the
// person's real index and staging are never touched, and untracked files count.

const PANE = 'git-diff'
const TITLE = 'Git changes'
const PLUGIN = 'git-diff-panel'
const INDEX_NAME = 'git-diff-panel.index'
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const TICK_MS = 1000
const POLL_MS = 4000
const RECENT_MS = 8000
const PATCH_LINES = 300

const EMPTY: DiffSnapshot = { root: null, branch: null, files: [], error: null, checkedAt: 0 }

const snapshot = atom({ plugin: 'git-diff-panel', key: 'snapshot' } as const, EMPTY, { shape: 'snapshot-1' })
const base = atom({ plugin: 'git-diff-panel', key: 'base' } as const, null as DiffBase, { shape: 'base-1' })
const mode = atom({ plugin: 'git-diff-panel', key: 'mode' } as const, 'session' as DiffMode)
const expanded = atom({ plugin: 'git-diff-panel', key: 'expanded' } as const, null as string | null)
const patch = atom({ plugin: 'git-diff-panel', key: 'patch' } as const, null as string | null)

// Module state: lost on a reload, which only costs a label or a poll.
const explicit = new Map<string, string>() // absolute path -> who wrote it
let pendingBy: string | null = null // who made the last change-making call
let isDirty = true
let keepLabels = false // the next look is a view change, not new edits
let isBusy = false
let lastPoll = 0
const labels = new Map<string, string>()

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')

async function git($: EngineInterface, cwd: string, args: string[], index?: string) {
  return $.process.run(['git', '-c', 'core.quotePath=false', ...args], {
    cwd,
    env: index ? { GIT_INDEX_FILE: index } : undefined,
    timeoutMs: 60_000,
  })
}

async function labelOf($: EngineInterface, agentId: string | undefined) {
  if (agentId === undefined) {
    return 'main'
  }
  const known = labels.get(agentId)
  if (known) {
    return known
  }
  const agent = (await $.agent.list()).find(one => one.id === agentId)
  const label = agent ? `${agent.type}: ${agent.description}` : `subagent ${agentId.slice(0, 6)}`
  labels.set(agentId, label)
  return label
}

function relativeTo(root: string, path: string) {
  const p = norm(path)
  const r = norm(root)
  return p.toLowerCase().startsWith(r.toLowerCase() + '/') ? p.slice(r.length + 1) : null
}

function parseNumstat(text: string) {
  const out = new Map<string, { added: number | null; deleted: number | null }>()
  for (const line of text.split('\n')) {
    const [a, d, ...rest] = line.split('\t')
    const path = rest.join('\t')
    if (!path) continue
    out.set(path, { added: a === '-' ? null : Number(a), deleted: d === '-' ? null : Number(d) })
  }
  return out
}

function parseNameStatus(text: string) {
  const out = new Map<string, string>()
  for (const line of text.split('\n')) {
    const [s, ...rest] = line.split('\t')
    const path = rest.join('\t')
    if (path) out.set(path, (s ?? "M").charAt(0))
  }
  return out
}

/** One look at the repository; writes the snapshot (and the open patch). */
async function refresh($: EngineInterface, opts: { relabel: boolean } = { relabel: true }) {
  const now = await $.clock.now()
  const cwd = await $.session.cwd()
  const top = await git($, cwd, ['rev-parse', '--show-toplevel'])
  if (top.exitCode !== 0) {
    await update($, snapshot, () => ({ ...EMPTY, error: `Not a git repository: ${cwd}`, checkedAt: now }))
    return
  }
  const root = norm(top.stdout.trim())
  const gitDir = norm((await git($, root, ['rev-parse', '--absolute-git-dir'])).stdout.trim())
  const index = `${gitDir}/${INDEX_NAME}`

  // Stage the whole working tree into the private index (fast after the first
  // time: the index caches file stats).
  const added = await git($, root, ['add', '-A', '--ignore-errors', '--', '.'], index)
  if (added.exitCode !== 0 && !added.stderr.includes('warning')) {
    await update($, snapshot, s => ({ ...s, root, error: `git add failed: ${added.stderr.trim().slice(0, 200)}`, checkedAt: now }))
  }

  let start = await read($, base)
  if (start === null || start.root !== root) {
    const tree = (await git($, root, ['write-tree'], index)).stdout.trim()
    start = { root, tree }
    await update($, base, () => start)
  }

  const head = await git($, root, ['rev-parse', '--verify', '-q', 'HEAD'])
  const which = (await read($, mode)) === 'head' ? (head.exitCode === 0 ? 'HEAD' : EMPTY_TREE) : start.tree
  const [numstat, names, branch] = await Promise.all([
    git($, root, ['diff', '--cached', '--numstat', '--no-renames', which], index),
    git($, root, ['diff', '--cached', '--name-status', '--no-renames', which], index),
    git($, root, ['rev-parse', '--abbrev-ref', 'HEAD']),
  ])
  const counts = parseNumstat(numstat.stdout)
  const statuses = parseNameStatus(names.stdout)

  const prev = await read($, snapshot)
  const isFirst = prev.root !== root
  const before = new Map(prev.files.map(f => [f.path, f]))
  const byPath = new Map<string, string>()
  for (const [abs, who] of explicit) {
    const rel = relativeTo(root, abs)
    if (rel) byPath.set(rel.toLowerCase(), who)
  }
  explicit.clear()
  const fallback = pendingBy ?? 'other'
  pendingBy = null

  const files: DiffFile[] = []
  for (const [path, c] of counts) {
    const old = before.get(path)
    const status = statuses.get(path) ?? 'M'
    const isSame = old && old.added === c.added && old.deleted === c.deleted && old.status === status
    if (old && (isSame || !opts.relabel)) {
      files.push({ ...old, ...c, status })
    } else if (isFirst) {
      files.push({ path, status, ...c, by: '', changedAt: 0 })
    } else {
      files.push({ path, status, ...c, by: byPath.get(path.toLowerCase()) ?? fallback, changedAt: now })
    }
  }

  await update($, snapshot, () => ({
    root,
    branch: branch.exitCode === 0 ? branch.stdout.trim() : null,
    files,
    error: null,
    checkedAt: now,
  }))

  const open = await read($, expanded)
  if (open !== null) {
    const out = await git($, root, ['diff', '--cached', '--no-renames', which, '--', open], index)
    const lines = out.stdout.split('\n')
    const text = lines.length > PATCH_LINES ? lines.slice(0, PATCH_LINES).join('\n') : out.stdout
    await update($, patch, () => text.trim() || null)
  }
}

async function tick($: EngineInterface, force = false) {
  if (isBusy) return
  const now = await $.clock.now()
  if (!force && !isDirty && now - lastPoll < POLL_MS) return
  isBusy = true
  isDirty = false
  lastPoll = now
  try {
    const relabel = !keepLabels
    keepLabels = false
    await refresh($, { relabel })
  } catch (err) {
    $.ui.log(`${PLUGIN}: ${String(err)}`, { to: 'debug' })
  } finally {
    isBusy = false
  }
}

function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  return m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`
}

function clip(text: string, room: number) {
  return text.length <= room ? text : '…' + text.slice(text.length - Math.max(1, room - 1))
}

const STATUS_COLOR: Record<string, 'success' | 'error' | 'warning' | 'suggestion'> = {
  A: 'success',
  D: 'error',
  M: 'warning',
  T: 'suggestion',
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const ran = await next(e)
    await $.command.register({ name: 'git-diff', description: 'Show the live git changes pane' })
    void $.ui.open({ id: PANE, title: TITLE })
    $.clock.every(TICK_MS, () => void tick($))
    return ran
  })

  on('command.run', { command: 'git-diff' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    isDirty = true
    return { text: 'Git changes pane opened.' }
  })

  // Every call that may write: note who made it, so the next look credits them.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const tool = String(e.tool)
    if (ran.isReadOnly || tool === 'Agent' || tool === 'Task') {
      return ran
    }
    const by = await labelOf($, e.agentId)
    if (e.tool === 'Edit' || e.tool === 'Write') {
      explicit.set(e.file_path, by)
    } else if (e.tool === 'NotebookEdit') {
      explicit.set(e.notebook_path, by)
    }
    pendingBy = by
    isDirty = true
    return ran
  }).catch(($, e, next) => next(e)) // never in the way of the call itself

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Code } = $.ui.resolve(e)
    const [snap, m, open, diff, now] = await Promise.all([
      read($, snapshot),
      read($, mode),
      read($, expanded),
      read($, patch),
      $.clock.now(),
    ])
    const cols = Math.max(20, e.props.bodyColumns ?? 40)

    const setMode = (to: DiffMode) => async () => {
      await update($, mode, () => to)
      keepLabels = true
      isDirty = true
    }
    const modeBar = (
      <Box flexDirection="row" gap={1}>
        <Button key="mode-session" label="This session" variant={m === 'session' ? 'primary' : 'secondary'} onPress={setMode('session')} />
        <Button key="mode-head" label="vs HEAD" variant={m === 'head' ? 'primary' : 'secondary'} onPress={setMode('head')} />
      </Box>
    )

    if (snap.error) {
      return (
        <Box flexDirection="column" gap={1}>
          {modeBar}
          <Text dimColor>{snap.error}</Text>
        </Box>
      )
    }
    if (snap.root === null) {
      return <Text dimColor>Looking at the repository…</Text>
    }

    const files = [...snap.files].sort((a, b) => b.changedAt - a.changedAt || a.path.localeCompare(b.path))
    const totalAdd = files.reduce((n, f) => n + (f.added ?? 0), 0)
    const totalDel = files.reduce((n, f) => n + (f.deleted ?? 0), 0)
    const biggest = Math.max(1, ...files.map(f => (f.added ?? 0) + (f.deleted ?? 0)))
    const barRoom = Math.min(40, cols - 2)

    const agents = new Map<string, { files: number; added: number; deleted: number }>()
    for (const f of files) {
      if (!f.by) continue
      const a = agents.get(f.by) ?? { files: 0, added: 0, deleted: 0 }
      a.files += 1
      a.added += f.added ?? 0
      a.deleted += f.deleted ?? 0
      agents.set(f.by, a)
    }

    const toggle = (path: string) => async () => {
      const next = open === path ? null : path
      await update($, expanded, () => next)
      await update($, patch, () => null)
      keepLabels = true
      isDirty = true
    }

    return (
      <Box flexDirection="column" gap={1}>
        {modeBar}
        <Text>
          <Text weight="semibold">{snap.branch ?? '(no branch)'}</Text>
          <Text dimColor>{`  ${files.length} file${files.length === 1 ? '' : 's'}  `}</Text>
          <Text color="diffAdded">{`+${totalAdd}`}</Text> <Text color="diffRemoved">{`−${totalDel}`}</Text>
        </Text>

        {agents.size > 0 && (
          <Box flexDirection="column">
            <Text dimColor>By agent</Text>
            {[...agents].map(([who, a]) => (
              <Text>
                {clip(who, cols - 22)} <Text dimColor>{`${a.files}f`}</Text> <Text color="diffAdded">{`+${a.added}`}</Text>{' '}
                <Text color="diffRemoved">{`−${a.deleted}`}</Text>
              </Text>
            ))}
          </Box>
        )}

        {files.length === 0 && (
          <Text dimColor>{m === 'session' ? 'No changes since this session started.' : 'Working tree matches HEAD.'}</Text>
        )}

        <Box flexDirection="column">
          {files.map(f => {
            const isRecent = f.changedAt > 0 && now - f.changedAt < RECENT_MS
            const isBinary = f.added === null
            const add = f.added ?? 0
            const del = f.deleted ?? 0
            const width = Math.max(1, Math.round(((add + del) / biggest) * barRoom))
            const addBar = add + del === 0 ? 0 : Math.round((add / (add + del)) * width)
            const counts = isBinary ? 'bin' : `+${add} −${del}`
            const who = f.by ? `${f.by} · ${ago(now - f.changedAt)}` : 'before this session'
            return (
              <Box flexDirection="column">
                <Button key={`file:${f.path}`} plain onPress={toggle(f.path)}>
                  <Text color={isRecent ? 'claude' : STATUS_COLOR[f.status] ?? 'text'} weight={isRecent ? 'bold' : 'regular'}>
                    {isRecent ? '● ' : ''}
                    {f.status}
                  </Text>{' '}
                  <Text weight={isRecent ? 'bold' : 'regular'}>{clip(f.path, cols - counts.length - 6)}</Text>{' '}
                  <Text dimColor>{counts}</Text>
                </Button>
                {!isBinary && add + del > 0 && (
                  <Text>
                    <Text color="diffAdded">{'█'.repeat(addBar)}</Text>
                    <Text color="diffRemoved">{'█'.repeat(width - addBar)}</Text>
                  </Text>
                )}
                <Text dimColor>{clip(who, cols)}</Text>
                {open === f.path &&
                  (diff ? <Code source={diff} format="diff" path={f.path} /> : <Text dimColor>Loading diff…</Text>)}
              </Box>
            )
          })}
        </Box>
      </Box>
    )
  })
}
