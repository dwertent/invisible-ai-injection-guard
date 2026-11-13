// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest'
import { ConfigError, readConfig } from '../src/config.js'
import { extractSnippets, messageOf, statusOf } from '../src/templates.js'

const reader = (inputs: Record<string, string>) => ({ getInput: (name: string) => inputs[name] ?? '' })

describe('readConfig', () => {
  it('applies defaults', () => {
    expect(readConfig(reader({ 'github-token': 't' }))).toEqual({
      token: 't',
      addLabel: true,
      label: 'suspicious-hidden-content',
      labelColor: 'b60205',
      labelDescription: 'Contains content hidden from human readers',
      close: false,
      comment: true,
      showEvidence: true,
      removeLabelWhenClean: true,
      minSeverity: 'medium',
      ignoreTemplateComments: true,
      maxBlankLines: 30,
      maxCommentLength: 200,
      exemptUsers: [],
      exemptAuthorAssociations: [],
      failOnDetection: false
    })
  })

  it('parses custom values', () => {
    const config = readConfig(
      reader({
        'github-token': 't',
        'add-label': 'no',
        close: 'True',
        label: 'prompt-injection',
        'label-color': '#00FF00',
        'min-severity': 'HIGH',
        'max-blank-lines': '10',
        'exempt-users': 'Alice, bob',
        'exempt-author-associations': 'owner,member'
      })
    )
    expect(config).toMatchObject({
      addLabel: false,
      close: true,
      label: 'prompt-injection',
      labelColor: '00ff00',
      minSeverity: 'high',
      maxBlankLines: 10,
      exemptUsers: ['alice', 'bob'],
      exemptAuthorAssociations: ['OWNER', 'MEMBER']
    })
  })

  it.each([
    [{}, /github-token/u],
    [{ close: 'maybe' }, /close/u],
    [{ 'min-severity': 'critical' }, /min-severity/u],
    [{ 'label-color': 'red' }, /label-color/u],
    [{ label: 'x'.repeat(51) }, /label/u],
    [{ 'max-blank-lines': '-1' }, /max-blank-lines/u],
    [{ 'exempt-author-associations': 'ADMIN' }, /ADMIN/u]
  ])('rejects invalid input %j', (inputs, message) => {
    const token = 'github-token' in inputs || Object.keys(inputs).length === 0 ? {} : { 'github-token': 't' }
    expect(() => readConfig(reader({ ...token, ...inputs }))).toThrow(ConfigError)
    expect(() => readConfig(reader({ ...token, ...inputs }))).toThrow(message)
  })
})

describe('template helpers', () => {
  it('extracts normalized comment snippets', () => {
    expect(
      extractSnippets('<!-- Describe\n  the bug -->\n[//]: # (Internal note)\n```\n<!-- in code -->\n```')
    ).toEqual(['describe the bug', 'internal note'])
  })

  it('reads HTTP status and messages from errors', () => {
    expect(statusOf({ status: 404 })).toBe(404)
    expect(statusOf(new Error('x'))).toBeUndefined()
    expect(statusOf(null)).toBeUndefined()
    expect(messageOf(new Error('boom'))).toBe('boom')
    expect(messageOf('plain')).toBe('plain')
  })
})
