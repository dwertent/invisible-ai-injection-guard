# Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [1.4.0] - 2026-11-15

### Changed

- List inputs (`trusted-bots`, `exempt-users`, `exempt-author-associations`) are written one item per line and
  accept YAML-style `- item` lines. Commas still separate items; spaces no longer do.
- The README's "Close flagged items" example uses
  [close-on-labels](https://github.com/dwertent/close-on-labels).

## [1.3.0] - 2026-11-15

### Added

- `trusted-bots` to allow the known hidden markers of listed bots (currently `dependabot[bot]`). The bot's text is
  still scanned for anything else, and the markers are only allowed when the bot is the author and also triggered
  the event.

### Changed

- `exempt-users` and `exempt-author-associations` no longer apply when someone other than the author edits the
  text; those edits are scanned.

## [1.2.0] - 2026-11-14

### Removed

- The `close` and `close-on-comment` inputs. The action now only flags content (label, report comment and hiding
  comments) and never closes issues or pull requests. To close flagged items, add a separate job that reads the
  `detected` output; the README has an example.

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
