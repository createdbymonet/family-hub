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

Use Node.js 24 and pnpm 11.21.0. Angular 21 also supports Node.js `^20.19.0` and `^22.12.0`; the supported Node.js 24 range is `^24.0.0`.

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
tsconfig.json
tsconfig.app.json
tsconfig.spec.json
```

The root component provides the shared app shell and router outlet. Each page lives under `features/`; Shopping List and Thanks Board keep their typed models, signal stores, and tests alongside the page. Shared icons and page headers live under `shared/components/`. Global styles begin in `src/styles.scss`, with the theme and base rules in `src/styles/_base.scss` and shared controls in `src/styles/_components.scss`.

When adding real shared family data, connect the feature stores to a backend with household membership and authorization, then add persistence and synchronization. Keep the current components focused on display and interaction.
