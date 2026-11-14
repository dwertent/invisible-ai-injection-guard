// SPDX-License-Identifier: MIT

import type { getOctokit } from '@actions/github'
import { statusOf } from './templates.js'

export type Octokit = ReturnType<typeof getOctokit>

export const REPORT_MARKER = '<!-- invisible-ai-injection-guard:report -->'

export type CommentKind = 'issue_comment' | 'review_comment' | 'review'

/** What was scanned: the title and description, or a single comment. */
export type Subject =
  { type: 'description' } | { type: 'comment'; kind: CommentKind; id: number; nodeId: string; url: string }

export interface Target {
  /** The issue or pull request the scanned content belongs to. */
  kind: 'issue' | 'pull_request'
  owner: string
  repo: string
  number: number
  subject: Subject
  /** Title of the item; only scanned for descriptions. */
  title: string
  /** The scanned text: the description or the comment body. */
  body: string
  /** Author of the scanned text. */
  author: string
  authorAssociation: string
  /** State of the issue or pull request. */
  state: string
  labels: string[]
}

export interface EventContext {
  eventName: string
  payload: Record<string, unknown>
  repo: { owner: string; repo: string }
}

type ResolveResult = { target: Target } | { skip: string }

interface EventSpec {
  actions: ReadonlySet<string>
  parent: 'issue' | 'pull_request'
  comment?: { key: 'comment' | 'review'; kind: CommentKind }
}

const DESCRIPTION_ACTIONS = new Set(['opened', 'edited', 'reopened'])
const COMMENT_ACTIONS = new Set(['created', 'edited'])

const EVENTS: Readonly<Record<string, EventSpec>> = {
  issues: { actions: DESCRIPTION_ACTIONS, parent: 'issue' },
  pull_request: { actions: DESCRIPTION_ACTIONS, parent: 'pull_request' },
  pull_request_target: { actions: DESCRIPTION_ACTIONS, parent: 'pull_request' },
  issue_comment: { actions: COMMENT_ACTIONS, parent: 'issue', comment: { key: 'comment', kind: 'issue_comment' } },
  pull_request_review_comment: {
    actions: COMMENT_ACTIONS,
    parent: 'pull_request',
    comment: { key: 'comment', kind: 'review_comment' }
  },
  pull_request_review: {
    actions: new Set(['submitted', 'edited']),
    parent: 'pull_request',
    comment: { key: 'review', kind: 'review' }
  }
}

function str(record: Record<string, unknown>, key: string, fallback = ''): string {
  const value = record[key]
  return typeof value === 'string' ? value : fallback
}

function obj(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined
}

/** Returns the marker that identifies this action's report comment for a subject. */
export function reportMarker(subject: Subject): string {
  return subject.type === 'description'
    ? REPORT_MARKER
    : `<!-- invisible-ai-injection-guard:report:${subject.kind}-${subject.id} -->`
}

/** Builds the scan target from the triggering event, or explains why the event is skipped. */
export function resolveTarget(context: EventContext): ResolveResult {
  const { eventName, payload } = context
  const spec = EVENTS[eventName]
  if (!spec) {
    return {
      skip: `Event "${eventName}" is not supported. Supported events: ${Object.keys(EVENTS).join(', ')}.`
    }
  }
  const action = str(payload, 'action')
  if (!spec.actions.has(action)) {
    return { skip: `Event action "${action}" does not add or change text; nothing to scan.` }
  }

  const parentKey = spec.parent === 'issue' ? 'issue' : 'pull_request'
  const parent = obj(payload[parentKey])
  if (!parent) return { skip: `The "${eventName}" payload has no ${parentKey}.` }
  // Comments on pull requests arrive as issue_comment events on an issue with a `pull_request` key.
  const kind = spec.parent === 'issue' && obj(parent['pull_request']) ? 'pull_request' : spec.parent

  const labels = Array.isArray(parent['labels']) ? parent['labels'] : []
  const base = {
    kind,
    owner: context.repo.owner,
    repo: context.repo.repo,
    number: Number(parent['number']),
    state: str(parent, 'state', 'open'),
    labels: labels
      .map((l) => (typeof l === 'string' ? l : obj(l)?.['name']))
      .filter((l): l is string => typeof l === 'string')
  } as const

  let source = parent
  let subject: Subject = { type: 'description' }
  if (spec.comment) {
    const comment = obj(payload[spec.comment.key])
    if (!comment) return { skip: `The "${eventName}" payload has no ${spec.comment.key}.` }
    source = comment
    subject = {
      type: 'comment',
      kind: spec.comment.kind,
      id: Number(comment['id']),
      nodeId: str(comment, 'node_id'),
      url: str(comment, 'html_url')
    }
    const user = obj(comment['user']) ?? {}
    if (str(user, 'type') === 'Bot' && str(comment, 'body').includes('<!-- invisible-ai-injection-guard:report')) {
      return { skip: 'Skipping a report comment written by this action.' }
    }
  }

  const user = obj(source['user']) ?? {}
  return {
    target: {
      ...base,
      subject,
      title: subject.type === 'description' ? str(parent, 'title') : '',
      body: str(source, 'body'),
      author: str(user, 'login'),
      authorAssociation: str(source, 'author_association')
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
  const marker = reportMarker(target.subject)
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner: target.owner,
    repo: target.repo,
    issue_number: target.number,
    per_page: 100
  })
  const ours = comments.filter((c) => c.body?.includes(marker) && c.user?.type === 'Bot')
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

const HIDE_MUTATION = `
  mutation ($id: ID!, $classifier: ReportedContentClassifiers!) {
    minimizeComment(input: { subjectId: $id, classifier: $classifier }) {
      minimizedComment {
        isMinimized
      }
    }
  }
`

/** Collapses ("minimizes") a comment for everyone. Pull request reviews cannot be minimized. */
export async function hideComment(octokit: Octokit, target: Target, classifier: string): Promise<boolean> {
  if (target.subject.type !== 'comment' || target.subject.kind === 'review' || target.subject.nodeId === '') {
    return false
  }
  await octokit.graphql(HIDE_MUTATION, { id: target.subject.nodeId, classifier })
  return true
}
