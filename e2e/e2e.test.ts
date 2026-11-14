// SPDX-License-Identifier: MIT

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decode, parseCase, parseOutputFile, runAction } from './run.js'

const ROOT = join(import.meta.dirname, '..')
const DIST = join(ROOT, 'dist', 'index.js')
const CASES_DIR = join(import.meta.dirname, 'cases')

const list = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)

interface FindingOutput {
  rule: string
  severity: string
  field: string
}

describe('e2e helpers', () => {
  it('decodes the escape notation', () => {
    expect(decode('a{U+200B*2}b')).toBe(`a${String.fromCodePoint(0x200b).repeat(2)}b`)
    expect(decode('{TAG:hi}')).toBe(String.fromCodePoint(0xe0068, 0xe0069))
    expect(decode('{VS:A}')).toBe(String.fromCodePoint(0xe0100 + 0x41 - 16))
    expect(decode('x{NL*3}y')).toBe('x\n\n\ny')
  })

  it('parses multi-line outputs', () => {
    expect(parseOutputFile('a<<EOF\n1\n2\nEOF\nb<<X\nok\nX\n')).toEqual({ a: '1\n2', b: 'ok' })
  })
})

describe('bundled action', () => {
  it('has been built', () => {
    expect(existsSync(DIST), 'run "npm run build" first').toBe(true)
  })

  const files = readdirSync(CASES_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort()

  it.each(files)('%s', (file) => {
    const c = parseCase(file, readFileSync(join(CASES_DIR, file), 'utf8'))
    const { meta } = c
    const result = runAction(DIST, c)
    const context = `\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`

    expect(result.status, `exit code${context}`).toBe(Number(meta['expect-exit-code'] ?? '0'))
    expect(result.outputs['detected'], `detected${context}`).toBe(meta['expect-detected'] ?? 'false')

    const findings = JSON.parse(result.outputs['findings'] ?? '[]') as FindingOutput[]
    const rules = findings.map((f) => f.rule)

    if (meta['expect-max-severity'] !== undefined) {
      expect(result.outputs['max-severity']).toBe(meta['expect-max-severity'])
    }
    if (meta['expect-count'] !== undefined) {
      expect(result.outputs['count']).toBe(meta['expect-count'])
    }
    for (const rule of list(meta['expect-rules'])) {
      expect(rules, `expected rule "${rule}"${context}`).toContain(rule)
    }
    for (const rule of list(meta['expect-no-rules'])) {
      expect(rules, `unexpected rule "${rule}"${context}`).not.toContain(rule)
    }
    for (const field of list(meta['expect-fields'])) {
      expect(findings.map((f) => f.field)).toContain(field)
    }
    for (const text of list(meta['expect-stdout'])) {
      expect(result.stdout, context).toContain(text)
    }

    // Every finding is annotated (GitHub shows at most 10 per step), and no API call was attempted.
    const annotations = result.stdout.split('\n').filter((l) => l.startsWith('::warning title=Hidden content::'))
    expect(annotations).toHaveLength(Math.min(findings.length, 10))
    expect(result.stdout).not.toMatch(/ECONNREFUSED|Failed to /u)
    // The raw hidden payload never appears in the log.
    expect(/\p{Cf}/u.test(result.stdout)).toBe(false)
  })
})
