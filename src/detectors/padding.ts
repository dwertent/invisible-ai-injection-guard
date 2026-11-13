// SPDX-License-Identifier: MIT

import { escapeForDisplay } from '../text.js'
import type { DetectorFinding } from '../types.js'
import { injectionSignals } from './injection.js'

/** Code points that render as blank space (no-break space, Hangul and Braille fillers, zero-width characters). */
const FILLERS = new Set([0xa0, 0x115f, 0x1160, 0x200b, 0x200c, 0x200d, 0x2060, 0x2800, 0x3164, 0xfeff, 0xffa0])
const BLANK_MARKUP = /&nbsp;|&#160;|&#xa0;|<br\s*\/?>|<p>\s*<\/p>|\\/giu

/**
 * A line that renders as empty vertical space: whitespace, invisible fillers, `&nbsp;`
 * entities, or bare `<br>` / empty `<p>` tags.
 */
function isVisuallyEmpty(line: string): boolean {
  for (const ch of line.replace(BLANK_MARKUP, '')) {
    const cp = ch.codePointAt(0) ?? 0
    if (!/\s/u.test(ch) && !FILLERS.has(cp)) return false
  }
  return true
}

/**
 * Detects long runs of visually empty lines followed by more content, a technique used
 * to push hidden instructions out of view in the rendered page.
 */
export function detectPadding(text: string, maxBlankLines: number): DetectorFinding[] {
  const findings: DetectorFinding[] = []
  const lines = text.split('\n')
  let offset = 0
  let runStart = -1
  let runStartOffset = 0
  let runLength = 0

  for (const line of lines) {
    if (isVisuallyEmpty(line)) {
      if (runLength === 0) {
        runStart = offset
        runStartOffset = offset
      }
      runLength++
    } else {
      if (runLength > maxBlankLines && runStart !== -1) {
        const rest = text.slice(offset).trim()
        const signals = injectionSignals(rest)
        findings.push({
          rule: 'blank-line-padding',
          severity: signals.length > 0 ? 'high' : 'medium',
          index: runStartOffset,
          message:
            signals.length > 0
              ? `${runLength} visually empty lines push later content out of view; that content contains text aimed at AI tools: ${signals.join(', ')}`
              : `${runLength} visually empty lines push later content out of view`,
          evidence: escapeForDisplay(rest)
        })
      }
      runLength = 0
      runStart = -1
    }
    offset += line.length + 1
  }
  return findings
}
