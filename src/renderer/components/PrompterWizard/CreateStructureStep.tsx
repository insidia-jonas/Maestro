import { useState } from 'react';
import { Folder, FileText, CheckCircle, AlertTriangle, Loader2, Hammer } from 'lucide-react';
import type { Theme } from '../../types';
import { usePrompterStore } from '../../stores/prompterStore';

const CONFLICT_REASONS: Record<string, string> = {
	'exists-as-file': 'existiert bereits als Datei',
	'exists-as-dir': 'existiert bereits als Ordner',
	'not-writable': 'nicht beschreibbar',
};

export function CreateStructureStep({ theme }: { theme: Theme }): JSX.Element {
	const projectDraft = usePrompterStore((s) => s.projectDraft);
	const projectPlan = usePrompterStore((s) => s.projectPlan);
	const createdProject = usePrompterStore((s) => s.createdProject);

	const [creating, setCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);

	if (!projectDraft) {
		return (
			<div className="flex flex-col gap-2 p-4 select-none">
				<span className="text-sm" style={{ color: theme.colors.textDim }}>
					Kein Projektentwurf vorhanden. Geh zurück zu Schritt 1 und lege Zielordner und
					Projektnamen fest.
				</span>
			</div>
		);
	}

	const conflictPaths = new Set((projectPlan?.conflicts ?? []).map((c) => c.path));

	const handleCreate = async (): Promise<void> => {
		setCreating(true);
		setError(null);
		try {
			const project = await window.maestro.prompter.createProject(
				projectDraft.targetDir,
				projectDraft.projectName
			);
			usePrompterStore.getState().setCreatedProject(project);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setCreating(false);
		}
	};

	return (
		<div className="flex flex-col gap-4 p-4">
			<div className="flex flex-col gap-1 select-none">
				<h2 className="text-base font-semibold" style={{ color: theme.colors.textMain }}>
					Ordnerstruktur erzeugen
				</h2>
				<span className="text-sm" style={{ color: theme.colors.textDim }}>
					Vorschau der Ordner und Dateien, die für{' '}
					<span style={{ color: theme.colors.textMain }}>{projectDraft.projectName}</span> angelegt
					werden.
				</span>
			</div>

			{!projectPlan && (
				<div
					className="rounded-md border p-3 text-sm select-none"
					style={{ borderColor: theme.colors.border, color: theme.colors.textDim }}
				>
					Noch kein Plan berechnet. Kehre zu Schritt 1 zurück, um die Struktur zu planen.
				</div>
			)}

			{projectPlan && (
				<div
					className="rounded-md border overflow-hidden"
					style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgSidebar }}
				>
					<div
						className="px-3 py-2 text-xs font-medium border-b select-none"
						style={{ borderColor: theme.colors.border, color: theme.colors.textDim }}
					>
						{projectPlan.projectRoot}
					</div>
					<div className="flex flex-col gap-0.5 p-2 max-h-72 overflow-auto select-text">
						{projectPlan.foldersToCreate.length === 0 && projectPlan.filesToCreate.length === 0 && (
							<span className="px-1 py-2 text-sm" style={{ color: theme.colors.textDim }}>
								Keine neuen Ordner oder Dateien geplant.
							</span>
						)}

						{projectPlan.foldersToCreate.map((folder) => {
							const conflicted = conflictPaths.has(folder);
							return (
								<div
									key={`folder-${folder}`}
									className="flex items-center gap-2 px-1 py-0.5 text-sm rounded"
								>
									<Folder
										size={14}
										style={{ color: conflicted ? theme.colors.error : theme.colors.accent }}
									/>
									<span style={{ color: conflicted ? theme.colors.error : theme.colors.textMain }}>
										{folder}
									</span>
								</div>
							);
						})}

						{projectPlan.filesToCreate.map((file) => {
							const conflicted = conflictPaths.has(file);
							return (
								<div
									key={`file-${file}`}
									className="flex items-center gap-2 px-1 py-0.5 text-sm rounded"
								>
									<FileText
										size={14}
										style={{ color: conflicted ? theme.colors.error : theme.colors.textDim }}
									/>
									<span style={{ color: conflicted ? theme.colors.error : theme.colors.textDim }}>
										{file}
									</span>
								</div>
							);
						})}
					</div>

					{projectPlan.conflicts.length > 0 && (
						<div
							className="flex flex-col gap-1 border-t px-3 py-2 select-text"
							style={{ borderColor: theme.colors.border }}
						>
							{projectPlan.conflicts.map((conflict) => (
								<div
									key={`conflict-${conflict.path}`}
									className="flex items-center gap-2 text-xs"
									style={{ color: theme.colors.error }}
								>
									<AlertTriangle size={13} />
									<span>
										{conflict.path} - {CONFLICT_REASONS[conflict.reason] ?? conflict.reason}
									</span>
								</div>
							))}
						</div>
					)}
				</div>
			)}

			{error && (
				<div
					className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm select-text"
					style={{ borderColor: theme.colors.error, color: theme.colors.error }}
				>
					<AlertTriangle size={15} className="mt-0.5 shrink-0" />
					<span>{error}</span>
				</div>
			)}

			{createdProject ? (
				<div
					className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm select-text"
					style={{ borderColor: theme.colors.success, color: theme.colors.success }}
				>
					<CheckCircle size={16} className="shrink-0" />
					<span>Projekt erstellt unter {createdProject.rootPath}</span>
				</div>
			) : (
				<div className="flex select-none">
					<button
						type="button"
						onClick={handleCreate}
						disabled={creating}
						className="flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60"
						style={{
							backgroundColor: theme.colors.accent,
							color: theme.colors.accentForeground,
						}}
					>
						{creating ? <Loader2 size={15} className="animate-spin" /> : <Hammer size={15} />}
						{creating ? 'Wird erstellt...' : 'Struktur erstellen'}
					</button>
				</div>
			)}
		</div>
	);
}
