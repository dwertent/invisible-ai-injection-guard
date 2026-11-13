// SPDX-License-Identifier: MIT

import { extractHtmlComments, extractMarkdownComments } from './detectors/markup.js'
import { maskCode, normalizeSnippet } from './text.js'
import type { Octokit } from './github.js'

const TEMPLATE_NAME = /^(?:pull_request_template|issue_template)(?:\.(?:md|markdown|txt))?$/iu
const TEMPLATE_DIR = /^(?:pull_request_template|issue_template)$/iu
const TEMPLATE_FILE = /\.(?:md|markdown|txt|ya?ml)$/iu
const MAX_FILES = 50

interface Entry {
  type: string
  name: string
  path: string
}

export interface Logger {
  debug(message: string): void
  warning(message: string): void
}

/**
 * Collects the hidden snippets (HTML comments and Markdown comments) that appear in the
 * repository's issue and pull request templates. Text copied from a template is expected
 * to keep those comments, so they are not reported.
 *
 * Falls back to the owner's `.github` repository, which GitHub uses for default templates.
 */
export async function loadTemplateSnippets(
  octokit: Octokit,
  owner: string,
  repo: string,
  log: Logger
): Promise<Set<string>> {
  const snippets = new Set<string>()
  let files = await findTemplates(octokit, owner, repo, log)
  let source = repo
  if (files.length === 0 && repo !== '.github') {
    files = await findTemplates(octokit, owner, '.github', log)
    source = '.github'
  }
  for (const path of files.slice(0, MAX_FILES)) {
    const content = await readFile(octokit, owner, source, path, log)
    if (content === undefined) continue
    for (const snippet of extractSnippets(content)) snippets.add(snippet)
  }
  log.debug(`Loaded ${snippets.size} template snippet(s) from ${files.length} file(s) in ${owner}/${source}.`)
  return snippets
}

export function extractSnippets(content: string): string[] {
  const masked = maskCode(content)
  return [
    ...extractHtmlComments(masked)
      .filter((c) => c.terminated)
      .map((c) => c.content),
    ...extractMarkdownComments(masked).map((c) => c.content)
  ]
    .map(normalizeSnippet)
    .filter(Boolean)
}

async function findTemplates(octokit: Octokit, owner: string, repo: string, log: Logger): Promise<string[]> {
  const files: string[] = []
  for (const dir of ['', '.github', 'docs']) {
    const entries = await listDir(octokit, owner, repo, dir, log)
    for (const entry of entries) {
      if (entry.type === 'file' && TEMPLATE_NAME.test(entry.name)) files.push(entry.path)
      if (entry.type === 'dir' && TEMPLATE_DIR.test(entry.name)) {
        const nested = await listDir(octokit, owner, repo, entry.path, log)
        files.push(...nested.filter((e) => e.type === 'file' && TEMPLATE_FILE.test(e.name)).map((e) => e.path))
      }
    }
  }
  return files
}

async function listDir(octokit: Octokit, owner: string, repo: string, path: string, log: Logger): Promise<Entry[]> {
  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path })
    return Array.isArray(data) ? data.map((e) => ({ type: e.type, name: e.name, path: e.path })) : []
  } catch (error) {
    if (statusOf(error) !== 404) log.warning(`Could not list "${path || '/'}" in ${owner}/${repo}: ${messageOf(error)}`)
    return []
  }
}

async function readFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  log: Logger
): Promise<string | undefined> {
  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path })
    if (Array.isArray(data) || data.type !== 'file' || !('content' in data)) return undefined
    return Buffer.from(data.content, 'base64').toString('utf8')
  } catch (error) {
    log.warning(`Could not read template ${owner}/${repo}/${path}: ${messageOf(error)}`)
    return undefined
  }
}

export function statusOf(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const { status } = error
    return typeof status === 'number' ? status : undefined
  }
  return undefined
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
