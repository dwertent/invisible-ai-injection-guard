# Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-11-13

### Added

- Scanning of issue comments, pull request conversation comments, inline review comments and review bodies
  (`issue_comment`, `pull_request_review_comment` and `pull_request_review` events).
- `hide-comment` and `hide-comment-reason` to minimize comments that contain hidden content.
- `close-on-comment` to close the issue or pull request when one of its comments contains hidden content (off by
  default).
- End-to-end suite that runs the bundled action against example files in `e2e/cases/`.

### Fixed

- Short Markdown link-reference comments, such as the markers in Dependabot pull request descriptions, are now low
  severity (like short HTML comments) instead of medium, so they no longer trigger actions by default.

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
