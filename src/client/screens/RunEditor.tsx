import { useEffect, useRef, useState } from 'preact/hooks';
import { RUN_TYPES, type ManualRunInput, type RunType } from '../../types';
import { todayIso } from '../../dates';
import { capitalize } from '../format';
import { createManualRun, deleteManualRun, updateManualRun } from '../api';
import { RunMetricsFields } from '../components/RunMetricsFields';
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
		return <RunEditorBody initialDate={todayIso()} initialRunType={null} initialFields={emptyRunFields()} />;
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
		/>
	);
}

interface RunEditorBodyProps {
	sessionId?: number;
	initialDate: string;
	initialRunType: RunType | null;
	initialFields: RunFields;
}

function RunEditorBody({ sessionId, initialDate, initialRunType, initialFields }: RunEditorBodyProps) {
	const [date, setDate] = useState(initialDate);
	const [runType, setRunType] = useState<RunType | null>(initialRunType);
	const [fields, setFields] = useState<RunFields>(initialFields);
	const [errors, setErrors] = useState<string[]>([]);
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

	const set = (key: string) => (e: Event) => setFields((f) => ({ ...f, [key]: (e.target as HTMLInputElement).value }));

	async function handleSave() {
		const parsed = parseRunFields(fields);
		if (!parsed.ok) {
			setErrors(parsed.errors);
			return;
		}
		if (!runType) {
			setErrors(['Choose a run type before saving.']);
			return;
		}

		setErrors([]);
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
		<main class="screen">
			<button type="button" class="back-btn" onClick={() => history.back()}>
				← Back
			</button>
			<h1>{sessionId === undefined ? 'Add a run' : 'Edit run'}</h1>

			{errors.length > 0 && (
				<ul class="error-list">
					{errors.map((error) => (
						<li key={error}>{error}</li>
					))}
				</ul>
			)}

			<label class="field">
				Date
				<input type="date" value={date} onInput={(e) => setDate((e.target as HTMLInputElement).value)} />
			</label>

			<TapGroup options={RUN_TYPES} value={runType} onChange={setRunType} label={capitalize} ariaLabel="Run type" />

			<RunMetricsFields fields={fields} onSet={set} />

			<button type="button" class="btn-primary" onClick={handleSave} disabled={saving}>
				{saving ? 'Saving…' : 'Save run'}
			</button>

			{sessionId !== undefined &&
				(confirmingDelete ? (
					<button type="button" class="btn-danger" onClick={handleDelete} disabled={deleting}>
						{deleting ? 'Deleting…' : 'Yes, delete this run'}
					</button>
				) : (
					<button type="button" class="btn-secondary" onClick={() => setConfirmingDelete(true)}>
						Delete this run
					</button>
				))}
		</main>
	);
}
