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
function fakeGit(on: Parameters<Parameters<typeof test>[1]>[1]) {
  const tree = { numstat: '', names: '', isRepo: true }
  on('process.run', (_$, e) => {
    const args = e.argv.slice(3).join(' ') // drop git -c core.quotePath=false
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (args === 'rev-parse --show-toplevel') {
      return tree.isRepo ? ok('C:/repo\n') : { value: { exitCode: 128, stdout: '', stderr: 'fatal', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (args === 'rev-parse --absolute-git-dir') return ok('C:/repo/.git\n')
    if (args === 'write-tree') return ok('tree0\n')
    if (args === 'rev-parse --abbrev-ref HEAD') return ok('main\n')
    if (args.includes('--numstat')) return ok(tree.numstat)
    if (args.includes('--name-status')) return ok(tree.names)
    return ok('')
  })
  on('session.cwd', () => ({ value: 'C:/repo' }))
  on('agent.list', () => ({
    value: [{ id: 'a1', type: 'Explore', description: 'tidy utils' }] as never,
  }))
  on('command.register', () => ({ value: { command: 'git-diff' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  return tree
}

test('files an agent writes show with their counts and who wrote them', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const tree = fakeGit(on)

  await $.session.start({ cwd: 'C:/repo', surface: 'desktop', isInteractive: true })
  await clock.advance(1000)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /No changes since this session started/ }))).toBeDefined()
    await ui.unmount()
  }

  // A subagent edits a file; the next tick credits it.
  tree.numstat = '12\t3\tsrc/utils.ts\n'
  tree.names = 'M\tsrc/utils.ts\n'
  await $.tool.call({ tool: 'Edit', file_path: 'C:\\repo\\src\\utils.ts', old_string: 'a', new_string: 'b', agentId: 'a1' })
  await clock.advance(1000)

  // Then the main agent creates a file with Bash.
  tree.numstat = '12\t3\tsrc/utils.ts\n40\t0\tsrc/new.ts\n'
  tree.names = 'M\tsrc/utils.ts\nA\tsrc/new.ts\n'
  await $.tool.call({ tool: 'Bash', command: 'echo > src/new.ts' })
  await clock.advance(1000)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /src\/utils\.ts/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\+12 −3/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\+40 −0/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Explore: tidy utils · / })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^main · / })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '+52' })).toBeDefined()
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
