import { describe, expect, it } from 'vitest';
import { weekDatesFor } from '../src/client/weekDates';

describe('weekDatesFor', () => {
	it('returns the Monday-Sunday week containing a mid-week date', () => {
		// 2026-08-05 is a Wednesday
		expect(weekDatesFor('2026-08-05')).toEqual(['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09']);
	});

	it('returns the same week when given the Monday itself', () => {
		expect(weekDatesFor('2026-08-03')).toEqual(['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09']);
	});

	it('returns the same week when given the Sunday itself', () => {
		expect(weekDatesFor('2026-08-09')).toEqual(['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09']);
	});

	it('handles a week that crosses a month boundary', () => {
		// 2026-08-31 is a Monday
		expect(weekDatesFor('2026-08-31')).toEqual(['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06']);
	});
});
