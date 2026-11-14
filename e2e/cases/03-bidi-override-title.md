---
# A right-to-left override in the title reverses how part of it is displayed.
event: issues
title: Update docs {U+202E}txt.exe{U+202C}
expect-detected: true
expect-max-severity: high
expect-rules: bidi-control
expect-fields: title
---

Small documentation fix.
