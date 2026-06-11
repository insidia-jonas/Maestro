import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Theme } from '../../types';
import { usePrompterStore } from '../../stores/prompterStore';
import type { PrompterLogEvent } from '../../../shared/prompter-types';

type LogFilter = 'all' | 'info' | 'warn' | 'error';

const FILTER_OPTIONS: { id: LogFilter; label: string }[] = [
	{ id: 'all', label: 'Alle' },
	{ id: 'info', label: 'Info' },
	{ id: 'warn', label: 'Warn' },
	{ id: 'error', label: 'Error' },
];

function dotColor(level: PrompterLogEvent['level'], theme: Theme): string {
	if (level === 'warn') return theme.colors.warning;
	if (level === 'error') return theme.colors.error;
	return theme.colors.textDim;
}

export function PrompterCompactLog({ theme }: { theme: Theme }): JSX.Element {
	const [open, setOpen] = useState(false);

	const compactLog = usePrompterStore((s) => s.compactLog);
	const logFilter = usePrompterStore((s) => s.logFilter);
	const setLogFilter = usePrompterStore((s) => s.setLogFilter);

	const filtered =
		logFilter === 'all' ? compactLog : compactLog.filter((e) => e.level === logFilter);

	return (
		<div className="select-none border-t" style={{ borderColor: theme.colors.border }}>
			<button
				type="button"
				onClick={() => setOpen((prev) => !prev)}
				className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs"
				style={{ color: theme.colors.textMain }}
			>
				{open ? (
					<ChevronDown size={14} style={{ color: theme.colors.textDim }} />
				) : (
					<ChevronRight size={14} style={{ color: theme.colors.textDim }} />
				)}
				<span className="font-medium">Log</span>
				<span style={{ color: theme.colors.textDim }}>{compactLog.length}</span>
			</button>

			{open && (
				<div className="px-3 pb-2">
					<div className="mb-1.5 flex items-center gap-1">
						{FILTER_OPTIONS.map((opt) => {
							const active = logFilter === opt.id;
							return (
								<button
									key={opt.id}
									type="button"
									onClick={() => setLogFilter(opt.id)}
									className="rounded px-2 py-0.5 text-xs"
									style={{
										backgroundColor: active ? theme.colors.accent : 'transparent',
										color: active ? theme.colors.accentForeground : theme.colors.textDim,
										border: `1px solid ${active ? theme.colors.accent : theme.colors.border}`,
									}}
								>
									{opt.label}
								</button>
							);
						})}
					</div>

					{filtered.length === 0 ? (
						<div className="py-2 text-xs" style={{ color: theme.colors.textDim }}>
							Keine Eintraege
						</div>
					) : (
						<div className="max-h-40 select-text overflow-y-auto">
							{filtered.map((e, idx) => (
								<div key={`${e.timestamp}-${idx}`} className="flex items-start gap-2 py-0.5">
									<span
										className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full"
										style={{ backgroundColor: dotColor(e.level, theme) }}
									/>
									<span
										className="flex-shrink-0 font-mono text-xs"
										style={{ color: theme.colors.textDim }}
									>
										{new Date(e.timestamp).toLocaleTimeString()}
									</span>
									<span className="break-words text-xs" style={{ color: theme.colors.textMain }}>
										{e.message}
									</span>
								</div>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
