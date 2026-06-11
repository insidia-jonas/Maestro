import { AlertCircle, Check, Circle, Loader2, MinusCircle, X } from 'lucide-react';
import type { Theme } from '../../types';
import type { PrompterTask } from '../../../shared/prompter-types';
import { PrompterResultBadge } from './PrompterResultBadge';

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
			{task.result ? <PrompterResultBadge theme={theme} band={task.result} size="sm" /> : null}
			{task.error ? (
				<span className="shrink-0 inline-flex" title={task.error}>
					<AlertCircle size={13} style={{ color: theme.colors.error }} />
				</span>
			) : null}
		</div>
	);
}
