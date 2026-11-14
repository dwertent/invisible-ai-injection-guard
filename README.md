# Invisible AI Injection Guard

[![CI](https://github.com/dwertent/invisible-ai-injection-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/dwertent/invisible-ai-injection-guard/actions/workflows/ci.yml)

A GitHub Action that detects content in issue and pull request titles, descriptions and comments that is **hidden
from people reading them on GitHub but fully visible to automated tools**, then labels, comments on, hides and/or
closes the issue, pull request or comment.

## Why

AI coding agents and assistants read the raw Markdown of issues and pull requests. GitHub's rendered view does not
show HTML comments, invisible Unicode characters, and several other constructs, so an attacker can put
instructions there that maintainers never see but an agent will follow ("prompt injection"). This has been used to
make agents running in CI leak secrets or take unwanted actions.

This action flags that hidden content before an agent (or a person) acts on it.

## What it detects

| Rule                        | Default severity             | What it means                                                                                                                                                                                                                |
| --------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unicode-tag`               | high                         | Unicode "tag" characters (U+E0000–E007F), which encode invisible ASCII text ("ASCII smuggling"). The decoded text is shown. Emoji subdivision flags are allowed.                                                             |
| `bidi-control`              | high (overrides) / medium    | Bidirectional controls (U+202A–202E, U+2066–2069) that reorder how text is displayed ("Trojan Source").                                                                                                                      |
| `variation-selector`        | high / medium                | Variation selectors that do not modify the preceding character, or runs of them that encode hidden bytes (decoded when possible). A single selector after an emoji or Han character is allowed.                              |
| `invisible-character`       | medium (high for runs of 8+) | Zero-width spaces/joiners, word joiners, Hangul and Braille blank fillers, and other format characters. Emoji ZWJ sequences, joiners inside Arabic/Persian/Indic words, and a leading BOM are allowed. Soft hyphens are low. |
| `html-comment`              | low / medium / high          | `<!-- … -->` comments. Long comments are medium; comments containing text aimed at AI tools are high. Comments that appear in the repository's templates are ignored.                                                        |
| `unterminated-html-comment` | high                         | A line starting with `<!--` that is never closed hides everything after it.                                                                                                                                                  |
| `markdown-comment`          | medium / high                | Link-reference "comments" such as `[//]: # (text)` that never render.                                                                                                                                                        |
| `hidden-html`               | medium / high                | Content inside elements GitHub removes (`<script>`, `<style>`, `<template>`, …), or elements with `hidden`, `aria-hidden`, or invisible inline styles.                                                                       |
| `hidden-attribute-text`     | high                         | `alt`, `title`, `aria-label`, `data-*` and Markdown image alt / link titles that contain text aimed at AI tools.                                                                                                             |
| `blank-line-padding`        | medium / high                | Long runs of visually empty lines (`&nbsp;`, `<br>`, fillers) that push content out of view.                                                                                                                                 |
| `directional-mark`          | low                          | LRM/RLM/ALM marks. Common in right-to-left text, so reported as low only.                                                                                                                                                    |

"Text aimed at AI tools" covers phrases such as instruction overrides ("ignore previous instructions"), role
assignment ("you are an AI assistant"), references to system prompts, named AI tools, command execution, secret
exfiltration, concealment ("don't tell the user"), approval requests and chat-template tokens.

Markup inside fenced code blocks and inline code is rendered literally (it is visible), so it is not reported.
Invisible Unicode is reported everywhere.

## Usage

Create `.github/workflows/invisible-ai-injection-guard.yml`:

```yaml
name: Invisible AI injection guard

on:
  issues:
    types: [opened, edited, reopened]
  pull_request_target:
    types: [opened, edited, reopened]
  issue_comment: # comments on issues and pull requests
    types: [created, edited]
  pull_request_review_comment: # inline review comments
    types: [created, edited]
  pull_request_review: # review bodies
    types: [submitted, edited]

permissions:
  contents: read # read issue/PR templates
  issues: write # labels, comments, hiding issue comments
  pull-requests: write # labels, comments, closing pull requests, hiding review comments

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: dwertent/invisible-ai-injection-guard@v1
```

By default this adds the `suspicious-hidden-content` label and posts a comment listing the findings. The comment
is updated in place when the description is edited, and when a later edit is clean the label is removed and the
comment is marked as resolved.

Drop any events you do not want to scan.

### Comments

When a comment (issue comment, pull request conversation comment, inline review comment or review body) contains
hidden content, the action:

- **hides the comment** (minimizes it as spam; set `hide-comment: false` to disable, or `hide-comment-reason` to
  pick another reason). Review bodies cannot be hidden through the API, so they are only reported.
- **adds the label** to the issue or pull request the comment belongs to (`add-label`).
- **posts a report** that links to the comment, without mentioning its author (`comment`).
- **does not close the issue or pull request** unless `close-on-comment: true`. This is deliberately separate from
  `close`: otherwise anyone who can comment could close any open item.

If the comment is later edited to remove the hidden content, its report is marked as resolved. The label stays
(the item may have been labeled for other reasons) and the comment stays hidden until a maintainer unhides it.

### Label only, with a custom label

```yaml
- uses: dwertent/invisible-ai-injection-guard@v1
  with:
    label: prompt-injection
    comment: false
```

### Close only

```yaml
- uses: dwertent/invisible-ai-injection-guard@v1
  with:
    add-label: false
    close: true
```

Issues are closed as "not planned". Closed items are not reopened automatically after a clean edit.

### Label and close

```yaml
- uses: dwertent/invisible-ai-injection-guard@v1
  with:
    label: needs-security-review
    close: true
    min-severity: high
```

### Gate an AI agent on the result

```yaml
jobs:
  scan:
    runs-on: ubuntu-latest
    outputs:
      detected: ${{ steps.guard.outputs.detected }}
    steps:
      - id: guard
        uses: dwertent/invisible-ai-injection-guard@v1

  agent:
    needs: scan
    if: needs.scan.outputs.detected == 'false'
    runs-on: ubuntu-latest
    steps:
      - run: echo "Safe to hand the description to an AI agent"
```

## Inputs

| Name                         | Default                                      | Description                                                                                                      |
| ---------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `github-token`               | `${{ github.token }}`                        | Token used to read templates and to label, comment on and close items.                                           |
| `add-label`                  | `true`                                       | Add a label when hidden content is detected.                                                                     |
| `label`                      | `suspicious-hidden-content`                  | Label name. Created if it does not exist.                                                                        |
| `label-color`                | `b60205`                                     | Hex color used when creating the label.                                                                          |
| `label-description`          | `Contains content hidden from human readers` | Description used when creating the label.                                                                        |
| `close`                      | `false`                                      | Close the issue (as not planned) or pull request when its title or description contains hidden content.          |
| `close-on-comment`           | `false`                                      | Also close the issue or pull request when one of its comments contains hidden content.                           |
| `hide-comment`               | `true`                                       | Hide (minimize) comments that contain hidden content.                                                            |
| `hide-comment-reason`        | `spam`                                       | Reason shown on hidden comments: `spam`, `abuse`, `off-topic`, `outdated`, `duplicate` or `resolved`.            |
| `comment`                    | `true`                                       | Post (and keep updated) a comment that lists the findings.                                                       |
| `show-evidence`              | `true`                                       | Include short, escaped excerpts of the hidden content in the comment.                                            |
| `remove-label-when-clean`    | `true`                                       | Remove the label after a clean edit.                                                                             |
| `min-severity`               | `medium`                                     | Lowest severity that triggers actions: `low`, `medium` or `high`.                                                |
| `ignore-template-comments`   | `true`                                       | Ignore comments that also appear in the repository's (or the owner's `.github` repository's) issue/PR templates. |
| `max-blank-lines`            | `30`                                         | Visually empty lines allowed before following content is reported as padding.                                    |
| `max-comment-length`         | `200`                                        | HTML comments longer than this are medium instead of low severity.                                               |
| `exempt-users`               | _(empty)_                                    | Comma- or newline-separated logins that are not scanned.                                                         |
| `exempt-author-associations` | _(empty)_                                    | Author associations that are not scanned, for example `OWNER,MEMBER`.                                            |
| `fail-on-detection`          | `false`                                      | Fail the step when hidden content is detected.                                                                   |

## Outputs

| Name           | Description                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------- |
| `detected`     | `true` if at least one finding meets `min-severity`, otherwise `false`.                       |
| `count`        | Number of findings at or above `min-severity`.                                                |
| `max-severity` | `low`, `medium`, `high`, or `none`.                                                           |
| `findings`     | JSON array of findings: `rule`, `severity`, `message`, `field`, `line`, `column`, `evidence`. |

Findings are also written as workflow annotations and to the job summary.

## Security notes

- **Use `pull_request_target` for pull requests.** Under `pull_request`, pull requests from forks receive a
  read-only token, so labeling, commenting and closing fail. This action never checks out or runs code from the
  pull request, so it is safe to run under `pull_request_target`. Do not add a step that checks out the pull
  request's head in the same job.
- **Evidence is never echoed verbatim.** The report comment describes findings by rule, code point and location.
  Excerpts are escaped (invisible characters are shown as `\u{…}`) and truncated, so the comment cannot itself
  smuggle the payload. Set `show-evidence: false` to omit excerpts entirely.
- **Exemptions are opt-in.** Nothing is exempt by default, because trusted accounts can be compromised and
  descriptions can be pasted from untrusted sources.
- **Detection is not prevention.** Treat issue and pull request text as untrusted input in any workflow that gives
  an AI agent access to secrets or write permissions, whether or not this action reports anything.

## Limitations

- Titles, descriptions, comments, review comments and review bodies are scanned. Commit messages, file contents and
  discussions are not.
- Pull request reviews and review comments on pull requests **from forks** run with a read-only token (GitHub has
  no `_target` variant for these events), so the action reports findings in the log, summary and outputs but cannot
  label, comment on or hide them. Comments in the pull request conversation (`issue_comment`) are not affected.
- Heuristics for "text aimed at AI tools" are English-only and can be evaded by a determined attacker. Content that
  is hidden is still reported at its base severity regardless of wording.
- Visible text is not analyzed; a prompt injection written in plain sight is out of scope.
- GitHub limits a step to 10 warning annotations; all findings are still in the comment, summary and outputs.

## Development

```bash
npm ci
npm run all       # format check, lint, typecheck, unit tests with coverage, build, end-to-end tests
npm run test:e2e  # build, then run dist/index.js against every example in e2e/cases/
```

### End-to-end examples

[`e2e/cases/`](e2e/cases) holds one Markdown file per scenario: front matter that describes the event, inputs and
expected outputs, followed by the issue, pull request or comment body. The end-to-end suite builds the action and
runs the bundled `dist/index.js` as a separate Node.js process for each file, with a fake GitHub event and no
network access, then checks the exit code, outputs and annotations.

```markdown
---
event: issue_comment # issues, pull_request(_target), issue_comment, pull_request_review(_comment)
title: Optional title
input-min-severity: low # any action input, as input-<name>
expect-detected: true
expect-max-severity: high
expect-rules: html-comment, unicode-tag
expect-no-rules: bidi-control
---

Body text with <!-- a hidden comment --> and {TAG:smuggled text}.
```

Invisible characters are written with an escape notation so that example files stay readable and reviewable:
`{U+200B}` (or `{U+200B*20}` to repeat), `{TAG:text}` for Unicode tag smuggling, `{VS:text}` for variation-selector
smuggling, and `{NL*40}` for repeated newlines. See the [`e2e/run.ts`](e2e/run.ts) header for the full list of keys.

`dist/index.js` is the bundled action and must be committed; CI fails if it is out of date. See
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
