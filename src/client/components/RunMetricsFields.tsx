import { INTERVAL_PACE_RUN_TYPES, RUN_METRIC_FIELDS, type RunType } from '../../types';
import { formatPace } from '../format';

export interface RunMetricsFieldsProps {
	fields: Record<string, string>;
	onSet: (key: string) => (e: Event) => void;
	/** Fires on blur/change, keystroke-safe — Review passes this so a partial
	 * value never gets committed mid-type. RunEditor omits it: it saves via an
	 * explicit Save button instead, so committing per-field would do nothing
	 * useful. Every input still wires the handler; it is just a no-op when this
	 * is absent. */
	onCommit?: () => void;
	/** Interval pace only makes sense for a run with a work segment to average
	 * it over — hidden entirely (not just optional) for easy/long runs. Absent
	 * (e.g. before a run type has been chosen) hides it too. */
	runType?: RunType | null;
}

/** The distance/duration/pace + "from your watch" metrics + note block shared
 * by Review's inline run editor and the standalone RunEditor screen. Lifted
 * out of ReviewRun unchanged so the two can't drift apart in markup. */
export function RunMetricsFields({ fields, onSet, onCommit, runType }: RunMetricsFieldsProps) {
	const commit = () => onCommit?.();
	const pace = formatPace(Number(fields.distance), (Number(fields.minutes) || 0) * 60 + (Number(fields.seconds) || 0));
	const showIntervalPace = runType != null && INTERVAL_PACE_RUN_TYPES.includes(runType);

	return (
		<div>
			<div class="table-scroll">
				<table class="review-table">
					<tbody>
						<tr>
							<td>Distance (km)</td>
							<td>
								<input type="number" inputmode="decimal" value={fields.distance} onInput={onSet('distance')} onChange={commit} />
							</td>
						</tr>
						<tr>
							<td>Duration</td>
							<td>
								<div class="duration-inputs">
									<input
										type="number"
										inputmode="numeric"
										placeholder="min"
										value={fields.minutes}
										onInput={onSet('minutes')}
										onChange={commit}
									/>
									<input
										type="number"
										inputmode="numeric"
										placeholder="sec"
										value={fields.seconds}
										onInput={onSet('seconds')}
										onChange={commit}
									/>
								</div>
							</td>
						</tr>
						{pace && (
							<tr>
								<td>Pace</td>
								<td class="exercise-target">{pace}</td>
							</tr>
						)}
						{/* Garmin's second pace figure for an interval/tempo run — the
						    average during the work segments only, distinct from the
						    overall pace above. Can't be derived like overall pace can,
						    since interval-level distance/duration aren't captured — see
						    the doc comment on LoggedRunEntry. */}
						{showIntervalPace && (
							<tr>
								<td>Interval pace</td>
								<td>
									<div class="duration-inputs">
										<input
											type="number"
											inputmode="numeric"
											placeholder="min"
											value={fields.intervalPaceMinutes}
											onInput={onSet('intervalPaceMinutes')}
											onChange={commit}
										/>
										<input
											type="number"
											inputmode="numeric"
											placeholder="sec"
											value={fields.intervalPaceSeconds}
											onInput={onSet('intervalPaceSeconds')}
											onChange={commit}
										/>
									</div>
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>

			{/* Behind a disclosure so the everyday case stays two fields. Everything
			    in here is typed off the watch face, and skipping any of it is fine. */}
			<details class="disclosure">
				<summary class="disclosure-summary">From your watch</summary>
				<div class="disclosure-body table-scroll">
					<table class="review-table">
						<tbody>
							{RUN_METRIC_FIELDS.map((field) => (
								<tr key={field.key}>
									<td>{field.label}</td>
									<td>
										<input
											type="number"
											inputmode={field.integer ? 'numeric' : 'decimal'}
											value={fields[field.key]}
											onInput={onSet(field.key)}
											onChange={commit}
										/>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</details>

			<label class="field">
				How it went
				<textarea rows={2} value={fields.note} onInput={onSet('note')} onBlur={commit} />
			</label>
		</div>
	);
}
