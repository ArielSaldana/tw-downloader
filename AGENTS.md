# Repository Guidelines

## Project Structure & Module Organization

The repository contains independent Chrome extensions under `plugins/tw-downloader/`, `plugins/ig-downloader/`, and `plugins/rd-downloader/`. Each plugin has a self-contained `extension/`, Node tests, Playwright browser tests, and a README. Shared popup source lives in `shared/`; build, validation, packaging, and preview tools live in `scripts/`.

Generated `popup.*`, `page-media.js`, and the Reddit `mux.js` bundle are checked in. Edit their source and run the build; never edit generated copies directly. Reddit's mux source is `plugins/rd-downloader/src/mux.js`.

## Build, Test, and Development Commands

Use Node.js 22+ and `npm ci --ignore-scripts` with the committed lockfile. Run `npm run build`, `npm test`, `npm run test:browser`, and `npm run check` for relevant changes. Install the test browser once with `npx playwright install chromium`. `npm run format` formats and rebuilds. Exact commands and plugin-specific packaging are documented in `README.md`.

## Coding Style & Naming Conventions

Follow the chosen language's standard conventions and use consistent indentation within each file. Choose descriptive module, function, and variable names. Add formatter and linter configuration alongside the first implementation, and document how to run them. Avoid unrelated formatting changes.

## Testing Guidelines

Node's test runner discovers `plugins/*/tests/*.test.cjs`; Playwright discovers `plugins/*/tests/browser/**/*.spec.cjs`. Add tests for meaningful behavior changes and bug fixes, including failure cases. Keep tests deterministic and independent of live services where practical.

## Commit & Pull Request Guidelines

No Git history is available to establish existing commit conventions. Use concise, imperative commit subjects, such as `Add download URL validation`. Keep changes focused.

Pull requests should explain the problem, resulting behavior, and validation performed. Link relevant issues and include screenshots for visible interface changes.

## Agent Instructions

Work on the user-provided branch or worktree. Do not create, switch, or rename branches without an explicit request. If the checkout is detached or the intended branch is unclear, ask before proceeding with branch-dependent work.
