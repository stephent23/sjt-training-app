import { applyD1Migrations, env, reset } from 'cloudflare:test';
import { beforeEach } from 'vitest';

// This pool shares D1 storage across every `it()` in a file rather than
// resetting per test, so each test must explicitly start from a clean,
// migrated schema — otherwise rows (and autoincrement ids) leak across tests.
beforeEach(async () => {
	await reset();
	await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
