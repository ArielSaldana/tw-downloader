# Repository Guidelines

## Project Structure & Module Organization

This directory currently contains no application code, tests, assets, or dependency manifests. No language or framework has been selected. Keep this guide aligned with the actual layout as the project develops.

When introducing code, group related modules by responsibility. Use clearly named locations such as `src/` for implementation, `tests/` for automated tests, and `assets/` for static resources when those directories suit the selected framework. Document entry points in `README.md`.

## Build, Test, and Development Commands

No build, test, lint, or local development commands are configured yet. Do not assume commands such as `npm test` are available.

When adding tooling, record the exact installation, development, build, and test commands in `README.md`. Include required runtime versions and configuration steps. Prefer reproducible dependency installation and commit the appropriate lockfile.

## Coding Style & Naming Conventions

Follow the chosen language's standard conventions and use consistent indentation within each file. Choose descriptive module, function, and variable names. Add formatter and linter configuration alongside the first implementation, and document how to run them. Avoid unrelated formatting changes.

## Testing Guidelines

No testing framework or coverage threshold is configured. Select a framework appropriate to the implementation and document its test discovery conventions. Add tests for meaningful behavior changes and bug fixes, including failure cases. Keep tests deterministic and independent of live services where practical.

## Commit & Pull Request Guidelines

No Git history is available to establish existing commit conventions. Use concise, imperative commit subjects, such as `Add download URL validation`. Keep changes focused.

Pull requests should explain the problem, resulting behavior, and validation performed. Link relevant issues and include screenshots for visible interface changes.

## Agent Instructions

Work on the user-provided branch or worktree. Do not create, switch, or rename branches without an explicit request. If the checkout is detached or the intended branch is unclear, ask before proceeding with branch-dependent work.
