// SPDX-License-Identifier: MIT

import { vi } from 'vitest'
import type { Core, Dependencies } from '../src/main.js'
import type { EventContext, Octokit } from '../src/github.js'

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message = `HTTP ${status}`
  ) {
    super(message)
  }
}

export interface Comment {
  id: number
  body: string
  user: { login: string; type: string }
}

export interface FakeRepo {
  labels: Set<string>
  files: Record<string, string>
  comments: Comment[]
}

/** An in-memory stand-in for the subset of the GitHub REST API the action uses. */
export function fakeOctokit(repo: Partial<FakeRepo> = {}) {
  const state: FakeRepo = {
    labels: repo.labels ?? new Set(),
    files: repo.files ?? {},
    comments: repo.comments ?? []
  }
  let nextId = 100
  const getContent = vi.fn(({ repo: name, path }: { repo: string; path: string }) => {
    const prefix = path === '' ? '' : `${path}/`
    const key = `${name}:${path}`
    const file = state.files[key]
    if (file !== undefined) {
      return Promise.resolve({
        data: { type: 'file', name: path.split('/').pop(), path, content: Buffer.from(file).toString('base64') }
      })
    }
    const children = new Map<string, string>()
    for (const k of Object.keys(state.files)) {
      const [r, p = ''] = k.split(':')
      if (r !== name || !p.startsWith(prefix)) continue
      const rest = p.slice(prefix.length).split('/')
      const childName = rest[0] ?? ''
      children.set(childName, rest.length > 1 ? 'dir' : 'file')
    }
    if (children.size === 0) return Promise.reject(new HttpError(404))
    return Promise.resolve({
      data: [...children].map(([n, type]) => ({ type, name: n, path: `${prefix}${n}` }))
    })
  })
  const rest = {
    repos: { getContent },
    issues: {
      getLabel: vi.fn(({ name }: { name: string }) =>
        state.labels.has(name) ? Promise.resolve({ data: { name } }) : Promise.reject(new HttpError(404))
      ),
      createLabel: vi.fn(({ name }: { name: string }) => {
        state.labels.add(name)
        return Promise.resolve({ data: { name } })
      }),
      addLabels: vi.fn(() => Promise.resolve({ data: [] })),
      removeLabel: vi.fn(() => Promise.resolve({ data: [] })),
      update: vi.fn(() => Promise.resolve({ data: {} })),
      listComments: vi.fn(),
      createComment: vi.fn(({ body }: { body: string }) => {
        state.comments.push({ id: nextId++, body, user: { login: 'github-actions[bot]', type: 'Bot' } })
        return Promise.resolve({ data: {} })
      }),
      updateComment: vi.fn(({ comment_id, body }: { comment_id: number; body: string }) => {
        const c = state.comments.find((x) => x.id === comment_id)
        if (c) c.body = body
        return Promise.resolve({ data: {} })
      })
    },
    pulls: { update: vi.fn(() => Promise.resolve({ data: {} })) }
  }
  const paginate = vi.fn(() => Promise.resolve([...state.comments]))
  return { octokit: { rest, paginate } as unknown as Octokit, rest, state }
}

export function fakeCore(inputs: Record<string, string> = {}) {
  const outputs: Record<string, string> = {}
  const summary = {
    addHeading: vi.fn(() => summary),
    addRaw: vi.fn(() => summary),
    addTable: vi.fn(() => summary),
    write: vi.fn(() => Promise.resolve(summary))
  }
  const core = {
    getInput: vi.fn((name: string) => inputs[name] ?? ''),
    setOutput: vi.fn((name: string, value: unknown) => {
      outputs[name] = String(value)
    }),
    info: vi.fn(),
    debug: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    setFailed: vi.fn(),
    summary
  }
  return { core: core as unknown as Core, mock: core, outputs }
}

export function issueEvent(body: string, overrides: Record<string, unknown> = {}, action = 'opened'): EventContext {
  return {
    eventName: 'issues',
    repo: { owner: 'acme', repo: 'widgets' },
    payload: {
      action,
      issue: {
        number: 7,
        title: 'Widget crashes',
        body,
        state: 'open',
        labels: [],
        author_association: 'NONE',
        user: { login: 'someone' },
        ...overrides
      }
    }
  }
}

export function deps(context: EventContext, core: Core, octokit: Octokit): Dependencies {
  return { context, core, getOctokit: () => octokit }
}
