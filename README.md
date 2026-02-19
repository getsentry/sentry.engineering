# Sentry Engineering Blog

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

`npm run build` regenerates the static route indexes and sitemap output in `dist/`.

## Formatting and Linting

```bash
# Fix files
npm run format
npm run lint

# Check only (CI)
npm run format:check
npm run lint:check
```

## CI

Formatting and lint checks run in GitHub Actions via `.github/workflows/format-lint.yml` on pushes and pull requests to `main`.
