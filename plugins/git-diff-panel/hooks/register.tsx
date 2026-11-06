import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { DiffBase, DiffFile, DiffMode, DiffSnapshot } from '../types'

// A live pane of what is changing in the session's git project: every file
// that differs from where the session started (or from HEAD), with lines
// added and deleted.
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
const PATCH_LINES = 300
const BLOCKS = 5

// GitHub's diffstat colors: they read on light and dark backgrounds alike.
const GREEN = '#2da44e'
const RED = '#e5534b'
const GREY = '#8c959f'

const EMPTY: DiffSnapshot = { root: null, branch: null, files: [], error: null, checkedAt: 0 }

const snapshot = atom({ plugin: 'git-diff-panel', key: 'snapshot' } as const, EMPTY, { shape: 'snapshot-2' })
const base = atom({ plugin: 'git-diff-panel', key: 'base' } as const, null as DiffBase, { shape: 'base-1' })
const mode = atom({ plugin: 'git-diff-panel', key: 'mode' } as const, 'session' as DiffMode)
const expanded = atom({ plugin: 'git-diff-panel', key: 'expanded' } as const, null as string | null)
const patch = atom({ plugin: 'git-diff-panel', key: 'patch' } as const, null as string | null)

let isDirty = true
let isBusy = false
let lastPoll = 0

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')

async function git($: EngineInterface, cwd: string, args: string[], index?: string) {
  return $.process.run(['git', '-c', 'core.quotePath=false', ...args], {
    cwd,
    env: index ? { GIT_INDEX_FILE: index } : undefined,
    timeoutMs: 60_000,
  })
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
    if (path) out.set(path, (s ?? 'M').charAt(0))
  }
  return out
}

/** One look at the repository; writes the snapshot (and the open patch). */
async function refresh($: EngineInterface) {
  const now = await $.clock.now()
  const cwd = await $.session.cwd()
  const top = await git($, cwd, ['rev-parse', '--show-toplevel'])
  if (top.exitCode !== 0) {
    await update($, snapshot, () => ({ ...EMPTY, error: 'Not a git repository', checkedAt: now }))
    return
  }
  const root = norm(top.stdout.trim())
  const gitDir = norm((await git($, root, ['rev-parse', '--absolute-git-dir'])).stdout.trim())
  const index = `${gitDir}/${INDEX_NAME}`

  // Stage the whole working tree into the private index (fast after the first
  // time: the index caches file stats).
  await git($, root, ['add', '-A', '--ignore-errors', '--', '.'], index)

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
  const statuses = parseNameStatus(names.stdout)
  const files: DiffFile[] = [...parseNumstat(numstat.stdout)]
    .map(([path, c]) => ({ path, status: statuses.get(path) ?? 'M', ...c }))
    .sort((a, b) => a.path.localeCompare(b.path))

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

async function tick($: EngineInterface) {
  if (isBusy) return
  const now = await $.clock.now()
  if (!isDirty && now - lastPoll < POLL_MS) return
  isBusy = true
  isDirty = false
  lastPoll = now
  try {
    await refresh($)
  } catch (err) {
    $.ui.log(`${PLUGIN}: ${String(err)}`, { to: 'debug' })
  } finally {
    isBusy = false
  }
}

/** How many of the five blocks are green, red and grey, GitHub's way. */
function blocks(add: number, del: number, biggest: number) {
  const total = add + del
  if (total === 0) return { green: 0, red: 0, grey: BLOCKS }
  const filled = Math.max(1, Math.round((total / biggest) * BLOCKS))
  let green = Math.round((add / total) * filled)
  if (add > 0 && green === 0) green = 1
  if (del > 0 && green === filled) green = Math.max(0, filled - 1)
  return { green, red: filled - green, grey: BLOCKS - filled }
}

function blocksSvg(b: { green: number; red: number; grey: number }) {
  const size = 8
  const step = 10
  const colors = [...Array(b.green).fill(GREEN), ...Array(b.red).fill(RED), ...Array(b.grey).fill(GREY)]
  const rects = colors
    .map((fill, i) => `<rect x="${i * step}" y="0" width="${size}" height="${size}" rx="2" fill="${fill}"${fill === GREY ? ' fill-opacity="0.35"' : ''}/>`)
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${BLOCKS * step - 2}" height="${size}" viewBox="0 0 ${BLOCKS * step - 2} ${size}">${rects}</svg>`
}

function splitSvg(add: number, del: number) {
  const total = Math.max(1, add + del)
  const w = 1000
  const g = Math.round((add / total) * w)
  const gap = add > 0 && del > 0 ? 6 : 0
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="6" viewBox="0 0 ${w} 6" preserveAspectRatio="none">` +
    `<rect width="${w}" height="6" rx="3" fill="${GREY}" fill-opacity="0.25"/>` +
    (g > 0 ? `<rect width="${Math.max(0, g - gap / 2)}" height="6" rx="3" fill="${GREEN}"/>` : '') +
    (g < w && del > 0 ? `<rect x="${g + gap / 2}" width="${w - g - gap / 2}" height="6" rx="3" fill="${RED}"/>` : '') +
    `</svg>`
  )
}

function clipStart(text: string, room: number) {
  return text.length <= room ? text : '…' + text.slice(text.length - Math.max(1, room - 1))
}

const STATUS_COLOR: Record<string, string> = { A: GREEN, D: RED, M: '#d29922', T: GREY }

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

  // A call that may write: look again on the next tick, not in four seconds.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (!ran.isReadOnly) isDirty = true
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button, Code } = ui
    const Svg = 'Svg' in ui ? ui.Svg : undefined // every surface but the terminal
    const [snap, m, open, diff] = await Promise.all([read($, snapshot), read($, mode), read($, expanded), read($, patch)])
    const cols = Math.max(24, e.props.bodyColumns ?? 40)

    const setMode = (to: DiffMode) => async () => {
      await update($, mode, () => to)
      isDirty = true
    }
    const toggle = (path: string) => async () => {
      await update($, expanded, () => (open === path ? null : path))
      await update($, patch, () => null)
      isDirty = true
    }

    const tabs = (
      <Box flexDirection="row" gap={1}>
        <Button key="mode-session" label="This session" variant={m === 'session' ? 'primary' : 'secondary'} onPress={setMode('session')} />
        <Button key="mode-head" label="vs HEAD" variant={m === 'head' ? 'primary' : 'secondary'} onPress={setMode('head')} />
      </Box>
    )

    if (snap.root === null) {
      return (
        <Box flexDirection="column" gap={1}>
          {tabs}
          <Text dimColor>{snap.error ?? 'Reading the repository…'}</Text>
        </Box>
      )
    }

    const files = snap.files
    const totalAdd = files.reduce((n, f) => n + (f.added ?? 0), 0)
    const totalDel = files.reduce((n, f) => n + (f.deleted ?? 0), 0)
    const biggest = Math.max(1, ...files.map(f => (f.added ?? 0) + (f.deleted ?? 0)))

    const bar = (add: number, del: number) => {
      const b = blocks(add, del, biggest)
      if (Svg) {
        return <Svg source={blocksSvg(b)} alt={`${add} added, ${del} deleted`} width={BLOCKS * 10 - 2} height={8} />
      }
      return (
        <Text>
          <Text color="diffAdded">{'■'.repeat(b.green)}</Text>
          <Text color="diffRemoved">{'■'.repeat(b.red)}</Text>
          <Text dimColor>{'■'.repeat(b.grey)}</Text>
        </Text>
      )
    }

    const counts = (f: DiffFile) =>
      f.added === null ? (
        <Text dimColor mono tabular>
          binary
        </Text>
      ) : (
        <Text mono tabular>
          <Text color="diffAdded">{`+${f.added}`}</Text> <Text color="diffRemoved">{`−${f.deleted ?? 0}`}</Text>
        </Text>
      )

    return (
      <Box flexDirection="column" gap={1}>
        {tabs}

        <Box flexDirection="column" gap="xs">
          <Box flexDirection="row" justifyContent="space-between">
            <Text>
              <Text weight="semibold">{`${files.length} file${files.length === 1 ? '' : 's'} changed`}</Text>
              {snap.branch ? <Text dimColor>{`  on ${snap.branch}`}</Text> : ''}
            </Text>
            <Text mono tabular>
              <Text color="diffAdded">{`+${totalAdd}`}</Text> <Text color="diffRemoved">{`−${totalDel}`}</Text>
            </Text>
          </Box>
          {Svg && totalAdd + totalDel > 0 && (
            <Svg source={splitSvg(totalAdd, totalDel)} alt={`${totalAdd} lines added, ${totalDel} deleted`} height={6} />
          )}
        </Box>

        {files.length === 0 ? (
          <Text dimColor>{m === 'session' ? 'No changes yet this session.' : 'Working tree matches HEAD.'}</Text>
        ) : (
          <Box flexDirection="column">
            {files.map(f => {
              const slash = f.path.lastIndexOf('/')
              const name = f.path.slice(slash + 1)
              const dir = slash >= 0 ? f.path.slice(0, slash) : ''
              const room = Math.max(4, cols - name.length - 22)
              return (
                <Box flexDirection="column">
                  <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
                    <Box flexShrink={1}>
                      <Button key={`file:${f.path}`} plain onPress={toggle(f.path)}>
                        <Text mono color={STATUS_COLOR[f.status] ?? GREY} weight="semibold">
                          {f.status}
                        </Text>{' '}
                        <Text weight="medium" strikethrough={f.status === 'D'}>
                          {name}
                        </Text>
                        {dir ? <Text dimColor>{`  ${clipStart(dir, room)}`}</Text> : ''}
                      </Button>
                    </Box>
                    <Box flexDirection="row" alignItems="center" gap={1} flexShrink={0}>
                      {counts(f)}
                      {f.added !== null && bar(f.added, f.deleted ?? 0)}
                    </Box>
                  </Box>
                  {open === f.path &&
                    (diff ? <Code source={diff} format="diff" path={f.path} /> : <Text dimColor>Loading diff…</Text>)}
                </Box>
              )
            })}
          </Box>
        )}
      </Box>
    )
  })
}
