import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'git-diff-panel',
  component: 'Pane',
  requestId: 'git-diff',
  props: {
    title: 'Git changes',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

// A fake repository: what `git diff` reports is whatever the test sets here.
function fakeGit(on: On) {
  const tree = { numstat: '', names: '', isRepo: true }
  const done = (exitCode: number, stdout: string) => ({
    value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  })
  on('process.run', (_$, e) => {
    const args = e.argv.slice(3).join(' ') // drop git -c core.quotePath=false
    if (args === 'rev-parse --show-toplevel') return tree.isRepo ? done(0, 'C:/repo\n') : done(128, '')
    if (args === 'rev-parse --absolute-git-dir') return done(0, 'C:/repo/.git\n')
    if (args === 'write-tree') return done(0, 'tree0\n')
    if (args === 'rev-parse --abbrev-ref HEAD') return done(0, 'main\n')
    if (args.includes('--numstat')) return done(0, tree.numstat)
    if (args.includes('--name-status')) return done(0, tree.names)
    return done(0, '')
  })
  on('session.cwd', () => ({ value: 'C:/repo' }))
  on('command.register', () => ({ value: { command: 'git-diff' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  return tree
}

test('changed files show with their counts on every surface', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const tree = fakeGit(on)

  await $.session.start({ cwd: 'C:/repo', surface: 'desktop', isInteractive: true })
  await clock.advance(1000)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /No changes yet this session/ })).toBeDefined()
    await ui.unmount()
  }

  tree.numstat = '12\t3\tsrc/utils.ts\n40\t0\tsrc/new.ts\n-\t-\tlogo.png\n'
  tree.names = 'M\tsrc/utils.ts\nA\tsrc/new.ts\nA\tlogo.png\n'
  await $.tool.call({ tool: 'Bash', command: 'echo > src/new.ts' })
  await clock.advance(1000)

  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: '3 files changed' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'utils.ts' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '+52' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '−3' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'binary' })).toBeDefined()
    await ui.unmount()
  }
})

test('outside a git repository it says so', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const tree = fakeGit(on)
  tree.isRepo = false

  await $.session.start({ cwd: 'C:/repo', surface: 'desktop', isInteractive: true })
  await clock.advance(1000)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Not a git repository/ })).toBeDefined()
  await ui.unmount()
})
