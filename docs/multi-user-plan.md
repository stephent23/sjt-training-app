# Multi-user plan

How this app goes from one unauthenticated user to several authenticated ones, without losing the
data that is already in it and without a week where the deployed app is broken.

Read [generator-design.md](generator-design.md) first for why the AI generation flow is a manual
round trip today — undoing that is the biggest single payoff of this work, and it is §6 below.

## 0 · Where we are

The state of things, stated plainly because every decision below follows from it:

- **The deployed app has no authentication at all.** Every endpoint, including all writes and the
  generator's accept/reject, is open to anyone with the URL. `README.md` records this and gives the
  Cloudflare Access instructions; `wrangler.jsonc` carries the same warning.
- **There is no `users` table and no user column anywhere.** `sessions`, `planned_sets`,
  `logged_sets`, `planned_runs`, `logged_runs`, `session_feedback`, `exercise_swaps`,
  `generated_plans` and `bodyweight` all belong, implicitly, to the one person using the app.
  `settings` is a single row pinned by `CHECK (id = 1)`.
- **Every query is written on the assumption that all rows are yours.** There is no scoping to copy,
  no ORM to enforce it, and no test that would notice a missing `AND user_id = ?`.
- **Writes are local-first.** `src/client/sync.ts` queues into `localStorage` under one global key
  and drains in the background; `src/client/sessionCache.ts` keeps whole `SessionDetail` objects
  under `ta:session:<id>`. Both are user-blind today.
- **It is a PWA that must work in a basement gym.** `public/sw.js` caches the shell; the write queue
  covers the rest. Anything that makes a cold boot require the network is a regression.
- **Solo developer.** No operations team, no on-call, no appetite for running an email pipeline.

## 1 · The auth decision

### Recommendation

**OAuth authorization-code flow with Google as the identity provider, opaque session tokens stored
hashed in D1, resolved to a `user_id` by one Hono middleware.** GitHub can be added later as a
second provider at the cost of about thirty lines; the schema is already shaped for it.

Concretely:

- `GET /api/auth/google/start` → 302 to Google with PKCE; the state and code verifier ride in a
  10-minute `HttpOnly` cookie, so no server-side state table is needed for the handshake.
- `GET /api/auth/google/callback` → exchanges the code server-to-server, reads `email` and `sub`
  from the returned ID token, upserts `users` + `user_identities`, mints a session, 302 to `/`.
- Session cookie `ta_session`: 32 random bytes, base64url. D1 stores only `sha256(token)`, so a
  database dump is not a pile of live sessions.
- `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=7776000` (90 days), refreshed on use when more
  than a day old. Ninety days is deliberate — see the offline argument below.
- `POST /api/auth/logout` deletes the row and clears the cookie.

No JWT library is needed. The ID token arrives over TLS directly from Google's token endpoint in a
server-to-server call, so the authorization-code flow does not require verifying its signature —
decode the payload and read the claims. That keeps the dependency list at `hono` + `preact`.

`global_fetch_strictly_public` is already set in `wrangler.jsonc` and does not interfere; Google's
endpoints are public hosts.

### Why, against the actual constraints

**No passwords means no password-reset email pipeline** — the thing that was explicitly ruled out.
Google owns recovery. That single fact removes the largest ongoing operational burden a solo
developer would otherwise be signing up for.

**It works offline in the way that matters.** Only the initial sign-in needs the network. After
that, the cookie is a 90-day credential that rides along with every request; a cold PWA boot in a
basement needs no auth round trip at all, provided the client treats a *failed* `/api/me` as
"unknown, keep going" rather than "logged out" (§5).

**Sessions in D1, not KV.** D1 is already bound, already migrated by the test harness, and
strongly consistent. KV's edge cache means a revoked session can keep working for up to a minute
after logout — for an app someone might open on a shared gym tablet, "log out" has to mean it. One
indexed primary-key read per request is not a cost worth optimising away at this scale.

**Not a stateless signed JWT cookie.** Same reason: you cannot revoke one. "Sign out everywhere"
would be a lie.

### What is being ruled out, and why

**Cloudflare Access / Zero Trust — as the multi-user answer.** Access is an
administrator-managed allowlist configured in a dashboard: adding a user means the owner editing a
policy. That is not signup, it is provisioning, and it does not scale past friends-and-family
without becoming a chore. It also has a specific hazard for this app: when the Access JWT expires,
API calls get a 302 to `<team>.cloudflareaccess.com`, and a background `fetch` from the sync queue
either follows it into a CORS failure or — worse, depending on the browser — comes back `ok` with a
login page as the body, at which point `drain()` deletes a logged set it never actually saved.

That said, **Access is exactly the right stopgap for right now** (§8, step 0). Turn it on today.
Take it off at step 6, when real auth replaces it — not before, and not after.

**WebAuthn / passkeys.** Genuinely attractive: nothing to steal, nothing to reset. Ruled out as the
*primary* mechanism because account recovery on a lost device lands you right back at needing an
email channel, and the cross-device story on an installed Android PWA is still fiddly enough to be
a support burden for one person. Worth adding later as a second factor or a faster re-auth on a
trusted device, once `user_identities` exists to hang it off.

**Email + password with hashed credentials.** Ruled out. It requires the reset pipeline that was
explicitly unwanted, it makes you the custodian of credentials, and on Workers you are limited to
PBKDF2 via WebCrypto (Argon2 and scrypt need WASM), which is the weakest of the acceptable choices.
All that, to reimplement what Google gives for free.

## 2 · Schema migration

### The naming trap, first

`sessions` already means *a training session*. The auth table must not be called `sessions`. It is
`auth_sessions` throughout. Getting this wrong once, in one query, is a silent catastrophe.

### Migration 0008 — identity tables

Nothing reads these yet. This migration changes no behaviour.

```sql
-- Migration number: 0008

CREATE TABLE users (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	email TEXT NOT NULL UNIQUE,
	display_name TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per (provider, account). A user can later link GitHub to the same
-- `users` row without a schema change, which is the whole reason this is a
-- separate table rather than two columns on `users`.
CREATE TABLE user_identities (
	provider TEXT NOT NULL CHECK (provider IN ('google', 'github')),
	provider_user_id TEXT NOT NULL,
	user_id INTEGER NOT NULL REFERENCES users (id),
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	PRIMARY KEY (provider, provider_user_id)
);

CREATE INDEX idx_user_identities_user ON user_identities (user_id);

-- Opaque bearer tokens. Only the SHA-256 of the token is stored, so a dump of
-- this table cannot be replayed. NOT called `sessions` — that name is taken by
-- training sessions and always will be.
CREATE TABLE auth_sessions (
	token_hash TEXT PRIMARY KEY,
	user_id INTEGER NOT NULL REFERENCES users (id),
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	expires_at TEXT NOT NULL,
	user_agent TEXT
);

CREATE INDEX idx_auth_sessions_user ON auth_sessions (user_id);

-- The existing single user. Every row already in the database belongs to them,
-- and migration 0009 backfills to this id. The email is the owner's; it is what
-- the first Google sign-in will match on, so the existing account is adopted
-- rather than a second one created alongside it.
INSERT INTO users (id, email, display_name) VALUES (1, 'accounts@sjtate.co.uk', 'Stephen');
```

Seeding user 1 **in the migration, not in `seeds/`**, matters for testing: `test/apply-migrations.ts`
re-applies migrations before every test, so user 1 exists in all ~292 existing tests for free (§7).

### Migration 0009 — `user_id` everywhere

The design decision here is **denormalise `user_id` onto every data table, including the ones that
already hang off `sessions.id`** — rather than scoping children through a join. Three reasons, all
drawn from queries that actually exist:

1. `loadSessionDetail`'s "last week" CTE in `src/routes/sessions.ts` reads
   `FROM logged_sets WHERE exercise_id IN (...) AND session_id != ?` — **no session scope at all,
   by design**. There is no `sessions` row in that query to join through without restructuring it.
   A denormalised column turns the fix into `AND user_id = ?`.
2. The swap candidate lookup in `src/routes/swaps.ts` has the same shape:
   `SELECT DISTINCT exercise_id FROM logged_sets WHERE exercise_id IN (...)`.
3. The generator does five bulk `WHERE session_id IN (...)` reads across five tables. Adding a
   predicate to each is a reviewable one-line change; rewriting five bulk queries into joins is not.

The cost is a redundant column that the write path must populate. That is contained by a single
rule: **`user_id` on a write is always the value the middleware resolved, never anything from the
request body or the URL.**

```sql
-- Migration number: 0009

-- Every existing row belongs to user 1. The DEFAULT is 0 rather than 1 on
-- purpose: 0 is not a real user, so a future INSERT that forgets to set
-- user_id produces a row nobody can see, rather than one silently filed under
-- the owner's account. Invisible is recoverable; cross-attributed is not.
-- `SELECT COUNT(*) FROM logged_sets WHERE user_id = 0` is the canary.
--
-- No REFERENCES clause: SQLite forbids ADD COLUMN with a foreign key unless the
-- default is NULL, and NULL is incompatible with NOT NULL here. The constraint
-- is enforced in code and by the tests in §7.
ALTER TABLE sessions          ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE planned_sets      ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE logged_sets       ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE planned_runs      ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE logged_runs       ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE session_feedback  ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE exercise_swaps    ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE generated_plans   ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bodyweight        ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0;

-- The backfill. This is the whole data migration: every row in the database
-- today is the owner's.
UPDATE sessions         SET user_id = 1;
UPDATE planned_sets     SET user_id = 1;
UPDATE logged_sets      SET user_id = 1;
UPDATE planned_runs     SET user_id = 1;
UPDATE logged_runs      SET user_id = 1;
UPDATE session_feedback SET user_id = 1;
UPDATE exercise_swaps   SET user_id = 1;
UPDATE generated_plans  SET user_id = 1;
UPDATE bodyweight       SET user_id = 1;

-- Reads are overwhelmingly "this user, ordered by date" and "this user, this
-- week", so the existing single-column indexes are now the wrong shape.
CREATE INDEX idx_sessions_user_date ON sessions (user_id, date);
CREATE INDEX idx_sessions_user_week ON sessions (user_id, week_number);
DROP INDEX idx_sessions_date;
DROP INDEX idx_sessions_week;

-- The lastWeek CTE partitions by exercise across all of a user's history.
CREATE INDEX idx_logged_sets_user_exercise_performed ON logged_sets (user_id, exercise_id, performed_on);
DROP INDEX idx_logged_sets_exercise_performed;
```

`bodyweight` has no reader anywhere in `src/`; it is dead. It gets the column anyway because that is
cheaper than deciding, and dropping a table is a separate conversation.

### The unique indexes from 0002

`migrations/0002_logging_unique_constraints.sql` added:

```sql
CREATE UNIQUE INDEX idx_logged_sets_unique ON logged_sets (session_id, exercise_id, set_index);
CREATE UNIQUE INDEX idx_logged_runs_unique ON logged_runs (session_id);
```

**Leave both exactly as they are.** `sessions.id` stays a globally unique autoincrement, so a
session belongs to exactly one user and `(session_id, exercise_id, set_index)` is already unique
per user. Adding `user_id` to the front would *weaken* them: it would let the same physical set
exist twice under two different `user_id` values instead of conflicting.

The real hazard the composite index is reaching for is different, and needs a different fix. The
upsert in `POST /:id/sets` says `ON CONFLICT (session_id, exercise_id, set_index) DO UPDATE SET …`.
If a bug ever routes a write at the wrong session, that conflict *overwrites another user's set*
and leaves `user_id` pointing at the original owner. Guard the update instead of the index:

```sql
ON CONFLICT (session_id, exercise_id, set_index) DO UPDATE SET
  weight_kg = excluded.weight_kg,
  …
WHERE logged_sets.user_id = excluded.user_id
```

A cross-user conflict becomes a silent no-op rather than corruption. Same clause on the
`logged_runs` and `session_feedback` upserts.

### The one index that genuinely must become composite

```sql
CREATE UNIQUE INDEX idx_generated_plans_one_pending ON generated_plans (status) WHERE status = 'pending';
```

This is a **global** "only one pending plan may exist". Left alone, the first user to import a plan
blocks every other user in the system, and the second user's import surfaces a raw D1 constraint
violation as a 500. It is invisible until a second user exists — which is precisely when nobody is
testing for it.

```sql
DROP INDEX idx_generated_plans_one_pending;
CREATE UNIQUE INDEX idx_generated_plans_one_pending ON generated_plans (user_id) WHERE status = 'pending';

CREATE INDEX idx_generated_plans_user_status ON generated_plans (user_id, status);
DROP INDEX idx_generated_plans_status;
```

### Migration 0010 — rebuilding `settings`

`CHECK (id = 1)` cannot be dropped by `ALTER TABLE`; SQLite requires a table rebuild. Give it its
own migration file so that if it fails, the blast radius is one table.

```sql
-- Migration number: 0010

CREATE TABLE settings_new (
	user_id INTEGER PRIMARY KEY REFERENCES users (id),
	goals TEXT NOT NULL DEFAULT '',
	days_per_week INTEGER NOT NULL DEFAULT 5,
	goal_tags TEXT NOT NULL DEFAULT '[]'
);

-- The `id` column disappears entirely; user_id is the primary key. Every
-- `WHERE id = 1` becomes `WHERE user_id = ?`.
INSERT INTO settings_new (user_id, goals, days_per_week, goal_tags)
	SELECT 1, goals, days_per_week, goal_tags FROM settings;

DROP TABLE settings;
ALTER TABLE settings_new RENAME TO settings;
```

A new user has no `settings` row. `readRow` in `src/routes/settings.ts` already falls back to
`DEFAULTS` when the row is missing, so `GET /api/settings` works for a brand-new account with no
change — but `PATCH` runs `UPDATE settings SET … WHERE id = 1`, which for a new user updates zero
rows and **returns 200 as though it saved**. That is a latent bug today that multi-user makes real
on every signup. It must become an upsert:

```sql
INSERT INTO settings (user_id, goals, days_per_week, goal_tags) VALUES (?, ?, ?, ?)
ON CONFLICT (user_id) DO UPDATE SET
  goals = excluded.goals, days_per_week = excluded.days_per_week, goal_tags = excluded.goal_tags
```

### On removing `DEFAULT 0` later

SQLite cannot drop a column default without the twelve-step table rebuild. Doing that for nine
tables against a live D1 is more risk than the footgun it removes, and the authorisation tests in
§7 catch the bug it protects against directly. **Recommendation: keep `DEFAULT 0` and run the
canary query after the step-6 flip.** If you later want belt and braces, rebuild only `sessions`
and `logged_sets` — the two tables where an orphan actually costs someone a workout.

## 3 · Query changes

### The pattern

One middleware resolves the user once per request. Nothing downstream ever touches a cookie again.

```ts
// src/auth/session.ts
export async function hashToken(token: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
```

```ts
// src/auth/middleware.ts
import { getCookie, deleteCookie } from 'hono/cookie';
import type { MiddlewareHandler } from 'hono';
import { hashToken } from './session';

declare module 'hono' {
	interface ContextVariableMap {
		userId: number;
	}
}

export const requireUser: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
	const token = getCookie(c, 'ta_session');
	if (!token) return c.json({ error: 'unauthenticated' }, 401);

	const row = await c.env.DB.prepare(
		`SELECT user_id FROM auth_sessions WHERE token_hash = ? AND expires_at > datetime('now')`,
	)
		.bind(await hashToken(token))
		.first<{ user_id: number }>();

	if (!row) {
		deleteCookie(c, 'ta_session', { path: '/' });
		return c.json({ error: 'unauthenticated' }, 401);
	}

	c.set('userId', row.user_id);
	await next();
};
```

Mounted in `src/api.ts`, with the two deliberate exemptions listed explicitly rather than by
ordering accident:

```ts
const OPEN_PATHS = ['/health', '/auth'];

api.use('*', async (c, next) => {
	if (OPEN_PATHS.some((p) => c.req.path.startsWith(`/api${p}`))) return next();
	return requireUser(c, next);
});
```

Then in every handler: `const userId = c.get('userId');`.

### Thread it as a required parameter, not a context object

The single highest-leverage decision in this whole document. Every helper that takes a `D1Database`
gains a **required positional `userId`**:

```ts
loadSessionDetail(db, session, userId)
buildExportContext(db, weekCount, userId)
generateNextWeeks(db, weekCount, userId)
importProposal(db, input, replace, userId)
insertWeeksFromProposal(db, plan, userId)
```

Not optional, not defaulted, not bundled into an options bag. `tsc --noEmit` then enumerates every
call site that has not been updated, which converts "did I remember to scope this?" from a review
question into a compiler error. It also makes the diff in step 3 of §8 mechanically checkable.

### Queries that are easy to miss

Everything below is currently correct *because there is only one user*, and would still look
correct in code review afterwards.

**`src/routes/sessions.ts` — the "last week" DENSE_RANK CTE.** The highest-severity leak in the
codebase.

```sql
WHERE exercise_id IN (…) AND session_id != ?
```

No user scope, and none available without the denormalised column. It feeds `PlannedSetDetail.
lastWeek`, and `resolveSetDefaults` in `src/setDefaults.ts` prefills **both weight and reps** from
it (precedence rule 3). So this is not merely a read leak: user B's set inputs would come
pre-populated with user A's numbers, and confirming a set writes them into B's log as B's own data.
The leak becomes B's history, then feeds B's progression, then feeds B's generated plan. Add
`AND user_id = ?`.

**`src/routes/sessions.ts` — the list aggregate.** The outer `WHERE s.date >= ? AND s.date <= ?`
needs `AND s.user_id = ?`. The three `LEFT JOIN`s are on `session_id` so they follow, but the
correlated `logged_set_count` subquery (`FROM logged_sets ls WHERE ls.session_id = s.id`) should
carry `AND ls.user_id = ?` too, for the same defence-in-depth reason as the upsert guard.

**`src/routes/swaps.ts` — the candidate history lookup.**

```sql
SELECT DISTINCT exercise_id FROM logged_sets WHERE exercise_id IN (…)
```

Entirely unscoped. It builds the `history` set that `rankSwapCandidates` uses to promote exercises
"you have done before", so another user's history silently reorders your swap sheet.

**`src/routes/swaps.ts` — the `scope: 'permanent'` bulk update.** The worst *write* in the app:

```sql
UPDATE planned_sets SET exercise_id = ?, target_weight_kg = NULL
WHERE exercise_id = ?
  AND session_id IN (
    SELECT s.id FROM sessions s WHERE s.status = 'planned' AND s.date > (SELECT date FROM sessions WHERE id = ?) …
  )
```

The subselect has no user filter. One person choosing "from now on" would repoint **every other
user's future planned sets** to their substitute, and nulls their target weights on the way past.
Scope both the outer `UPDATE` and the inner `SELECT`. The clash check above it and the
`SELECT date FROM sessions WHERE id = ?` anchor both need it too.

**`src/generator.ts` — `buildExportContext`.** Six unscoped reads plus two scalars:

- `SELECT * FROM settings WHERE id = 1` → `WHERE user_id = ?`
- `SELECT MAX(week_number) FROM sessions` → unscoped, so the week number comes from whichever user
  is furthest along. Every generated plan lands on the wrong week number.
- `SELECT * FROM exercises` → scope per §4.
- `SELECT * FROM sessions WHERE week_number IN (?, ?)`, and the five bulk
  `WHERE session_id IN (…)` reads over `planned_sets`, `logged_sets`, `planned_runs`, `logged_runs`,
  `session_feedback` — each gains `AND user_id = ?`. The `session_feedback` one is the one that
  computes `painFlags`, so leaving it unscoped means another user's shoulder pain bans exercises
  from your plan.

**`src/generator.ts` — `importProposal`.** Two availability bugs rather than leaks, and both are
invisible with one user:

- `SELECT id FROM generated_plans WHERE status = 'pending' LIMIT 1` — user B's pending plan makes
  user A's import 422 with "already pending", and the Replace button then rejects B's plan.
- `SELECT DISTINCT date FROM sessions WHERE date IN (…)` — the collision check. Another user having
  trained on a Tuesday makes your plan fail validation for that Tuesday.

**`src/routes/generator.ts` — `/pending`, `/:id/accept`, `/:id/reject`.** All three look up by id:
`WHERE id = ? AND status = 'pending'`. Without `AND user_id = ?`, any signed-in user can accept or
reject any other user's plan by guessing a small integer — and accepting runs
`insertWeeksFromProposal`, which writes twelve weeks of sessions.

**`src/api.ts` — `/health`.** `SELECT COUNT(*) AS n FROM exercises`. **Leave it unauthenticated and
user-agnostic.** It is a liveness probe, it must answer without a cookie, and counting the global
catalogue leaks nothing. Do not overload it with identity — add a separate `GET /api/me` behind
`requireUser` returning `{ user: { id, email, display_name } }`, which is what the client boot
sequence in §5 needs anyway.

## 4 · The exercise catalogue

**Decision: global, plus per-user additions.** One nullable owner column:

```sql
-- Migration 0009 (same file)
ALTER TABLE exercises ADD COLUMN owner_user_id INTEGER;  -- NULL = global/seeded
CREATE INDEX idx_exercises_owner ON exercises (owner_user_id);
```

Visibility predicate, used on **every** read of the table:

```sql
AND (e.owner_user_id IS NULL OR e.owner_user_id = ?)
```

### Why not the alternatives

**Not purely global.** `POST /api/exercises` is new (roadmap stage 11) and is the first write path
to this table. Purely global, every user's additions land in everyone's swap sheet — one person's
"Steve's weird cable thing" is now an option offered to strangers, and there is no delete endpoint
to undo it.

**Not per-user copies of the whole catalogue.** The 33 seeded rows describe shared physical facts;
a neutral-grip DB press is the same movement for everyone. Copying them per user multiplies rows
for no benefit and, worse, makes `exercise_id` user-specific — which matters because
`planned_sets.exercise_id` and `logged_sets.exercise_id` are the join keys for the entire
progression and swap system. Global ids are worth keeping.

### The interactions with `POST /api/exercises`

Three of them, all in `src/routes/exercises.ts` and all easy to get wrong:

1. **The duplicate-name check** — `WHERE lower(name) = lower(?)` — must be scoped to what the
   caller can see. Unscoped, user B is told "Push-ups is already in the catalogue" for a row they
   cannot see and cannot use, which is unexplainable from the UI.
2. **The pattern check** — `SELECT id FROM exercises WHERE pattern = ? LIMIT 1` — should be scoped
   the same way for consistency, though the risk is nil: patterns are a closed vocabulary and the
   route refuses novel ones precisely so a new exercise cannot be orphaned from swaps.
3. **The insert** sets `owner_user_id = <caller>`, and `is_default = 0` as it already does.
   `is_default` only ever means anything on globals — it is a swap-ranking tiebreak in
   `src/swaps.ts` and a user-owned row should never win it.

`GET /api/exercises/patterns` gets the predicate too. And `buildExportContext`'s
`SELECT * FROM exercises` gets it, which closes the loop for free: `validateProposal` checks every
proposed `exercise_id` against `context.exerciseCatalogue`, so a scoped catalogue automatically
means an imported plan cannot reference another user's private exercise.

There is no delete endpoint, so there is no dangling-reference problem to solve.

## 5 · The client

This is where the data-loss bugs live. The server side is careful SQL; this side is the part that
can write one person's sets into another person's log.

### Boot, and the offline trap

```ts
// src/client/auth.ts
export interface CurrentUser { id: number; email: string; display_name: string | null }

const USER_KEY = 'ta:user';

export function readCachedUser(): CurrentUser | null { /* JSON.parse localStorage */ }

export type AuthState = { status: 'loading' } | { status: 'anonymous' } | { status: 'signedIn'; user: CurrentUser };
```

`App` gains an `AuthState`, seeded **optimistically** from `readCachedUser()`, then confirmed:

```ts
fetchMe()
	.then((user) => { writeCachedUser(user); setAuth({ status: 'signedIn', user }); })
	.catch((err) => {
		// A 401 is an answer: the session is gone, clear everything and show login.
		if (err.status === 401) { clearCachedUser(); setAuth({ status: 'anonymous' }); return; }
		// A network failure is NOT an answer. Keep the cached user and carry on —
		// this is the basement gym, and it is the whole point of the PWA.
		if (cached) setAuth({ status: 'signedIn', user: cached });
		else setAuth({ status: 'anonymous' });
	});
```

**Only an explicit 401 signs someone out.** Getting this backwards — treating any failed `/api/me`
as "logged out" — turns every dead-signal gym visit into a login wall in front of an app that is
otherwise fully functional offline. It is the easiest thing in this whole plan to get wrong and the
most annoying in practice.

### Login and route guard

- `src/client/screens/Login.tsx` — one screen, one button. It must be a plain
  `<a href="/api/auth/google/start">`, a real top-level navigation, **not** a `fetch`. OAuth needs
  a document-level redirect; a `fetch` gets a CORS failure at Google.
- The guard sits above the hash router in `app.tsx`: `status === 'anonymous'` renders `<Login/>`
  whatever the hash says. Stash `location.hash` before redirecting and restore it after callback,
  so a deep link to `#/lift/42` survives sign-in.
- `status === 'loading'` renders nothing for a frame rather than flashing the login screen.
- Logout lives in `Shell` — the app has no settings screen, and the tab bar is the only persistent
  chrome.

### Namespaced storage — the fix that makes user switching safe by construction

Both `localStorage` consumers are global today:

- `src/client/sync.ts`: `const QUEUE_KEY = 'ta:queue'`
- `src/client/sessionCache.ts`: `` `ta:session:${sessionId}` ``

Both become user-scoped:

```ts
// src/client/sync.ts
let currentUserId: number | null = null;
export function setSyncUser(id: number | null): void { currentUserId = id; }

function queueKey(): string | null {
	return currentUserId === null ? null : `ta:queue:${currentUserId}`;
}
```

`enqueue` throws if there is no current user — a write with no owner is a bug, not something to
paper over. `flush()` returns immediately when there is no current user. `readQueue`/`writeQueue`
only ever touch the current user's key, so `drain()` **cannot** see another user's items. Session
cache keys become `ta:session:<userId>:<sessionId>`.

`setSyncUser` must be called before the first render that can enqueue, from the same place the
auth state is set. `useSession`'s `pendingCount(`/api/sessions/${sessionId}/`)` call keeps working
unchanged, because it reads through the same namespaced key.

### The 401 bug that would silently delete workouts

`src/client/sync.ts`, in `drain()`:

```ts
if (res.status >= 400 && res.status < 500) {
	console.error(`sync: dropping request that the server rejected (${res.status}): …`);
}
// falls through to: writeQueue(readQueue().filter((item) => item.id !== next.id));
```

Today that branch is correct — a 4xx means a permanently malformed body, and retrying it forever
would block every later write behind it. The routes are carefully written to return 400 rather than
let a D1 CHECK constraint 500, precisely so this branch fires.

**The moment auth exists, 401 and 403 join that range.** A background flush fired by the `focus`
listener after a session expires — or after logout — gets a 401, and this code **permanently
deletes the user's unsynced sets**, leaving a `console.error` nobody will ever see on a phone. This
is the single most likely real data-loss bug in the project.

```ts
if (res.status === 401 || res.status === 403) {
	// Not a bad request — an unauthenticated one. The body is fine and will be
	// accepted as soon as there is a session again. Stop draining, keep the item.
	onAuthRequired?.();
	return;
}
if (res.status >= 400 && res.status < 500) { /* existing drop */ }
```

Alongside it: surface `pendingCount()` in `Shell` as a small "N not synced" indicator. It already
exists as a function and is already called by `useSession`; nothing about queued writes is visible
to the user today, which is exactly why a silent drop would go unnoticed.

### Logout, in order

1. `setSyncUser(null)` — stop accepting new writes immediately.
2. `await flush()` with a short timeout, using the still-valid cookie.
3. If `pendingCount() > 0`, **do not proceed silently**. Tell them: "3 sets haven't synced yet.
   Stay online for a moment, or sign out anyway — they'll sync next time you sign in on this
   device."
4. `POST /api/auth/logout` — revoke the row server-side, not just locally. A client-only logout
   leaves a 90-day credential live.
5. Delete `ta:user` and every `ta:session:<userId>:*` key. **Keep `ta:queue:<userId>` if it is
   non-empty.**

Step 5 is a deliberate trade. Keeping an unsynced queue at rest leaves one person's set numbers in
`localStorage` on a possibly-shared device; deleting it throws away a workout they just did. For a
training log, losing the workout is the worse failure. In the normal case step 2 empties the queue
and everything is deleted anyway. If you disagree, the alternative is to block logout until the
queue drains — never to delete it.

### User switch

Namespaced keys make this safe by construction: sign-in as user B sets `currentUserId = 2`, and
every subsequent read and write goes to `ta:queue:2`. B's `drain()` loop physically cannot reach
A's items. Two loose ends:

- Reset the module-level `flushing` promise on user change, so a switch does not join an in-flight
  drain belonging to the previous user.
- Reset every screen's state. Simplest and most reliable: `location.reload()` after the callback
  redirect, which the OAuth flow gives you free since it is a full navigation anyway.

### The service worker needs no change

`public/sw.js` already refuses to cache anything under `/api/`, with a comment explaining why. That
decision — made for staleness reasons — happens to also mean there is no cross-user API response
cache to poison. The shell (`/`, `/index.html`, `/app.js`, `/styles.css`) is identical for everyone.
Leave it alone; bump `CACHE_VERSION` as usual when the bundle changes.

One thing to actually test rather than assume: the OAuth redirect chain inside an **installed**
standalone PWA. On iOS the installed app has a separate cookie jar from Safari, and an OAuth bounce
can land the session cookie in the wrong one. Test the flow from the home-screen icon, not just a
browser tab.

## 6 · Phase 2 — the live generation call

This is the payoff. [generator-design.md](generator-design.md) is explicit that the manual
export/import round trip exists **because** there is no auth in front of a paid API key: "a public
endpoint spending a paid key would be a cost-drain risk." Authentication is the only thing standing
between the app as it is and a single Generate button.

The design doc also says the seam is already built, and it is:

- `generated_plans.source` is `'external-import'` today and exists solely to become `'live-api'`.
- `validateProposal`, `hydrateProposal`, `importProposal` and accept/reject are all source-agnostic.
- The prompt is already a pure function in `src/client/prompt.ts`.
- The Generate screen already polls `GET /api/generator/pending`.

### What lands

1. `wrangler secret put AI_API_KEY`. A secret, never `wrangler.jsonc`, never a var.
2. Move `src/client/prompt.ts` to `src/prompt.ts` so server and client share one string. The client
   still needs it for the copy-the-prompt fallback, and two copies would drift on the first edit.
3. `POST /api/generator/generate?weeks=N`, behind `requireUser`:

```ts
generator.post('/generate', async (c) => {
	const userId = c.get('userId');
	const weeks = clampWeeks(c.req.query('weeks'));

	if (await weeklyLiveCallCount(c.env.DB, userId) >= LIVE_CALLS_PER_WEEK) {
		return c.json({ error: 'weekly generation limit reached' }, 429);
	}

	const context = await generateNextWeeks(c.env.DB, weeks, userId);

	// A 12-week review is one model call that can run well past a comfortable
	// request timeout. Return immediately and let it finish in the background —
	// the Generate screen already polls /pending, so the existing UI picks the
	// proposal up with no new plumbing.
	c.executionCtx.waitUntil(
		runLiveGeneration(c.env, context, userId).catch((err) => console.error('live generation failed', err)),
	);

	return c.json({ started: true }, 202);
});
```

`runLiveGeneration` calls the model, then feeds the reply through **the same**
`parseProposal` → `validateProposal` → `hydrateProposal` → `importProposal` path the pasted answer
takes today, with `source = 'live-api'`. A bad model response produces the same 422-shaped
validation errors on the pending row that a bad paste produces now.

4. **Keep the manual path.** It is the fallback when the API is down or the key is exhausted, it is
   the only path that works with no connection, and it stays tool-agnostic. Two buttons on the
   Generate screen, not one.

### Cost control, which auth is what makes possible

With a `user_id` on every row, spend is attributable, which is the actual unlock — not just that
the endpoint is closed. The cheapest limiter that works needs no new table:

```sql
SELECT COUNT(*) FROM generated_plans
WHERE user_id = ? AND source = 'live-api' AND created_at > datetime('now', '-7 days')
```

Cap it at something like ten a week. Plan review is a weekly action by design, so ten is generous
and a runaway loop is bounded at ten calls rather than a bill.

Keep the design doc's principle intact: **the model is for judgement, not calculation.** The
deterministic pass still runs first, still produces week 1, and is still what the proposal is
validated against. Nothing about `speculativeFromWeek` or the 12-week cap changes.

## 7 · Testing

There are ~292 `it()` blocks across the two vitest projects. The goal is that **none of them need
editing except mechanically**, and that a new unscoped route cannot ship green.

### `test/fixtures.ts` and `test/apply-migrations.ts`

`test/apply-migrations.ts` resets and re-applies every migration before each test, so seeding user 1
in migration 0008 means user 1 exists in every test with no fixture change. Extend that hook to seed
a second user and both auth sessions — one place, zero per-call cost, deterministic tokens:

```ts
// test/apply-migrations.ts
export const OWNER = 1;
export const OTHER = 2;

beforeEach(async () => {
	await reset();
	await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
	await env.DB.batch([
		env.DB.prepare(`INSERT INTO users (id, email) VALUES (2, 'other@example.test')`),
		env.DB.prepare(`INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, 1, '9999-12-31')`)
			.bind(await hashToken('test-token-1')),
		env.DB.prepare(`INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, 2, '9999-12-31')`)
			.bind(await hashToken('test-token-2')),
	]);
});
```

Every `insertX` in `test/fixtures.ts` gains an optional `userId` defaulting to `OWNER`:

```ts
export async function insertSession(
	overrides: Partial<{ date: string; kind: SessionKind; …; user_id: number }> = {},
): Promise<number> {
	const s = { date: '2026-08-03', …, user_id: OWNER, ...overrides };
	// INSERT INTO sessions (user_id, date, kind, label, status, week_number) …
}
```

Because the default is `OWNER`, **every existing fixture call keeps working unchanged**. That is the
whole reason for defaulting rather than requiring it here — the opposite of the rule for production
code in §3, and deliberately so: in tests the compiler enumerating 400 call sites is churn, not
safety, and the authorisation suite below is what actually provides the safety.

### Making the ~292 existing route tests pass

Every route test calls `SELF.fetch('https://training-app.test/api/…')`. With `requireUser` mounted,
all of them 401. Add one helper and do a single mechanical find-and-replace:

```ts
// test/fixtures.ts
export function apiFetch(url: string, init: RequestInit = {}, userId: number = OWNER): Promise<Response> {
	return SELF.fetch(url, { ...init, headers: { ...init.headers, cookie: `ta_session=test-token-${userId}` } });
}
```

`SELF.fetch(` → `apiFetch(` across `test/*.test.ts`, plus the import line. Mechanical, reviewable,
and it leaves the third argument available for the authorisation tests.

Keep a handful of deliberate `SELF.fetch` calls: `/api/health` with no cookie must still be 200,
and one representative route with no cookie must be 401.

### Testing authorisation itself

A dedicated `test/authorization.test.ts`. The important assertion is always the same shape: **seed
data as user 1, act as user 2, assert user 2 gets nothing.**

Two properties matter more than the individual cases:

**Table-driven, over an enumerated route list.** Hono exposes `app.routes`. A test that walks the
registered routes and fails when one is absent from the coverage table turns "forgot to scope the
new endpoint" into a red build rather than a discovery in production:

```ts
const COVERED = new Set(['GET /api/sessions', 'GET /api/sessions/:id', …]);

it('every API route has an authorisation case', () => {
	const uncovered = app.routes
		.map((r) => `${r.method} ${r.path}`)
		.filter((k) => !COVERED.has(k) && !k.includes('/api/health') && !k.includes('/api/auth'));
	expect(uncovered).toEqual([]);
});
```

**404, not 403, for another user's object.** A 403 confirms the row exists. Both are safe here, but
404 is the habit worth forming, and it is what `GET /api/sessions/:id` already returns for a
missing id — so scoping it is a one-predicate change with no new branch.

The cases that must exist, because each corresponds to a specific query from §3:

| What | Why it is on the list |
| --- | --- |
| B cannot `GET` A's session detail | the basic case |
| B cannot `POST` a set into A's session | the basic write case |
| **B's own session detail shows no `lastWeek` from A** — same `exercise_id`, both users have logged it | the DENSE_RANK CTE; needs both users to share an exercise or it passes vacuously |
| A's logged history does not appear in B's swap candidate ranking | the `SELECT DISTINCT exercise_id` scan |
| A's `scope: 'permanent'` swap leaves B's future `planned_sets` untouched | the bulk `UPDATE` |
| B cannot accept or reject A's pending plan | `/:id/accept`, `/:id/reject` |
| **A and B can each hold a pending plan at the same time** | the partial unique index; fails loudly if it was not made composite |
| A and B have independent settings; B `PATCH`ing does not change A's | the `settings` rebuild and the upsert |
| B's export carries B's `MAX(week_number)`, not A's | the unscoped scalar |
| A's private exercise is invisible in B's `/patterns`, swap candidates, and export catalogue | §4 |
| A having trained on a date does not block B's plan import for that date | the collision check |
| B's `painFlags` do not reflect A's `session_feedback` | the sixth bulk query |

### Client tests

`test/client/sync.test.ts` already covers the queue's hard-won behaviour (the re-read-per-iteration
fix). Add:

- a 401 response leaves the item queued and stops the drain — the §5 bug, asserted directly;
- a 400 still drops it, so the existing protection is not lost;
- writes enqueued as user 1 are invisible to `pendingCount()` after `setSyncUser(2)`;
- `flush()` as user 2 sends none of user 1's items.

A new `test/client/auth.test.ts` for the boot logic: a 401 from `/api/me` clears the cached user; a
**network error does not**. That second assertion is the offline guarantee, and it is worth a test
because it is the kind of thing a later refactor "simplifies" away.

### Migration verification

`applyD1Migrations` applies all migrations at once, so there is no clean in-suite way to assert
"0009 backfilled 0007-era data". Do this as a pre-flight against a real copy instead, before the
remote apply:

```sh
wrangler d1 export sjt-training-db --remote --output backup.sql
# restore into a scratch local DB, apply 0008-0010, then:
wrangler d1 execute scratch --local --command "SELECT COUNT(*) FROM logged_sets WHERE user_id != 1"
```

Zero, or stop.

## 8 · Staging

Ordered, each independently shippable, each leaving the app working.

### Step 0 — turn on Cloudflare Access. Today. Regardless of everything below.

**Do this now.** It takes about ten minutes in the Zero Trust dashboard, the instructions are
already written up in `README.md`, and it closes a hole that is open right now. Everything in steps
1–6 is weeks of work during which the app is otherwise public, including every write endpoint and
the generator's accept/reject.

Two settings worth getting right while you are in there:

- Set the Access **session duration to the maximum (1 month)**. The default 24 hours puts a login
  wall in front of the PWA roughly every other gym visit.
- Leave the application path blank so `/api/*` is covered too. A policy on the SPA routes alone
  protects nothing.

Verify with the `curl` in the README: 302 means protected. Then update the warning comment in
`wrangler.jsonc` and the README section, as they both ask.

Accept that Access and the sync queue interact badly at expiry (§1). With a one-month session it is
rare, and the §5 401 fix — which you should land early — covers it.

### Step 1 — identity tables

Migration 0008 only. No code reads them. Apply local, apply remote, deploy. Nothing changes.

### Step 2 — `user_id` columns, indexes, `settings` rebuild

Migrations 0009 and 0010. Still no code reads them. Apply local, apply remote, deploy. Nothing
changes.

Steps 1 and 2 are deliberately pure-migration commits with no code change, because the README
records a production outage from code shipping ahead of the remote schema. Separating them means
there is no version of the deploy where code needs a column that is not there.

### Step 3 — scope every query, against a hard-coded user

The big diff, and the one that de-risks everything. `requireUser` exists but is stubbed:

```ts
// Step 3 only. Replaced wholesale in step 4.
export const requireUser: MiddlewareHandler = async (c, next) => { c.set('userId', 1); await next(); };
```

Every query from §3 gets its predicate, every helper gets its required `userId` parameter, every
upsert gets its guard clause, the catalogue gets `owner_user_id` handling, and the whole
authorisation test suite from §7 gets written — running two users against a stub that always
returns 1 will not pass, so for this step the stub reads a test-only header, or the suite lands with
step 4. Prefer the former: **all the query rewriting happens with no auth in play, so a mistake is a
red test, not a lockout.**

Observable behaviour: none. Ship it.

### Step 4 — real auth, permissive

OAuth start/callback routes, `auth_sessions` writes, `GET /api/me`, `POST /api/auth/logout`, and
`requireUser` reading the cookie for real — but falling back to user 1 with a `console.warn` when
there is no cookie. Deploy behind Access, sign in yourself, confirm the whole handshake including
the installed-PWA cookie jar.

### Step 5 — the client

Login screen, route guard, `/api/me` boot with the offline rule, namespaced storage keys,
`setSyncUser`, the **401-does-not-drop fix**, the logout sequence, and the pending-writes indicator
in `Shell`. Still permissive server-side, so a bug here cannot lock you out.

### Step 6 — flip to strict, and remove Access

`requireUser` returns 401 with no cookie. **This is the step that first makes the app genuinely
multi-user** — and it is also the step where Cloudflare Access comes off, because Access is an
allowlist and would block every user but you from ever signing up.

Off in that order, in one sitting: flip strict, deploy, verify sign-in works, then remove the
Access application. Never remove Access before the flip.

Run the canary afterwards: `SELECT COUNT(*) FROM logged_sets WHERE user_id = 0`, and the same over
`sessions`.

### Step 7 — polish

Second provider if wanted, account deletion, "sign out everywhere" (delete all `auth_sessions` rows
for a user — trivial now that they are in D1).

### Step 8 — Phase 2

The live generation call, per §6. The reason for all of the above.

## 9 · What could go wrong

### A half-migrated database

The README already records one outage from exactly this: code shipped ahead of
`db:migrate:remote`, and every affected request 500'd. This work multiplies the opportunity by
three migrations.

Here the failure mode is worse in one way and better in another. Worse: step 3's code queries
`WHERE user_id = ?` against a table without the column, so **every** request 500s and the app is
dead, not degraded. Better: the sync queue retries 5xx forever, so queued writes survive the outage
rather than being lost — the one place the existing design saves you.

Mitigations, in order of value:

- Steps 1 and 2 are pure-migration commits with no code change. There is no deploy in which code
  needs a column that is not there.
- Verify before merging step 3:
  `wrangler d1 execute sjt-training-db --remote --command "PRAGMA table_info(logged_sets)"`.
- `wrangler d1 export sjt-training-db --remote --output backup.sql` before 0009 and 0010. This is
  the first migration in the project's history that rewrites existing rows.
- **CI does not gate the deploy** — the README says so explicitly, and a red build still ships.
  For a change of this shape that is worth fixing first; a failing authorisation test that deploys
  anyway is the whole risk in one sentence.

A second flavour: partial application *within* a file. If migration 0010 fails between
`DROP TABLE settings` and the `RENAME`, the settings table is gone. That is why the rebuild is its
own file with nothing else in it, and why the backup is not optional.

### A sync queue flushing after logout

The concrete mechanism, spelled out because it is not hypothetical. `sync.ts` registers
`window.addEventListener('focus', () => void flush())`. Someone logs out, the tab regains focus,
`drain()` sends a queued set, gets a 401, and — because the current code treats every 4xx as
permanently invalid — **deletes it**. The only trace is a `console.error` on a phone.

Three independent defences, all in §5, and all worth having:

1. 401/403 branch to "stop and retry later", not "drop". This is the actual fix.
2. Namespaced queue keys, so a drain can only ever see the current user's items. This makes
   cross-user contamination structurally impossible rather than merely unlikely.
3. Logout flushes first and warns if it cannot drain, and never deletes a non-empty queue.

Plus the visible pending-writes count, so that if all three fail, someone notices.

The related failure is the one Cloudflare Access introduces at step 0: when the Access JWT expires,
a background `fetch` to `/api/…` gets a 302 to a cross-origin login page. Depending on the browser
it either throws (treated as offline — safe) or resolves `ok` with an HTML body (treated as success
— the write is deleted having never been saved). Landing defence 1 early covers the first case;
the one-month Access session makes the second rare. It is a good reason not to leave Access in
place any longer than step 6.

### Getting authorisation wrong, in an app that currently trusts everything

This is the one that deserves the most respect, because there is no existing scoped query to copy
and nothing that fails loudly when you miss one.

Every one of roughly thirty queries is written on the assumption that all rows are yours. A missing
`AND user_id = ?` does not throw, does not log, and does not look wrong in review — the query still
reads exactly like what the app is supposed to do. Worse, the symptom is invisible with one user
and invisible again with two users who never happen to share an `exercise_id` or a date.

And in this app a read leak does not stay a read leak. `resolveSetDefaults` prefills weight and reps
from `lastWeek`; `lastWeek` comes from the unscoped DENSE_RANK CTE. So user B opens a session, sees
user A's numbers pre-filled, taps confirm — and A's numbers are now **B's logged data**, feeding B's
progression, feeding B's next generated plan. The leak launders itself into the other user's
history within one session, and there is no way to tell afterwards which numbers were real.

What actually reduces the risk, in order:

- The **required positional `userId`** on every db helper (§3). The compiler enumerates the call
  sites; you do not have to remember to.
- The **route-enumerating authorisation test** (§7). A new endpoint without a scoping case is a red
  build.
- Hand-reviewing the three queries that have no natural join to `sessions`: the lastWeek CTE, the
  swap history scan, and the permanent-swap bulk update. These are the ones a mechanical pass over
  "add the predicate to every `WHERE session_id`" will not catch, because they do not mention
  `session_id` at all.
- Doing all of it in step 3, **before** auth is real, so mistakes surface as test failures rather
  than as data.

### Smaller ones, worth writing down

- **Orphaned rows at `user_id = 0`.** An INSERT that forgets `user_id` produces a row nobody can
  see. That is the deliberate trade over `DEFAULT 1` (invisible beats cross-attributed), but it
  needs the canary query run after step 6, not just intended.
- **The `generated_plans` partial index.** Forget it and the second user's first import throws a
  raw constraint violation as a 500, while the first user's pending plan blocks everyone. Silent
  until the exact moment you stop testing alone.
- **Double login walls.** Leaving Access on past step 6 means new users hit an allowlist they are
  not on, and the failure looks like the app being broken rather than like access being denied.
- **The installed-PWA cookie jar.** Test the OAuth round trip from the home-screen icon. A flow that
  works perfectly in a browser tab can drop the session cookie in the wrong jar on iOS.
- **Ninety-day sessions versus revocation.** "Sign out everywhere" cannot reach a phone that is
  offline; that device keeps working until it next talks to the server. For a training log this is
  the right trade, but it is a trade, not an oversight.
- **`exercise_id` portability.** If per-user catalogues are ever revisited, every
  `planned_sets.exercise_id` and `logged_sets.exercise_id` becomes user-specific. Global-plus-
  additions (§4) closes that door on purpose; keep it closed.
