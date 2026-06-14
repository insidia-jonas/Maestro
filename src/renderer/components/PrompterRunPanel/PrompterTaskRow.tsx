import { AlertCircle, Check, Circle, Loader2, MinusCircle, X } from 'lucide-react';
import type { Theme } from '../../types';
import type { PrompterTask } from '../../../shared/prompter-types';
import { PrompterResultBadge } from './PrompterResultBadge';

function extractTransformName(filePath: string): string {
	const match = filePath.match(/tv-[^/]+-([a-z0-9-]+)\.md$/);
	return match?.[1] ?? 'variant';
}

export function PrompterTaskRow({
	theme,
	task,
}: {
	theme: Theme;
	task: PrompterTask;
}): JSX.Element {
	function renderStatusIcon(): JSX.Element {
		switch (task.status) {
			case 'running':
				return (
					<Loader2
						size={14}
						className="animate-spin shrink-0"
						style={{ color: theme.colors.accent }}
					/>
				);
			case 'completed':
				return <Check size={14} className="shrink-0" style={{ color: theme.colors.success }} />;
			case 'failed':
				return <X size={14} className="shrink-0" style={{ color: theme.colors.error }} />;
			case 'skipped':
				return (
					<MinusCircle size={14} className="shrink-0" style={{ color: theme.colors.textDim }} />
				);
			case 'pending':
			default:
				return <Circle size={14} className="shrink-0" style={{ color: theme.colors.textDim }} />;
		}
	}

	return (
		<div
			className="flex items-center gap-2 px-3 py-1.5 text-xs select-none"
			style={{ borderBottom: `1px solid ${theme.colors.border}` }}
		>
			{renderStatusIcon()}
			<span className="font-medium shrink-0" style={{ color: theme.colors.textMain }}>
				{task.agentId}
			</span>
			<span className="shrink-0" style={{ color: theme.colors.textDim }}>
				{task.schemaId}
			</span>
			<span
				className="flex-1 min-w-0 truncate select-text"
				style={{ color: theme.colors.textDim }}
				title={task.instructionFile}
			>
				{task.instructionFile}
			</span>
			{task.instructionFile.startsWith('4-advanced-tests/character-variations/tv-') && (
				<span
					className="shrink-0 rounded px-1 py-0.5 text-[10px]"
					style={{
						color: theme.colors.accentText,
						backgroundColor: `${theme.colors.accent}18`,
						border: `1px solid ${theme.colors.accentDim}`,
					}}
				>
					{extractTransformName(task.instructionFile)}
				</span>
			)}
			{task.tokenCount != null && (
				<span
					className="shrink-0 text-[10px] font-mono"
					style={{ color: theme.colors.textDim }}
					title={`${task.tokenCount} tokens, ${task.responseLength ?? 0} chars`}
				>
					{task.tokenCount >= 1000 ? `${(task.tokenCount / 1000).toFixed(1)}k` : task.tokenCount}t
				</span>
			)}
			{task.complianceScore != null && (
				<span
					className="shrink-0 text-[10px] font-mono rounded px-1 py-0.5"
					style={{
						color:
							task.complianceScore >= 0.7
								? theme.colors.warning
								: task.complianceScore >= 0.4
									? theme.colors.accent
									: theme.colors.textDim,
						backgroundColor:
							task.complianceScore >= 0.7
								? `${theme.colors.warning}18`
								: task.complianceScore >= 0.4
									? `${theme.colors.accent}18`
									: 'transparent',
					}}
					title={`Compliance Score: ${Math.round(task.complianceScore * 100)}%`}
				>
					{Math.round(task.complianceScore * 100)}%
				</span>
			)}
			{task.result ? <PrompterResultBadge theme={theme} band={task.result} size="sm" /> : null}
			{task.error ? (
				<span className="shrink-0 inline-flex" title={task.error}>
					<AlertCircle size={13} style={{ color: theme.colors.error }} />
				</span>
			) : null}
		</div>
	);
}
