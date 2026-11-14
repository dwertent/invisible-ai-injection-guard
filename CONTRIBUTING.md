# Contributing

1. Use Node.js 24 (`nvm use`), then run `npm ci`.
2. Make your change and add unit tests in `__tests__/`. For a new detection or a false positive, also add an
   example to `e2e/cases/` (see the README for the format).
3. Run `npm run all` (format check, lint, typecheck, unit tests with coverage, build, end-to-end tests).
4. Commit the regenerated `dist/index.js` together with your source change.

Never put invisible or bidirectional characters directly in source or test files. Build them from code points
(for example `String.fromCodePoint(0x200b)`, or `{U+200B}` in `e2e/cases/`) so reviewers can see them; CI rejects
literal ones.

## Releasing

1. Update `CHANGELOG.md` and the version in `package.json`.
2. Tag the release (`git tag -a v1.2.3 -m v1.2.3`) and push the tag.
3. Move the major tag: `git tag -fa v1 -m v1 && git push -f origin v1`.
4. Publish the GitHub release (optionally to the Marketplace).
