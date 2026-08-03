import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
	const migrationsPath = path.join(import.meta.dirname, 'migrations');
	const migrations = await readD1Migrations(migrationsPath);

	return {
		test: {
			setupFiles: ['./test/apply-migrations.ts'],
		},
		plugins: [
			cloudflareTest({
				wrangler: { configPath: './wrangler.jsonc' },
				miniflare: {
					bindings: { TEST_MIGRATIONS: migrations },
				},
			}),
		],
	};
});
