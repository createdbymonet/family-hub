# Family Hub setup and operations

This guide documents administrator actions. The implementation task performed local work only. Production database creation, migrations, OAuth client creation, secrets, deployment, Git commits/pushes and PR actions were not performed.

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

The default local D1 state is under `.wrangler/state`. Tests use an isolated runtime database. Administrator provisioning verification used a separate local persistence directory, so it does not populate the regular development database.

## Google OAuth configuration (administrator action)

Follow [Google's OpenID Connect documentation](https://developers.google.com/identity/openid-connect/openid-connect). Create a **Web application** OAuth client in a project you control. Configure the consent screen and appropriate test users while developing. Use separate development and production clients.

Register this exact development redirect URI:

```text
https://localhost:4200/api/auth/google/callback
```

Production uses `https://YOUR_APP_HOST/api/auth/google/callback`. Scheme, host, port and path must match. Set `APP_ORIGIN` to the origin only, with no trailing slash, path or query. The Worker requires HTTPS.

The Worker requests `openid profile`, uses Authorization Code Flow with S256 PKCE, and stores a short-lived `__Host-family-hub-oauth` cookie. State, nonce, verifier and browser-binding hashes are persisted for ten minutes in `oauth_transactions`; a conditional UPDATE consumes each transaction once before token exchange. Replayed/expired transactions and changed browser secrets are rejected.

The ID token is verified with Google's fixed HTTPS JWKS endpoint using `jose`: RS256 signature, issuer, client audience, expiration, issued-at age, nonce and authorized-party rules are checked. Successful Google authentication is still rejected unless the subject already exists in `users` and has household membership. Tokens from Google are not stored or used as Family Hub sessions. Failed callbacks return a generic login error and clear the temporary OAuth cookie.

No Google client or real login was created/executed as part of this local implementation. Use your own credentials to complete an end-to-end Google check after setup.

## Obtain verified Google subjects

Only an administrator provisions users; neither a public signup API nor automatic account creation exists. Google `sub` identifies the account permanently. An email address, display name, or an unverified JWT payload is not sufficient.

One administrator workflow is to obtain a fresh ID token through the official [Google OAuth 2.0 Playground](https://developers.google.com/oauthplayground/) using a development OAuth client you control and the `openid profile` scopes. If using your own client there, temporarily register the Playground redirect URI according to its instructions. Confirm the account selected for each spouse. Treat the token and client secret as private and remove unused redirect URIs afterwards.

The offline helper can independently verify a fresh ID token against Google's keys before extracting its subject. Pass the expected client ID as a non-secret argument, and the token through stdin, never a shell argument or chat message. For example, in PowerShell, reading an administrator-protected file outside the repository:

```powershell
Get-Content -Raw -LiteralPath 'C:\private\google-id-token.txt' |
  node scripts/bootstrap-users.mjs --inspect-google-token 'EXPECTED_CLIENT_ID'
```

It verifies signature/issuer/audience/expiry and token age, then prints only the verified subject. It does not authenticate a browser or modify D1. Use the audience of the client that actually issued this token. Remove the temporary token file when done. Never commit tokens, real subjects, provisioning SQL, or secrets.

## Provision the two accounts

The database must be empty and migrated. In an interactive terminal:

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

All private endpoints require the Cookie session, including GET. IDs are UUID v4, generated by the client before create requests. Unknown fields, invalid types, blank or overlong text, NUL characters and unsupported reactions are rejected. JSON request bodies are limited to 16 KiB. DB row types are private to the Worker; `shared/contracts.ts` defines public DTOs.

| Method and endpoint                            | Request / result                                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| `GET /api/auth/google/start`                   | Starts login; optional `returnTo` is restricted to the two Family routes            |
| `GET /api/auth/google/callback`                | Validates transaction/token, permits registered subject, creates session, redirects |
| `GET /api/auth/session`                        | `SessionDto` or 401                                                                 |
| `POST /api/auth/logout`                        | CSRF required; 204 and current-session revocation                                   |
| `GET /api/shopping-items`                      | `ShoppingItemDto[]`, creation order                                                 |
| `POST /api/shopping-items`                     | `{id,name}` → item, 201; identical create retry returns existing item               |
| `PATCH /api/shopping-items/:id`                | `{version,name?,completed?}` → updated item                                         |
| `DELETE /api/shopping-items/:id?version=N`     | Version match → 204                                                                 |
| `GET /api/thanks-posts`                        | `{posts,nextCursor}`; latest 50 posts, displayed oldest-first                       |
| `GET /api/thanks-posts?before=CURSOR`          | Previous page; opaque cursor must be URL-encoded                                    |
| `POST /api/thanks-posts`                       | `{id,message}` → post, 201; same-author identical retry returns existing post       |
| `PATCH /api/thanks-posts/:id`                  | Author only, `{version,message}` → updated post                                     |
| `DELETE /api/thanks-posts/:id?version=N`       | Author and version match → 204                                                      |
| `PUT /api/thanks-posts/:id/reactions/:code`    | Ensures this user's reaction exists; returns post                                   |
| `DELETE /api/thanks-posts/:id/reactions/:code` | Removes only this user's matching reaction; returns post                            |

Codes: `super-thanks`, `thanks`, `awesome`, `heart`, `clap`. Multiple different reactions and reacting to one's own post are allowed. The composite primary key prevents duplicate reactions.

Error envelopes are `{error:{code,message}}`. Common statuses are 400 (input), 401 (session), 403 (CSRF/author), 404 (absent or outside household), 409 (version/create conflict), 413 (body size), 415 (content type), 405 (method), and a generic 500 (internal failure). Authentication configuration problems return 503. API failures never become SPA HTML or demo data. A conflict refreshes current state while retaining the user's draft for review. Lost acknowledgements of PATCH/DELETE can require refresh/review; they do not silently overwrite a newer version.

## Schema, tests and recovery

`0001_initial.sql` contains seven domain/session tables plus `oauth_transactions`, foreign keys, UNIQUE/CHECK constraints, STRICT tables and household/time indexes. No sample data is inserted into real databases. Demo fixtures live only in `src/app/core/demo-data.ts`.

Run `pnpm format:check`, `pnpm typecheck`, `pnpm test`, and `pnpm build`. Worker tests run the real migration against isolated local D1 and mock Google's token/JWKS endpoints with signed fixtures. They do not use development or production D1. The bootstrap suite is offline; its generated SQL was also tested separately with local Wrangler. Tests do not substitute for completing the real Google flow with your credentials.

Inspect/repair local D1 using explicit `--local` commands. Before changing production schema or account records, review the target and recovery plan. D1 supports [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/); verify your plan's retention and recovery process. A Worker code rollback does not undo database changes. Restoring a database can restore old session records too, so revoke sessions after a security-sensitive restore.

Expired OAuth transactions are removed on new login starts. Expired/revoked application sessions are rejected immediately but their rows are retained; choose and document a retention/cleanup policy before adding scheduled cleanup. Post history is paged; shopping items currently load as one household list.

## Production setup (manual)

These are future administrator steps, not actions performed by this implementation:

1. Create a production D1 database in the intended Cloudflare account. Replace the all-zero `database_id` and verify `database_name` in `wrangler.jsonc`. Keep the Worker name `family-hub` and static output directory unchanged. Do not remove the explicit database ID, which avoids accidental automatic resource provisioning.
2. Set `APP_ORIGIN` and `GOOGLE_CLIENT_ID` in Wrangler to the chosen HTTPS production origin and production web client. Register the exact Google callback URI. Keep client secrets out of Wrangler plaintext variables and Git.
3. Register `GOOGLE_CLIENT_SECRET` as a Cloudflare Worker secret using an administrator-controlled process. [Cloudflare secret setup](https://developers.cloudflare.com/workers/configuration/secrets/) distinguishes immediate-deployment `wrangler secret put` from staged version operations; plan this initial secret setup accordingly. The secret is not a frontend variable or a GitHub Actions deployment secret.
4. Review schema and recovery, then manually apply production migrations to the intended database. Only here, after checking the target, use `pnpm exec wrangler d1 migrations apply family-hub-production --remote`. Neither Actions workflow contains this command.
5. Generate and review a new private provisioning file for the two verified accounts. After local verification and a target check, manually apply it to the production database. Do not include this file in migrations, static assets, Git, or CI artifacts.
6. Configure the GitHub `production` environment to allow `release`, with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for the intended account. Ensure the token can deploy this Worker/bind the configured D1; migration privileges are not needed by CI. Keep any separate Cloudflare Git auto-deployment disabled.
7. Run local checks, complete a real Google login for each allowed account, and verify that an unrelated account is rejected. Release through the existing `release` push workflow when ready. Workflows run checks and deploy code/assets only; production schema changes remain manual and backward-compatible.
8. After release, confirm Cookie attributes, 30/180-day deadlines, no-store API headers, two-device sharing, author-only post changes, logout, direct URLs, read-only demo/no private requests, and logging redaction.

Static assets set CSP, no-referrer, nosniff and frame protection in `public/_headers`. Angular critical CSS inlining is disabled so the CSP does not require inline script handlers; component styles use the current inline-style allowance. Worker responses set their own API security/cache headers. Logs and traces are enabled with query-string redaction; application errors deliberately log no raw request, SQL, identity token, session token or client secret.
