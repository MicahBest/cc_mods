import { test, expect } from 'claude-code/testing'

import { duration, format } from './register'

const NOW = Date.parse('2026-10-14T12:00:00Z')
const at = (ms: number) => new Date(NOW + ms).toISOString()
const HOUR = 3_600_000

test('durations read as minutes, hours and days', () => {
  expect(duration(40 * 60_000)).toBe('40m')
  expect(duration(100 * 60_000)).toBe('1h 40m')
  expect(duration(53 * HOUR)).toBe('2d 5h')
})

test('verbose line labels each figure and counts down to the resets', () => {
  const line = format(
    {
      context: { tokens: 42_000, window: 200_000, percent: 21 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 37.5, resetsAt: at(100 * 60_000) },
        { kind: 'seven_day', percentUsed: 12, resetsAt: at(53 * HOUR) },
      ],
    },
    NOW,
  )
  expect(line).toBe(
    'Context: 21% used (42k/200k)  │  5-hour limit: 38% used, resets in 1h 40m  │  Weekly limit: 12% used, resets in 2d 5h',
  )
})

test('compact line, missing figures and a reached limit', () => {
  const usage = {
    context: { window: 200_000 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 100, resetsAt: at(20 * 60_000) }],
  }
  expect(format(usage, NOW)).toBe('Context: --  │  5-hour limit: REACHED, resets in 20m  │  Weekly limit: --')
  expect(format(usage, NOW, true)).toBe('ctx -- · 5h 100% (20m) · wk --')
})

test('warns when the rate so far would max out a window before it resets', () => {
  const line = format(
    {
      context: { tokens: 42_000, window: 200_000, percent: 21 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 80, resetsAt: at(3 * HOUR) }],
    },
    NOW,
  )
  expect(line).toContain('5-hour limit: 80% used, resets in 3h 0m ⚠ on pace to max out')
})
