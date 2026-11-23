# Family Hub

**Small things. Better together.**

Family Hub is an Angular application for a couple to share everyday errands, appreciation, wishes, and notes. Its public demos use fictional, read-only content.

**[Live Demo](https://family-hub.sumihana.workers.dev/)**

## Features

- **Shopping List:** Shared CRUD, completion counts, deletion confirmation, version-based conflict detection, and recoverable save errors.
- **Thanks Board:** Shared posts, author-only editing/deletion, five positive reactions, and cursor-based history (50 posts per page).
- **Wishlist:** Shared titles and optional memos, editing/deletion by either spouse, and Achieved/Undo with achievement history.
- **Notes:** Shared plain-text notes, expandable details, editing/deletion by either spouse, and Resolve/Reopen with resolution history.
- **Settings:** Three color themes and three independent history-display preferences, persisted per user in D1 across devices and sign-ins. Completed, achieved, and resolved entries start hidden and are retained.
- **Menu:** Four feature cards with Family and Demo links. Successful Google sign-in always returns to Menu (`/`), including when an old link contains `returnTo`.
- **Family Mode:** Google OpenID Connect Authorization Code Flow with PKCE; only two administrator-provisioned Google subjects can sign in.
- **Sessions:** Independent device sessions, 30-day sliding inactivity expiry, 180-day absolute expiry, server-side logout, and CSRF protection.
- **Demo Mode:** Fictional fixtures, no content-editing controls, and no private API or session requests.
- **Demo Settings:** Theme and display preferences can be explored for the current visit without signing in, using memory only and no private API.
- **Synchronization:** Fetch on entry, route return, visible-tab restoration, and successful changes. No polling or WebSockets.

## Architecture

```text
Angular standalone component → Signal Store → Feature API service
                                                  ↓ same-origin /api/*
                                       Cloudflare Worker → D1

Demo routes → Static fictional fixtures (no API)
Google OIDC → Worker callback → Private HttpOnly Cookie session
```

The application retains Angular standalone components, OnPush, typed Reactive Forms, Signals, SCSS, keyboard/IME handling, and accessible status/error announcements.

Components own drafts and focus; stores own server state and pending/error states. Request generations and transport cancellation prevent old sessions from restoring private data.

The Worker authenticates every private read/write, checks household membership, and derives identity from the session. Thanks Board edits/deletions remain author-only; either spouse can change any household wish or note. Settings endpoints accept no user ID and affect only the authenticated user's preferences.

Queries bind values, mutations validate inputs, and update/delete statements compare versions. UUID create requests and reaction PUT/DELETE operations support safe retries.

## Stack

Angular 21.2, TypeScript 5.9, RxJS, Vitest/jsdom, Cloudflare Workers Static Assets, D1, `jose`, pnpm, and GitHub Actions.

Use Node.js 24 and pnpm 11.21.0. The committed lockfile provides exact dependency versions.

These additions reuse the existing dependencies; no UI library was added.

## Local development

```sh
pnpm install --frozen-lockfile
pnpm db:migrate:local
pnpm build
```

Start two terminals:

```sh
# Terminal 1: Local Worker and local D1 only
pnpm dev:worker

# Terminal 2: Angular with a same-origin API proxy
pnpm dev
```

Open **https://localhost:4200/**.

HTTPS keeps session cookies `Secure` locally as well as in production.

Local development requires trusted HTTPS certificates. On Windows, `mkcert` can generate a local certificate authority and certificates for `localhost`.

Configure the development servers to use trusted certificates. The Angular proxy should validate the Worker's certificate when the local CA is trusted by Node.js.

Public demos work without Google credentials. Family Mode requires a development OAuth client and two provisioned Google accounts.

See the [setup guide](docs/SETUP.md) for local secrets, verified Google subjects, certificate requirements, and administrator-only provisioning.

No authentication bypass or development login endpoint is included.

## Routes

| URL                   | Access                                           |
| --------------------- | ------------------------------------------------ |
| `/`                   | Public menu with four feature cards              |
| `/demo/shopping-list` | Public, read-only Shopping demo                  |
| `/demo/thanks-board`  | Public, read-only Thanks demo                    |
| `/demo/wishlist`      | Public, read-only Wishlist demo                  |
| `/demo/notes`         | Public, read-only Notes demo                     |
| `/demo/settings`      | Public appearance/display preview for this visit |
| `/login`              | Google sign-in and session recovery              |
| `/shopping-list`      | Authenticated household members                  |
| `/thanks-board`       | Authenticated household members                  |
| `/wishlist`           | Authenticated household members                  |
| `/notes`              | Authenticated household members                  |
| `/settings`           | Authenticated user's personal preferences        |
| `/api/*`              | Worker API; private data requires authentication |

Authentication errors never switch Family Mode to Demo Mode.

The public shell and assets contain no real household data. Private API responses use `private, no-store`; logging redacts query strings to keep OAuth callback codes out of request URLs.

## Checks

```sh
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm deploy:check
```

- `test:ui`: Angular component/store/router/auth/API tests in jsdom.
- `test:worker`: Signed OIDC fixtures and isolated local D1 integration tests in the Workers runtime. Google network calls are mocked; real Google sign-in is a separate setup check.
- `test:bootstrap`: Offline administrator-tool input/SQL checks and production OAuth metadata-check fixtures. Tests do not access production.
- `typecheck:worker`: Generates runtime/binding declarations from Wrangler before checking Worker code. Generated declarations are ignored by Git.

The Worker suite applies the actual migrations and verifies sessions, authorization, CRUD, persistence across requests, conflicts, reactions, pagination, status timestamps, independent user preferences, and preservation of existing data without production credentials or databases.

No coverage percentage is claimed; coverage thresholds and a real-browser E2E suite are not configured.

## Data and API

`migrations/0001_initial.sql` creates:

- `users`
- `households`
- `household_members`
- `sessions`
- `shopping_items`
- `thanks_posts`
- `thanks_reactions`
- `oauth_transactions`

The original migration is unchanged. The additive `migrations/0002_wishes_notes_settings.sql` creates `wishlist_items`, `notes`, and `user_settings`, with foreign keys, status/timestamp constraints, versions, and household/status/update indexes. It does not update or remove existing household, authentication, Shopping, or Thanks data. Neither migration seeds users, household content, or demo data.

DB timestamps are UTC epoch milliseconds; API timestamps are ISO 8601 strings.

Shopping booleans are converted from SQLite 0/1. UI dates use the viewer's browser timezone.

Text limits use JavaScript string length after trimming: shopping names 200, Thanks messages 2,000, wish titles 200, optional wish memos 1,000, note titles 200, and required note bodies 4,000. Notes support multiline plain text. JSON bodies are bounded at 32 KiB for Notes creation/updates and 16 KiB elsewhere.

The five stable reaction codes remain unchanged. Labels are `Thanks a lot!`, `Thank you!`, `Awesome!`, `❤️`, and `👏`; emoji buttons have English accessible labels.

`/api/wishes` and `/api/notes` provide household-scoped list/create/detail/update/delete operations with version conflicts. Server-generated completion timestamps are cleared on Undo/Reopen and retained when completed entries are edited. User settings use `/api/user-settings`, with a version-checked PATCH and identity derived from the session.

## Appearance and personal preferences

| Theme              | Primary   | Accent    |
| ------------------ | --------- | --------- |
| KAWASAKI (default) | `#8E1728` | `#C5A052` |
| CHARLOTTE          | `#00A3B5` | `#7952C7` |
| EDOGAWA            | `#123F80` | `#F28C28` |

The selected theme sets `data-theme` on the document root. Shared CSS Custom Properties derive backgrounds, gradients, buttons, links, icons, card accents, badges, and focus styling. The exact primary/accent colors are retained as tokens; CHARLOTTE uses a darker derived ink color for text, filled buttons, and focus outlines to keep readable contrast.

Settings default to KAWASAKI and `false` for `showCompletedShoppingItems`, `showAchievedWishes`, and `showResolvedNotes`. A missing D1 settings row returns those defaults; the first change creates the user's row. Changes appear immediately, are confirmed by the API, and roll back visibly if saving fails. History filters change visibility only. Turn the corresponding preference on to access Undo/Reopen for a finished entry.

Demo settings are separate in-memory visit state, with no D1, account, private-session request, or private API dependency. Reloading starts a fresh demo visit.

See [API and security details](docs/SETUP.md#api-contract) for endpoints and response semantics.

## Production deployment

The existing Worker name **`family-hub`** and static asset output **`dist/family-hub/browser`** are preserved.

**Production URL:** https://family-hub.sumihana.workers.dev/

| Event                | Automation                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------ |
| PR or push to `main` | Formatting, app/Worker types, all tests, production build; no deployment                   |
| Push to `release`    | The same checks, OAuth binding preflight, production deployment, then binding verification |

**Production migrations are manual. Neither workflow runs remote migrations or provisions a database.**

### Production environment

The production environment uses:

- Cloudflare Worker: `family-hub`
- Cloudflare D1 database: `family-hub-production`
- Google OAuth: Separate production Web application client
- Authentication: Two administrator-provisioned Google accounts
- Application origin: `https://family-hub.sumihana.workers.dev`

The production D1 database has been created, its initial migration applied, and the two household accounts provisioned.

Do not recreate the production database, rerun the initial migration manually, or reprovision the two existing accounts for this release. After confirming the target and recovery plan, an administrator applies only pending migrations, expected to be `0002_wishes_notes_settings.sql`, before releasing the new code.

Read-only investigation on 2026-11-24 JST confirmed that the active Worker version contains the expected Origin and Client ID but lacks the `GOOGLE_CLIENT_SECRET` binding. A historical staged-version update annotation did not establish that a usable Secret is present. The current configuration therefore still requires administrator repair; local implementation does not fix production by itself. See [the evidence and administrator recovery procedure](docs/AUTH-OPERATIONS.md).

### GitHub Actions

Pushes to `release` deploy through [GitHub Actions](.github/workflows/deploy-production.yml).

The GitHub `production` environment requires:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Restrict deployments to the `release` branch.

`GOOGLE_CLIENT_SECRET` belongs in a Cloudflare Worker Secret, not GitHub Actions, source control, or plaintext `vars`. `secrets.required` declares its name so Wrangler rejects missing inheritance. The CI metadata checks verify every active production version before and after deployment without reading Secret values; the existing missing-Secret state stops the release before deployment. An administrator must repair the active configuration first. A Secret on an undeployed version alone is insufficient.

Run the read-only production metadata check separately when Cloudflare read access is available:

```sh
node scripts/check-production-auth.mjs
```

Wrangler dry-run checks packaging only; it does not verify remote Secret inheritance, migration status, Google Console settings, or real login.

Run the following command to validate the production build and Worker packaging without deploying:

```sh
pnpm deploy:check
```

For the complete deployment procedure, see [Production setup](docs/SETUP.md#production-setup-manual).

## Source layout

```text
src/app/core/              Auth, settings, guarded API client, demo fixtures, refresh lifecycle
src/app/features/          Menu, login, Shopping, Thanks, Wishlist, Notes, Settings and tests
src/app/shared/            Existing icons and page headers
shared/contracts.ts        Framework-independent API DTOs, limits and reaction codes
worker/                    OIDC, sessions, API authorization, SQL access and tests
migrations/                Versioned D1 schema (no seed data)
scripts/                   Offline provisioning and read-only production-auth checks
public/_headers            Static asset security headers
docs/SETUP.md              Local and production setup, API and operational decisions
docs/AUTH-OPERATIONS.md    Production auth evidence and administrator recovery steps
.github/workflows/         Validation and release deployment
```

## Current boundaries

Family Mode intentionally supports two accounts and one household per user; the relational schema keeps users and households separate.

There is no public signup, household creation API, password authentication, automatic polling, WebSockets, or offline editing.

Long-lived invalid/revoked session rows can be cleaned up manually after their retention requirements are decided.

Automated checks cover local behavior with isolated D1 and signed Google fixtures. Real production Google authentication, the Google Console Redirect URI, and cross-device behavior require administrator verification after configuration repair and release. No production migration, Secret change, deployment, commit, push, or PR action is part of this implementation.
