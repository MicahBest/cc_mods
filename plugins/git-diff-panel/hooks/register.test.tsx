import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'git-diff-panel',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 6,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 5 },
    view: {},
  },
} as const

// A fake repository: what `git diff` reports is whatever the test sets here.
function fakeGit(on: On) {
  const tree = { numstat: '', isRepo: true }
  const done = (exitCode: number, stdout: string) => ({
    value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  })
  on('process.run', (_$, e) => {
    const args = e.argv.slice(3).join(' ') // drop git -c core.quotePath=false
    if (args === 'rev-parse --show-toplevel') return tree.isRepo ? done(0, 'C:/repo\n') : done(128, '')
    if (args === 'rev-parse --absolute-git-dir') return done(0, 'C:/repo/.git\n')
    if (args === 'write-tree') return done(0, 'tree0\n')
    if (args === 'rev-parse --abbrev-ref HEAD') return done(0, 'feature/login\n')
    if (args.includes('--numstat')) return done(0, tree.numstat)
    return done(0, '')
  })
  on('session.cwd', () => ({ value: 'C:/repo' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  // What another mod draws in the band beneath this one.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>usage line</Text>
  })
  return tree
}

test('the band shows files, branch and line totals, above what is beneath', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const tree = fakeGit(on)

  await $.session.start({ cwd: 'C:/repo', surface: 'desktop', isInteractive: true })
  tree.numstat = '12\t3\tsrc/utils.ts\n40\t0\tsrc/new.ts\n-\t-\tlogo.png\n'
  await $.tool.call({ tool: 'Bash', command: 'echo > src/new.ts' })
  await clock.advance(1000)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: '3 files changed' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'feature/login' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '+52' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '−3' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'usage line' })).toBeDefined()
    await ui.unmount()
  }
})

test('outside a git repository the band is left to the others', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const tree = fakeGit(on)
  tree.isRepo = false

  await $.session.start({ cwd: 'C:/repo', surface: 'desktop', isInteractive: true })
  await clock.advance(1000)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /files? changed/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'usage line' })).toBeDefined()
  await ui.unmount()
})
