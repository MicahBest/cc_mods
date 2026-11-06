import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

// The desktop app's take on statusline.py: the same grey usage line, drawn above
// the prompt. The terminal keeps statusline.py, so this draws nothing there.
const WINDOWS: Record<string, string> = { five_hour: '5-hour limit', seven_day: 'Weekly limit' }
const usageText = atom({ plugin: 'usage-line', key: 'usage' } as const, null)

function duration(seconds: number) {
  const minutes = Math.max(0, Math.ceil(seconds / 60))
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  const m = minutes % 60
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`
}

function tokens(n: number) {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M`.replace('.0M', 'M') : `${Math.round(n / 1000)}k`
}

function contextPart(ctx: SessionContextUsage) {
  if (ctx.percent === undefined) {
    return 'Context: --'
  }
  const fill = ctx.tokens !== undefined && ctx.window ? ` (${tokens(ctx.tokens)}/${tokens(ctx.window)})` : ''
  return `Context: ${Math.round(ctx.percent)}% used${fill}`
}

function limitPart(kind: string, limits: SessionRateLimit[], now: number) {
  const label = WINDOWS[kind]
  const limit = limits.find(one => one.kind === kind)
  if (!limit) {
    return `${label}: --`
  }
  const resets = limit.resetsAt ? `, resets in ${duration((Date.parse(limit.resetsAt) - now) / 1000)}` : ''
  if (limit.percentUsed >= 100) {
    return `${label}: REACHED${resets}`
  }
  return `${label}: ${Math.round(limit.percentUsed)}% used${resets}`
}

async function refresh($: EngineInterface) {
  const [usage, now] = await Promise.all([$.session.usage(), $.clock.now()])
  const text = [contextPart(usage.context), ...Object.keys(WINDOWS).map(kind => limitPart(kind, usage.rateLimits, now))].join('  │  ')
  await update($, usageText, () => text)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const ran = await next(e)
    await refresh($)
    // Keep the reset countdowns current, as statusline.py's refreshInterval of 60 does.
    $.clock.every(60_000, () => void refresh($))
    return ran
  })

  on('session.measure', async ($, e, next) => {
    const ran = await next(e)
    await refresh($)
    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface === 'terminal' || e.props.hasSurvey) {
      return next(e)
    }
    const text = await read($, usageText)
    if (text === null) {
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)
    // Keep what the mods beneath draw here (git-diff-panel's line), under this one.
    const below = await next(e)
    return (
      <Box flexDirection="column">
        <Text dimColor>{text}</Text>
        {below}
      </Box>
    )
  })
}
