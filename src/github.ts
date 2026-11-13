// SPDX-License-Identifier: MIT

import type { getOctokit } from '@actions/github'
import { statusOf } from './templates.js'

export type Octokit = ReturnType<typeof getOctokit>

export const REPORT_MARKER = '<!-- invisible-ai-injection-guard:report -->'

export interface Target {
  kind: 'issue' | 'pull_request'
  owner: string
  repo: string
  number: number
  title: string
  body: string
  author: string
  authorAssociation: string
  state: string
  labels: string[]
}

export interface EventContext {
  eventName: string
  payload: Record<string, unknown>
  repo: { owner: string; repo: string }
}

const SUPPORTED_ACTIONS = new Set(['opened', 'edited', 'reopened'])

type ResolveResult = { target: Target } | { skip: string }

/** Builds the scan target from the triggering event, or explains why the event is skipped. */
export function resolveTarget(context: EventContext): ResolveResult {
  const { eventName, payload } = context
  const action = typeof payload['action'] === 'string' ? payload['action'] : ''
  let kind: Target['kind']
  let item: unknown
  if (eventName === 'issues') {
    kind = 'issue'
    item = payload['issue']
  } else if (eventName === 'pull_request' || eventName === 'pull_request_target') {
    kind = 'pull_request'
    item = payload['pull_request']
  } else {
    return {
      skip: `Event "${eventName}" is not supported. Trigger this action on "issues", "pull_request" or "pull_request_target".`
    }
  }
  if (!SUPPORTED_ACTIONS.has(action)) {
    return { skip: `Event action "${action}" does not change the title or description; nothing to scan.` }
  }
  if (typeof item !== 'object' || item === null) return { skip: `The "${eventName}" payload has no ${kind}.` }

  const record = item as Record<string, unknown>
  const user = (record['user'] ?? {}) as Record<string, unknown>
  const labels = Array.isArray(record['labels']) ? record['labels'] : []
  return {
    target: {
      kind,
      owner: context.repo.owner,
      repo: context.repo.repo,
      number: Number(record['number']),
      title: typeof record['title'] === 'string' ? record['title'] : '',
      body: typeof record['body'] === 'string' ? record['body'] : '',
      author: typeof user['login'] === 'string' ? user['login'] : '',
      authorAssociation: typeof record['author_association'] === 'string' ? record['author_association'] : '',
      state: typeof record['state'] === 'string' ? record['state'] : 'open',
      labels: labels
        .map((l) => (typeof l === 'string' ? l : (l as { name?: unknown }).name))
        .filter((l): l is string => typeof l === 'string')
    }
  }
}

/** Creates the label if it is missing, then applies it. */
export async function addLabel(
  octokit: Octokit,
  target: Target,
  label: { name: string; color: string; description: string }
): Promise<void> {
  const { owner, repo, number } = target
  try {
    await octokit.rest.issues.getLabel({ owner, repo, name: label.name })
  } catch (error) {
    if (statusOf(error) !== 404) throw error
    try {
      await octokit.rest.issues.createLabel({ owner, repo, ...label })
    } catch (createError) {
      // 422: another run created it concurrently.
      if (statusOf(createError) !== 422) throw createError
    }
  }
  await octokit.rest.issues.addLabels({ owner, repo, issue_number: number, labels: [label.name] })
}

export async function removeLabel(octokit: Octokit, target: Target, name: string): Promise<boolean> {
  try {
    await octokit.rest.issues.removeLabel({ owner: target.owner, repo: target.repo, issue_number: target.number, name })
    return true
  } catch (error) {
    if (statusOf(error) === 404) return false
    throw error
  }
}

export async function close(octokit: Octokit, target: Target): Promise<void> {
  const { owner, repo, number } = target
  if (target.kind === 'issue') {
    await octokit.rest.issues.update({
      owner,
      repo,
      issue_number: number,
      state: 'closed',
      state_reason: 'not_planned'
    })
  } else {
    await octokit.rest.pulls.update({ owner, repo, pull_number: number, state: 'closed' })
  }
}

/** Finds the report comment previously written by this action (authored by a bot account). */
export async function findReportComment(octokit: Octokit, target: Target): Promise<number | undefined> {
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner: target.owner,
    repo: target.repo,
    issue_number: target.number,
    per_page: 100
  })
  const ours = comments.filter((c) => c.body?.includes(REPORT_MARKER) && c.user?.type === 'Bot')
  return ours.at(-1)?.id
}

export async function upsertReportComment(
  octokit: Octokit,
  target: Target,
  body: string
): Promise<'created' | 'updated'> {
  const { owner, repo } = target
  const existing = await findReportComment(octokit, target)
  if (existing !== undefined) {
    await octokit.rest.issues.updateComment({ owner, repo, comment_id: existing, body })
    return 'updated'
  }
  await octokit.rest.issues.createComment({ owner, repo, issue_number: target.number, body })
  return 'created'
}
