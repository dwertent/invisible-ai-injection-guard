// SPDX-License-Identifier: MIT

/** Formats a code point as `U+XXXX`. */
export function codePointLabel(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`
}

/** Resolves a UTF-16 offset to a 1-based line and code-point column. */
export function locate(text: string, index: number): { line: number; column: number } {
  let line = 1
  let lineStart = 0
  for (let i = 0; i < index && i < text.length; i++) {
    if (text.charCodeAt(i) === 0x0a) {
      line++
      lineStart = i + 1
    }
  }
  const column = Array.from(text.slice(lineStart, index)).length + 1
  return { line, column }
}

const SAFE_CHAR = /[\p{L}\p{N}\p{P}\p{S} ]/u

/**
 * Renders untrusted text so that it is safe to show in a Markdown code span:
 * every invisible, control, format or non-space whitespace character is shown as
 * an escape, backticks are escaped, and the result is truncated.
 */
export function escapeForDisplay(text: string, maxLength = 60): string {
  let out = ''
  let count = 0
  for (const ch of text) {
    if (count >= maxLength) {
      out += '…'
      break
    }
    const cp = ch.codePointAt(0) ?? 0
    if (ch === '`') out += '\\x60'
    else if (ch === '\\') out += '\\\\'
    else if (ch === '\n') out += '\\n'
    else if (ch === '\t') out += '\\t'
    else if (ch === '|') out += '\\|'
    else if (SAFE_CHAR.test(ch) && !isInvisibleish(cp)) out += ch
    else out += `\\u{${cp.toString(16).toUpperCase()}}`
    count++
  }
  return out
}

function isInvisibleish(cp: number): boolean {
  return (
    (cp >= 0xe0000 && cp <= 0xe0fff) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    cp === 0x2800 ||
    cp === 0x3164 ||
    cp === 0xffa0 ||
    cp === 0x115f ||
    cp === 0x1160
  )
}

/** Collapses whitespace so that comments can be compared regardless of formatting. */
export function normalizeSnippet(text: string): string {
  return text.replace(/\s+/gu, ' ').trim().toLowerCase()
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/

/**
 * Returns a copy of `text` of identical length in which fenced code blocks and
 * inline code spans are replaced by spaces (newlines are kept). Markup inside code
 * renders literally, so it is visible and must not be reported as hidden.
 */
export function maskCode(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let fence: { char: string; length: number } | undefined
  let paragraph: string[] = []

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      out.push(...maskInlineCode(paragraph.join('\n')).split('\n'))
      paragraph = []
    }
  }

  for (const line of lines) {
    if (fence) {
      out.push(blank(line))
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)
      if (close?.[1] && close[1][0] === fence.char && close[1].length >= fence.length) {
        fence = undefined
      }
      continue
    }
    const open = FENCE_OPEN.exec(line)
    if (open?.[1]) {
      const marker = open[1]
      // A backtick fence's info string may not contain backticks.
      if (marker[0] !== '`' || !line.slice(open[0].length).includes('`')) {
        flushParagraph()
        fence = { char: marker[0] ?? '`', length: marker.length }
        out.push(blank(line))
        continue
      }
    }
    if (line.trim() === '') {
      flushParagraph()
      out.push(line)
    } else {
      paragraph.push(line)
    }
  }
  flushParagraph()
  return out.join('\n')
}

function maskInlineCode(block: string): string {
  return block.replace(/(`+)(?!`)([\s\S]*?[^`])\1(?!`)/gu, (match) => blank(match))
}

function blank(text: string): string {
  return text.replace(/[^\n]/gu, (ch) => ' '.repeat(ch.length))
}
