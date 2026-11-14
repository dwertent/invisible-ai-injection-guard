---
# A comment that is never closed hides everything after it.
event: issues
expect-detected: true
expect-max-severity: high
expect-rules: unterminated-html-comment
---

Short bug report.

<!--
Everything from here on is hidden from people reading the issue.
