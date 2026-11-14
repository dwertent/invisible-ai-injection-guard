// SPDX-License-Identifier: MIT

/**
 * Helpers for the end-to-end suite: parse example files, decode their escape notation,
 * and run the bundled action (dist/index.js) as a real Node.js process with a fake
 * GitHub event. No GitHub API calls are made.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface Case {
  name: string
  meta: Record<string, string>
  body: string
}

/**
 * Splits an example file into its `key: value` front matter and Markdown body.
 * Front matter is delimited by `---` lines; values are plain strings.
 */
export function parseCase(name: string, source: string): Case {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/u.exec(source)
  if (!match) throw new Error(`${name}: missing front matter`)
  const meta: Record<string, string> = {}
  for (const line of (match[1] ?? '').split('\n')) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    const sep = line.indexOf(':')
    if (sep === -1) throw new Error(`${name}: invalid front matter line "${line}"`)
    meta[line.slice(0, sep).trim()] = line.slice(sep + 1).trim()
  }
  return { name, meta, body: (match[2] ?? '').replace(/\n$/u, '') }
}

/**
 * Decodes the escape notation used in example files so that they contain no literal
 * invisible characters:
 *
 * - `{U+200B}` one code point; `{U+200B*20}` repeated
 * - `{TAG:text}` text encoded as invisible Unicode tag characters
 * - `{VS:text}` text encoded as variation selectors (one per UTF-8 byte)
 * - `{NL*40}` repeated newlines
 */
export function decode(text: string): string {
  return text.replace(
    /\{(U\+[0-9A-Fa-f]{4,6}|TAG|VS|NL)(?:\*(\d+))?(?::([^}]*))?\}/gu,
    (_, kind: string, times?: string, arg?: string) => {
      const n = times === undefined ? 1 : Number(times)
      if (kind === 'NL') return '\n'.repeat(n)
      if (kind === 'TAG')
        return Array.from(arg ?? '', (c) => String.fromCodePoint(0xe0000 + (c.codePointAt(0) ?? 0))).join('')
      if (kind === 'VS') {
        const bytes = new TextEncoder().encode(arg ?? '')
        return Array.from(bytes, (b) => String.fromCodePoint(b < 16 ? 0xfe00 + b : 0xe0100 + b - 16)).join('')
      }
      return String.fromCodePoint(Number.parseInt(kind.slice(2), 16)).repeat(n)
    }
  )
}

const DEFAULT_ACTION: Record<string, string> = {
  issues: 'opened',
  pull_request: 'opened',
  pull_request_target: 'opened',
  issue_comment: 'created',
  pull_request_review_comment: 'created',
  pull_request_review: 'submitted'
}

/** Builds a webhook payload for the case's event. */
export function buildEvent(c: Case): { eventName: string; payload: Record<string, unknown> } {
  const eventName = c.meta['event'] ?? 'issues'
  const action = c.meta['action'] ?? DEFAULT_ACTION[eventName] ?? 'opened'
  const body = decode(c.body)
  const title = decode(c.meta['title'] ?? 'Example')
  const author = { login: c.meta['author'] ?? 'contributor', type: c.meta['author-type'] ?? 'User' }
  const association = c.meta['association'] ?? 'NONE'
  const item = { number: 42, title, state: 'open', labels: [], user: { login: 'reporter', type: 'User' } }
  const comment = { id: 1001, node_id: 'IC_e2e', html_url: 'https://github.com/e2e/repo/issues/42#issuecomment-1001' }

  switch (eventName) {
    case 'issues':
      return { eventName, payload: { action, issue: { ...item, body, user: author, author_association: association } } }
    case 'pull_request':
    case 'pull_request_target':
      return {
        eventName,
        payload: { action, pull_request: { ...item, body, user: author, author_association: association } }
      }
    case 'issue_comment':
      return {
        eventName,
        payload: {
          action,
          issue: { ...item, body: '' },
          comment: { ...comment, body, user: author, author_association: association }
        }
      }
    case 'pull_request_review_comment':
      return {
        eventName,
        payload: {
          action,
          pull_request: item,
          comment: { ...comment, body, user: author, author_association: association }
        }
      }
    case 'pull_request_review':
      return {
        eventName,
        payload: {
          action,
          pull_request: item,
          review: { ...comment, body, user: author, author_association: association }
        }
      }
    default:
      return { eventName, payload: { action } }
  }
}

export interface RunOutput {
  status: number | null
  stdout: string
  stderr: string
  outputs: Record<string, string>
}

/**
 * Inputs that make API calls are disabled so the action runs offline. The API URL points
 * at a closed local port, so any unexpected request fails fast instead of reaching GitHub.
 */
const OFFLINE_INPUTS: Record<string, string> = {
  'github-token': 'e2e-fake-token',
  'add-label': 'false',
  comment: 'false',
  close: 'false',
  'close-on-comment': 'false',
  'hide-comment': 'false',
  'ignore-template-comments': 'false'
}

export function runAction(distPath: string, c: Case): RunOutput {
  const dir = mkdtempSync(join(tmpdir(), 'iaig-e2e-'))
  try {
    const { eventName, payload } = buildEvent(c)
    const eventPath = join(dir, 'event.json')
    const outputPath = join(dir, 'output.txt')
    writeFileSync(eventPath, JSON.stringify(payload))
    writeFileSync(outputPath, '')

    const inputs: Record<string, string> = { ...OFFLINE_INPUTS }
    for (const [key, value] of Object.entries(c.meta)) {
      if (key.startsWith('input-')) inputs[key.slice('input-'.length)] = value
    }
    const env: Record<string, string> = {
      PATH: process.env['PATH'] ?? '',
      GITHUB_EVENT_NAME: eventName,
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_OUTPUT: outputPath,
      GITHUB_REPOSITORY: 'e2e/repo',
      GITHUB_API_URL: 'http://127.0.0.1:9',
      GITHUB_SERVER_URL: 'https://github.com'
    }
    for (const [key, value] of Object.entries(inputs)) env[`INPUT_${key.toUpperCase()}`] = value

    const result = spawnSync(process.execPath, [distPath], { env, encoding: 'utf8', timeout: 30_000 })
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      outputs: parseOutputFile(readFileSync(outputPath, 'utf8'))
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Parses the `name<<delimiter` format that @actions/core writes to $GITHUB_OUTPUT. */
export function parseOutputFile(content: string): Record<string, string> {
  const outputs: Record<string, string> = {}
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const header = /^([^<]+)<<(.+)$/u.exec(lines[i] ?? '')
    if (!header) continue
    const [, name = '', delimiter] = header
    const value: string[] = []
    while (++i < lines.length && lines[i] !== delimiter) value.push(lines[i] ?? '')
    outputs[name] = value.join('\n')
  }
  return outputs
}
