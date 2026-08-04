import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Two projects, because the two halves of this app genuinely need different
// runtimes:
//
//  - "worker" runs the Hono routes and the pure server modules inside real
//    workerd via vitest-pool-workers, against a real migrated D1. That's the
//    only way route tests can be trusted — D1 CHECK constraints, batch()
//    transactions and window functions all behave like production.
//  - "client" runs the Preact/browser-side modules in jsdom. sync.ts and
//    sessionCache.ts need localStorage; Stepper needs a DOM to render into.
//    None of that exists in workerd, which is why these were previously
//    untested despite being the most correctness-critical client code here.
export default defineConfig(async () => {
	const migrationsPath = path.join(import.meta.dirname, 'migrations');
	const migrations = await readD1Migrations(migrationsPath);

	return {
		test: {
			projects: [
				{
					plugins: [
						cloudflareTest({
							wrangler: { configPath: './wrangler.jsonc' },
							miniflare: {
								bindings: { TEST_MIGRATIONS: migrations },
							},
						}),
					],
					test: {
						name: 'worker',
						include: ['test/**/*.test.ts'],
						exclude: ['test/client/**'],
						setupFiles: ['./test/apply-migrations.ts'],
					},
				},
				{
					// Vitest 4 transforms with oxc, which ignores `esbuild.jsx*`
					// options and emits imports of `react/jsx-(dev-)runtime` from
					// the automatic JSX runtime. Aliasing those onto Preact's
					// single jsx-runtime is what makes .tsx component tests work —
					// the same job `--jsx-import-source=preact` does for the real
					// client bundle in package.json's build:client.
					resolve: {
						alias: {
							'react/jsx-dev-runtime': 'preact/jsx-runtime',
							'react/jsx-runtime': 'preact/jsx-runtime',
						},
					},
					test: {
						name: 'client',
						include: ['test/client/**/*.test.{ts,tsx}'],
						environment: 'jsdom',
					},
				},
			],
		},
	};
});
