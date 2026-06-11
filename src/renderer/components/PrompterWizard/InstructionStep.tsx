import { useEffect, useState } from 'react';
import { FileText, FolderOpen, RefreshCw, AlertTriangle } from 'lucide-react';
import type { Theme } from '../../types';
import { usePrompterStore } from '../../stores/prompterStore';
import type { InstructionFile } from '../../../shared/prompter-types';

function formatBytes(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	return `${(bytes / 1024).toFixed(1)} KB`;
}

export function InstructionStep({ theme }: { theme: Theme }): JSX.Element {
	const createdProject = usePrompterStore((s) => s.createdProject);
	const availableInstructions = usePrompterStore((s) => s.availableInstructions);

	const [loading, setLoading] = useState(false);

	useEffect(() => {
		if (!createdProject) {
			return;
		}
		let cancelled = false;
		setLoading(true);
		window.maestro.prompter
			.listInstructions(createdProject.rootPath)
			.then((list: InstructionFile[]) => {
				if (!cancelled) {
					usePrompterStore.getState().setAvailableInstructions(list);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setLoading(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [createdProject]);

	const refresh = (): void => {
		if (!createdProject) {
			return;
		}
		setLoading(true);
		window.maestro.prompter
			.listInstructions(createdProject.rootPath)
			.then((list: InstructionFile[]) => {
				usePrompterStore.getState().setAvailableInstructions(list);
			})
			.finally(() => {
				setLoading(false);
			});
	};

	const openFolder = (): void => {
		if (!createdProject) {
			return;
		}
		window.maestro.prompter.openProjectFolder(`${createdProject.rootPath}/1-generic-instructions`);
	};

	if (!createdProject) {
		return (
			<div className="flex flex-col gap-2 p-4 select-none">
				<div className="flex items-center gap-2 text-sm" style={{ color: theme.colors.textDim }}>
					<AlertTriangle size={16} />
					<span>
						Bitte zuerst Schritt 2 abschliessen und ein Projekt anlegen, bevor die Instructions
						angezeigt werden koennen.
					</span>
				</div>
			</div>
		);
	}

	const count = availableInstructions.length;

	return (
		<div className="flex flex-col gap-4 p-4 select-none">
			<div className="flex items-center justify-between gap-2">
				<span
					className="inline-flex items-center gap-2 rounded-md px-3 py-1 text-sm font-medium"
					style={{
						color: theme.colors.accentForeground,
						backgroundColor: theme.colors.accent,
					}}
				>
					{count} {count === 1 ? 'Datei wird getestet' : 'Dateien werden getestet'}
				</span>
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={openFolder}
						className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm"
						style={{
							color: theme.colors.textMain,
							border: `1px solid ${theme.colors.border}`,
							backgroundColor: theme.colors.bgSidebar,
						}}
					>
						<FolderOpen size={15} />
						Ordner oeffnen
					</button>
					<button
						type="button"
						onClick={refresh}
						disabled={loading}
						className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm disabled:opacity-60"
						style={{
							color: theme.colors.accentText,
							border: `1px solid ${theme.colors.accentDim}`,
							backgroundColor: theme.colors.bgSidebar,
						}}
					>
						<RefreshCw size={15} className={loading ? 'animate-spin' : undefined} />
						Aktualisieren
					</button>
				</div>
			</div>

			<p className="text-sm" style={{ color: theme.colors.textDim }}>
				Alle Dateien in diesem Ordner werden automatisch in jeden Test einbezogen. Lege weitere
				Dateien ab oder importiere sie.
			</p>
			<p className="text-sm" style={{ color: theme.colors.textDim }}>
				Zusaetzlich wird jede Basis-Instruction in 23 Character-/Layout-Variationen (Homoglyphen,
				Fullwidth, Whitespace, Bidi/Control u.a.) erzeugt und immer mitgetestet.
			</p>

			{count === 0 && !loading && (
				<div
					className="flex items-center gap-2 rounded-md px-3 py-2 text-sm"
					style={{
						color: theme.colors.warning,
						border: `1px solid ${theme.colors.warning}`,
						backgroundColor: theme.colors.bgSidebar,
					}}
				>
					<AlertTriangle size={16} />
					<span>
						Mindestens 1 Instruction-Datei wird benoetigt. Lege Dateien in 1-generic-instructions/
						ab.
					</span>
				</div>
			)}

			{loading && count === 0 && (
				<div className="text-sm" style={{ color: theme.colors.textDim }}>
					Lade Instructions ...
				</div>
			)}

			<div className="flex flex-col gap-3 overflow-y-auto" style={{ maxHeight: 420 }}>
				{availableInstructions.map((file) => (
					<div
						key={file.path}
						className="flex flex-col gap-2 rounded-md p-3"
						style={{
							border: `1px solid ${theme.colors.border}`,
							backgroundColor: theme.colors.bgMain,
						}}
					>
						<div className="flex items-center gap-2">
							<FileText size={15} style={{ color: theme.colors.accent }} className="shrink-0" />
							<span
								className="truncate text-sm font-medium"
								style={{ color: theme.colors.textMain }}
							>
								{file.path}
							</span>
						</div>
						<div
							className="flex items-center gap-3 text-xs"
							style={{ color: theme.colors.textDim }}
						>
							<span>{formatBytes(file.sizeBytes)}</span>
							<span className="font-mono">{file.hash.slice(0, 8)}</span>
						</div>
						<pre
							className="select-text overflow-x-auto whitespace-pre-wrap rounded-md p-2 font-mono text-xs"
							style={{
								color: theme.colors.textDim,
								backgroundColor: theme.colors.bgSidebar,
								border: `1px solid ${theme.colors.border}`,
							}}
						>
							{file.preview}
						</pre>
					</div>
				))}
			</div>
		</div>
	);
}
