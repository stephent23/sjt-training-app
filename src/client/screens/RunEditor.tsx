import { useEffect, useRef, useState } from 'preact/hooks';
import { INTERVAL_PACE_RUN_TYPES, RUN_TYPES, type ManualRunInput, type RunType } from '../../types';
import { todayIso } from '../../dates';
import { capitalize } from '../format';
import { createManualRun, deleteManualRun, updateManualRun } from '../api';
import { DateChips } from '../components/DateChips';
import { Icon } from '../components/Icon';
import { RunMetricsFields, type PlannedTarget } from '../components/RunMetricsFields';
import { TapGroup } from '../components/TapGroup';
import { emptyRunFields, parseRunFields, runFieldsFrom, type RunFields } from '../runFields';
import { useSession } from '../useSession';

interface RunEditorProps {
	sessionId?: number;
}

/** A run that was never planned — recorded after the fact — or a correction
 * to one that was. No `sessionId` is add mode; a `sessionId` is edit mode.
 * These are two different routes in app.tsx (`#/run/new` vs `#/run/:id/edit`)
 * rather than one screen that can flip between modes, so it's safe for only
 * the edit branch to touch useSession/fetch — add mode has nothing to load
 * and must paint before any network round trip. */
export function RunEditor({ sessionId }: RunEditorProps) {
	if (sessionId === undefined) {
		return <RunEditorBody initialDate={todayIso()} initialRunType={null} initialFields={emptyRunFields()} planned={null} />;
	}
	return <EditingRunEditor sessionId={sessionId} />;
}

function EditingRunEditor({ sessionId }: { sessionId: number }) {
	const { detail } = useSession(sessionId);

	return (
		<RunEditorBody
			sessionId={sessionId}
			initialDate={detail?.session.date ?? todayIso()}
			initialRunType={detail?.plannedRun?.run_type ?? null}
			initialFields={runFieldsFrom(detail?.loggedRun ?? null)}
			planned={detail?.plannedRun ?? null}
		/>
	);
}

interface RunEditorBodyProps {
	sessionId?: number;
	initialDate: string;
	initialRunType: RunType | null;
	initialFields: RunFields;
	/** The plan being logged against, if any — only used to offer "Ran as planned". */
	planned: PlannedTarget | null;
}

function RunEditorBody({ sessionId, initialDate, initialRunType, initialFields, planned }: RunEditorBodyProps) {
	const [date, setDate] = useState(initialDate);
	const [runType, setRunType] = useState<RunType | null>(initialRunType);
	const [fields, setFields] = useState<RunFields>(initialFields);
	// `errors` are whole-screen problems (a server refusal); `fieldErrors` sit
	// under the field they are about.
	const [errors, setErrors] = useState<string[]>([]);
	const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
	const [saving, setSaving] = useState(false);
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const [deleting, setDeleting] = useState(false);

	// The session GET for edit mode lands after first paint, same as
	// ReviewRun's resync-on-signature-change: re-seed the form once the real
	// values arrive rather than leaving it stuck on the placeholders it was
	// first rendered with. Guarded against firing on the mount that seeded
	// `useState` in the first place — that pass runs asynchronously, and in
	// add mode (no fetch to actually wait for) it can land *after* the first
	// keystroke, which would otherwise stomp whatever was just typed back to
	// today's blank form.
	const signature = JSON.stringify([initialDate, initialRunType, initialFields]);
	const seeded = useRef(false);
	useEffect(() => {
		if (!seeded.current) {
			seeded.current = true;
			return;
		}
		setDate(initialDate);
		setRunType(initialRunType);
		setFields(initialFields);
	}, [signature]);

	// A pace typed in while intervals/tempo was selected must not silently
	// survive a switch to a type that hides the field — otherwise it could
	// still get submitted for an easy/long run, correctable only by switching
	// back to see it again.
	function handleRunTypeChange(next: RunType) {
		setRunType(next);
		setFieldErrors(({ runType: _cleared, ...rest }) => rest);
		if (!INTERVAL_PACE_RUN_TYPES.includes(next)) {
			setFields((f) => ({ ...f, intervalPace: '' }));
		}
	}

	async function handleSave() {
		const parsed = parseRunFields(fields);
		const problems = parsed.ok ? {} : { ...parsed.fieldErrors };
		if (!runType) problems.runType = 'Choose a run type before saving.';

		if (!parsed.ok || !runType) {
			setErrors([]);
			setFieldErrors(problems);
			// Land on the first thing to fix — the form is taller than a phone.
			setTimeout(() => {
				const bad = document.querySelector<HTMLElement>('[aria-invalid="true"], .run-type-error');
				bad?.focus?.();
				bad?.scrollIntoView?.({ block: 'center' });
			}, 0);
			return;
		}

		setErrors([]);
		setFieldErrors({});
		setSaving(true);
		const body: ManualRunInput = { date, run_type: runType, ...parsed.value };

		try {
			if (sessionId === undefined) {
				const { id } = await createManualRun(body);
				location.hash = `#/review/${id}`;
			} else {
				await updateManualRun(sessionId, body);
				location.hash = `#/review/${sessionId}`;
			}
		} catch (err) {
			setErrors([err instanceof Error ? err.message : 'Could not save this run.']);
			setSaving(false);
		}
	}

	async function handleDelete() {
		if (sessionId === undefined) return;
		setDeleting(true);
		try {
			await deleteManualRun(sessionId);
			location.hash = '#/history';
		} catch (err) {
			setErrors([err instanceof Error ? err.message : 'Could not delete this run.']);
			setDeleting(false);
		}
	}

	return (
		<main class="screen run-screen">
			<button type="button" class="back-btn" onClick={() => history.back()}>
				<Icon name="chevron-left" />
				Back
			</button>
			<h1>{sessionId === undefined ? 'Add a run' : 'Edit run'}</h1>

			{errors.length > 0 && (
				<ul class="error-list" role="alert">
					{errors.map((error) => (
						<li key={error}>{error}</li>
					))}
				</ul>
			)}

			<div class="run-type">
				<span class="run-field-label">Run type</span>
				<TapGroup options={RUN_TYPES} value={runType} onChange={handleRunTypeChange} label={capitalize} ariaLabel="Run type" />
				{fieldErrors.runType && (
					<span class="run-field-error run-type-error" role="alert" tabIndex={-1}>
						{fieldErrors.runType}
					</span>
				)}
			</div>

			<DateChips value={date} onChange={setDate} />

			<RunMetricsFields fields={fields} onChange={setFields} runType={runType} planned={planned} errors={fieldErrors} />

			{sessionId !== undefined &&
				(confirmingDelete ? (
					<div class="run-delete">
						<button type="button" class="btn-danger" onClick={handleDelete} disabled={deleting}>
							{deleting ? 'Deleting…' : 'Yes, delete this run'}
						</button>
						<button type="button" class="btn-quiet" onClick={() => setConfirmingDelete(false)} disabled={deleting}>
							Keep it
						</button>
					</div>
				) : (
					<button type="button" class="btn-quiet run-delete" onClick={() => setConfirmingDelete(true)}>
						Delete this run
					</button>
				))}

			{/* Sticky so Save is under the thumb however far down the form you are. */}
			<div class="run-actionbar">
				<button type="button" class="btn-primary" onClick={handleSave} disabled={saving}>
					{saving ? 'Saving…' : 'Save run'}
				</button>
			</div>
		</main>
	);
}
