---
# A long run of zero-width characters can encode hidden binary data.
event: issues
expect-detected: true
expect-max-severity: high
expect-rules: invisible-character
---

Looks like a normal sentence{U+200B}{U+200C}{U+200B}{U+200B}{U+200C}{U+200C}{U+200B}{U+200C}{U+200B}{U+200C} with data hidden inside.
