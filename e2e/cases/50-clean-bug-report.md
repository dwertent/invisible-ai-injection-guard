---
# A realistic, clean bug report: code blocks with comments, details, images, tables.
event: issues
title: 'Crash when parsing <!-- comments --> in YAML'
expect-detected: false
expect-max-severity: none
---

## Description

Parsing fails when the input contains an HTML comment such as `<!-- note -->`.

```html
<!-- this comment is inside a code block and is visible -->
<div hidden>also visible, it is code</div>
```

```
<script>console.log("visible code")</script>
```

<details>
<summary>Stack trace</summary>

```
Error: unexpected token at line 3
```

</details>

| Version | OS    |
| ------- | ----- |
| 1.2.3   | macOS |

![Screenshot of the error dialog](https://example.com/error.png)

See [the docs](https://example.com/docs 'Configuration reference') and [1].

[1]: https://example.com/issue
