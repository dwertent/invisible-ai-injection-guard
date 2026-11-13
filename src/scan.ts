// SPDX-License-Identifier: MIT

import { detectHiddenHtml, detectHtmlComments, detectMarkdownComments } from './detectors/markup.js'
import { detectPadding } from './detectors/padding.js'
import { detectUnicode } from './detectors/unicode.js'
import { locate, maskCode } from './text.js'
import type { DetectorFinding, Field, Finding, RuleId } from './types.js'
import { SEVERITY_RANK, maxSeverity } from './types.js'

export interface ScanOptions {
  maxBlankLines: number
  maxCommentLength: number
  ignoredSnippets: ReadonlySet<string>
  /** Findings of one rule beyond this count are folded into a single summary finding. */
  maxFindingsPerRule: number
}

export const DEFAULT_SCAN_OPTIONS: ScanOptions = {
  maxBlankLines: 30,
  maxCommentLength: 200,
  ignoredSnippets: new Set(),
  maxFindingsPerRule: 25
}

/** Scans one field. Titles are plain text, so only Unicode checks apply to them. */
export function scanField(text: string, field: Field, options: ScanOptions = DEFAULT_SCAN_OPTIONS): Finding[] {
  if (text === '') return []
  const raw: DetectorFinding[] = [...detectUnicode(text)]
  if (field === 'body') {
    const masked = maskCode(text)
    const markup = { maxCommentLength: options.maxCommentLength, ignoredSnippets: options.ignoredSnippets }
    raw.push(
      ...detectHtmlComments(masked, markup),
      ...detectMarkdownComments(masked, markup),
      ...detectHiddenHtml(masked, markup),
      ...detectPadding(text, options.maxBlankLines)
    )
  }
  raw.sort((a, b) => a.index - b.index)
  return cap(raw, options.maxFindingsPerRule).map((f) => {
    const { index, ...rest } = f
    return { ...rest, field, ...locate(text, index) }
  })
}

export function scan(
  content: { title?: string | null; body?: string | null },
  options: ScanOptions = DEFAULT_SCAN_OPTIONS
): Finding[] {
  return [...scanField(content.title ?? '', 'title', options), ...scanField(content.body ?? '', 'body', options)]
}

function cap(findings: DetectorFinding[], limit: number): DetectorFinding[] {
  const kept: DetectorFinding[] = []
  const dropped = new Map<RuleId, DetectorFinding[]>()
  const counts = new Map<RuleId, number>()
  for (const f of findings) {
    const n = (counts.get(f.rule) ?? 0) + 1
    counts.set(f.rule, n)
    if (n <= limit) kept.push(f)
    else dropped.set(f.rule, [...(dropped.get(f.rule) ?? []), f])
  }
  for (const [rule, extra] of dropped) {
    const first = extra[0]
    if (!first) continue
    // Keep the most severe of the dropped findings visible in the summary severity.
    const severity = maxSeverity(extra) ?? first.severity
    kept.push({
      rule: 'truncated',
      severity,
      index: first.index,
      message: `${extra.length} more "${rule}" finding(s) not listed individually`
    })
  }
  return kept.sort((a, b) => a.index - b.index || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
}
