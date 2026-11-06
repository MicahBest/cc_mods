import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { DiffBase, DiffSummary } from '../types'

// One line above the prompt: how many files changed this session, on which
// branch, and the lines added and deleted.
//
// git runs against a private index of the mod's own (GIT_INDEX_FILE), so the
// person's real index and staging are never touched, and untracked files count.
// The band draws whatever other mods put there beneath its own line.

const PLUGIN = 'git-diff-panel'
const INDEX_NAME = 'git-diff-panel.index'
const TICK_MS = 1000
const POLL_MS = 4000

const summary = atom({ plugin: 'git-diff-panel', key: 'summary' } as const, null as DiffSummary, { shape: 'summary-1' })
const base = atom({ plugin: 'git-diff-panel', key: 'base' } as const, null as DiffBase, { shape: 'base-1' })

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

/** One look at the repository; writes the summary (null outside a repository). */
async function refresh($: EngineInterface) {
  const cwd = await $.session.cwd()
  const top = await git($, cwd, ['rev-parse', '--show-toplevel'])
  if (top.exitCode !== 0) {
    await update($, summary, () => null)
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

  const [numstat, branch] = await Promise.all([
    git($, root, ['diff', '--cached', '--numstat', '--no-renames', start.tree], index),
    git($, root, ['rev-parse', '--abbrev-ref', 'HEAD']),
  ])
  let files = 0
  let added = 0
  let deleted = 0
  for (const line of numstat.stdout.split('\n')) {
    const [a, d, ...path] = line.split('\t')
    if (!path.join('\t')) continue
    files += 1
    added += Number(a) || 0 // '-' for a binary file
    deleted += Number(d) || 0
  }
  const next: DiffSummary = {
    branch: branch.exitCode === 0 ? branch.stdout.trim() : null,
    files,
    added,
    deleted,
  }
  const prev = await read($, summary)
  const isSame =
    prev !== null &&
    prev.branch === next.branch &&
    prev.files === next.files &&
    prev.added === next.added &&
    prev.deleted === next.deleted
  if (!isSame) await update($, summary, () => next)
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const ran = await next(e)
    $.clock.every(TICK_MS, () => void tick($))
    return ran
  })

  // A call that may write: look again on the next tick, not in four seconds.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (!ran.isReadOnly) isDirty = true
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, summary)
    if (s === null || e.props.hasSurvey) {
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)
    const line = (
      <Text>
        <Text weight="semibold">{`${s.files} file${s.files === 1 ? '' : 's'} changed`}</Text>
        <Text dimColor>{' on '}</Text>
        <Text weight="semibold">{s.branch ?? '(no branch)'}</Text>
        {'  '}
        <Text color="diffAdded" mono tabular>{`+${s.added}`}</Text>{' '}
        <Text color="diffRemoved" mono tabular>{`−${s.deleted}`}</Text>
      </Text>
    )
    // Keep what the mods beneath draw here, under this line.
    const below = await next(e)
    return (
      <Box flexDirection="column">
        {line}
        {below}
      </Box>
    )
  })
}
