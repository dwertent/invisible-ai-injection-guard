// SPDX-License-Identifier: MIT

import type { Severity } from './types.js'
import { SEVERITIES } from './types.js'

export interface Config {
  token: string
  addLabel: boolean
  label: string
  labelColor: string
  labelDescription: string
  close: boolean
  closeOnComment: boolean
  hideComment: boolean
  hideCommentReason: string
  comment: boolean
  showEvidence: boolean
  removeLabelWhenClean: boolean
  minSeverity: Severity
  ignoreTemplateComments: boolean
  maxBlankLines: number
  maxCommentLength: number
  exemptUsers: string[]
  exemptAuthorAssociations: string[]
  failOnDetection: boolean
}

export interface InputReader {
  getInput(name: string, options?: { required?: boolean; trimWhitespace?: boolean }): string
}

const AUTHOR_ASSOCIATIONS = [
  'COLLABORATOR',
  'CONTRIBUTOR',
  'FIRST_TIMER',
  'FIRST_TIME_CONTRIBUTOR',
  'MANNEQUIN',
  'MEMBER',
  'NONE',
  'OWNER'
]

const HIDE_REASONS: Readonly<Record<string, string>> = {
  spam: 'SPAM',
  abuse: 'ABUSE',
  'off-topic': 'OFF_TOPIC',
  outdated: 'OUTDATED',
  duplicate: 'DUPLICATE',
  resolved: 'RESOLVED'
}

export class ConfigError extends Error {
  override name = 'ConfigError'
}

/** Reads and validates the action inputs. Throws `ConfigError` with an actionable message. */
export function readConfig(io: InputReader): Config {
  const str = (name: string, fallback: string): string => {
    const value = io.getInput(name).trim()
    return value === '' ? fallback : value
  }
  const bool = (name: string, fallback: boolean): boolean => {
    const value = io.getInput(name).trim().toLowerCase()
    if (value === '') return fallback
    if (['true', 'yes', 'on', '1'].includes(value)) return true
    if (['false', 'no', 'off', '0'].includes(value)) return false
    throw new ConfigError(`Input "${name}" must be "true" or "false", got "${value}".`)
  }
  const int = (name: string, fallback: number): number => {
    const value = io.getInput(name).trim()
    if (value === '') return fallback
    if (!/^\d+$/u.test(value)) throw new ConfigError(`Input "${name}" must be a non-negative integer, got "${value}".`)
    return Number.parseInt(value, 10)
  }
  const list = (name: string): string[] =>
    io
      .getInput(name)
      .split(/[\s,]+/u)
      .map((v) => v.trim())
      .filter(Boolean)

  const token = io.getInput('github-token').trim()
  if (token === '') throw new ConfigError('Input "github-token" is required.')

  const minSeverity = str('min-severity', 'medium').toLowerCase()
  if (!SEVERITIES.includes(minSeverity as Severity)) {
    throw new ConfigError(`Input "min-severity" must be one of ${SEVERITIES.join(', ')}, got "${minSeverity}".`)
  }

  const label = str('label', 'suspicious-hidden-content')
  if (label.length > 50) throw new ConfigError('Input "label" must be at most 50 characters (a GitHub limit).')

  const labelColor = str('label-color', 'b60205').replace(/^#/u, '')
  if (!/^[0-9a-f]{6}$/iu.test(labelColor)) {
    throw new ConfigError(`Input "label-color" must be a 6-digit hex color, got "${labelColor}".`)
  }

  const hideReason = str('hide-comment-reason', 'spam').toLowerCase()
  const hideCommentReason = HIDE_REASONS[hideReason]
  if (hideCommentReason === undefined) {
    throw new ConfigError(
      `Input "hide-comment-reason" must be one of ${Object.keys(HIDE_REASONS).join(', ')}, got "${hideReason}".`
    )
  }

  const exemptAuthorAssociations = list('exempt-author-associations').map((a) => a.toUpperCase())
  const unknown = exemptAuthorAssociations.filter((a) => !AUTHOR_ASSOCIATIONS.includes(a))
  if (unknown.length > 0) {
    throw new ConfigError(
      `Input "exempt-author-associations" has unknown value(s) ${unknown.join(', ')}; expected any of ${AUTHOR_ASSOCIATIONS.join(', ')}.`
    )
  }

  const config: Config = {
    token,
    addLabel: bool('add-label', true),
    label,
    labelColor: labelColor.toLowerCase(),
    labelDescription: str('label-description', 'Contains content hidden from human readers').slice(0, 100),
    close: bool('close', false),
    closeOnComment: bool('close-on-comment', false),
    hideComment: bool('hide-comment', true),
    hideCommentReason,
    comment: bool('comment', true),
    showEvidence: bool('show-evidence', true),
    removeLabelWhenClean: bool('remove-label-when-clean', true),
    minSeverity: minSeverity as Severity,
    ignoreTemplateComments: bool('ignore-template-comments', true),
    maxBlankLines: int('max-blank-lines', 30),
    maxCommentLength: int('max-comment-length', 200),
    exemptUsers: list('exempt-users').map((u) => u.toLowerCase()),
    exemptAuthorAssociations,
    failOnDetection: bool('fail-on-detection', false)
  }
  return config
}
