# Training log

Personal lifting and running log. Preact SPA + Hono on Cloudflare Workers, with D1 (SQLite) for storage.

Live at https://sjt-training-app.accounts-db2.workers.dev/

## ⚠️ The app is currently unauthenticated

Every endpoint — including all writes — is open to anyone who knows the URL. Verified by an
unauthenticated `GET /api/settings` returning 200 with real data rather than redirecting to a login
page.

This is the one outstanding piece of work that can't be done from the repo: Cloudflare Access is
configured in the Zero Trust dashboard, not in `wrangler.jsonc` or via `wrangler`.

### Enabling Cloudflare Access

1. Cloudflare dashboard → **Zero Trust** → **Access** → **Applications** → **Add an application**.
2. Type **Self-hosted**.
3. Application domain: `sjt-training-app.accounts-db2.workers.dev` (leave the path blank so the
   whole app is covered, API included).
4. Add a policy: action **Allow**, rule **Emails** → your address. That's sufficient for a
   single-user app.
5. Identity provider: the built-in **One-time PIN** works without configuring an external IdP.
6. Save, then confirm it worked:

   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' https://sjt-training-app.accounts-db2.workers.dev/api/settings
   # 302 (redirect to the Access login) = protected. 200 = still open.
   ```

Once that returns 302, update the warning comment in `wrangler.jsonc` and delete this section's
warning above.

## Development

```sh
npm install
npm run db:migrate:local     # apply migrations to the local D1
npm run db:seed:local        # exercise catalogue
npm run dev                  # build client + wrangler dev
```

## Testing

```sh
npm test          # both projects
npm run typecheck # worker + test tsconfigs
```

Tests are split into two vitest projects (see `vitest.config.ts`), because the two halves of the app
need different runtimes:

- **worker** — routes and pure server modules, running in real workerd against a migrated D1, so D1
  CHECK constraints, `batch()` transactions and window functions behave as they do in production.
- **client** — browser-side modules in jsdom, which is what `localStorage` (the offline write queue)
  and component rendering need.

`--no-file-parallelism` is set in the `test` script deliberately: running the workerd pool with
parallel files intermittently fails with `ECONNRESET` while starting pool workers.

## Database

D1 migrations live in `migrations/` and must be applied to **both** local and remote — they are
separate databases and applying one does nothing to the other.

```sh
npm run db:migrate:local
npm run db:migrate:remote    # do not skip this after deploying schema-dependent code
```

Forgetting the remote apply has already caused one production outage: code that depended on a new
column shipped while the remote schema was still old, and every affected request 500'd.

## Deployment

Push to `main`. Cloudflare Workers Builds deploys automatically. CI (`.github/workflows/ci.yml`)
runs typecheck, tests and the client build — but note it does not gate the deploy, so a red build
still ships.

`public/app.js` is gitignored and built at deploy time, so the Cloudflare build command must run
`npm run build:client` before `wrangler deploy` (it's configured in the Cloudflare dashboard, not in
this repo). If a deploy ever ships without a bundle, that setting is the first place to look.

## Architecture notes

- **Local-first writes.** Logged sets land in `localStorage` and render immediately; `src/client/sync.ts`
  drains a queue to the server in the background, dropping 4xx (permanently invalid) and retrying
  5xx/network failures. Combined with the service worker in `public/sw.js`, the app opens and
  records a full session with no connection.
- **The generator is not a live AI call.** `src/generator.ts` runs a deterministic progression pass
  and exports it as JSON for a human to paste into whatever AI assistant they use; the reply is
  pasted back, validated (`validateProposal`) and held as a pending plan until accepted. There is
  deliberately no API key in the Worker — with no authentication in front of it, a public endpoint
  spending a paid key would be a cost-drain risk.
- **Only week 1 of a multi-week generation is real.** Later weeks start as flat copies, explicitly
  flagged speculative, because nothing has been logged against them yet.
