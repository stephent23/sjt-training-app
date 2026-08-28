// Deleting a session, in the one place that knows what hangs off one.
//
// Every child table REFERENCES sessions (id) with no ON DELETE CASCADE
// (migration 0001), so the children have to go first and by hand. Getting that
// list wrong doesn't fail loudly — SQLite doesn't enforce foreign keys unless
// asked — it just orphans rows that nothing will ever read again.
//
// Statements rather than execution, so callers can put them in their own
// db.batch() alongside whatever else has to succeed or fail with them: the
// manual-run delete uses one batch, and the plan-replace path puts these ahead
// of its inserts so a half-replaced week can't survive a failure.

/** Every statement needed to remove these sessions, children first.
 * Empty when `ids` is empty — a caller can splice the result in unconditionally. */
export function deleteSessionStatements(db: D1Database, ids: number[]): D1PreparedStatement[] {
	if (ids.length === 0) return [];

	const placeholders = ids.map(() => '?').join(', ');

	// Ordered children-before-parent. exercise_swaps and session_feedback are
	// included because a planned session can carry both before anything is
	// logged against it — a swap made while previewing, or feedback left on a
	// session that was then rescheduled.
	return [
		`DELETE FROM exercise_swaps WHERE session_id IN (${placeholders})`,
		`DELETE FROM logged_sets WHERE session_id IN (${placeholders})`,
		`DELETE FROM planned_sets WHERE session_id IN (${placeholders})`,
		`DELETE FROM session_feedback WHERE session_id IN (${placeholders})`,
		`DELETE FROM logged_runs WHERE session_id IN (${placeholders})`,
		`DELETE FROM planned_runs WHERE session_id IN (${placeholders})`,
		`DELETE FROM sessions WHERE id IN (${placeholders})`,
	].map((sql) => db.prepare(sql).bind(...ids));
}
