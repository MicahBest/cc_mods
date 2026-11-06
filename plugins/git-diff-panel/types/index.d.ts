export type DiffFile = {
  path: string
  /** A added, D deleted, M modified, T type change. */
  status: string
  /** null for a binary file. */
  added: number | null
  deleted: number | null
}

export type DiffSnapshot = {
  root: string | null
  branch: string | null
  files: DiffFile[]
  error: string | null
  checkedAt: number
}

/** The session's starting point: a tree of the working tree as it was. */
export type DiffBase = { root: string; tree: string } | null

export type DiffMode = 'session' | 'head'

declare module 'claude-code' {
  interface PluginState {
    'git-diff-panel': {
      snapshot: Shaped<DiffSnapshot>
      base: Shaped<DiffBase>
      mode: DiffMode
      expanded: string | null
      patch: string | null
    }
  }
}
