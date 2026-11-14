---
# With min-severity low, the Dependabot markers are still visible as low findings.
event: pull_request_target
input-min-severity: low
expect-detected: true
expect-max-severity: low
expect-count: 2
expect-rules: markdown-comment
---

Bumps a dependency.

[//]: # 'dependabot-automerge-start'
[//]: # 'dependabot-automerge-end'
