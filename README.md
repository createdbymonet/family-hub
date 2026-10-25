# Family Hub

A shared family planning and household management app for couples and families.

**[Demo](https://family-hub.sumihana.workers.dev/)**

## Features

- **Shopping List:** Add, edit, complete, and delete shopping items.
- **Thanks Board:** Share everyday accomplishments and react to family members' posts.

Frontend MVP using local mock data. Changes reset on page refresh; shared data, authentication, and persistence are planned.

## Tech stack

Angular 21, TypeScript, SCSS, Angular Signals, Vitest, and Cloudflare Workers Static Assets.

## Local development

Use Node.js 24 and pnpm 11.21.0.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open [localhost:4200](http://localhost:4200/).

## Checks

```bash
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

## Deployment

Push to `release` to deploy to Cloudflare Workers through [GitHub Actions](.github/workflows/deploy-production.yml). `main` is the development branch.

Configure the GitHub `production` environment with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets, and restrict deployments to `release`.

```bash
pnpm deploy:check # Validate the build and packaging without deploying
pnpm run deploy  # Deploy manually after authenticating Wrangler
```
