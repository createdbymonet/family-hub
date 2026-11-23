# Family Hub

Small things. Better together.

Family Hub is an Angular application for a couple to share a shopping list and celebrate everyday accomplishments. It also offers a public, read-only demo built entirely from fictional data.

## Features

- **Shopping List:** shared CRUD, completion counts, deletion confirmation, version-based conflict detection, and recoverable save errors.
- **Thanks Board:** shared posts, author-only editing/deletion, five positive reactions, and cursor-based history (50 posts per page).
- **Family Mode:** Google OpenID Connect Authorization Code Flow with PKCE; only two administrator-provisioned Google subjects can sign in.
- **Sessions:** independent device sessions, 30-day sliding inactivity expiry, 180-day absolute expiry, server-side logout, and CSRF protection.
- **Demo Mode:** fictional fixtures, no editing controls, and no private API or session requests.
- **Synchronization:** fetch on entry, route return, visible-tab restoration, and successful changes. No polling or WebSockets.

## Architecture

```text
Angular standalone component → Signal Store → feature API service
                                               ↓ same-origin /api/*
                                    Cloudflare Worker → D1

Demo routes → static fictional fixtures (no API)
Google OIDC → Worker callback → private HttpOnly Cookie session
```

The application retains Angular standalone components, OnPush, typed Reactive Forms, Signals, SCSS, keyboard/IME handling, and accessible status/error announcements. Components own drafts and focus; stores own server state and pending/error states. Request generations and transport cancellation prevent old sessions from restoring private data.

The Worker authenticates every private read/write, checks household membership, derives identity from the session, and checks authorship for post edits/deletions. Queries bind values, mutations validate inputs, and update/delete statements compare versions. UUID create requests and reaction PUT/DELETE operations support safe retries.

## Stack

Angular 21.2, TypeScript 5.9, RxJS, Vitest/jsdom, Cloudflare Workers Static Assets, D1, `jose`, pnpm, and GitHub Actions. Use Node.js 24 and pnpm 11.21.0. The committed lockfile provides exact dependency versions.

## Local development

```sh
pnpm install --frozen-lockfile
pnpm db:migrate:local
pnpm build
```

Start two terminals:

```sh
# Terminal 1: local Worker and local D1 only
pnpm dev:worker

# Terminal 2: Angular with a same-origin API proxy
pnpm dev
```

Open **https://localhost:4200/**. HTTPS keeps session cookies `Secure` locally as well as in production. Development servers use local certificates; configure browser trust for local development on your own device. The proxy's `secure: false` applies only to the local Worker connection.

Public demos work without Google credentials. Family Mode requires your own development OAuth client and two provisioned accounts. See [the setup guide](docs/SETUP.md) for local secrets, verified Google subjects, and administrator-only provisioning. No authentication bypass or development login endpoint is included.

## Routes

| URL                   | Access                                           |
| --------------------- | ------------------------------------------------ |
| `/`                   | Public menu                                      |
| `/demo/shopping-list` | Public, read-only Shopping demo                  |
| `/demo/thanks-board`  | Public, read-only Thanks demo                    |
| `/login`              | Google sign-in and session recovery              |
| `/shopping-list`      | Authenticated household members                  |
| `/thanks-board`       | Authenticated household members                  |
| `/api/*`              | Worker API; private data requires authentication |

Authentication errors never switch Family Mode to Demo Mode. The public shell and assets contain no real household data. Private API responses use `private, no-store`; logging redacts query strings to keep OAuth callback codes out of request URLs.

## Checks

```sh
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

- `test:ui`: Angular component/store/router/auth/API tests in jsdom.
- `test:worker`: signed OIDC fixtures and isolated local D1 integration tests in the Workers runtime. Google network calls are mocked; real Google sign-in is a separate setup check.
- `test:bootstrap`: offline administrator-tool input and SQL-generation checks.
- `typecheck:worker` generates runtime/binding declarations from Wrangler before checking Worker code. Generated declarations are ignored by Git.

The Worker suite applies the actual migration and verifies sessions, authorization, CRUD, persistence across requests, conflicts, reactions, and pagination without production credentials or databases. No coverage percentage is claimed; coverage thresholds and a real-browser E2E suite are not configured.

## Data and API

`migrations/0001_initial.sql` creates `users`, `households`, `household_members`, `sessions`, `shopping_items`, `thanks_posts`, `thanks_reactions`, and short-lived one-use `oauth_transactions`. It seeds no users, household content, or demo data.

DB timestamps are UTC epoch milliseconds; API timestamps are ISO 8601 strings. Shopping booleans are converted from SQLite 0/1. UI dates use the viewer's browser timezone. Product names are limited to 200 characters and posts to 2,000 (JavaScript string length after trimming). The five stable reaction codes are separate from their labels.

See [API and security details](docs/SETUP.md#api-contract) for endpoints and response semantics.

## Production deployment

The existing Worker name **`family-hub`** and static asset output **`dist/family-hub/browser`** are preserved.

| Event                | Automation                                                               |
| -------------------- | ------------------------------------------------------------------------ |
| PR or push to `main` | Formatting, app/Worker types, all tests, production build; no deployment |
| Push to `release`    | The same checks, then the existing `production` environment deploy       |

**Production migrations are manual. Neither workflow runs a remote migration or provisions a database.** The committed database ID and application origin are deliberate placeholders. A maintainer must complete [production setup](docs/SETUP.md#production-setup-manual) before a release. This implementation has not created Google clients, production D1, secrets, or deployments.

## Source layout

```text
src/app/core/              Auth, guarded API client, demo fixtures, refresh lifecycle
src/app/features/          Menu, login, Shopping List, Thanks Board and tests
src/app/shared/            Existing icons and page headers
shared/contracts.ts       Framework-independent API DTOs, limits and reaction codes
worker/                   OIDC, sessions, API authorization, SQL access and tests
migrations/               Versioned D1 schema (no seed data)
scripts/                  Offline administrator provisioning tool and tests
public/_headers           Static asset security headers
docs/SETUP.md              Local and production setup, API and operational decisions
.github/workflows/         Validation and release deployment
```

## Current boundaries

Family Mode intentionally supports two accounts and one household per user; the relational schema keeps users and households separate. There is no public signup, household creation API, password authentication, automatic polling, WebSockets, or offline editing. Long-lived invalid/revoked session rows can be cleaned up manually after their retention requirements are decided. Real OAuth and production rollout require administrator-owned configuration and verification.
