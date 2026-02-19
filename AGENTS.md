# Repository Guidelines

## Project Structure & Module Organization

This repository is an Astro-based static site for `sentry.engineering`.

- `src/pages/`: route files (`index.astro`, blog/tag/about pages, RSS endpoints).
- `src/content/blog/`: blog posts as Markdown; filename becomes the slug (for example, `scaling-cron-monitoring.md`).
- `src/content/authors/`: author profiles referenced by blog frontmatter.
- `src/components/` and `src/layouts/`: reusable UI and page shells.
- `src/lib/` and `src/data/`: content loaders, slug/date utilities, site metadata.
- `src/assets/`: local images and avatars used by content.
- `public/`: static passthrough assets.
- `dist/`: build output (generated).

## Build, Test, and Development Commands

- `npm install`: install dependencies.
- `npm run dev`: start local dev server.
- `npm run build`: create production static build in `dist/`.
- `npm run preview`: serve the built site locally.
- `npm run format`: format code/content with `oxfmt`.
- `npm run format:check`: check formatting without changing files.
- `npm run lint`: run `oxlint` with `--fix`.
- `npm run lint:check`: run `oxlint` in check-only mode (used in CI).

## Coding Style & Naming Conventions

- Use formatting and lint auto-fixes before opening a PR: run `npm run format` and `npm run lint`.
- Keep existing Astro/JS style intact; avoid mixing unrelated refactors into content changes.
- Use `PascalCase.astro` for components/layouts (for example, `PostList.astro`).
- Use lowercase, hyphenated slugs for blog files (`my-new-post.md`).
- Keep author files lowercase (`src/content/authors/janedoe.md`) so references stay stable.

## Testing Guidelines

There is no dedicated automated test suite configured right now. Use this minimum validation:

1. `npm run format:check`
2. `npm run lint:check`
3. `npm run build`
4. `npm run preview` and spot-check key routes (`/`, `/blog`, `/tags`, `/about`)

For content changes, verify frontmatter matches `src/content/config.ts` (especially `title`, `date`, `authors`, `tags`, and image paths).
For CI parity, `.github/workflows/format-lint.yml` runs `npm run format:check` and `npm run lint:check` on pushes and pull requests to `main`.

## Commit & Pull Request Guidelines

- Prefer concise, imperative commit subjects.
- Conventional-style prefixes are common and encouraged: `feat(blog): ...`, `fix: ...`, `build(deps): ...`.
- When relevant, include issue/PR refs like `(#123)`.
- PRs should include: what changed, why, affected routes/content, and screenshots for visual/layout updates.
- Confirm format/lint/build checks passed before requesting review.
