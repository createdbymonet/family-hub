# Family Hub

Plan together. Stay in sync.

Family Hub is a shared family planning and household management app for couples and families.

**Status: Frontend MVP / Early Development**

The current application includes a mobile-first Menu, Shopping List, and Thanks Board. It uses local mock data and in-memory frontend state. Changes remain available while navigating between screens and reset when the page is refreshed.

## Tech stack

- Angular 21 with standalone components, Angular Router, and OnPush change detection
- Angular Signals for local state and typed Reactive Forms for inputs
- TypeScript 5.9 with strict type checking and strict Angular templates
- SCSS for global and component styles
- Prettier for consistent formatting
- Vitest and jsdom for automated tests through Angular CLI
- pnpm and Angular CLI for local development and production builds
- Wrangler for Cloudflare production deployment

The app uses Angular's default zoneless change detection. Feature stores expose signal-based state and keep the current frontend logic separate from the page components.

## Current features

- **Menu:** Two large, keyboard-accessible navigation cards for the household tools.
- **Shopping List:** Add items with the button or Enter, mark them complete or incomplete, edit with Save and Cancel, and delete items immediately.
- **Thanks Board:** Post everyday accomplishments in conversation-style bubbles and add positive reactions. New posts are authored by the current user; the sample conversation includes both family members.

This version does not share data between people or devices. It does not include a backend, authentication, a database, or real-time communication.

## Planned features

- Today's schedule
- Weekly schedule and shared plans
- Shared household information
- Persistent shared family data and real-time updates

These features are planned for future development. Shopping List and Thanks Board currently demonstrate the interactions using local/mock frontend state.

## Local development

Use Node.js 24 and pnpm 11.21.0. The project's supported Node.js ranges are `^22.12.0` and `^24.0.0`, covering both Angular and the production deployment tooling.

Install dependencies and start the development server:

```bash
pnpm install
pnpm dev
```

Open [localhost:4200](http://localhost:4200/). Source changes reload the application automatically. For reproducible installation from the committed lockfile, use `pnpm install --frozen-lockfile`.

## Checks and production build

```bash
pnpm format
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

Run `pnpm format` to apply formatting. `pnpm typecheck` checks TypeScript without emitting files; the production build also compiles and checks Angular templates.

The default build uses the production configuration and writes browser assets to `dist/family-hub/browser/`. Use `pnpm watch` for a development build that watches for changes.

`pnpm test` runs the focused Vitest/jsdom tests once through Angular's unit-test builder. ESLint is not configured.

The pnpm override for Angular's build dependency `undici` pins the patched `7.30.1` release. Review this override when updating Angular CLI.

## Production deployment

The production hosting configuration targets one Cloudflare Worker, `family-hub`, using Workers Static Assets. Local development continues to use Angular CLI; it does not deploy a Worker.

| Source            | Result                                                                     |
| ----------------- | -------------------------------------------------------------------------- |
| Local `pnpm dev`  | Angular development server at `localhost:4200`                             |
| `main`            | Development branch; no Cloudflare deployment                               |
| Push to `release` | GitHub Actions → `production` environment → Cloudflare Worker `family-hub` |

`.github/workflows/deploy-production.yml` runs only for pushes to `release`. It checks out the code, configures Node.js 24 and the pnpm version from `package.json`, installs from the frozen lockfile, runs formatting/type checks and tests, builds the production app, and deploys with the project's local Wrangler installation.

The top-level `wrangler.jsonc` configuration is the production target. It serves the generated `dist/family-hub/browser/` directory. `assets.not_found_handling` is set to `single-page-application`, so direct navigation and refreshes at `/shopping-list` and `/thanks-board` receive `index.html` and are handled by Angular Router. See [Cloudflare's SPA routing documentation](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/).

There are no named Wrangler environments or Cloudflare backend bindings in this setup. Version preview URLs are disabled.

### One-time GitHub and Cloudflare setup

1. In the GitHub repository, create the `production` environment and restrict its deployment branches to `release`.
2. Add these environment secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The workflow reads them only for deployment; do not commit their values.
3. Scope the API token to the intended Cloudflare account. An existing `family-hub` Worker needs `Editor` access for that Worker; creating it for the first time needs Workers product-level `Admin` access. After initial creation, the token can be narrowed to that Worker. See [Cloudflare's Wrangler permission requirements](https://developers.cloudflare.com/workers/authorization/workers/#wrangler). This configuration does not manage DNS or custom domains.
4. If the Worker already has a Cloudflare Workers Builds/Git integration, disable its automatic deployments and previews or disconnect that integration. GitHub Actions should be the only automatic deployment path, so a push to `main` cannot trigger a separate Cloudflare build.
5. Put the intended production commit, including this workflow, on `release` and push that branch when ready to deploy.

### Local deployment commands

Validate the production build and Wrangler packaging without uploading or deploying:

```bash
pnpm deploy:check
```

When an intentional manual production deployment is needed, authenticate Wrangler for the intended account and run:

```bash
pnpm run deploy
```

`pnpm run deploy` builds the app and targets only the default `family-hub` Worker. Do not pass a named environment. Adding these configuration files does not itself deploy the application or change existing remote resources.

## Routes

| Path             | Current behavior           |
| ---------------- | -------------------------- |
| `/`              | Displays the Menu          |
| `/shopping-list` | Displays the Shopping List |
| `/thanks-board`  | Displays the Thanks Board  |
| `/dashboard`     | Redirects to `/`           |
| `/schedule`      | Redirects to `/`           |
| Any other path   | Redirects to `/`           |

When hosting the application, configure the server to return `index.html` for application routes so that direct links and refreshes work with Angular Router.

## Project structure

```text
public/
  favicon.svg
src/
  app/
    features/
      menu/
      shopping-list/
      thanks-board/
    shared/
      components/
        icon.component.ts
        page-header.component.ts
    app.component.ts
    app.component.html
    app.component.scss
    app.config.ts
    app.routes.ts
  styles/
    _base.scss
    _components.scss
  index.html
  main.ts
  styles.scss
angular.json
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
wrangler.jsonc
.github/workflows/deploy-production.yml
tsconfig.json
tsconfig.app.json
tsconfig.spec.json
```

The root component provides the shared app shell and router outlet. Each page lives under `features/`; Shopping List and Thanks Board keep their typed models, signal stores, and tests alongside the page. Shared icons and page headers live under `shared/components/`. Global styles begin in `src/styles.scss`, with the theme and base rules in `src/styles/_base.scss` and shared controls in `src/styles/_components.scss`.

When adding real shared family data, connect the feature stores to a backend with household membership and authorization, then add persistence and synchronization. Keep the current components focused on display and interaction.
