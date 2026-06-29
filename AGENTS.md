# Repository Guidelines

## Project Structure & Module Organization

This repository is currently a blank project root. As source is added, keep the layout predictable and shallow:

- `src/` for application or library code.
- `tests/` for automated tests that mirror `src/` structure.
- `assets/` for static files such as images, fixtures, and sample data.
- `docs/` for design notes, architecture decisions, and user-facing documentation.
- `scripts/` for repeatable maintenance or development commands.

Avoid placing implementation files directly in the repository root unless they are standard project entry points or configuration files.

## Build, Test, and Development Commands

No build system or package manager files are present yet. Add commands here when tooling is introduced, and prefer checked-in scripts over one-off shell commands. Common examples:

- `npm install` / `npm test` for a Node.js project.
- `python -m pytest` for a Python project.
- `cargo test` for a Rust project.
- `make build` when a `Makefile` becomes the project command surface.

Document required environment variables and local setup steps near the command that needs them.

## Coding Style & Naming Conventions

Follow the formatter and linter configured for the language in use. If no formatter exists yet, add one before the codebase grows. Use descriptive filenames and keep naming consistent with the chosen ecosystem: `snake_case` for Python modules, `kebab-case` for CLI scripts, and `PascalCase` for exported UI components or classes where applicable.

Prefer small modules with clear ownership. Keep generated files out of source directories unless they are intentionally committed.

## Testing Guidelines

Place tests under `tests/` and name them so their target is obvious, such as `tests/test_parser.py` or `tests/parser.test.ts`. Add regression tests for bug fixes and cover public behavior before internal implementation details. If coverage tooling is added, document the minimum threshold and the command used to verify it.

## Commit & Pull Request Guidelines

This directory does not currently contain Git history, so no existing commit convention can be inferred. Use concise, imperative commit messages, for example `Add parser validation` or `Fix config loading`.

Pull requests should include a short description, verification steps, and linked issues when relevant. Include screenshots or recordings for UI changes, and call out migrations, configuration changes, or compatibility risks.

## Agent-Specific Instructions

Before making changes, inspect the repository for newly added tooling or conventions. Do not assume the placeholder structure above is authoritative once real project files exist.
