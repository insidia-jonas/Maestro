import { useEffect, useState } from 'react';
import { FolderOpen, FolderTree, FileText, AlertTriangle, Loader2 } from 'lucide-react';
import type { Theme } from '../../types';
import { usePrompterStore } from '../../stores/prompterStore';
import type { PrompterProjectDraft, ProjectPlan } from '../../../shared/prompter-types';

const DEFAULT_DRAFT: PrompterProjectDraft = {
	targetDir: '',
	projectName: 'prompt-safety-lab',
	dryRun: true,
};

export function ProjectFolderStep({ theme }: { theme: Theme }): JSX.Element {
	const projectDraft = usePrompterStore((s) => s.projectDraft);
	const projectPlan = usePrompterStore((s) => s.projectPlan);

	const [planLoading, setPlanLoading] = useState(false);

	// Initialize a local draft in the store if none exists yet.
	useEffect(() => {
		if (!projectDraft) {
			usePrompterStore.getState().setProjectDraft({ ...DEFAULT_DRAFT });
		}
	}, [projectDraft]);

	const draft = projectDraft ?? DEFAULT_DRAFT;
	const targetDir = draft.targetDir;
	const projectName = draft.projectName;

	// Run planProject when targetDir or projectName change. Errors clear the plan.
	useEffect(() => {
		if (!targetDir || !projectName) {
			usePrompterStore.getState().setProjectPlan(null);
			return;
		}
		let cancelled = false;
		setPlanLoading(true);
		const handle = setTimeout(async () => {
			try {
				const plan: ProjectPlan = await window.maestro.prompter.planProject(targetDir, projectName);
				if (!cancelled) {
					usePrompterStore.getState().setProjectPlan(plan);
				}
			} catch {
				if (!cancelled) {
					usePrompterStore.getState().setProjectPlan(null);
				}
			} finally {
				if (!cancelled) {
					setPlanLoading(false);
				}
			}
		}, 400);
		return () => {
			cancelled = true;
			clearTimeout(handle);
		};
	}, [targetDir, projectName]);

	const handleSelectFolder = async (): Promise<void> => {
		const path = await window.maestro.dialog.selectFolder();
		if (path) {
			const current = usePrompterStore.getState().projectDraft ?? DEFAULT_DRAFT;
			usePrompterStore.getState().setProjectDraft({ ...current, targetDir: path });
		}
	};

	const handleNameChange = (value: string): void => {
		const current = usePrompterStore.getState().projectDraft ?? DEFAULT_DRAFT;
		usePrompterStore.getState().setProjectDraft({ ...current, projectName: value });
	};

	const handleDryRunChange = (checked: boolean): void => {
		const current = usePrompterStore.getState().projectDraft ?? DEFAULT_DRAFT;
		usePrompterStore.getState().setProjectDraft({ ...current, dryRun: checked });
	};

	return (
		<div className="flex flex-col gap-5 select-none">
			<div className="flex flex-col gap-1">
				<h2 className="text-lg font-semibold" style={{ color: theme.colors.textMain }}>
					Projektordner
				</h2>
				<p className="text-sm" style={{ color: theme.colors.textDim }}>
					Waehle das Zielverzeichnis und den Projektnamen fuer das Prompt Safety Lab.
				</p>
			</div>

			{/* Folder picker */}
			<div className="flex flex-col gap-2">
				<span className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
					Zielverzeichnis
				</span>
				<div className="flex items-center gap-3">
					<button
						type="button"
						onClick={handleSelectFolder}
						className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-opacity hover:opacity-90"
						style={{
							backgroundColor: theme.colors.accent,
							color: theme.colors.accentForeground,
						}}
					>
						<FolderOpen size={16} />
						Ordner auswaehlen
					</button>
					{targetDir ? (
						<span
							className="truncate text-sm select-text"
							style={{ color: theme.colors.textMain }}
							title={targetDir}
						>
							{targetDir}
						</span>
					) : (
						<span className="text-sm italic" style={{ color: theme.colors.textDim }}>
							Noch kein Ordner gewaehlt
						</span>
					)}
				</div>
			</div>

			{/* Project name */}
			<div className="flex flex-col gap-2">
				<label
					htmlFor="prompter-project-name"
					className="text-sm font-medium"
					style={{ color: theme.colors.textMain }}
				>
					Projektname
				</label>
				<input
					id="prompter-project-name"
					type="text"
					value={projectName}
					onChange={(e) => handleNameChange(e.target.value)}
					placeholder="prompt-safety-lab"
					className="w-full rounded-md px-3 py-2 text-sm outline-none focus:ring-1"
					style={{
						backgroundColor: theme.colors.bgMain,
						color: theme.colors.textMain,
						border: `1px solid ${theme.colors.border}`,
					}}
				/>
			</div>

			{/* Dry run toggle */}
			<label className="flex cursor-pointer items-center gap-2">
				<input
					type="checkbox"
					checked={draft.dryRun}
					onChange={(e) => handleDryRunChange(e.target.checked)}
					className="h-4 w-4 cursor-pointer"
					style={{ accentColor: theme.colors.accent }}
				/>
				<span className="text-sm" style={{ color: theme.colors.textMain }}>
					Dry Run anzeigen, bevor Dateien geschrieben werden
				</span>
			</label>

			{/* Plan preview */}
			<div
				className="flex flex-col gap-3 rounded-md p-4 select-text"
				style={{
					backgroundColor: theme.colors.bgSidebar,
					border: `1px solid ${theme.colors.border}`,
				}}
			>
				<div className="flex items-center justify-between">
					<span className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
						Vorschau
					</span>
					{planLoading && (
						<span
							className="flex items-center gap-1 text-xs"
							style={{ color: theme.colors.textDim }}
						>
							<Loader2 size={14} className="animate-spin" />
							Lade Plan
						</span>
					)}
				</div>

				{!targetDir || !projectName ? (
					<span className="text-sm italic" style={{ color: theme.colors.textDim }}>
						Waehle einen Ordner und einen Projektnamen, um die Vorschau zu sehen.
					</span>
				) : !projectPlan ? (
					<span className="text-sm italic" style={{ color: theme.colors.textDim }}>
						{planLoading ? 'Plan wird berechnet ...' : 'Keine Vorschau verfuegbar.'}
					</span>
				) : (
					<div className="flex flex-col gap-3">
						<div className="flex flex-wrap items-center gap-4 text-sm">
							<span className="flex items-center gap-1.5" style={{ color: theme.colors.textMain }}>
								<FolderTree size={15} style={{ color: theme.colors.accent }} />
								{projectPlan.foldersToCreate.length} Ordner
							</span>
							<span className="flex items-center gap-1.5" style={{ color: theme.colors.textMain }}>
								<FileText size={15} style={{ color: theme.colors.accent }} />
								{projectPlan.filesToCreate.length} Dateien
							</span>
							{projectPlan.existingFiles.length > 0 && (
								<span style={{ color: theme.colors.textDim }}>
									{projectPlan.existingFiles.length} bereits vorhanden
								</span>
							)}
						</div>

						<div className="flex flex-col gap-1">
							<span
								className="text-xs uppercase tracking-wide"
								style={{ color: theme.colors.textDim }}
							>
								Wurzel
							</span>
							<span className="text-sm" style={{ color: theme.colors.textMain }}>
								{projectPlan.projectRoot}
							</span>
						</div>

						{projectPlan.foldersToCreate.length > 0 && (
							<div className="flex flex-col gap-1">
								<span
									className="text-xs uppercase tracking-wide"
									style={{ color: theme.colors.textDim }}
								>
									Neue Ordner
								</span>
								<ul className="flex flex-col gap-0.5">
									{projectPlan.foldersToCreate.slice(0, 6).map((folder) => (
										<li key={folder} className="text-sm" style={{ color: theme.colors.textMain }}>
											{folder}
										</li>
									))}
									{projectPlan.foldersToCreate.length > 6 && (
										<li className="text-xs italic" style={{ color: theme.colors.textDim }}>
											+ {projectPlan.foldersToCreate.length - 6} weitere
										</li>
									)}
								</ul>
							</div>
						)}

						{projectPlan.conflicts.length > 0 && (
							<div
								className="flex flex-col gap-1.5 rounded-md p-3"
								style={{
									backgroundColor: theme.colors.bgMain,
									border: `1px solid ${theme.colors.warning}`,
								}}
							>
								<span
									className="flex items-center gap-1.5 text-sm font-medium"
									style={{ color: theme.colors.warning }}
								>
									<AlertTriangle size={15} />
									{projectPlan.conflicts.length} Konflikt
									{projectPlan.conflicts.length === 1 ? '' : 'e'}
								</span>
								<ul className="flex flex-col gap-0.5">
									{projectPlan.conflicts.map((conflict) => (
										<li
											key={conflict.path}
											className="text-sm"
											style={{ color: theme.colors.warning }}
										>
											{conflict.path} ({conflict.reason})
										</li>
									))}
								</ul>
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
