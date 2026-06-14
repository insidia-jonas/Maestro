import {
	CheckCircle,
	ListChecks,
	Save,
	AlertTriangle,
	FolderOpen,
	Zap,
	Swords,
} from 'lucide-react';
import type { Theme } from '../../types';
import { usePrompterStore } from '../../stores/prompterStore';
import { RED_TEAM_STRATEGIES } from '../../../shared/prompter-types';

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
	const selectedSchemas = usePrompterStore((s) => s.selectedSchemas);
	const selectedTransforms = usePrompterStore((s) => s.selectedTransforms);
	const testTargets = usePrompterStore((s) => s.testTargets);
	const crafterConfig = usePrompterStore((s) => s.crafterConfig);
	const crafterAgents = usePrompterStore((s) => s.crafterAgents);

	const instructionCount = availableInstructions.length;
	const baseTopLevel = availableInstructions.filter((f) => !f.path.includes('/')).length;
	const transformCount = selectedTransforms.size;
	const variationCount = transformCount > 0 ? baseTopLevel * transformCount : 0;
	const totalInputs = instructionCount + variationCount;
	const agentCount = selectedAgents.length;
	const schemaCount = selectedSchemas.size;
	const taskCount = totalInputs * agentCount * schemaCount;

	const schemaList = Array.from(selectedSchemas);

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

			{/* Test Targets */}
			{testTargets.length > 0 && (
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
						Ziel-Modelle ({testTargets.length})
					</span>
					<div className="flex flex-col gap-1.5 select-text">
						{testTargets.map((target) => (
							<div
								key={`${target.agentId}-${target.modelId}`}
								className="flex items-center justify-between gap-3 text-sm"
							>
								<span style={{ color: theme.colors.textMain }}>
									{target.displayName ?? `${target.agentId} / ${target.modelId}`}
								</span>
								<div className="flex items-center gap-1.5">
									{target.isExecutor ? (
										<span
											className="text-[10px] rounded px-1.5 py-0.5"
											style={{
												color: theme.colors.accentText,
												backgroundColor: theme.colors.bgMain,
												border: `1px solid ${theme.colors.accent}`,
											}}
										>
											Executor + Ziel
										</span>
									) : (
										<span
											className="text-[10px] rounded px-1.5 py-0.5"
											style={{
												color: theme.colors.textDim,
												backgroundColor: theme.colors.bgMain,
												border: `1px solid ${theme.colors.border}`,
											}}
										>
											Nur Ziel
										</span>
									)}
									{target.isPrimary && (
										<span
											className="text-[10px] rounded px-1.5 py-0.5"
											style={{
												color: theme.colors.warning,
												backgroundColor: theme.colors.bgMain,
												border: `1px solid ${theme.colors.warning}`,
											}}
										>
											Primaer
										</span>
									)}
								</div>
							</div>
						))}
					</div>
				</div>
			)}

			{/* Red-Team Crafter */}
			{crafterConfig?.enabled && (
				<div
					className="flex flex-col gap-2 rounded-md p-3"
					style={{
						backgroundColor: theme.colors.bgSidebar,
						border: `1px solid ${theme.colors.border}`,
					}}
				>
					<div className="flex items-center gap-2">
						<Zap size={12} style={{ color: theme.colors.warning }} />
						<span
							className="text-xs uppercase tracking-wide select-none"
							style={{ color: theme.colors.textDim }}
						>
							Red-Team Crafter
						</span>
					</div>
					<div className="flex flex-col gap-1 select-text">
						<span className="text-sm" style={{ color: theme.colors.textMain }}>
							{crafterConfig.crafterAgentId} / {crafterConfig.crafterModelId}
						</span>
						<span className="text-xs" style={{ color: theme.colors.textDim }}>
							Strategien:{' '}
							{crafterConfig.strategies
								.map((s) => RED_TEAM_STRATEGIES.find((r) => r.key === s)?.label ?? s)
								.join(', ')}
						</span>
						<span className="text-xs" style={{ color: theme.colors.textDim }}>
							Profiling: {crafterConfig.profileInstruction ? 'aktiv' : 'aus'} | Feedback-Tiefe:{' '}
							{crafterConfig.feedbackDepth}
						</span>
					</div>
				</div>
			)}

			{/* Crafter Pool */}
			{crafterAgents.length > 0 && (
				<div
					className="flex flex-col gap-2 rounded-md p-3"
					style={{
						backgroundColor: theme.colors.bgSidebar,
						border: `1px solid ${theme.colors.border}`,
					}}
				>
					<div className="flex items-center gap-2">
						<Swords size={12} style={{ color: theme.colors.warning }} />
						<span
							className="text-xs uppercase tracking-wide select-none"
							style={{ color: theme.colors.textDim }}
						>
							Crafter-Pool ({crafterAgents.length} Angreifer)
						</span>
					</div>
					<div className="flex flex-col gap-1 select-text">
						{crafterAgents.map((c) => (
							<span
								key={`${c.agentId}-${c.modelId}`}
								className="text-sm"
								style={{ color: theme.colors.textMain }}
							>
								{c.displayName ?? `${c.agentId} / ${c.modelId}`}
							</span>
						))}
					</div>
				</div>
			)}

			{/* Instructions + Variations */}
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
					Instructions + Variationen
				</span>
				<span className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
					{instructionCount} Dateien
					{variationCount > 0
						? ` + ${variationCount} Variationen (${transformCount} Transforms)`
						: ''}
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

			{/* Test-Schemata */}
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
					Test-Schemata ({schemaCount})
				</span>
				<span className="text-sm break-words select-text" style={{ color: theme.colors.textMain }}>
					{schemaList.join(', ')}
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
						{totalInputs} Inputs x {agentCount} Agents x {schemaCount} Schemata ={' '}
						<span style={{ color: theme.colors.accent }}>{taskCount} Tasks</span>
					</span>
					<span className="text-xs" style={{ color: theme.colors.textDim }}>
						{instructionCount} Basis + {variationCount} Variationen
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
