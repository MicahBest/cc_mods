import { atom, read, update } from 'claude-code'
import type { Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Usage } from '../types'

const usage = atom({ plugin: 'usage-status', key: 'usage' } as const, null)
// Bumped each minute so the reset countdowns redraw between measurements.
const tick = atom({ plugin: 'usage-status', key: 'tick' } as const, 0)

const HOUR = 3_600_000
const WINDOWS = {
  five_hour: { label: '5-hour limit', short: '5h', ms: 5 * HOUR },
  seven_day: { label: 'Weekly limit', short: 'wk', ms: 7 * 24 * HOUR },
} as const

export const duration = (ms: number) => {
  const minutes = Math.max(0, Math.ceil(ms / 60_000))
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  const m = minutes % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

const tokens = (n: number) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`)

const contextPart = (context: SessionContextUsage, isCompact: boolean) => {
  if (context.percent === undefined) return isCompact ? 'ctx --' : 'Context: --'
  if (isCompact) return `ctx ${context.percent}%`
  const fill = context.tokens === undefined ? '' : ` (${tokens(context.tokens)}/${tokens(context.window)})`
  return `Context: ${context.percent}% used${fill}`
}

const limitPart = (kind: keyof typeof WINDOWS, limits: SessionRateLimit[], now: number, isCompact: boolean) => {
  const window = WINDOWS[kind]
  const limit = limits.find(l => l.kind === kind)
  if (!limit) return isCompact ? `${window.short} --` : `${window.label}: --`

  const used = Math.round(limit.percentUsed)
  const left = limit.resetsAt === undefined ? undefined : Date.parse(limit.resetsAt) - now
  if (isCompact) return `${window.short} ${used}%${left === undefined ? '' : ` (${duration(left).replace(' ', '')})`}`

  const resets = left === undefined ? '' : `, resets in ${duration(left)}`
  if (limit.percentUsed >= 100) return `${window.label}: REACHED${resets}`

  // Projects usage to the end of the window at the rate so far.
  const elapsed = left === undefined ? 0 : 1 - left / window.ms
  const isOnPaceToMax = elapsed > 0.1 && limit.percentUsed / elapsed >= 100
  return `${window.label}: ${used}% used${resets}${isOnPaceToMax ? ' ⚠ on pace to max out' : ''}`
}

export const format = ({ context, rateLimits }: Usage, now: number, isCompact = false) =>
  [
    contextPart(context, isCompact),
    limitPart('five_hour', rateLimits, now, isCompact),
    limitPart('seven_day', rateLimits, now, isCompact),
  ].join(isCompact ? ' · ' : '  │  ')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const { context, rateLimits } = await $.session.usage()
    await update($, usage, () => ({ context, rateLimits }))
    $.ui.status(undefined)
    $.clock.every(60_000, () => void update($, tick, n => n + 1))
    return result
  })

  on('session.measure', async ($, e, next) => {
    await update($, usage, () => ({ context: e.context, rateLimits: e.rateLimits }))
    return next(e)
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const current = await read($, usage)
    await read($, tick)
    if (current === null) return next(e)

    const now = await $.clock.now()
    const room = (e.viewport?.columns ?? 200) - e.props.hint.length - 4
    const verbose = format(current, now)
    const tail = `   ${verbose.length <= room ? verbose : format(current, now, true)}`
    return next({ ...e, props: { ...e.props, tail } })
  })
}
