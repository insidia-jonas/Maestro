/**
 * TargetModelsStep - wizard step for declaring which agent + model combos
 * are the test targets of this Prompter project.
 *
 * Shows ALL detected agents with ALL their available models (via agent
 * detection + model discovery), not just the already-configured executors.
 * Configured executor agents are pre-selected and marked with an "Executor"
 * badge. The user can add any other agent+model combination as a target.
 *
 * For security research and model safety evaluation only.
 */

import { useState, useEffect, useCallback } from 'react';
import { Target, Star, Info, ChevronDown, ChevronRight, Loader2, Swords, Zap } from 'lucide-react';
import type { Theme } from '../../types';
import { usePrompterStore } from '../../stores/prompterStore';
import { getAgentDisplayName } from '../../../shared/agentMetadata';
import type { TestTarget, PrompterModelOption } from '../../../shared/prompter-types';

interface AgentGroup {
	agentId: string;
	displayName: string;
	available: boolean;
	models: PrompterModelOption[];
	loading: boolean;
}

export function TargetModelsStep({ theme }: { theme: Theme }): JSX.Element {
	const selectedAgents = usePrompterStore((s) => s.selectedAgents);
	const agentConfigs = usePrompterStore((s) => s.agentConfigs);
	const testTargets = usePrompterStore((s) => s.testTargets);
	const toggleTestTarget = usePrompterStore((s) => s.toggleTestTarget);
	const setPrimaryTarget = usePrompterStore((s) => s.setPrimaryTarget);
	const setTestTargets = usePrompterStore((s) => s.setTestTargets);
	const crafterAgents = usePrompterStore((s) => s.crafterAgents);
	const toggleCrafterAgent = usePrompterStore((s) => s.toggleCrafterAgent);
	const [showCrafterPool, setShowCrafterPool] = useState(crafterAgents.length > 0);

	const [agentGroups, setAgentGroups] = useState<AgentGroup[]>([]);
	const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
	const [initialLoading, setInitialLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;

		async function loadAgents(): Promise<void> {
			try {
				const detected = await window.maestro.agents.detect();
				if (cancelled) return;

				const groups: AgentGroup[] = detected
					.filter((a) => a.available)
					.map((a) => ({
						agentId: a.id,
						displayName: a.name || getAgentDisplayName(a.id),
						available: a.available,
						models: [],
						loading: true,
					}));

				setAgentGroups(groups);
				setInitialLoading(false);

				const executorIds = new Set(selectedAgents.map((a) => a.agentId));
				setExpandedAgents(new Set(executorIds));

				for (const group of groups) {
					if (cancelled) return;
					try {
						const models = await window.maestro.prompter.getAgentModelOptions(group.agentId);
						if (cancelled) return;
						setAgentGroups((prev) =>
							prev.map((g) =>
								g.agentId === group.agentId
									? { ...g, models, loading: false }
									: g
							)
						);
					} catch {
						if (cancelled) return;
						setAgentGroups((prev) =>
							prev.map((g) =>
								g.agentId === group.agentId
									? { ...g, loading: false }
									: g
							)
						);
					}
				}

				if (!cancelled && testTargets.length === 0) {
					const autoTargets: TestTarget[] = [];
					for (const agent of selectedAgents) {
						const config = agentConfigs.get(agent.agentId);
						if (config?.modelId) {
							autoTargets.push({
								agentId: agent.agentId,
								modelId: config.modelId,
								displayName: `${getAgentDisplayName(agent.agentId)} (${config.modelId})`,
								isPrimary: autoTargets.length === 0,
								isExecutor: true,
							});
						}
					}
					if (autoTargets.length > 0) setTestTargets(autoTargets);
				}
			} catch {
				if (!cancelled) setInitialLoading(false);
			}
		}

		void loadAgents();
		return () => { cancelled = true; };
	}, []);  

	const isSelected = useCallback(
		(agentId: string, modelId: string): boolean =>
			testTargets.some((t) => t.agentId === agentId && t.modelId === modelId),
		[testTargets]
	);

	const isPrimary = useCallback(
		(agentId: string, modelId: string): boolean =>
			testTargets.some((t) => t.agentId === agentId && t.modelId === modelId && t.isPrimary),
		[testTargets]
	);

	const isExecutor = useCallback(
		(agentId: string, modelId: string): boolean => {
			const config = agentConfigs.get(agentId);
			return config?.modelId === modelId && selectedAgents.some((a) => a.agentId === agentId);
		},
		[agentConfigs, selectedAgents]
	);

	const isCrafterSelected = useCallback(
		(agentId: string, modelId: string): boolean =>
			crafterAgents.some((c) => c.agentId === agentId && c.modelId === modelId),
		[crafterAgents]
	);

	const handleToggle = (agentId: string, modelId: string): void => {
		const displayName = `${getAgentDisplayName(agentId)} (${modelId})`;
		toggleTestTarget({
			agentId,
			modelId,
			displayName,
			isExecutor: isExecutor(agentId, modelId),
		});
	};

	const handleToggleCrafter = (agentId: string, modelId: string): void => {
		const displayName = `${getAgentDisplayName(agentId)} (${modelId})`;
		toggleCrafterAgent({ agentId, modelId, displayName });
	};

	const handleSelectAll = (): void => {
		const allTargets: TestTarget[] = [];
		for (const group of agentGroups) {
			for (const model of group.models) {
				allTargets.push({
					agentId: group.agentId,
					modelId: model.id,
					displayName: `${group.displayName} (${model.id})`,
					isPrimary: allTargets.length === 0,
					isExecutor: isExecutor(group.agentId, model.id),
				});
			}
		}
		if (allTargets.length > 0) setTestTargets(allTargets);
	};

	const toggleExpand = (agentId: string): void => {
		setExpandedAgents((prev) => {
			const next = new Set(prev);
			if (next.has(agentId)) next.delete(agentId);
			else next.add(agentId);
			return next;
		});
	};

	const selectedCountForAgent = (agentId: string): number =>
		testTargets.filter((t) => t.agentId === agentId).length;

	if (initialLoading) {
		return (
			<div className="flex items-center justify-center gap-2 py-12">
				<Loader2 size={18} className="animate-spin" style={{ color: theme.colors.accent }} />
				<span className="text-sm" style={{ color: theme.colors.textDim }}>
					Agents und Modelle werden erkannt...
				</span>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4 select-none">
			<div className="flex items-center justify-between gap-3">
				<div className="flex flex-col gap-1">
					<div className="flex items-center gap-2">
						<Target size={18} style={{ color: theme.colors.accent }} />
						<h2 className="text-lg font-semibold" style={{ color: theme.colors.textMain }}>
							Ziel-Modelle
						</h2>
					</div>
					<p className="text-sm" style={{ color: theme.colors.textDim }}>
						Gegen welche Modelle sollen die Injection-Tests laufen?
					</p>
				</div>
				<button
					type="button"
					onClick={handleSelectAll}
					className="rounded-md px-3 py-1.5 text-sm font-medium"
					style={{
						backgroundColor: theme.colors.accent,
						color: theme.colors.accentForeground,
					}}
				>
					Alle
				</button>
			</div>

			<div
				className="flex items-start gap-2 rounded-md p-3"
				style={{
					backgroundColor: `${theme.colors.accent}0d`,
					border: `1px solid ${theme.colors.accent}33`,
				}}
			>
				<Info size={14} className="shrink-0 mt-0.5" style={{ color: theme.colors.accent }} />
				<span className="text-xs" style={{ color: theme.colors.textDim }}>
					Waehle beliebige Agent+Modell-Kombinationen als Test-Ziele, auch andere als die
					konfigurierten Executors. Executor-Targets sind vorausgewaehlt und mit Badge markiert.
				</span>
			</div>

			<div className="flex flex-col gap-1 overflow-y-auto" style={{ maxHeight: 360 }}>
				{agentGroups.map((group) => {
					const expanded = expandedAgents.has(group.agentId);
					const selCount = selectedCountForAgent(group.agentId);

					return (
						<div key={group.agentId}>
							<button
								type="button"
								onClick={() => toggleExpand(group.agentId)}
								className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors"
								style={{
									backgroundColor: expanded ? theme.colors.bgSidebar : 'transparent',
								}}
							>
								{expanded ? (
									<ChevronDown size={14} style={{ color: theme.colors.textDim }} />
								) : (
									<ChevronRight size={14} style={{ color: theme.colors.textDim }} />
								)}
								<span className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
									{group.displayName}
								</span>
								<span className="text-xs" style={{ color: theme.colors.textDim }}>
									{group.loading
										? 'laden...'
										: `${group.models.length} Modelle`}
								</span>
								{selCount > 0 && (
									<span
										className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium"
										style={{
											backgroundColor: theme.colors.accent,
											color: theme.colors.accentForeground,
										}}
									>
										{selCount}
									</span>
								)}
							</button>

							{expanded && (
								<div className="ml-6 flex flex-col gap-1 pb-2">
									{group.loading ? (
										<div className="flex items-center gap-2 px-3 py-2">
											<Loader2 size={12} className="animate-spin" style={{ color: theme.colors.textDim }} />
											<span className="text-xs" style={{ color: theme.colors.textDim }}>Modelle laden...</span>
										</div>
									) : group.models.length === 0 ? (
										<span className="px-3 py-2 text-xs" style={{ color: theme.colors.textDim }}>
											Keine Modelle verfuegbar
										</span>
									) : (
										group.models.map((model) => {
											const selected = isSelected(group.agentId, model.id);
											const primary = isPrimary(group.agentId, model.id);
											const executor = isExecutor(group.agentId, model.id);

											return (
												<div
													key={model.id}
													className="flex items-center gap-3 rounded-md border px-3 py-2 transition-colors"
													style={{
														borderColor: selected ? theme.colors.accent : theme.colors.border,
														backgroundColor: selected ? theme.colors.accentDim : theme.colors.bgActivity,
													}}
												>
													<button
														type="button"
														onClick={() => handleToggle(group.agentId, model.id)}
														className="flex min-w-0 flex-1 items-center gap-3 text-left"
													>
														<div
															className="flex h-4 w-4 shrink-0 items-center justify-center rounded border"
															style={{
																borderColor: selected ? theme.colors.accent : theme.colors.border,
																backgroundColor: selected ? theme.colors.accent : 'transparent',
															}}
														>
															{selected && (
																<svg width="10" height="10" viewBox="0 0 12 12">
																	<path
																		d="M2.5 6L5 8.5L9.5 3.5"
																		stroke={theme.colors.accentForeground}
																		strokeWidth="2"
																		fill="none"
																		strokeLinecap="round"
																		strokeLinejoin="round"
																	/>
																</svg>
															)}
														</div>

														<span
															className="text-xs font-mono truncate"
															style={{ color: theme.colors.textMain }}
														>
															{model.label || model.id}
														</span>

														{executor && (
															<span
																className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium"
																style={{
																	backgroundColor: theme.colors.accent,
																	color: theme.colors.accentForeground,
																}}
															>
																Executor
															</span>
														)}
													</button>

													{selected && (
														<button
															type="button"
															onClick={() => setPrimaryTarget(group.agentId, model.id)}
															title="Als primaeres Ziel markieren"
															className="shrink-0 rounded p-1 transition-colors"
															style={{
																color: primary ? theme.colors.warning : theme.colors.textDim,
															}}
														>
															<Star size={14} fill={primary ? theme.colors.warning : 'none'} />
														</button>
													)}
												</div>
											);
										})
									)}
								</div>
							)}
						</div>
					);
				})}
			</div>

			{testTargets.length === 0 && (
				<p className="text-xs" style={{ color: theme.colors.error }}>
					Mindestens 1 Ziel-Modell muss ausgewaehlt werden.
				</p>
			)}

			{/* Crafter Pool (Attacker Side) */}
			<div
				className="flex flex-col gap-2 rounded-md p-3 mt-2"
				style={{
					backgroundColor: `${theme.colors.warning}0a`,
					border: `1px solid ${theme.colors.warning}33`,
				}}
			>
				<button
					type="button"
					onClick={() => setShowCrafterPool((o) => !o)}
					className="flex items-center gap-2 text-left"
				>
					{showCrafterPool ? (
						<ChevronDown size={14} style={{ color: theme.colors.warning }} />
					) : (
						<ChevronRight size={14} style={{ color: theme.colors.warning }} />
					)}
					<Swords size={14} style={{ color: theme.colors.warning }} />
					<span className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
						Crafter-Pool (Angreifer)
					</span>
					<Zap size={10} style={{ color: theme.colors.warning }} />
					{crafterAgents.length > 0 && (
						<span
							className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium"
							style={{
								backgroundColor: theme.colors.warning,
								color: theme.colors.bgMain,
							}}
						>
							{crafterAgents.length}
						</span>
					)}
				</button>

				{showCrafterPool && (
					<>
						<p className="text-xs" style={{ color: theme.colors.textDim }}>
							Optionaler Pool von Crafter-Agents, die als Angreifer den Test-Prompt intelligent
							modifizieren. Bei mehreren Craftern werden diese pro Task aus dem Pool zugewiesen.
							For security research and model evaluation only.
						</p>
						<div className="flex flex-col gap-1 overflow-y-auto" style={{ maxHeight: 200 }}>
							{agentGroups.map((group) =>
								group.loading ? null : (
									<div key={`crafter-${group.agentId}`} className="flex flex-col gap-1">
										<span className="text-xs font-medium px-2 pt-1" style={{ color: theme.colors.textDim }}>
											{group.displayName}
										</span>
										{group.models.map((model) => {
											const selected = isCrafterSelected(group.agentId, model.id);
											return (
												<button
													key={`crafter-${group.agentId}-${model.id}`}
													type="button"
													onClick={() => handleToggleCrafter(group.agentId, model.id)}
													className="flex items-center gap-3 rounded-md border px-3 py-1.5 text-left transition-colors ml-2"
													style={{
														borderColor: selected ? theme.colors.warning : theme.colors.border,
														backgroundColor: selected ? `${theme.colors.warning}15` : theme.colors.bgActivity,
													}}
												>
													<div
														className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border"
														style={{
															borderColor: selected ? theme.colors.warning : theme.colors.border,
															backgroundColor: selected ? theme.colors.warning : 'transparent',
														}}
													>
														{selected && (
															<svg width="8" height="8" viewBox="0 0 12 12">
																<path d="M2.5 6L5 8.5L9.5 3.5" stroke={theme.colors.bgMain} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
															</svg>
														)}
													</div>
													<span className="text-xs font-mono truncate" style={{ color: theme.colors.textMain }}>
														{model.label || model.id}
													</span>
													<Swords size={10} style={{ color: selected ? theme.colors.warning : theme.colors.textDim }} />
												</button>
											);
										})}
									</div>
								)
							)}
						</div>
					</>
				)}
			</div>
		</div>
	);
}
