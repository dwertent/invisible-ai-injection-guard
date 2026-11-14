---
# min-severity high ignores medium findings such as a lone zero-width space.
event: issues
input-min-severity: high
expect-detected: false
---

pass{U+200B}word
