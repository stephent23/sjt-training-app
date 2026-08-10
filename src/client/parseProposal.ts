import type { MultiWeekProposalInput } from '../types';

// Finding the plan inside whatever an assistant replied with. The import used
// to be a bare JSON.parse of the whole paste, which meant the prompt's own
// closing instruction — explain what changed, then give the JSON — produced an
// answer the app rejected. Rather than demand JSON and nothing else (which
// tends to get an apology bolted on anyway), accept the reply as it comes.

export type ParsedPaste = { ok: true; value: MultiWeekProposalInput } | { ok: false; error: string };

const FENCE = /```[ \t]*[A-Za-z0-9_-]*[ \t]*\r?\n([\s\S]*?)```/g;

/** Every `{...}` region that balances, from one left-to-right scan. Tracks
 * string state so a brace inside a `notes` value doesn't end the region — the
 * case that defeats a naive first-`{`-to-last-`}` slice. */
function balancedRegions(text: string): string[] {
	const regions: string[] = [];
	let depth = 0;
	let start = -1;
	let inString = false;
	let escaped = false;

	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (inString) {
			if (escaped) escaped = false;
			else if (char === '\\') escaped = true;
			else if (char === '"') inString = false;
			continue;
		}
		if (char === '"') inString = true;
		else if (char === '{') {
			if (depth === 0) start = i;
			depth++;
		} else if (char === '}' && depth > 0) {
			depth--;
			if (depth === 0) regions.push(text.slice(start, i + 1));
		}
	}
	return regions;
}

/** Longest first: an assistant that shows a small example of the shape before
 * the real plan would otherwise hand us the example. */
const longestFirst = (values: string[]) => [...values].sort((a, b) => b.length - a.length);

export function extractProposal(text: string): ParsedPaste {
	const trimmed = text.replace(/^﻿/, '').trim();
	if (trimmed === '') return { ok: false, error: "Paste the assistant's answer first." };

	const fenced = [...trimmed.matchAll(FENCE)].map((m) => m[1]);
	const candidates = [trimmed, ...longestFirst(fenced), ...longestFirst(balancedRegions(trimmed))];

	let sawJson = false;
	for (const candidate of candidates) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(candidate);
		} catch {
			continue; // prose never parses, so trying the whole paste first is free
		}
		if (typeof parsed !== 'object' || parsed === null) continue;
		sawJson = true;
		if (Array.isArray((parsed as MultiWeekProposalInput).weeks)) {
			return { ok: true, value: parsed as MultiWeekProposalInput };
		}
	}

	return sawJson
		? { ok: false, error: 'That JSON has no "weeks" array — ask for the whole plan object, the one starting {"weeks": [ … ].' }
		: { ok: false, error: "Couldn't find any JSON in that answer — send the whole reply, or just the json block it gave you." };
}
