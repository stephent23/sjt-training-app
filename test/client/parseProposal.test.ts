import { describe, expect, it } from 'vitest';
import { extractProposal } from '../../src/client/parseProposal';

const plan = { weeks: [{ week_number: 2, sessions: [{ date: '2026-08-10', kind: 'lift', label: 'Lift A', plannedSets: [], plannedRun: null }] }] };
const planJson = JSON.stringify(plan);

function expectPlan(result: ReturnType<typeof extractProposal>) {
	if (!result.ok) throw new Error(`expected a plan, got: ${result.error}`);
	expect(result.value.weeks[0].sessions[0].date).toBe('2026-08-10');
}

describe('extractProposal', () => {
	it('takes a bare JSON paste', () => {
		expectPlan(extractProposal(planJson));
	});

	it('tolerates surrounding whitespace and a byte-order mark', () => {
		expectPlan(extractProposal(`﻿\n  ${planJson}  \n`));
	});

	// The prompt asks for an explanation followed by one fenced block, because
	// an assistant told to emit nothing but JSON tends to emit an apology too.
	it('finds a fenced json block inside prose', () => {
		expectPlan(extractProposal(`Here's what I changed and why.\n\n\`\`\`json\n${planJson}\n\`\`\`\n`));
	});

	it('finds an unlabelled fenced block', () => {
		expectPlan(extractProposal(`Some notes\n\n\`\`\`\n${planJson}\n\`\`\``));
	});

	it('prefers the real plan over a smaller illustrative snippet shown first', () => {
		const snippet = '```json\n{"weeks":[]}\n```';
		expectPlan(extractProposal(`First, the shape:\n${snippet}\nAnd here is yours:\n\`\`\`json\n${planJson}\n\`\`\``));
	});

	it('finds a naked object with prose on both sides', () => {
		expectPlan(extractProposal(`I dropped a set in week 2. ${planJson} Let me know if you want it harder.`));
	});

	// A brace inside a string value is what defeats a naive first-{-to-last-}
	// scan on anything with a notes field.
	it('survives a brace inside a string value', () => {
		const withBrace = JSON.stringify({
			weeks: [
				{
					week_number: 2,
					sessions: [{ date: '2026-08-10', kind: 'lift', label: 'Lift A', plannedSets: [], plannedRun: null, notes: 'superset } with the next one' }],
				},
			],
		});
		expectPlan(extractProposal(`Done:\n\n\`\`\`json\n${withBrace}\n\`\`\``));
	});

	it('rejects an empty paste with a message about pasting', () => {
		const result = extractProposal('   \n ');
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toMatch(/[Pp]aste/);
	});

	it('rejects prose with no JSON in it at all', () => {
		const result = extractProposal("Sure! I'd be happy to help you plan your training.");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toMatch(/find any JSON/);
	});

	it('distinguishes valid JSON that is not a plan', () => {
		const result = extractProposal('{"sessions": []}');
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toMatch(/no "weeks" array/);
	});

	it('passes an empty weeks array through to the server, which has its own message for it', () => {
		const result = extractProposal('{"weeks":[]}');
		expect(result.ok).toBe(true);
	});
});
