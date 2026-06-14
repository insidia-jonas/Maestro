/**
 * PrompterRunPanel - main container for a live Prompter run. Colour-offset from
 * the normal workspace (bgActivity), compact layout: a horizontal phase
 * timeline, a scrollable task list, a collapsible compact log (collapsed by
 * default), run controls, and an always-visible summary bar at the bottom.
 *
 * Reads the active run from the prompterStore; renders nothing when idle.
 *
 * Playbook reference: section 6 (run panel), Task G.
 */

import { useMemo } from 'react';
import type { Theme } from '../../types';
import { ShieldCheck } from 'lucide-react';
import {
	usePrompterStore,
	selectActiveRun,
	selectActiveCampaign,
} from '../../stores/prompterStore';
import { PrompterTimeline } from './PrompterTimeline';
import { PrompterTaskList } from './PrompterTaskList';
import { PrompterCompactLog } from './PrompterCompactLog';
import { PrompterControls } from './PrompterControls';
import { PrompterSummaryBar } from './PrompterSummaryBar';
import { PrompterRobustnessPanel } from './PrompterRobustnessPanel';
import { PrompterConsistencyMatrix } from './PrompterConsistencyMatrix';
import { PrompterHardeningPanel } from './PrompterHardeningPanel';
import { PrompterTestMetricsPanel } from './PrompterTestMetricsPanel';
import { PrompterCampaignPanel } from './PrompterCampaignPanel';
import { PrompterCampaignCreator } from './PrompterCampaignCreator';
import { PrompterInjectionBuilderPanel } from './PrompterInjectionBuilderPanel';
import { PrompterSearchPathPanel } from './PrompterSearchPathPanel';
import { PrompterWeaknessExportPanel } from './PrompterWeaknessExportPanel';
import { PrompterHardenedNotice } from './PrompterHardenedNotice';

interface PrompterRunPanelProps {
	theme: Theme;
}

export function PrompterRunPanel({ theme }: PrompterRunPanelProps): JSX.Element | null {
	const run = usePrompterStore(selectActiveRun);
	const campaign = usePrompterStore(selectActiveCampaign);
	// Campaign context is derived from the active run (always present when this
	// panel renders), NOT from wizard state. resetWizard() clears createdProject
	// and agentConfigs right after the wizard finishes, which left the campaign
	// creator with projectRoot=null / agents=[] and made it silently disappear
	// (CampaignCreator returns null in that case).
	const projectRoot = run?.projectRoot ?? null;
	const agents = useMemo(() => run?.agents ?? [], [run]);

	// Hooks must run unconditionally (before any early return).
	const progress = useMemo(() => {
		if (!run) return { completed: 0, total: 0, pct: 0, greenRate: 0 };
		const completed = run.tasks.filter(
			(t) => t.status === 'completed' || t.status === 'failed'
		).length;
		const total = run.tasks.length;
		const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
		const greenRate = run.summary
			? Math.round((run.summary.green / Math.max(1, run.summary.completedTasks)) * 100)
			: 0;
		return { completed, total, pct, greenRate };
	}, [run]);

	if (!run) return null;

	return (
		<div
			className="flex flex-1 min-h-0 flex-col rounded-lg overflow-hidden select-none"
			style={{
				backgroundColor: theme.colors.bgActivity,
				border: `1px solid ${theme.colors.border}`,
			}}
		>
			{/* Header */}
			<div
				className="flex items-center justify-between px-3 py-2"
				style={{ borderBottom: `1px solid ${theme.colors.border}` }}
			>
				<div className="flex items-center gap-2">
					<ShieldCheck className="w-4 h-4" style={{ color: theme.colors.accent }} />
					<span className="text-sm font-semibold" style={{ color: theme.colors.textMain }}>
						Power Lab
					</span>
					<span
						className="text-xs font-mono rounded px-1.5 py-0.5"
						style={{
							color: theme.colors.textMain,
							backgroundColor: theme.colors.bgSidebar,
							border: `1px solid ${theme.colors.border}`,
						}}
					>
						{progress.completed}/{progress.total} ({progress.pct}%)
					</span>
					{progress.greenRate > 0 && (
						<span
							className="flex items-center gap-1 text-xs font-medium rounded px-1.5 py-0.5"
							style={{
								color: progress.greenRate >= 70 ? theme.colors.success : theme.colors.warning,
								backgroundColor: theme.colors.bgSidebar,
							}}
						>
							<ShieldCheck size={11} />
							{progress.greenRate}% stabil
						</span>
					)}
				</div>
				<PrompterControls theme={theme} run={run} />
			</div>

			{/* Timeline */}
			<div className="px-3 py-2" style={{ borderBottom: `1px solid ${theme.colors.border}` }}>
				<PrompterTimeline theme={theme} phase={run.phase} status={run.status} />
			</div>

			{/* Task list (scrollable) */}
			<div className="flex-1 overflow-y-auto min-h-0">
				<PrompterTaskList theme={theme} tasks={run.tasks} />
			</div>

			{/* Robustness findings (after completion): where variations broke understanding/boundaries */}
			<PrompterRobustnessPanel theme={theme} run={run} />

			{/* Refusal-consistency heatmap (models x transform classes) */}
			<PrompterConsistencyMatrix theme={theme} run={run} />

			{/* Adversarial test metrics (for model evaluation research) */}
			<PrompterTestMetricsPanel theme={theme} run={run} />

			{/* Search path visualization (schema → technique tree) */}
			<PrompterSearchPathPanel theme={theme} run={run} />

			{/* Test refinement assistant (injection builder) */}
			<PrompterInjectionBuilderPanel theme={theme} run={run} />

			{/* Weakness database with structured export */}
			<PrompterWeaknessExportPanel theme={theme} run={run} />

			{/* Benign hardening / quality suggestions for the instruction wording */}
			<PrompterHardeningPanel theme={theme} run={run} />

			{/* Auto-generated hardened instruction notice (post-run) */}
			<PrompterHardenedNotice theme={theme} run={run} />

			{/* Campaign creator stays available so each new start creates a separate Campaign entry. */}
			<PrompterCampaignCreator theme={theme} projectRoot={projectRoot} agents={agents} />

			{/* Autonomous campaign dashboard (when a campaign is active) */}
			<PrompterCampaignPanel theme={theme} campaign={campaign} />

			{/* Collapsible compact log */}
			<PrompterCompactLog theme={theme} />

			{/* Summary bar (always visible) */}
			<PrompterSummaryBar theme={theme} summary={run.summary} />
		</div>
	);
}
