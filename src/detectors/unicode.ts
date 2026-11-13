// SPDX-License-Identifier: MIT

import { codePointLabel, escapeForDisplay } from '../text.js'
import type { DetectorFinding, RuleId, Severity } from '../types.js'

type Category = 'tag' | 'bidi' | 'mark' | 'invisible' | 'variation'

interface CodePoint {
  cp: number
  index: number
}

const PICTOGRAPHIC = /\p{Extended_Pictographic}/u
const EMOJI = /\p{Emoji}/u
const EMOJI_MODIFIER = /\p{Emoji_Modifier}/u
const HAN = /\p{Script=Han}/u
const JOINING_LETTER = /[\p{L}\p{M}]/u
const LATIN_OR_COMMON = /[\p{Script=Latin}\p{Script=Common}]/u
const FORMAT = /\p{Cf}/u

const BLACK_FLAG = 0x1f3f4
const CANCEL_TAG = 0xe007f
const ZWNJ = 0x200c
const ZWJ = 0x200d
const VS16 = 0xfe0f
const BOM = 0xfeff
const SOFT_HYPHEN = 0x00ad

/** Characters that render as nothing or as blank space but are not whitespace. */
const INVISIBLE = new Set([
  0x034f, // combining grapheme joiner
  0x115f, // hangul choseong filler
  0x1160, // hangul jungseong filler
  0x17b4, // khmer vowel inherent aq
  0x17b5, // khmer vowel inherent aa
  0x180e, // mongolian vowel separator
  0x200b, // zero width space
  ZWNJ,
  ZWJ,
  0x2060, // word joiner
  0x2061, // function application
  0x2062, // invisible times
  0x2063, // invisible separator
  0x2064, // invisible plus
  0x2800, // braille pattern blank
  0x3164, // hangul filler
  BOM,
  0xffa0, // halfwidth hangul filler
  0x1d159, // musical symbol null notehead
  0x1d173,
  0x1d174,
  0x1d175,
  0x1d176,
  0x1d177,
  0x1d178,
  0x1d179,
  0x1d17a
])

function categorize(cp: number): Category | undefined {
  if (cp >= 0xe0000 && cp <= 0xe007f) return 'tag'
  if ((cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069)) return 'bidi'
  if (cp === 0x200e || cp === 0x200f || cp === 0x061c) return 'mark'
  if ((cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef)) return 'variation'
  if (INVISIBLE.has(cp) || cp === SOFT_HYPHEN) return 'invisible'
  if (FORMAT.test(String.fromCodePoint(cp))) return 'invisible'
  return undefined
}

function toCodePoints(text: string): CodePoint[] {
  const out: CodePoint[] = []
  let index = 0
  for (const ch of text) {
    out.push({ cp: ch.codePointAt(0) ?? 0, index })
    index += ch.length
  }
  return out
}

function is(re: RegExp, cp: number | undefined): boolean {
  return cp !== undefined && re.test(String.fromCodePoint(cp))
}

/**
 * Detects invisible and direction-changing Unicode characters, which can hide text
 * from human reviewers while remaining fully readable to a language model.
 */
export function detectUnicode(text: string): DetectorFinding[] {
  const cps = toCodePoints(text)
  const findings: DetectorFinding[] = []

  let i = 0
  while (i < cps.length) {
    const current = cps[i]
    if (!current) break
    const category = categorize(current.cp)
    if (category === undefined) {
      i++
      continue
    }

    // Group a run of consecutive characters of the same category.
    let end = i + 1
    while (end < cps.length && categorize(cps[end]?.cp ?? 0) === category) end++
    const run = cps.slice(i, end)
    const prev = cps[i - 1]?.cp
    const next = cps[end]?.cp

    const finding = evaluateRun(category, run, prev, next, i === 0)
    if (finding) findings.push({ ...finding, index: current.index })
    i = end
  }
  return findings
}

function evaluateRun(
  category: Category,
  run: CodePoint[],
  prev: number | undefined,
  next: number | undefined,
  atStart: boolean
): Omit<DetectorFinding, 'index'> | undefined {
  const codes = run.map((c) => c.cp)
  const labels = summarizeCodePoints(codes)

  switch (category) {
    case 'tag': {
      // Subdivision flags (e.g. Scotland) are U+1F3F4 followed by tag letters and CANCEL TAG.
      if (prev === BLACK_FLAG && codes.at(-1) === CANCEL_TAG && codes.length <= 7) return undefined
      const decoded = codes
        .filter((cp) => cp >= 0xe0020 && cp <= 0xe007e)
        .map((cp) => String.fromCodePoint(cp - 0xe0000))
        .join('')
      return finding(
        'unicode-tag',
        'high',
        `${codes.length} invisible Unicode tag character(s) (${labels}); these can smuggle hidden ASCII text`,
        decoded ? `decodes to: ${escapeForDisplay(decoded)}` : undefined
      )
    }
    case 'bidi': {
      // Overrides force a display order and are the core of "Trojan Source" style attacks;
      // embeddings and isolates are occasionally pasted along with right-to-left text.
      const override = codes.some((cp) => cp === 0x202d || cp === 0x202e)
      return finding(
        'bidi-control',
        override ? 'high' : 'medium',
        `${codes.length} bidirectional control character(s) (${labels}) that can change how text is displayed`
      )
    }
    case 'mark':
      return finding(
        'directional-mark',
        'low',
        `${codes.length} directional mark(s) (${labels}); usually harmless in right-to-left text`
      )
    case 'variation': {
      const base = prev
      const single = codes.length === 1
      const cp = codes[0] ?? 0
      if (single && cp <= 0xfe0f && (is(EMOJI, base) || is(HAN, base))) return undefined
      if (single && cp >= 0xe0100 && is(HAN, base)) return undefined
      const decoded = decodeVariationSelectors(codes)
      return finding(
        'variation-selector',
        codes.length > 1 || cp >= 0xe0100 ? 'high' : 'medium',
        codes.length > 1
          ? `${codes.length} consecutive variation selectors (${labels}); runs like this can encode hidden data`
          : `unexpected variation selector (${labels}) that does not modify the preceding character`,
        decoded ? `decodes to: ${escapeForDisplay(decoded)}` : undefined
      )
    }
    case 'invisible': {
      if (codes.length === 1) {
        const cp = codes[0] ?? 0
        if (cp === BOM && atStart) return undefined
        if (cp === ZWJ && isEmojiJoin(prev, next)) return undefined
        if ((cp === ZWJ || cp === ZWNJ) && isScriptJoin(prev, next)) return undefined
      }
      const onlySoftHyphen = codes.every((cp) => cp === SOFT_HYPHEN)
      const severity: Severity = onlySoftHyphen ? 'low' : codes.length >= 8 ? 'high' : 'medium'
      return finding(
        'invisible-character',
        severity,
        codes.length >= 8
          ? `${codes.length} consecutive invisible characters (${labels}); long runs can encode hidden data`
          : `${codes.length} invisible character(s) (${labels})`
      )
    }
  }
}

function finding(rule: RuleId, severity: Severity, message: string, evidence?: string): Omit<DetectorFinding, 'index'> {
  return evidence === undefined ? { rule, severity, message } : { rule, severity, message, evidence }
}

function isEmojiJoin(prev: number | undefined, next: number | undefined): boolean {
  const prevOk = is(PICTOGRAPHIC, prev) || prev === VS16 || is(EMOJI_MODIFIER, prev)
  return prevOk && is(PICTOGRAPHIC, next)
}

/** ZWJ/ZWNJ are required for correct shaping in scripts such as Arabic, Persian and Devanagari. */
function isScriptJoin(prev: number | undefined, next: number | undefined): boolean {
  return (
    is(JOINING_LETTER, prev) && is(JOINING_LETTER, next) && !(is(LATIN_OR_COMMON, prev) && is(LATIN_OR_COMMON, next))
  )
}

/** Variation selectors map to bytes: U+FE00–FE0F → 0–15, U+E0100–E01EF → 16–255. */
function decodeVariationSelectors(codes: number[]): string | undefined {
  if (codes.length < 2) return undefined
  const bytes = codes.map((cp) => (cp <= 0xfe0f ? cp - 0xfe00 : cp - 0xe0100 + 16))
  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(Uint8Array.from(bytes))
  const printable = Array.from(decoded).filter((ch) => /[\p{L}\p{N}\p{P}\p{S} ]/u.test(ch)).length
  return printable >= Math.max(2, decoded.length * 0.6) ? decoded : undefined
}

function summarizeCodePoints(codes: number[]): string {
  const unique = [...new Set(codes)]
  const shown = unique.slice(0, 4).map(codePointLabel).join(', ')
  return unique.length > 4 ? `${shown}, …` : shown
}
