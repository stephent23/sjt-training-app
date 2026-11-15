import type { SessionSummary } from '../../types';
import { WEEKDAY_LABELS } from '../weekDates';
import { Icon } from './Icon';

// Seven day cells for the week containing today: "where am I in the week",
// answered without opening Plan. The dates come from weekDatesFor, so the strip
// renders the moment Today mounts — before (and without) the network. Sessions
// fill the marks in once the list arrives.
//
// Every day state carries a shape as well as a colour, because colour is never
// the only signal in this system: done = tick, skipped = dash, still to do =
// a dot, today = filled cell. The cell's aria-label says it in words.

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function parts(dateIso: string) {
	const [y, m, d] = dateIso.split('-').map(Number);
	// getDay() is 0 = Sunday; the app's weeks are Monday-first.
	const weekday = (new Date(y, m - 1, d).getDay() + 6) % 7;
	return { weekday, month: m - 1, day: d };
}

/** "Monday 9 November". Built by hand rather than with toLocaleDateString,
 * whose punctuation varies by engine and locale data ("Monday, 9 November"). */
export function longDate(dateIso: string): string {
	const { weekday, month, day } = parts(dateIso);
	return `${DAY_NAMES[weekday]} ${day} ${MONTH_NAMES[month]}`;
}

export function weekdayName(dateIso: string): string {
	return DAY_NAMES[parts(dateIso).weekday];
}

type DayState = 'rest' | 'planned' | 'done' | 'skipped';

/** One state per day, even when a day holds two sessions. Anything still to do
 * wins — a half-finished day is not a done day — then done beats skipped, so a
 * day where the run was skipped but the lift happened still reads as trained. */
function dayState(items: SessionSummary[]): DayState {
	if (items.length === 0) return 'rest';
	if (items.some((s) => s.status === 'planned')) return 'planned';
	if (items.some((s) => s.status === 'completed')) return 'done';
	return 'skipped';
}

const STATE_WORDS: Record<DayState, string> = {
	rest: 'nothing planned',
	planned: 'to do',
	done: 'done',
	skipped: 'skipped',
};

interface WeekStripProps {
	/** Seven ISO dates, Monday first — from weekDatesFor. */
	dates: string[];
	today: string;
	/** Undefined while loading: the strip still renders its seven days. */
	sessions: SessionSummary[] | undefined;
	/** Where tapping a day goes, given that day's first session. */
	linkFor: (session: SessionSummary) => string;
}

export function WeekStrip({ dates, today, sessions, linkFor }: WeekStripProps) {
	return (
		<ol class="week-strip" aria-label="This week">
			{dates.map((date, i) => {
				const items = sessions?.filter((s) => s.date === date) ?? [];
				const state = sessions === undefined ? 'rest' : dayState(items);
				const isToday = date === today;
				const cls = `week-day week-day--${state}${isToday ? ' week-day--today' : ''}${date < today ? ' week-day--past' : ''}`;
				const label = `${longDate(date)}${isToday ? ', today' : ''}: ${
					items.length > 0 ? `${items.map((s) => s.label).join(' and ')}, ${STATE_WORDS[state]}` : STATE_WORDS.rest
				}`;
				const body = (
					<>
						<span class="week-day-name">{WEEKDAY_LABELS[i]}</span>
						<span class="week-day-num">{String(parts(date).day).padStart(2, '0')}</span>
						<span class="week-day-mark">
							{state === 'done' && <Icon name="check" />}
							{state === 'skipped' && <Icon name="minus" />}
							{state === 'planned' && <span class="week-day-dot" />}
						</span>
					</>
				);
				return (
					<li key={date}>
						{items.length > 0 ? (
							<a class={cls} href={linkFor(items[0])} aria-label={label} aria-current={isToday ? 'date' : undefined}>
								{body}
							</a>
						) : (
							<span class={cls} aria-label={label} aria-current={isToday ? 'date' : undefined} role="img">
								{body}
							</span>
						)}
					</li>
				);
			})}
		</ol>
	);
}
