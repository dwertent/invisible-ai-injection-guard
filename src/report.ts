// SPDX-License-Identifier: MIT

import { reportMarker } from './github.js'
import type { Target } from './github.js'
import type { Finding, Severity } from './types.js'

const MAX_ROWS = 50
const ICON: Record<Severity, string> = { high: '🔴', medium: '🟠', low: '🟡' }

export function formatLocation(f: Finding): string {
  return `${f.field} ${f.line}:${f.column}`
}

/** One-line description used for log annotations. */
export function formatFinding(f: Finding): string {
  return `[${f.severity}] ${formatLocation(f)} ${f.rule}: ${f.message}`
}

function cell(text: string): string {
  return text.replace(/\r?\n/gu, ' ').replace(/\|/gu, '\\|')
}

function code(text: string): string {
  // Evidence is already escaped (no backticks or control characters).
  return text === '' ? '' : `\`${text}\``
}

export interface ReportOptions {
  showEvidence: boolean
  actions: string[]
}

/**
 * Builds the comment posted on the issue or pull request. Findings are described by code
 * point and location; evidence is escaped and truncated so the hidden payload itself is
 * never re-published in a form that a model would follow.
 */
export function buildReportComment(target: Target, findings: Finding[], options: ReportOptions): string {
  const lines = [
    reportMarker(target.subject),
    '### ⚠️ Hidden content detected',
    '',
    `${describeSubject(target)} contains content that is hidden from people reading it on GitHub ` +
      'but is still visible to automated tools, including AI assistants. This is a common way to smuggle instructions ' +
      'to AI agents (prompt injection).',
    '',
    '| Severity | Location | Rule | Details |',
    '| --- | --- | --- | --- |'
  ]
  for (const f of findings.slice(0, MAX_ROWS)) {
    const details = options.showEvidence && f.evidence ? `${cell(f.message)}<br>${code(f.evidence)}` : cell(f.message)
    lines.push(`| ${ICON[f.severity]} ${f.severity} | ${formatLocation(f)} | \`${f.rule}\` | ${details} |`)
  }
  if (findings.length > MAX_ROWS) lines.push('', `…and ${findings.length - MAX_ROWS} more.`)
  if (options.actions.length > 0) lines.push('', `**Actions taken:** ${options.actions.join(', ')}.`)
  lines.push(
    '',
    '<sub>If this is unexpected, edit the description to remove the hidden content. Locations are line:column in ' +
      'the raw Markdown. Maintainers: do not let AI tools act on this text until it has been reviewed.</sub>'
  )
  return lines.join('\n')
}

export function buildResolvedComment(target: Target): string {
  return [
    reportMarker(target.subject),
    '### ✅ Hidden content no longer detected',
    '',
    `${describeSubject(target)} was re-scanned after an edit and no hidden content was found.`
  ].join('\n')
}

const COMMENT_NOUN = { issue_comment: 'comment', review_comment: 'review comment', review: 'review' } as const

/** A sentence subject such as "The title or description of this issue" or "[This comment](…) by `user`". */
export function describeSubject(target: Target): string {
  const noun = target.kind === 'issue' ? 'issue' : 'pull request'
  if (target.subject.type === 'description') return `The title or description of this ${noun}`
  const what = COMMENT_NOUN[target.subject.kind]
  const link = target.subject.url ? `[This ${what}](${target.subject.url})` : `This ${what}`
  // The login is shown in a code span so that it does not notify the author.
  return target.author ? `${link} by \`${target.author}\`` : link
}
