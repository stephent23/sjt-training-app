import type { SessionDetail } from '../types';

function key(sessionId: number): string {
	return `ta:session:${sessionId}`;
}

export function readCachedSession(sessionId: number): SessionDetail | null {
	try {
		const raw = localStorage.getItem(key(sessionId));
		return raw ? (JSON.parse(raw) as SessionDetail) : null;
	} catch {
		return null;
	}
}

export function writeCachedSession(sessionId: number, detail: SessionDetail): void {
	localStorage.setItem(key(sessionId), JSON.stringify(detail));
}
