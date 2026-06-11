import { useState } from 'react';
import { Pause, Play, Square, FolderOpen, Download, Trash2 } from 'lucide-react';
import type { Theme } from '../../types';
import { usePrompterStore } from '../../stores/prompterStore';
import type { PrompterRun } from '../../../shared/prompter-types';

export function PrompterControls({ theme, run }: { theme: Theme; run: PrompterRun }): JSX.Element {
	const [pending, setPending] = useState<string | null>(null);

	const buttonStyle = (active: boolean): React.CSSProperties => ({
		color: theme.colors.textDim,
		opacity: active ? 0.4 : 1,
	});

	const onHoverEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
		e.currentTarget.style.backgroundColor = theme.colors.bgActivity;
		e.currentTarget.style.color = theme.colors.textMain;
	};

	const onHoverLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
		e.currentTarget.style.backgroundColor = 'transparent';
		e.currentTarget.style.color = theme.colors.textDim;
	};

	const withPending = (key: string, fn: () => Promise<void>) => async () => {
		if (pending) return;
		setPending(key);
		try {
			await fn();
		} catch (err) {
			console.error(`[Prompter] ${key} failed:`, err);
		} finally {
			setPending(null);
		}
	};

	const handlePause = withPending('pause', () => window.maestro.prompter.pauseRun(run.id));
	const handleResume = withPending('resume', () => window.maestro.prompter.resumeRun(run.id));
	const handleStop = withPending('stop', () => window.maestro.prompter.stopRun(run.id));
	const handleOpenFolder = withPending('folder', () =>
		window.maestro.prompter.openProjectFolder(run.projectRoot)
	);
	const handleExport = withPending('export', async () => {
		await window.maestro.prompter.exportReport(run.id, 'md');
	});
	const handleDelete = withPending('delete', async () => {
		await window.maestro.prompter.deleteRun(run.id);
		usePrompterStore.getState().clearActiveRun();
	});

	return (
		<div className="flex items-center gap-1 select-none">
			{run.status === 'running' && (
				<button
					type="button"
					title="Pausieren"
					onClick={handlePause}
					onMouseEnter={onHoverEnter}
					onMouseLeave={onHoverLeave}
					disabled={pending !== null}
					className="p-1.5 rounded transition-colors"
					style={buttonStyle(pending !== null)}
				>
					<Pause className="w-4 h-4" />
				</button>
			)}

			{run.status === 'paused' && (
				<button
					type="button"
					title="Fortsetzen"
					onClick={handleResume}
					onMouseEnter={onHoverEnter}
					onMouseLeave={onHoverLeave}
					disabled={pending !== null}
					className="p-1.5 rounded transition-colors"
					style={buttonStyle(pending !== null)}
				>
					<Play className="w-4 h-4" />
				</button>
			)}

			{(run.status === 'running' || run.status === 'paused') && (
				<button
					type="button"
					title="Stoppen"
					onClick={handleStop}
					onMouseEnter={onHoverEnter}
					onMouseLeave={onHoverLeave}
					disabled={pending !== null}
					className="p-1.5 rounded transition-colors"
					style={buttonStyle(pending !== null)}
				>
					<Square className="w-4 h-4" />
				</button>
			)}

			<button
				type="button"
				title="Ordner oeffnen"
				onClick={handleOpenFolder}
				onMouseEnter={onHoverEnter}
				onMouseLeave={onHoverLeave}
				disabled={pending !== null}
				className="p-1.5 rounded transition-colors"
				style={buttonStyle(pending !== null)}
			>
				<FolderOpen className="w-4 h-4" />
			</button>

			<button
				type="button"
				title="Export (Markdown)"
				onClick={handleExport}
				onMouseEnter={onHoverEnter}
				onMouseLeave={onHoverLeave}
				disabled={pending !== null}
				className="p-1.5 rounded transition-colors"
				style={buttonStyle(pending !== null)}
			>
				<Download className="w-4 h-4" />
			</button>

			<button
				type="button"
				title="Loeschen"
				onClick={handleDelete}
				onMouseEnter={(e) => {
					e.currentTarget.style.backgroundColor = theme.colors.bgActivity;
				}}
				onMouseLeave={(e) => {
					e.currentTarget.style.backgroundColor = 'transparent';
				}}
				disabled={pending !== null}
				className="p-1.5 rounded transition-colors"
				style={{ color: theme.colors.error, opacity: pending !== null ? 0.4 : 1 }}
			>
				<Trash2 className="w-4 h-4" />
			</button>
		</div>
	);
}
