# Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-11-12

### Added

- Detection of Unicode tag characters, bidirectional controls, variation selectors, invisible characters and
  directional marks, with emoji, joining-script and BOM exceptions.
- Detection of HTML comments, unterminated comments, Markdown link-reference comments, stripped or hidden HTML,
  AI-directed attribute text and blank-line padding.
- AI-directed phrase heuristics that raise hidden content to high severity.
- Allowlisting of comments from repository and organization issue/PR templates.
- Configurable label, close, comment and fail actions; label removal and comment resolution after clean edits.
- Outputs, workflow annotations and job summary.
