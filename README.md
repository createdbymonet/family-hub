# Family Hub

Plan together. Stay in sync.

Family Hub is a shared family planning and household management app for couples and families.

**Status: Coming Soon / Early Development**

The current application contains a responsive Coming Soon page and the Angular project foundation. Household features are planned for future development.

## Tech stack

- Angular 21 with standalone components, Angular Router, and OnPush change detection
- TypeScript 5.9 with strict type checking and strict Angular templates
- SCSS for global and component styles
- Prettier for consistent formatting
- pnpm and Angular CLI for local development and production builds

The app uses Angular's default zoneless change detection. Signals can be introduced when reactive state is needed; the static Coming Soon page does not need them.

## Planned features

- Today's schedule
- Weekly schedule and shared plans
- Shared shopping list
- Shared household information

These features are not implemented yet. The foundation does not include authentication, backend services, API clients, a database, or a state management library.

## Local development

Use Node.js 24 and pnpm 11.21.0. Angular 21 also supports Node.js `^20.19.0` and `^22.12.0`; the supported Node.js 24 range is `^24.0.0`.

Install dependencies and start the development server:

```bash
pnpm install
pnpm dev
```

Open [localhost:4200](http://localhost:4200/). Source changes reload the application automatically. For reproducible installation from the committed lockfile, use `pnpm install --frozen-lockfile`.

## Checks and production build

```bash
pnpm format:check
pnpm typecheck
pnpm build
```

Run `pnpm format` to apply formatting. `pnpm typecheck` checks TypeScript without emitting files; the production build also compiles and checks Angular templates.

The default build uses the production configuration and writes browser assets to `dist/family-hub/browser/`. Use `pnpm watch` for a development build that watches for changes.

ESLint and a test runner are not configured in this initial foundation.

The pnpm override for Angular's build dependency `undici` pins the patched `7.30.1` release. Review this override when updating Angular CLI.

## Routes

| Path             | Current behavior                          |
| ---------------- | ----------------------------------------- |
| `/`              | Displays the lazy-loaded Coming Soon page |
| `/dashboard`     | Redirects to `/`                          |
| `/schedule`      | Redirects to `/`                          |
| `/shopping-list` | Redirects to `/`                          |
| Any other path   | Redirects to `/`                          |

When hosting the application, configure the server to return `index.html` for application routes so that direct links and refreshes work with Angular Router.

## Project structure

```text
public/
  favicon.svg
src/
  app/
    features/
      coming-soon/
        coming-soon.component.ts
        coming-soon.component.html
        coming-soon.component.scss
    app.component.ts
    app.config.ts
    app.routes.ts
  styles/
    _base.scss
  index.html
  main.ts
  styles.scss
angular.json
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
tsconfig.json
tsconfig.app.json
```

The root component hosts the router outlet, and each page lives under `features/`. Global styles begin in `src/styles.scss`, with base styles in `src/styles/_base.scss`.

Add `core/` for application-wide services, `shared/` for reusable UI, and feature folders such as `dashboard/`, `schedule/`, and `shopping-list/` when they contain real code. Empty placeholder folders and speculative abstractions are intentionally omitted.
