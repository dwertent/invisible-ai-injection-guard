// SPDX-License-Identifier: MIT

export type Severity = 'low' | 'medium' | 'high'

export const SEVERITIES: readonly Severity[] = ['low', 'medium', 'high']

export const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  low: 1,
  medium: 2,
  high: 3
}

export type RuleId =
  | 'unicode-tag'
  | 'bidi-control'
  | 'directional-mark'
  | 'invisible-character'
  | 'variation-selector'
  | 'html-comment'
  | 'unterminated-html-comment'
  | 'markdown-comment'
  | 'hidden-html'
  | 'hidden-attribute-text'
  | 'blank-line-padding'
  | 'truncated'

export type Field = 'title' | 'body'

/** A finding produced by a detector, positioned by UTF-16 offset into the scanned text. */
export interface DetectorFinding {
  rule: RuleId
  severity: Severity
  message: string
  index: number
  /** Escaped, truncated text that is safe to display. Never the raw payload. */
  evidence?: string
}

/** A finding resolved to a human-readable location. */
export interface Finding {
  rule: RuleId
  severity: Severity
  message: string
  field: Field
  /** 1-based line number. */
  line: number
  /** 1-based column, counted in Unicode code points. */
  column: number
  evidence?: string
}

export function maxSeverity(findings: readonly { severity: Severity }[]): Severity | undefined {
  let max: Severity | undefined
  for (const f of findings) {
    if (max === undefined || SEVERITY_RANK[f.severity] > SEVERITY_RANK[max]) max = f.severity
  }
  return max
}

export function atLeast(severity: Severity, threshold: Severity): boolean {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[threshold]
}
