// The app's whole icon set. One family, drawn here by hand in the Lucide idiom
// (24px viewBox, 2px stroke, round caps and joins, no fills) so every glyph has
// the same weight and the same corner treatment — mixing in a glyph from a
// different set is the fastest way for icons to look amateur, so a new one gets
// drawn here, in this style, or not at all. Inline SVG rather than an icon
// font or sprite file: nothing to fetch, so it renders offline on first paint.
//
// Two sizes only (16 and 20), and always decorative: every icon sits next to a
// word that already says the same thing, so they are aria-hidden and never the
// sole carrier of meaning.

export type IconName =
	| 'lift'
	| 'run'
	| 'check'
	| 'chevron-right'
	| 'chevron-left'
	| 'plus'
	| 'minus'
	| 'alert'
	| 'today'
	| 'calendar'
	| 'history';

const PATHS: Record<IconName, string[]> = {
	// A dumbbell end-on: bar, inner plates, outer collars.
	lift: ['M6.5 6.5v11', 'M17.5 6.5v11', 'M3.5 9.5v5', 'M20.5 9.5v5', 'M6.5 12h11'],
	// A pulse trace rather than a running figure — a figure at 16px is a blob.
	run: ['M2.5 12h4l2.5-6.5 5 13 2.5-6.5h5'],
	check: ['M20 6 9 17l-5-5'],
	'chevron-right': ['m9 18 6-6-6-6'],
	'chevron-left': ['m15 18-6-6 6-6'],
	plus: ['M12 5v14', 'M5 12h14'],
	minus: ['M5 12h14'],
	alert: ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18', 'M12 8v4.5', 'M12 16h.01'],
	// Tab bar glyphs.
	today: ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18', 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6'],
	calendar: ['M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z', 'M8 3v4', 'M16 3v4', 'M3 10h18'],
	history: ['M3 12a9 9 0 1 0 2.6-6.4L3 8', 'M3 3v5h5', 'M12 7.5V12l3 2'],
};

interface IconProps {
	name: IconName;
	/** 'sm' = 16px (inline with text), 'md' = 20px (tab bar, stepper). */
	size?: 'sm' | 'md';
	/** Extra classes, e.g. `icon--down` to point a chevron downwards. */
	class?: string;
}

export function Icon({ name, size = 'sm', class: extra }: IconProps) {
	const px = size === 'md' ? 20 : 16;
	return (
		<svg
			class={`icon icon--${size}${extra ? ` ${extra}` : ''}`}
			width={px}
			height={px}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
			focusable="false"
		>
			{PATHS[name].map((d) => (
				<path key={d} d={d} />
			))}
		</svg>
	);
}
