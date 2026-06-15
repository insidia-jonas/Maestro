/**
 * PrompterLabSection - the Left Bar entry point for the Prompt Power & Robustness
 * Lab. Separates the three concepts the lab produces into their own groups so they
 * no longer pile up under one heading:
 *
 *   - Tests  : individual runs (fixed prompt against character variations).
 *   - Kampagnen: autonomous, AI-driven discovery campaigns.
 *   - Logs   : per-run evidence/log folder (opened via the folder button).
 *
 * Reads the prompterStore directly (no prop threading), like PrompterSidebarEntry
 * and GroupChatList do. Renders nothing when the lab has no runs and no campaigns,
 * so it stays invisible for users who never open it.
 */

import { ShieldCheck, FlaskConical, FolderOpen, Plus, X } from 'lucide-react';
import type { Theme } from '../../types';
import type { Campaign, PrompterRun } from '../../../shared/prompter-types';
import { getBasename } from '../../../shared/formatters';
import { usePrompterStore, selectRunHistory, selectActiveRun } from '../../stores/prompterStore';
import { selectCampaignHistory, selectActiveCampaign } from '../../stores/prompterStore';
import { useModalStore } from '../../stores/modalStore';

function statusColor(theme: Theme, status: string): string {
	switch (status) {
		case 'running':
			return theme.colors.accent;
		case 'completed':
			return theme.colors.success;
		case 'paused':
			return theme.colors.warning;
		case 'failed':
		case 'stopping':
			return theme.colors.error;
		default:
			return theme.colors.textDim;
	}
}

function runLabel(run: PrompterRun): string {
	const project = run.projectRoot ? getBasename(run.projectRoot) : 'lab';
	return `${project} · ${run.id.slice(0, 6)}`;
}

function openRunLogs(run: PrompterRun): void {
	if (!run.projectRoot) return;
	void window.maestro.prompter.openProjectFolder(
		`${run.projectRoot}/3-temp-results/runs/${run.id}`
	);
}

export function PrompterLabSection({ theme }: { theme: Theme }): JSX.Element | null {
	const runHistory = usePrompterStore(selectRunHistory);
	const activeRun = usePrompterStore(selectActiveRun);
	const focused = usePrompterStore((s) => s.prompterFocused);
	const campaignHistory = usePrompterStore(selectCampaignHistory);
	const activeCampaign = usePrompterStore(selectActiveCampaign);

	const setActiveRun = usePrompterStore((s) => s.setActiveRun);
	const setActiveCampaign = usePrompterStore((s) => s.setActiveCampaign);
	const dismissCampaign = usePrompterStore((s) => s.dismissCampaign);
	const focusPrompterRun = usePrompterStore((s) => s.focusPrompterRun);

	if (runHistory.length === 0 && campaignHistory.length === 0 && !activeRun) {
		return null;
	}

	const openRun = (run: PrompterRun): void => {
		setActiveRun(run);
		focusPrompterRun();
	};
	const openCampaign = (campaign: Campaign): void => {
		setActiveCampaign(campaign);
		focusPrompterRun();
	};
	const newTest = (): void => {
		useModalStore.getState().openModal('prompter');
	};

	return (
		<div className="flex flex-col gap-1 px-1 pb-2 select-none">
			{/* Section header */}
			<div className="flex items-center gap-1 px-1">
				<ShieldCheck className="w-3 h-3" style={{ color: theme.colors.accent }} />
				<span className="text-[10px] font-medium" style={{ color: theme.colors.accent }}>
					Prompt Power Lab
				</span>
				<button
					type="button"
					onClick={newTest}
					title="Neuen Test starten (Wizard)"
					className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
					style={{ color: theme.colors.accent, border: `1px solid ${theme.colors.accent}40` }}
				>
					<Plus className="w-3 h-3" />
					Test
				</button>
			</div>

			{/* Tests (runs) */}
			{(runHistory.length > 0 || activeRun) && (
				<div className="flex flex-col gap-0.5">
					<span
						className="px-1 text-[9px] uppercase tracking-wide"
						style={{ color: theme.colors.textDim }}
					>
						Tests
					</span>
					{runHistory.map((run) => {
						const isOpen = focused && activeRun?.id === run.id;
						const s = run.summary;
						return (
							<div
								key={run.id}
								className="group flex items-center gap-1 rounded transition-colors hover:bg-white/5"
								style={{ backgroundColor: isOpen ? `${theme.colors.accent}18` : 'transparent' }}
							>
								<button
									type="button"
									onClick={() => openRun(run)}
									className="min-w-0 flex-1 flex items-center gap-2 px-2 py-1 text-left text-xs"
									style={{ color: theme.colors.textMain }}
									title={`Test oeffnen: ${run.id}`}
								>
									<FlaskConical
										className="w-3 h-3 shrink-0"
										style={{ color: statusColor(theme, run.status) }}
									/>
									<span className="truncate flex-1">{runLabel(run)}</span>
									{s && (
										<span
											className="text-[10px] tabular-nums shrink-0"
											style={{ color: theme.colors.textDim }}
										>
											{s.green}/{s.yellow}/{s.red}
										</span>
									)}
								</button>
								<button
									type="button"
									onClick={() => openRunLogs(run)}
									title="Logs / Evidence-Ordner oeffnen"
									className="shrink-0 rounded p-1 opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
									style={{ color: theme.colors.textDim }}
								>
									<FolderOpen className="w-3 h-3" />
								</button>
							</div>
						);
					})}
				</div>
			)}

			{/* Kampagnen */}
			{campaignHistory.length > 0 && (
				<div className="flex flex-col gap-0.5">
					<span
						className="px-1 text-[9px] uppercase tracking-wide"
						style={{ color: theme.colors.textDim }}
					>
						Kampagnen
					</span>
					{campaignHistory.map((campaign) => {
						const isOpen = activeCampaign?.id === campaign.id;
						const locked = campaign.status === 'running' || campaign.status === 'paused';
						return (
							<div
								key={campaign.id}
								className="group flex items-center gap-1 rounded transition-colors hover:bg-white/5"
								style={{ backgroundColor: isOpen ? `${theme.colors.accent}18` : 'transparent' }}
							>
								<button
									type="button"
									onClick={() => openCampaign(campaign)}
									className="min-w-0 flex-1 flex items-center gap-2 px-2 py-1 text-left text-xs"
									style={{ color: theme.colors.textMain }}
									title={`Kampagne oeffnen: ${campaign.config.name || campaign.id}`}
								>
									<ShieldCheck
										className="w-3 h-3 shrink-0"
										style={{ color: statusColor(theme, campaign.status) }}
									/>
									<span className="truncate flex-1">{campaign.config.name || campaign.id}</span>
									<span className="text-[10px] opacity-60 tabular-nums shrink-0">
										{campaign.status}
									</span>
								</button>
								<button
									type="button"
									onClick={(event) => {
										event.stopPropagation();
										dismissCampaign(campaign.id);
									}}
									disabled={locked}
									title={locked ? 'Erst stoppen, dann ausblenden' : 'Kampagne ausblenden'}
									className="shrink-0 rounded p-1 transition-opacity hover:opacity-100"
									style={{
										color: theme.colors.textDim,
										opacity: locked ? 0.25 : 0.6,
										cursor: locked ? 'not-allowed' : 'pointer',
									}}
								>
									<X className="w-3 h-3" />
								</button>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
