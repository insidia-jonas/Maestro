import { CheckCircle, ListChecks, Save, AlertTriangle, FolderOpen } from 'lucide-react';
import type { Theme } from '../../types';
import { usePrompterStore } from '../../stores/prompterStore';
import { PROMPTER_REFUSAL_PROBES } from '../../../shared/prompter-types';

export function ReviewStep({
	theme,
	maxParallelAgents,
	onMaxParallelChange,
}: {
	theme: Theme;
	maxParallelAgents: number;
	onMaxParallelChange: (n: number) => void;
}): JSX.Element {
	const createdProject = usePrompterStore((s) => s.createdProject);
	const selectedAgents = usePrompterStore((s) => s.selectedAgents);
	const agentConfigs = usePrompterStore((s) => s.agentConfigs);
	const availableInstructions = usePrompterStore((s) => s.availableInstructions);

	// Top-level base instructions are each varied into 23 character/layout
	// fixtures that are always tested alongside the base files.
	const VARIATIONS_PER_BASE = 23;
	const instructionCount = availableInstructions.length;
	const baseTopLevel = availableInstructions.filter((f) => !f.path.includes('/')).length;
	const variationCount = baseTopLevel * VARIATIONS_PER_BASE;
	const totalInputs = instructionCount + variationCount;
	const agentCount = selectedAgents.length;
	// Fixed refusal-probe set (no schema picker).
	const schemaCount = PROMPTER_REFUSAL_PROBES.length;
	const taskCount = totalInputs * agentCount * schemaCount;

	const schemaList = [...PROMPTER_REFUSAL_PROBES];

	const handleClampChange = (raw: number): void => {
		if (Number.isNaN(raw)) {
			return;
		}
		const clamped = Math.max(1, Math.min(8, Math.round(raw)));
		onMaxParallelChange(clamped);
	};

	const handleSaveTemplate = (): void => {
		usePrompterStore.getState().saveStateForResume();
	};

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center gap-2 select-none">
				<CheckCircle size={18} style={{ color: theme.colors.success }} />
				<span className="text-base font-semibold" style={{ color: theme.colors.textMain }}>
					Review und Start
				</span>
			</div>

			{/* Projekt */}
			<div
				className="flex flex-col gap-1 rounded-md p-3 select-text"
				style={{
					backgroundColor: theme.colors.bgSidebar,
					border: `1px solid ${theme.colors.border}`,
				}}
			>
				<span className="text-xs uppercase tracking-wide" style={{ color: theme.colors.textDim }}>
					Projekt
				</span>
				{createdProject ? (
					<>
						<span className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
							{createdProject.name}
						</span>
						<div className="flex items-center gap-1.5">
							<FolderOpen size={13} style={{ color: theme.colors.textDim }} />
							<span className="text-xs break-all" style={{ color: theme.colors.textDim }}>
								{createdProject.rootPath}
							</span>
						</div>
					</>
				) : (
					<span className="text-sm" style={{ color: theme.colors.textDim }}>
						Kein Projekt erstellt.
					</span>
				)}
			</div>

			{/* Agents */}
			<div
				className="flex flex-col gap-2 rounded-md p-3"
				style={{
					backgroundColor: theme.colors.bgSidebar,
					border: `1px solid ${theme.colors.border}`,
				}}
			>
				<span
					className="text-xs uppercase tracking-wide select-none"
					style={{ color: theme.colors.textDim }}
				>
					Agents ({agentCount})
				</span>
				{agentCount === 0 ? (
					<span className="text-sm" style={{ color: theme.colors.textDim }}>
						Keine Agents ausgewaehlt.
					</span>
				) : (
					<div className="flex flex-col gap-1.5 select-text">
						{selectedAgents.map((agent) => {
							const model = agentConfigs.get(agent.agentId)?.modelId;
							return (
								<div
									key={agent.agentId}
									className="flex items-center justify-between gap-3 text-sm"
								>
									<span style={{ color: theme.colors.textMain }}>{agent.displayName}</span>
									<span
										className="text-xs rounded px-1.5 py-0.5"
										style={{
											color: model ? theme.colors.accentText : theme.colors.textDim,
											backgroundColor: theme.colors.bgMain,
											border: `1px solid ${theme.colors.border}`,
										}}
									>
										{model ?? 'kein Modell'}
									</span>
								</div>
							);
						})}
					</div>
				)}
			</div>

			{/* Instructions */}
			<div
				className="flex flex-col gap-2 rounded-md p-3"
				style={{
					backgroundColor: theme.colors.bgSidebar,
					border: `1px solid ${theme.colors.border}`,
				}}
			>
				<span
					className="text-xs uppercase tracking-wide select-none"
					style={{ color: theme.colors.textDim }}
				>
					Instructions
				</span>
				<span className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
					{instructionCount} Dateien + {variationCount} Character-Variations (automatisch)
				</span>
				{instructionCount > 0 && (
					<div className="flex flex-col gap-1 select-text">
						{availableInstructions.slice(0, 5).map((file) => (
							<span
								key={file.path}
								className="text-xs break-all"
								style={{ color: theme.colors.textDim }}
							>
								{file.path}
							</span>
						))}
						{instructionCount > 5 && (
							<span className="text-xs" style={{ color: theme.colors.textDim }}>
								und {instructionCount - 5} weitere
							</span>
						)}
					</div>
				)}
			</div>

			{/* Refusal-Test (fixed probe set) */}
			<div
				className="flex flex-col gap-1 rounded-md p-3"
				style={{
					backgroundColor: theme.colors.bgSidebar,
					border: `1px solid ${theme.colors.border}`,
				}}
			>
				<span
					className="text-xs uppercase tracking-wide select-none"
					style={{ color: theme.colors.textDim }}
				>
					Refusal-Test ({schemaCount} Probes)
				</span>
				<span className="text-sm break-words select-text" style={{ color: theme.colors.textMain }}>
					{schemaList.join(', ')}
				</span>
				<span className="text-xs" style={{ color: theme.colors.textDim }}>
					Prueft, ob die Instruction akzeptiert wird und der Agent seine Grenzen konsistent haelt.
				</span>
			</div>

			{/* Task count */}
			<div
				className="flex items-center gap-3 rounded-md p-4 select-none"
				style={{ backgroundColor: theme.colors.bgMain, border: `1px solid ${theme.colors.accent}` }}
			>
				<ListChecks size={22} style={{ color: theme.colors.accent }} />
				<div className="flex flex-col">
					<span className="text-lg font-semibold" style={{ color: theme.colors.textMain }}>
						{totalInputs} Inputs x {agentCount} Agents x {schemaCount} Probes ={' '}
						<span style={{ color: theme.colors.accent }}>{taskCount} Tasks</span>
					</span>
					<span className="text-xs" style={{ color: theme.colors.textDim }}>
						{instructionCount} Basis-Instructions + {variationCount} Character-Variations, alle
						mitgetestet.
					</span>
				</div>
			</div>

			{taskCount > 100 && (
				<div
					className="flex items-center gap-2 rounded-md p-3 select-none"
					style={{
						backgroundColor: theme.colors.bgSidebar,
						border: `1px solid ${theme.colors.warning}`,
					}}
				>
					<AlertTriangle size={16} style={{ color: theme.colors.warning }} />
					<span className="text-sm" style={{ color: theme.colors.warning }}>
						Dieser Run erzeugt {taskCount} Tasks. Das kann dauern.
					</span>
				</div>
			)}

			{/* Max parallel agents */}
			<div className="flex items-center justify-between gap-3 select-none">
				<label
					htmlFor="prompter-max-parallel"
					className="text-sm"
					style={{ color: theme.colors.textMain }}
				>
					Max. parallele Agents
				</label>
				<input
					id="prompter-max-parallel"
					type="number"
					min={1}
					max={8}
					value={maxParallelAgents}
					onChange={(e) => handleClampChange(Number(e.target.value))}
					className="w-20 rounded-md px-2 py-1 text-sm text-center outline-none"
					style={{
						backgroundColor: theme.colors.bgMain,
						color: theme.colors.textMain,
						border: `1px solid ${theme.colors.border}`,
					}}
				/>
			</div>

			{/* Save as template */}
			<div className="flex select-none">
				<button
					type="button"
					onClick={handleSaveTemplate}
					className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors"
					style={{
						backgroundColor: theme.colors.bgSidebar,
						color: theme.colors.textMain,
						border: `1px solid ${theme.colors.border}`,
					}}
				>
					<Save size={15} style={{ color: theme.colors.textDim }} />
					Als Template speichern
				</button>
			</div>
		</div>
	);
}
