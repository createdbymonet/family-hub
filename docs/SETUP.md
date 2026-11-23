# Family Hub setup and operations

This guide documents local setup and administrator operations for the existing installation. Implementation and writes were local only; production metadata and CI logs were inspected read-only. Production database creation, migrations, data changes, OAuth configuration changes, Secret changes, deployments, Git commits/pushes and PR actions were not performed.

## Local setup

Use Node.js 24 and pnpm 11.21.0. Run `pnpm install --frozen-lockfile`, `pnpm db:migrate:local`, and `pnpm build`. The migration command explicitly targets local D1. It creates schema only; Family data starts empty.

Copy `.dev.vars.example` to `.dev.vars` in the project root. Keep the resulting file ignored by Git:

```dotenv
APP_ORIGIN="https://localhost:4200"
GOOGLE_CLIENT_ID="your-development-web-client-id"
GOOGLE_CLIENT_SECRET="your-development-web-client-secret"
```

`pnpm dev:worker` runs Wrangler locally on HTTPS port 8787 with remote bindings disabled and the local application origin. `pnpm dev` runs Angular on HTTPS port 4200. `proxy.conf.json` forwards `/api` while preserving the browser's Host/Origin. Do not set `changeOrigin: true`: the Worker deliberately validates its request URL origin against `APP_ORIGIN`.

Local HTTPS certificates must be trusted by the developer's browser. Keep `Secure` on session and OAuth cookies. No non-secure-cookie or fake-login switch is provided. The public menu and demos can be explored without secrets or any registered users.

The default local D1 state is under `.wrangler/state`. Tests use an isolated runtime database and do not populate the regular development database.

## Google OAuth configuration (administrator action)

Follow [Google's OpenID Connect documentation](https://developers.google.com/identity/openid-connect/openid-connect). Create a **Web application** OAuth client in a project you control. Configure the consent screen and appropriate test users while developing. Use separate development and production clients.

Register this exact development redirect URI:

```text
https://localhost:4200/api/auth/google/callback
```

The existing production callback is `https://family-hub.sumihana.workers.dev/api/auth/google/callback`. Scheme, host, port and path must match the Google Console registration exactly. Set `APP_ORIGIN` to the origin only, with no trailing slash, path or query. The Worker requires HTTPS. The Google Console's current registration was not inspected during this task; an administrator must verify it without changing the OAuth client as part of a routine application release.

The Worker requests `openid profile`, uses Authorization Code Flow with S256 PKCE, and stores a short-lived `__Host-family-hub-oauth` cookie. State, nonce, verifier and browser-binding hashes are persisted for ten minutes in `oauth_transactions`; a conditional UPDATE consumes each transaction once before token exchange. Replayed/expired transactions and changed browser secrets are rejected.

The ID token is verified with Google's fixed HTTPS JWKS endpoint using `jose`: RS256 signature, issuer, client audience, expiration, issued-at age, nonce and authorized-party rules are checked. Successful Google authentication is still rejected unless the subject already exists in `users` and has household membership. Tokens from Google are not stored or used as Family Hub sessions. Failed callbacks return a generic login error and clear the temporary OAuth cookie.

Successful Google login always redirects to Menu (`/`), irrespective of the previous route or an old `returnTo` query parameter. The client no longer sends `returnTo`. The legacy `oauth_transactions.return_to` column is retained for compatibility with the previous Worker during rollout, receives only a fixed value, and is never read as a redirect destination. Normal navigation with an existing valid session stays on the requested private route. Failed callbacks retain the generic login error behavior.

No OAuth client was created and no real Google login was executed as part of this implementation. Complete a real Google check after the administrator repairs configuration and releases the app. See [production authentication findings and recovery](AUTH-OPERATIONS.md).

## Obtain verified Google subjects

The existing production installation already has its two accounts. The provisioning instructions below are for a fresh local database or a separately authorized new installation, not this release. Do not replace existing subjects, recreate users, or rerun bootstrap against the current production household.

Only an administrator provisions users; neither a public signup API nor automatic account creation exists. Google `sub` identifies the account permanently. An email address, display name, or an unverified JWT payload is not sufficient.

One administrator workflow is to obtain a fresh ID token through the official [Google OAuth 2.0 Playground](https://developers.google.com/oauthplayground/) using a development OAuth client you control and the `openid profile` scopes. If using your own client there, temporarily register the Playground redirect URI according to its instructions. Confirm the account selected for each spouse. Treat the token and client secret as private and remove unused redirect URIs afterwards.

The offline helper can independently verify a fresh ID token against Google's keys before extracting its subject. Pass the expected client ID as a non-secret argument, and the token through stdin, never a shell argument or chat message. For example, in PowerShell, reading an administrator-protected file outside the repository:

```powershell
Get-Content -Raw -LiteralPath 'C:\private\google-id-token.txt' |
  node scripts/bootstrap-users.mjs --inspect-google-token 'EXPECTED_CLIENT_ID'
```

It verifies signature/issuer/audience/expiry and token age, then prints only the verified subject. It does not authenticate a browser or modify D1. Use the audience of the client that actually issued this token. Remove the temporary token file when done. Never commit tokens, real subjects, provisioning SQL, or secrets.

## Provision the two accounts

For fresh local setup only, the database must be empty and migrated. The existing production database is already initialized and must not be reprovisioned. In an interactive terminal:

```powershell
node scripts/bootstrap-users.mjs > 'C:\private\family-hub-bootstrap.sql'
```

The helper asks for household name, the two independently verified Google subjects and their display names. Prompts use stderr and SQL uses stdout. Review the generated private SQL before applying it. It requires exactly two different subjects, validates and quotes values, creates one household and two memberships, and never invokes Wrangler or D1 itself.

Apply it locally first:

```powershell
pnpm exec wrangler d1 execute DB --local --file 'C:\private\family-hub-bootstrap.sql'
```

D1 does not accept application SQL `BEGIN/COMMIT`. Provisioning uses a temporary bootstrap trigger and one household INSERT, so the user/membership inserts are atomic within that statement. The trigger checks that no installation already exists and is dropped afterwards. A retry on an already initialized database fails rather than appending more users. If interrupted, inspect database state and the `family_hub_bootstrap_once` trigger before retrying; do not blindly rerun or remove existing household data.

The schema also restricts user count to two, gives `google_sub` a UNIQUE constraint, and permits only one household per user. There is no application-level administrator registration endpoint. To change an allowed account later, perform a separately reviewed administrative data migration and revoke its sessions.

## Session and CSRF behavior

- The browser receives a 256-bit random token in `__Host-family-hub-session`, with `Path=/; HttpOnly; Secure; SameSite=Lax` and an expiry matching the server deadline.
- Only SHA-256 of the token is stored in D1. Each device gets an independent row. User identity and household membership are loaded from server-side records.
- Inactivity expires after 30 days; absolute expiry is 180 days from login. An expired or revoked row is never renewed.
- Initial private-screen entry and deliberate changes use `X-Family-Hub-Activity: 1`. Passive focus/visibility restoration and follow-up synchronization do not send it. There is no polling. The server caps every extension at the absolute deadline.
- Session GET returns a separately derived CSRF token. Every mutation requires `Origin === APP_ORIGIN` and `X-Family-Hub-CSRF`; external CORS access is not enabled. GET endpoints do not change household content.
- Authenticated responses include a non-session-token scope header (`X-Family-Hub-Session`, the derived CSRF value). The client rejects responses from a switched session.
- Logout revokes only the current server-side session, then clears its cookie. Private stores/drafts are cleared immediately; pending requests are aborted, and generation checks reject stale completions. BroadcastChannel propagates invalidation across tabs.
- If logout cannot reach the server, the UI reports that invalidation is unconfirmed and offers a retry. It does not silently restore private data.

The stateful application session is separate from any D1 Sessions API for database read consistency. See [OWASP session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

## API contract

All private endpoints require the Cookie session, including GET. IDs are UUID v4, generated by the client before create requests. Unknown fields, invalid types, blank required text, overlong text, NUL characters and unsupported reactions/statuses are rejected. JSON request bodies are limited to 16 KiB, except Notes creation/updates, which allow 32 KiB so maximum-size multiline Unicode bodies fit the bounded envelope. DB row types are private to the Worker; `shared/contracts.ts` defines public DTOs.

| Method and endpoint                            | Request / result                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `GET /api/auth/google/start`                   | Starts login; any `returnTo` query is ignored                                                    |
| `GET /api/auth/google/callback`                | Validates transaction/token, permits registered subject, creates session, redirects to `/`       |
| `GET /api/auth/session`                        | `SessionDto` or 401                                                                              |
| `POST /api/auth/logout`                        | CSRF required; 204 and current-session revocation                                                |
| `GET /api/shopping-items`                      | `ShoppingItemDto[]`, creation order                                                              |
| `POST /api/shopping-items`                     | `{id,name}` → item, 201; identical create retry returns existing item                            |
| `PATCH /api/shopping-items/:id`                | `{version,name?,completed?}` → updated item                                                      |
| `DELETE /api/shopping-items/:id?version=N`     | Version match → 204                                                                              |
| `GET /api/thanks-posts`                        | `{posts,nextCursor}`; latest 50 posts, displayed oldest-first                                    |
| `GET /api/thanks-posts?before=CURSOR`          | Previous page; opaque cursor must be URL-encoded                                                 |
| `POST /api/thanks-posts`                       | `{id,message}` → post, 201; same-author identical retry returns existing post                    |
| `PATCH /api/thanks-posts/:id`                  | Author only, `{version,message}` → updated post                                                  |
| `DELETE /api/thanks-posts/:id?version=N`       | Author and version match → 204                                                                   |
| `PUT /api/thanks-posts/:id/reactions/:code`    | Ensures this user's reaction exists; returns post                                                |
| `DELETE /api/thanks-posts/:id/reactions/:code` | Removes only this user's matching reaction; returns post                                         |
| `GET /api/wishes`                              | `WishlistItemDto[]`; pending first, then most recently updated                                   |
| `POST /api/wishes`                             | `{id,title,memo?}` → wish, 201; same-author identical retry returns existing wish                |
| `GET /api/wishes/:id`                          | Household-scoped `WishlistItemDto`                                                               |
| `PATCH /api/wishes/:id`                        | `{version,title?,memo?,status?}`; status is `pending` or `achieved`                              |
| `DELETE /api/wishes/:id?version=N`             | Either spouse, household and version match → 204                                                 |
| `GET /api/notes`                               | `NoteDto[]`; open first, then most recently updated                                              |
| `POST /api/notes`                              | `{id,title,body}` → note, 201; same-author identical retry returns existing note                 |
| `GET /api/notes/:id`                           | Household-scoped `NoteDto` including the full plain-text body                                    |
| `PATCH /api/notes/:id`                         | `{version,title?,body?,status?}`; status is `open` or `resolved`                                 |
| `DELETE /api/notes/:id?version=N`              | Either spouse, household and version match → 204                                                 |
| `GET /api/user-settings`                       | Current user's `UserSettingsDto`; missing row returns defaults                                   |
| `PATCH /api/user-settings`                     | `{version,theme?,showCompletedShoppingItems?,showAchievedWishes?,showResolvedNotes?}` → settings |

Reaction codes and existing D1 values remain `super-thanks`, `thanks`, `awesome`, `heart`, `clap`. Their display labels are `Thanks a lot!`, `Thank you!`, `Awesome!`, `❤️`, `👏`. Emoji buttons use the English accessible labels `Heart` and `Clap`. Multiple different reactions and reacting to one's own post are allowed. The composite primary key prevents duplicate reactions. Thanks Board's author-only editing/deletion rule is unchanged.

Text limits are JavaScript string lengths after trimming: shopping name 200, Thanks message 2,000, wish title 200, optional wish memo 1,000, note title 200, and required note body 4,000. Notes are multiline plain text rendered with Angular text interpolation; Markdown, attachments, tags, and search are not supported.

Wishes and notes record `authorId` from the session and expose the author's display name, `createdAt`, `updatedAt`, `version`, and a nullable `achievedAt` or `resolvedAt`. Both spouses can edit, delete, finish, and reopen any entry in their household. A finish transition records the server time; editing a finished entry preserves it, while Undo/Reopen clears it. Finished entries stay in D1. There are no deadlines, priorities, categories, or notifications. SQL identifiers come from a fixed server-owned feature map; all request values are bound parameters.

Settings derive `user_id` exclusively from the current session. Client-supplied user IDs are rejected as unexpected fields; one spouse cannot change the other's row. GET returns KAWASAKI, three `false` display flags, and version 1 when no row exists, without writing. The first PATCH inserts a default row if needed and uses an atomic version comparison for the update. Concurrent edits return 409 rather than overwrite another device.

Error envelopes are `{error:{code,message}}`. Common statuses are 400 (input), 401 (session), 403 (CSRF/author), 404 (absent or outside household), 409 (version/create conflict), 413 (body size), 415 (content type), 405 (method), and a generic 500 (internal failure). Authentication configuration problems return 503. API failures never become SPA HTML or demo data. A conflict refreshes current state while retaining the user's draft for review. Lost acknowledgements of PATCH/DELETE can require refresh/review; they do not silently overwrite a newer version.

## Screens, themes and display preferences

Menu `/` contains exactly four feature cards: Shopping List, Thanks Board, Wishlist, and Notes, each with Family and Demo links. The previous hero and lower family-space section have been removed; the shared header, sign-in/sign-out, Settings access, and footer remain.

Family routes are `/shopping-list`, `/thanks-board`, `/wishlist`, `/notes`, and `/settings`. Each requires a valid session. Public feature demos use the corresponding `/demo/` prefix. `/demo/settings` previews themes and history preferences without authentication. Demo content is fictional and read-only; demo preferences use separate in-memory state for the current visit and reset on reload. Neither demo content nor demo settings call private session or data endpoints.

`SettingsService` loads authenticated settings from D1 and applies `data-theme` to the document root. Shared CSS Custom Properties in `src/styles/_base.scss` retain the exact theme colors:

| Theme              | Primary token | Accent token |
| ------------------ | ------------- | ------------ |
| KAWASAKI (default) | `#8E1728`     | `#C5A052`    |
| CHARLOTTE          | `#00A3B5`     | `#7952C7`    |
| EDOGAWA            | `#123F80`     | `#F28C28`    |

Backgrounds/gradients, button states, links, icons, badges, card accents, and focus styling derive from these tokens. CHARLOTTE's lighter teal remains the raw theme color; a darker derived `--color-primary-ink` supplies text, filled buttons, and focus outlines for contrast. Existing Angular/SCSS patterns and dependencies are reused; no UI library was added.

The independent settings `showCompletedShoppingItems`, `showAchievedWishes`, and `showResolvedNotes` all default to `false`. Turning them on shows preserved history and allows completion Undo, wish Undo, and note Reopen. Hiding history never deletes data. Changes apply immediately; failed saves roll back with an error, and version conflicts reload the latest preferences for review. User settings survive reloads, sign-ins, and device changes through D1. Logout/session changes clear private settings and abort pending requests; demo state cannot overwrite private preferences.

## Schema, tests and recovery

`0001_initial.sql` is unchanged and contains seven domain/session tables plus `oauth_transactions`, foreign keys, UNIQUE/CHECK constraints, STRICT tables and household/time indexes. Additive migration `0002_wishes_notes_settings.sql` creates `wishlist_items`, `notes`, and `user_settings`, with household/author foreign keys, status/timestamp consistency checks, versions, and household/status/update indexes. It does not drop or rewrite existing tables or data, including OAuth transactions. No sample data or new users are inserted into real databases. Fictional demo fixtures live only in `src/app/core/demo-data.ts` and `src/app/core/new-feature-demo-data.ts`.

Run `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm deploy:check`. Worker tests run the real migrations against isolated local D1 and mock Google's token/JWKS endpoints with signed fixtures. They cover household boundaries, spouse permissions, version conflicts, timestamps, independent user preferences, and preservation of existing data. They do not use development or production D1. Node tests cover offline bootstrap and synthetic production metadata snapshots, without production credentials. Tests and Wrangler dry-run do not substitute for remote configuration checks or completing the real Google flow.

Inspect/repair local D1 using explicit `--local` commands. Before changing production schema or account records, review the target and recovery plan. D1 supports [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/); verify your plan's retention and recovery process. A Worker code rollback does not undo database changes. Restoring a database can restore old session records too, so revoke sessions after a security-sensitive restore.

Expired OAuth transactions are removed on new login starts. Expired/revoked application sessions are rejected immediately but their rows are retained; choose and document a retention/cleanup policy before adding scheduled cleanup. Thanks history is paged; Shopping, Wishlist, and Notes currently load as complete household lists.

## Production setup (manual)

The production D1 database and two provisioned accounts already exist. **Do not recreate the database, reset migrations, rerun bootstrap, or reprovision accounts for this release.** These future steps belong to the administrator and were not executed:

1. Verify the intended Cloudflare account, Worker `family-hub`, D1 `family-hub-production`, and the explicit existing database ID in `wrangler.jsonc`. Keep the Worker name, DB binding, and asset directory unchanged. Review the current recovery/backup plan and available D1 recovery point before any migration.
2. Review [AUTH-OPERATIONS.md](AUTH-OPERATIONS.md). The read-only investigation confirmed the active Worker has correct Origin/Client ID but no `GOOGLE_CLIENT_SECRET` binding. Repair the active Secret configuration using the reviewed administrator procedure; do not deploy an arbitrary historical staged version. Secret values must stay out of source, plaintext `vars`, GitHub Actions, logs, and command arguments. Confirm the existing Google client's exact callback URI separately.
3. Run `node scripts/check-production-auth.mjs` with appropriate read access. It must verify all active versions successfully before the new CI can deploy. It reads binding metadata, never Secret values. A Secret-update annotation on an undeployed version is insufficient.
4. Review `0002_wishes_notes_settings.sql` and list pending migrations for the verified production target with `pnpm exec wrangler d1 migrations list family-hub-production --remote --config wrangler.jsonc`. Confirm `0001_initial.sql` is already recorded as applied and **only the reviewed `0002` is pending**. If the migration history differs, stop and reconcile it without changing existing data. After the backup/target checks, manually apply pending migrations using `pnpm exec wrangler d1 migrations apply family-hub-production --remote --config wrangler.jsonc`. This command applies all pending files, so the preceding pending-list review is required. Neither Actions workflow performs remote migrations. Apply the additive schema before releasing the new Worker code.
5. Keep the existing GitHub `production` environment restricted to `release`, with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The CI token needs deployment/binding access plus read access for Worker deployment/version metadata; this check does not require extra D1 data-changing privileges. Keep separate automatic Cloudflare Git deployment disabled.
6. Run all local checks and review changes. Release through the existing `release` push workflow only when authorized. `secrets.required` declares `GOOGLE_CLIENT_SECRET` by name and prevents missing inheritance from silently succeeding. CI also checks active OAuth bindings before deployment and verifies the newly active versions afterwards. The current missing-Secret state intentionally stops deployment before changes are uploaded by the deploy step.
7. After release, complete actual Google login for both allowed accounts, confirm every successful flow lands on Menu even with `returnTo`, and reject an unrelated account. Verify Cookie attributes, 30/180-day deadlines, no-store API headers, logout, private direct routes, and query-string redaction.
8. Verify preserved Shopping/Thanks data, Thanks author-only edits/deletes, either spouse editing the same wishes/notes, status dates/Undo/Reopen, independent theme/display settings across reloads and devices, and read-only Demo/no private requests. Confirm that hiding history retains the data.

Static assets set CSP, no-referrer, nosniff and frame protection in `public/_headers`. Angular critical CSS inlining is disabled so the CSP does not require inline script handlers; component styles use the current inline-style allowance. Worker responses set their own API security/cache headers. Logs and traces are enabled with query-string redaction; application errors deliberately log no raw request, SQL, identity token, session token or client secret.
