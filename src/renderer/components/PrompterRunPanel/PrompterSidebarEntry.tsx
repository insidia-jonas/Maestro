/**
 * PrompterSidebarEntry - a left-bar entry for the active Prompter run, shown the
 * way group chats are: a clickable row that opens the run in the center
 * workspace. Reads the prompterStore directly (no prop threading), like
 * GroupChatList reads the group chat store. Renders nothing when no run is active.
 */

import { ShieldCheck } from 'lucide-react';
import type { Theme } from '../../types';
import { usePrompterStore } from '../../stores/prompterStore';

export function PrompterSidebarEntry({ theme }: { theme: Theme }): JSX.Element | null {
	const activeRun = usePrompterStore((s) => s.activeRun);
	const focused = usePrompterStore((s) => s.prompterFocused);
	if (!activeRun) return null;

	const summary = activeRun.summary;
	const statusColor =
		activeRun.status === 'running'
			? theme.colors.accent
			: activeRun.status === 'completed'
				? theme.colors.success
				: activeRun.status === 'paused'
					? theme.colors.warning
					: activeRun.status === 'failed' || activeRun.status === 'stopping'
						? theme.colors.error
						: theme.colors.textDim;

	const done = summary ? summary.completedTasks + summary.failed + summary.skipped : 0;
	const total = summary?.totalTasks ?? activeRun.tasks.length;

	return (
		<button
			type="button"
			onClick={() => usePrompterStore.getState().focusPrompterRun()}
			title="Prompt Power Lab im Center oeffnen"
			className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors select-none"
			style={{
				backgroundColor: focused ? `${theme.colors.accent}22` : 'transparent',
				border: `1px solid ${focused ? theme.colors.accent : theme.colors.border}`,
			}}
		>
			<ShieldCheck className="w-4 h-4 shrink-0" style={{ color: theme.colors.accent }} />
			<div className="flex-1 min-w-0">
				<div className="text-sm font-medium truncate" style={{ color: theme.colors.textMain }}>
					Prompt Power Lab
				</div>
				<div className="text-xs truncate" style={{ color: theme.colors.textDim }}>
					{done}/{total} Tasks
					{summary ? ` · ${summary.green}/${summary.yellow}/${summary.red}` : ''}
				</div>
			</div>
			<span
				className="text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0"
				style={{ color: statusColor, border: `1px solid ${statusColor}` }}
			>
				{activeRun.status}
			</span>
		</button>
	);
}
