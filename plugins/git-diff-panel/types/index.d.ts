/** What the band shows; null outside a git repository. */
export type DiffSummary = {
  branch: string | null
  files: number
  added: number
  deleted: number
} | null

/** The session's starting point: a tree of the working tree as it was. */
export type DiffBase = { root: string; tree: string } | null

declare module 'claude-code' {
  interface PluginState {
    'git-diff-panel': {
      summary: Shaped<DiffSummary>
      base: Shaped<DiffBase>
    }
  }
}
