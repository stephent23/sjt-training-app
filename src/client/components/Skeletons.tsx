// Loading shapes shared by the list screens. Each matches the footprint of what
// replaces it, so nothing jumps when the data lands. aria-hidden: they are
// decoration, and the screen's heading is already on the page.

/** A summary strip's worth of placeholder. */
export function StripSkeleton() {
	return <span class="skeleton skeleton--block" aria-hidden="true" />;
}

/** `rows` list rows, optionally under a week-header-sized title. */
export function ListSkeleton({ rows, title }: { rows: number; title?: boolean }) {
	return (
		<div class="skeleton-list" aria-hidden="true">
			{title && <span class="skeleton skeleton--title" style={{ width: '40%' }} />}
			{Array.from({ length: rows }, (_, i) => (
				<span key={i} class="skeleton skeleton--row" />
			))}
		</div>
	);
}
