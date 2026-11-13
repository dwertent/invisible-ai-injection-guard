// SPDX-License-Identifier: MIT

import { escapeForDisplay, normalizeSnippet } from '../text.js'
import type { DetectorFinding, Severity } from '../types.js'
import { injectionSignals } from './injection.js'

export interface MarkupOptions {
  /** HTML comments longer than this many characters are reported as medium severity. */
  maxCommentLength: number
  /** Normalized hidden snippets (e.g. from repository templates) that are allowed. */
  ignoredSnippets: ReadonlySet<string>
}

function classify(content: string, options: MarkupOptions, base: Severity): { severity: Severity; signals: string[] } {
  const signals = injectionSignals(content)
  if (signals.length > 0) return { severity: 'high', signals }
  if (content.length > options.maxCommentLength && base === 'low') return { severity: 'medium', signals }
  return { severity: base, signals }
}

function describe(base: string, content: string, signals: string[]): string {
  const size = `${Array.from(content).length} characters`
  return signals.length > 0
    ? `${base} (${size}) containing text aimed at AI tools: ${signals.join(', ')}`
    : `${base} (${size})`
}

/**
 * Extracts the text of every HTML comment, for building the template allowlist.
 * Operates on code-masked text.
 */
export function extractHtmlComments(masked: string): { index: number; content: string; terminated: boolean }[] {
  const out: { index: number; content: string; terminated: boolean }[] = []
  let from = 0
  while (from < masked.length) {
    const start = masked.indexOf('<!--', from)
    if (start === -1) break
    // `<!-->` and `<!--->` are complete (empty) comments.
    const empty = /^<!--->?|^<!-->/u.exec(masked.slice(start, start + 6))
    if (empty) {
      from = start + empty[0].length
      continue
    }
    const end = masked.indexOf('-->', start + 4)
    if (end === -1) {
      out.push({ index: start, content: masked.slice(start + 4), terminated: false })
      break
    }
    out.push({ index: start, content: masked.slice(start + 4, end), terminated: true })
    from = end + 3
  }
  return out
}

function startsLine(text: string, index: number): boolean {
  const lineStart = text.lastIndexOf('\n', index - 1) + 1
  return /^ {0,3}$/u.test(text.slice(lineStart, index))
}

/** HTML comments are removed when GitHub renders Markdown, but remain in the raw text. */
export function detectHtmlComments(masked: string, options: MarkupOptions): DetectorFinding[] {
  const findings: DetectorFinding[] = []
  for (const { index, content, terminated } of extractHtmlComments(masked)) {
    if (!terminated) {
      // Only an HTML block (a line starting with `<!--`) hides everything that follows;
      // an unterminated inline `<!--` is rendered as literal text.
      if (!startsLine(masked, index)) continue
      const { signals } = classify(content, options, 'high')
      findings.push({
        rule: 'unterminated-html-comment',
        severity: 'high',
        index,
        message: describe('unterminated HTML comment hides the rest of the text', content, signals),
        evidence: escapeForDisplay(content.trim())
      })
      continue
    }
    const trimmed = content.trim()
    if (trimmed === '' || options.ignoredSnippets.has(normalizeSnippet(trimmed))) continue
    const { severity, signals } = classify(trimmed, options, 'low')
    findings.push({
      rule: 'html-comment',
      severity,
      index,
      message: describe('hidden HTML comment', trimmed, signals),
      evidence: escapeForDisplay(trimmed)
    })
  }
  return findings
}

const LINK_REFERENCE =
  /^ {0,3}\[([^\]\n]+)\]:[ \t]*(<[^>\n]*>|\S+)?(?:[ \t]+(?:"([^"\n]*)"|'([^'\n]*)'|\(([^)\n]*)\)))?[ \t]*$/gmu

/** Extracts hidden text from Markdown "comments" such as `[//]: # (text)`. */
export function extractMarkdownComments(masked: string): { index: number; content: string }[] {
  const out: { index: number; content: string }[] = []
  for (const m of masked.matchAll(LINK_REFERENCE)) {
    const [, label = '', destination = '', ...titles] = m
    const title = titles.find((t): t is string => typeof t === 'string') ?? ''
    const commentStyle = /^(?:#|<>|\/\/)$/u.test(destination) || /^(?:\/\/|comment|#)$/iu.test(label)
    // Plain reference links such as `[1]: https://example.com` are legitimate.
    if (!commentStyle && title === '') continue
    const keepLabel = commentStyle && !/^(?:\/\/|comment|#)$/iu.test(label)
    const content = [keepLabel ? label : '', title].filter(Boolean).join(' ').trim()
    if (content === '') continue
    out.push({ index: m.index, content })
  }
  return out
}

/** Link reference definitions never render, so they are a popular way to write hidden notes. */
export function detectMarkdownComments(masked: string, options: MarkupOptions): DetectorFinding[] {
  const findings: DetectorFinding[] = []
  for (const { index, content } of extractMarkdownComments(masked)) {
    if (options.ignoredSnippets.has(normalizeSnippet(content))) continue
    const { severity, signals } = classify(content, options, 'medium')
    findings.push({
      rule: 'markdown-comment',
      severity,
      index,
      message: describe('hidden Markdown link-reference comment', content, signals),
      evidence: escapeForDisplay(content)
    })
  }
  return findings
}

const STRIPPED_ELEMENT =
  /<(script|style|template|noscript|iframe|object|textarea|xmp)\b[^>]*>([\s\S]*?)(?:<\/\1\s*>|$)/giu
const OPEN_TAG = /<([a-z][a-z0-9-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/giu
const HIDING_STYLE =
  /(?:display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?:\.0+)?(?:px|em|rem|pt|%)?\s*(?:;|$)|opacity\s*:\s*0(?:\.0+)?\s*(?:;|$)|(?:max-)?(?:height|width)\s*:\s*0(?:px)?\s*(?:;|$)|(?<![\w-])color\s*:\s*(?:transparent|white|#fff\b|#ffffff\b)|clip-path|text-indent\s*:\s*-\d{3,})/iu
const ATTRIBUTE =
  /\b(alt|title|aria-label|aria-description|data-[\w-]+|placeholder|summary)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/giu
const MD_IMAGE_ALT = /!\[([^\]\n]{20,})\]\(/gu
const MD_LINK_TITLE = /\]\([^)\s]+\s+(?:"([^"\n]{20,})"|'([^'\n]{20,})')\)/gu

function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

/**
 * Detects HTML that GitHub strips or that is styled to be invisible, and attribute text
 * (alt, title, …) that is not normally shown but is read by AI tools.
 */
export function detectHiddenHtml(masked: string, options: MarkupOptions): DetectorFinding[] {
  const findings: DetectorFinding[] = []

  for (const m of masked.matchAll(STRIPPED_ELEMENT)) {
    const tag = (m[1] ?? '').toLowerCase()
    const content = textOf(m[2] ?? '')
    if (content === '') continue
    const { severity, signals } = classify(content, options, 'medium')
    findings.push({
      rule: 'hidden-html',
      severity,
      index: m.index,
      message: describe(`content inside <${tag}>, which GitHub does not display`, content, signals),
      evidence: escapeForDisplay(content)
    })
  }

  for (const m of masked.matchAll(OPEN_TAG)) {
    const tag = (m[1] ?? '').toLowerCase()
    const attrs = m[2] ?? ''
    const style = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/iu.exec(attrs)
    const styleValue = style?.[1] ?? style?.[2] ?? ''
    const hiddenAttr = /(?:^|\s)hidden(?:\s|=|$)/iu.test(attrs) || /aria-hidden\s*=\s*["']?true/iu.test(attrs)
    if (hiddenAttr || HIDING_STYLE.test(styleValue)) {
      const after = masked.slice(m.index + m[0].length)
      const close = after.search(new RegExp(`</${tag}\\s*>`, 'iu'))
      const content = textOf(after.slice(0, close === -1 ? 500 : Math.min(close, 2000)))
      if (content !== '') {
        const { severity, signals } = classify(content, options, 'medium')
        findings.push({
          rule: 'hidden-html',
          severity,
          index: m.index,
          message: describe(`<${tag}> element marked as hidden or styled to be invisible`, content, signals),
          evidence: escapeForDisplay(content)
        })
      }
    }
    for (const a of attrs.matchAll(ATTRIBUTE)) {
      reportAttribute(findings, m.index, `${a[1] ?? 'attribute'} attribute`, a[2] ?? a[3] ?? a[4] ?? '')
    }
  }

  for (const m of masked.matchAll(MD_IMAGE_ALT)) reportAttribute(findings, m.index, 'image alt text', m[1] ?? '')
  for (const m of masked.matchAll(MD_LINK_TITLE)) reportAttribute(findings, m.index, 'link title', m[1] ?? m[2] ?? '')

  return findings
}

/** Attribute text is visible on hover or to screen readers, so only AI-directed text is reported. */
function reportAttribute(findings: DetectorFinding[], index: number, what: string, value: string): void {
  const signals = injectionSignals(value)
  if (signals.length === 0) return
  findings.push({
    rule: 'hidden-attribute-text',
    severity: 'high',
    index,
    message: describe(`${what} that is not normally displayed`, value, signals),
    evidence: escapeForDisplay(value)
  })
}
