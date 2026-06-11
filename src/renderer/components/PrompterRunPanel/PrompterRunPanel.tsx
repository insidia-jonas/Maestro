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

import type { Theme } from '../../types';
import { ShieldCheck } from 'lucide-react';
import { usePrompterStore, selectActiveRun } from '../../stores/prompterStore';
import { PrompterTimeline } from './PrompterTimeline';
import { PrompterTaskList } from './PrompterTaskList';
import { PrompterCompactLog } from './PrompterCompactLog';
import { PrompterControls } from './PrompterControls';
import { PrompterSummaryBar } from './PrompterSummaryBar';

interface PrompterRunPanelProps {
	theme: Theme;
}

export function PrompterRunPanel({ theme }: PrompterRunPanelProps): JSX.Element | null {
	const run = usePrompterStore(selectActiveRun);
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
						Prompt Safety Lab
					</span>
					<span className="text-xs font-mono" style={{ color: theme.colors.textDim }}>
						{run.id}
					</span>
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

			{/* Collapsible compact log */}
			<PrompterCompactLog theme={theme} />

			{/* Summary bar (always visible) */}
			<PrompterSummaryBar theme={theme} summary={run.summary} />
		</div>
	);
}
