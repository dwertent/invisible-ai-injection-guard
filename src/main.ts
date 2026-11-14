// SPDX-License-Identifier: MIT

import * as core from '@actions/core'
import * as github from '@actions/github'
import type { Config } from './config.js'
import { ConfigError, readConfig } from './config.js'
import type { EventContext, Octokit, Target } from './github.js'
import {
  addLabel,
  close,
  findReportComment,
  hideComment,
  removeLabel,
  resolveTarget,
  upsertReportComment
} from './github.js'
import { buildReportComment, buildResolvedComment, formatFinding, formatLocation } from './report.js'
import { DEFAULT_SCAN_OPTIONS, scan } from './scan.js'
import { loadTemplateSnippets, messageOf, statusOf } from './templates.js'
import type { Finding } from './types.js'
import { atLeast, maxSeverity } from './types.js'

export type Core = Pick<
  typeof core,
  'getInput' | 'setOutput' | 'info' | 'debug' | 'warning' | 'error' | 'setFailed' | 'summary'
>

export interface Dependencies {
  core: Core
  context: EventContext
  getOctokit: (token: string) => Octokit
}

const MAX_ANNOTATIONS = 10

function defaultDependencies(): Dependencies {
  return {
    core,
    context: { eventName: github.context.eventName, payload: github.context.payload, repo: github.context.repo },
    getOctokit: (token) => github.getOctokit(token)
  }
}

export interface RunResult {
  findings: Finding[]
  actions: string[]
}

/** Entry point. Never throws: failures are reported through `core.setFailed`. */
export async function run(deps: Dependencies = defaultDependencies()): Promise<RunResult | undefined> {
  const { core: io } = deps
  try {
    return await execute(deps)
  } catch (error) {
    const prefix = error instanceof ConfigError ? 'Invalid configuration: ' : ''
    io.setFailed(`${prefix}${messageOf(error)}`)
    return undefined
  }
}

async function execute(deps: Dependencies): Promise<RunResult | undefined> {
  const { core: io, context } = deps
  const config = readConfig(io)

  const resolved = resolveTarget(context)
  if ('skip' in resolved) {
    io.info(resolved.skip)
    setOutputs(io, [])
    return undefined
  }
  const { target } = resolved
  const isComment = target.subject.type === 'comment'
  const item = `${target.kind === 'issue' ? 'issue' : 'pull request'} #${target.number}`
  const ref =
    target.subject.type === 'comment'
      ? `${target.subject.kind.replace('_', ' ')} ${target.subject.id} on ${item}`
      : item

  if (isExempt(config, target)) {
    io.info(`Skipping ${ref}: author "${target.author}" (${target.authorAssociation}) is exempt.`)
    setOutputs(io, [])
    return { findings: [], actions: [] }
  }

  const octokit = deps.getOctokit(config.token)

  let ignoredSnippets: Set<string> = new Set()
  // Templates only seed titles and descriptions, so they are not consulted for comments.
  if (config.ignoreTemplateComments && !isComment) {
    try {
      ignoredSnippets = await loadTemplateSnippets(octokit, target.owner, target.repo, io)
    } catch (error) {
      io.warning(`Could not load issue/PR templates; template comments will be reported: ${messageOf(error)}`)
    }
  }

  const all = scan(
    { title: target.title, body: target.body },
    {
      ...DEFAULT_SCAN_OPTIONS,
      maxBlankLines: config.maxBlankLines,
      maxCommentLength: config.maxCommentLength,
      ignoredSnippets
    },
    isComment ? 'comment' : 'body'
  )
  const findings = all.filter((f) => atLeast(f.severity, config.minSeverity))
  io.info(`Scanned ${ref}: ${all.length} finding(s), ${findings.length} at or above "${config.minSeverity}" severity.`)
  for (const f of all.filter((f) => !findings.includes(f))) io.debug(`Below threshold: ${formatFinding(f)}`)

  setOutputs(io, findings)
  await writeSummary(io, ref, findings)

  const actions: string[] = []
  const errors: string[] = []
  const attempt = async (what: string, fn: () => Promise<string | undefined>): Promise<void> => {
    try {
      const done = await fn()
      if (done) actions.push(done)
    } catch (error) {
      errors.push(`Failed to ${what}: ${explain(error, context.eventName)}`)
    }
  }

  if (findings.length > 0) {
    for (const f of findings.slice(0, MAX_ANNOTATIONS)) io.warning(formatFinding(f), { title: 'Hidden content' })
    if (findings.length > MAX_ANNOTATIONS) io.warning(`…and ${findings.length - MAX_ANNOTATIONS} more finding(s).`)

    if (config.addLabel) {
      await attempt(`add label "${config.label}"`, async () => {
        await addLabel(octokit, target, {
          name: config.label,
          color: config.labelColor,
          description: config.labelDescription
        })
        return `added label \`${config.label}\``
      })
    }
    if (isComment && config.hideComment) {
      await attempt('hide the comment', async () =>
        (await hideComment(octokit, target, config.hideCommentReason)) ? 'hid the comment' : undefined
      )
    }
    if ((isComment ? config.closeOnComment : config.close) && target.state === 'open') {
      await attempt(`close ${item}`, async () => {
        await close(octokit, target)
        return `closed this ${target.kind === 'issue' ? 'issue' : 'pull request'}`
      })
    }
    if (config.comment) {
      await attempt('post the report comment', async () => {
        const body = buildReportComment(target, findings, { showEvidence: config.showEvidence, actions })
        const result = await upsertReportComment(octokit, target, body)
        return `${result} report comment`
      })
    }
  } else {
    // A clean comment says nothing about the rest of the item, so only descriptions remove the label.
    if (!isComment && config.removeLabelWhenClean && config.addLabel && target.labels.includes(config.label)) {
      await attempt(`remove label "${config.label}"`, async () =>
        (await removeLabel(octokit, target, config.label)) ? `removed label \`${config.label}\`` : undefined
      )
    }
    if (config.comment) {
      await attempt('update the report comment', async () => {
        const existing = await findReportComment(octokit, target)
        if (existing === undefined) return undefined
        await octokit.rest.issues.updateComment({
          owner: target.owner,
          repo: target.repo,
          comment_id: existing,
          body: buildResolvedComment(target)
        })
        return 'marked report comment as resolved'
      })
    }
  }

  for (const action of actions) io.info(`✔ ${action.replace(/`/gu, '')}`)
  if (errors.length > 0) {
    for (const e of errors) io.error(e)
    io.setFailed(errors.join('\n'))
  } else if (findings.length > 0 && config.failOnDetection) {
    io.setFailed(`Hidden content detected in ${ref} (${findings.length} finding(s)).`)
  }
  return { findings, actions }
}

function isExempt(config: Config, target: Target): boolean {
  return (
    config.exemptUsers.includes(target.author.toLowerCase()) ||
    config.exemptAuthorAssociations.includes(target.authorAssociation.toUpperCase())
  )
}

function setOutputs(io: Core, findings: Finding[]): void {
  io.setOutput('detected', findings.length > 0 ? 'true' : 'false')
  io.setOutput('count', String(findings.length))
  io.setOutput('max-severity', maxSeverity(findings) ?? 'none')
  io.setOutput('findings', JSON.stringify(findings))
}

async function writeSummary(io: Core, ref: string, findings: Finding[]): Promise<void> {
  if (!process.env['GITHUB_STEP_SUMMARY']) return
  try {
    const summary = io.summary.addHeading('Hidden content scan', 3)
    if (findings.length === 0) {
      summary.addRaw(`No hidden content found in ${ref}.`, true)
    } else {
      summary.addRaw(`Found ${findings.length} finding(s) in ${ref}.`, true).addTable([
        [
          { data: 'Severity', header: true },
          { data: 'Location', header: true },
          { data: 'Rule', header: true },
          { data: 'Details', header: true }
        ],
        ...findings.map((f) => [f.severity, formatLocation(f), f.rule, escapeHtml(f.message)])
      ])
    }
    await summary.write()
  } catch (error) {
    io.debug(`Could not write job summary: ${messageOf(error)}`)
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
}

function explain(error: unknown, eventName: string): string {
  const message = messageOf(error)
  const status = statusOf(error)
  if (status === 403 || status === 404) {
    const hint =
      eventName === 'pull_request'
        ? ' Pull requests from forks get a read-only token under "pull_request"; use "pull_request_target" instead.'
        : eventName === 'pull_request_review' || eventName === 'pull_request_review_comment'
          ? ' Reviews on pull requests from forks only get a read-only token, so the action can report but not act on them.'
          : ''
    return `${message}. Make sure the workflow grants "issues: write" and "pull-requests: write".${hint}`
  }
  return message
}
