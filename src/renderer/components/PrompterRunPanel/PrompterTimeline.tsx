import { ChevronRight } from 'lucide-react';
import type { Theme } from '../../types';
import type { PrompterRunPhase, PrompterRunStatus } from '../../../shared/prompter-types';

const PHASE_ORDER: PrompterRunPhase[] = [
	'scaffold',
	'baseline',
	'provider-config',
	'schema-test',
	'evaluate',
	'write-results',
	'report',
];

const PHASE_LABELS: Record<PrompterRunPhase, string> = {
	scaffold: 'Scaffold',
	baseline: 'Baseline',
	'provider-config': 'Provider',
	'schema-test': 'Schema-Test',
	evaluate: 'Evaluate',
	'write-results': 'Ergebnisse',
	report: 'Report',
};

const STATUS_LABELS: Record<PrompterRunStatus, string> = {
	planned: 'Geplant',
	preparing: 'Vorbereitung',
	running: 'Laeuft',
	paused: 'Pausiert',
	stopping: 'Stoppt',
	completed: 'Fertig',
	failed: 'Fehler',
};

function statusColor(theme: Theme, status: PrompterRunStatus): string {
	switch (status) {
		case 'running':
		case 'preparing':
			return theme.colors.accent;
		case 'paused':
			return theme.colors.warning;
		case 'completed':
			return theme.colors.success;
		case 'stopping':
		case 'failed':
			return theme.colors.error;
		default:
			return theme.colors.textDim;
	}
}

export function PrompterTimeline({
	theme,
	phase,
	status,
}: {
	theme: Theme;
	phase: PrompterRunPhase;
	status: PrompterRunStatus;
}): JSX.Element {
	const activeIndex = PHASE_ORDER.indexOf(phase);
	const pillColor = statusColor(theme, status);

	return (
		<div className="flex flex-wrap items-center gap-x-1 gap-y-1 select-none text-xs">
			{PHASE_ORDER.map((p, index) => {
				const isActive = index === activeIndex;
				const isPast = activeIndex >= 0 && index < activeIndex;
				const labelColor = isActive
					? theme.colors.accent
					: isPast
						? theme.colors.textMain
						: theme.colors.textDim;

				return (
					<div key={p} className="flex items-center gap-x-1">
						<span
							className="rounded px-1.5 py-0.5 whitespace-nowrap"
							style={{
								color: labelColor,
								backgroundColor: isActive ? `${theme.colors.accent}22` : 'transparent',
								fontWeight: isActive ? 600 : 400,
							}}
						>
							{PHASE_LABELS[p]}
						</span>
						{index < PHASE_ORDER.length - 1 && (
							<ChevronRight
								size={12}
								style={{ color: theme.colors.textDim }}
								className="shrink-0"
							/>
						)}
					</div>
				);
			})}

			<span
				className="ml-1 rounded-full px-2 py-0.5 whitespace-nowrap"
				style={{
					color: pillColor,
					backgroundColor: `${pillColor}22`,
					fontWeight: 600,
				}}
			>
				{STATUS_LABELS[status]}
			</span>
		</div>
	);
}
