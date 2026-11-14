---
# fail-on-detection makes the step fail.
event: issues
input-fail-on-detection: true
expect-detected: true
expect-exit-code: 1
expect-stdout: ::error::Hidden content detected in issue #42
---

Hello{U+202E}dlrow
