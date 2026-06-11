import type { Theme } from '../../types';
import type { PrompterRunSummary } from '../../../shared/prompter-types';

export function PrompterSummaryBar({
	theme,
	summary,
}: {
	theme: Theme;
	summary?: PrompterRunSummary;
}): JSX.Element {
	if (!summary) {
		return (
			<div
				className="select-none flex items-center gap-4 px-3 py-2 text-xs border-t"
				style={{ borderColor: theme.colors.border, color: theme.colors.textDim }}
			>
				-
			</div>
		);
	}

	return (
		<div
			className="select-none flex items-center gap-4 px-3 py-2 text-xs border-t"
			style={{ borderColor: theme.colors.border }}
		>
			<span style={{ color: theme.colors.textMain }}>
				{summary.completedTasks}/{summary.totalTasks} Tasks
			</span>

			<span className="flex items-center gap-1" style={{ color: theme.colors.textMain }}>
				<span
					className="inline-block w-2 h-2 rounded-full"
					style={{ backgroundColor: theme.colors.success }}
				/>
				{summary.green}
			</span>

			<span className="flex items-center gap-1" style={{ color: theme.colors.textMain }}>
				<span
					className="inline-block w-2 h-2 rounded-full"
					style={{ backgroundColor: theme.colors.warning }}
				/>
				{summary.yellow}
			</span>

			<span className="flex items-center gap-1" style={{ color: theme.colors.textMain }}>
				<span
					className="inline-block w-2 h-2 rounded-full"
					style={{ backgroundColor: theme.colors.error }}
				/>
				{summary.red}
			</span>

			{summary.failed > 0 && (
				<span style={{ color: theme.colors.error }}>fehlgeschlagen: {summary.failed}</span>
			)}

			{summary.skipped > 0 && (
				<span style={{ color: theme.colors.textDim }}>skip: {summary.skipped}</span>
			)}

			{summary.totalTokens > 0 && (
				<span
					className="font-mono"
					style={{ color: theme.colors.accent }}
					title={`${summary.totalTokens} tokens total, avg ${summary.avgResponseLength} chars/response`}
				>
					{summary.totalTokens >= 1000
						? `${(summary.totalTokens / 1000).toFixed(1)}k`
						: summary.totalTokens}{' '}
					tokens
				</span>
			)}

			<span className="ml-auto" style={{ color: theme.colors.textDim }}>
				{Math.round(summary.durationMs / 1000)}s
			</span>
		</div>
	);
}
