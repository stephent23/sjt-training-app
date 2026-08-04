// Tiny shared SQL helpers. Deliberately not a query builder — just the one
// bit of string assembly that was being reimplemented in three places.

/**
 * Placeholder list for an `IN (...)` clause: `sqlIn(3)` -> `'?,?,?'`.
 *
 * Returns the literal `NULL` for a count of 0 so `IN (NULL)` stays valid SQL
 * that matches nothing — an empty `IN ()` is a syntax error in SQLite, and
 * callers otherwise have to special-case the empty list at every site.
 */
export function sqlIn(n: number): string {
	return n > 0 ? Array(n).fill('?').join(',') : 'NULL';
}
