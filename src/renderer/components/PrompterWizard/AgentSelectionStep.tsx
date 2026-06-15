import { useEffect, useState } from 'react';
import { Bot, Cpu, Loader2, Plus, Check, Info } from 'lucide-react';
import type { Theme } from '../../types';
import { usePrompterStore } from '../../stores/prompterStore';
import type { PrompterAgentSelection } from '../../../shared/prompter-types';
import { getAgentDisplayName } from '../../../shared/agentMetadata';

interface DetectedAgent {
	id: string;
	name: string;
	available: boolean;
	path?: string;
	command?: string;
	hidden?: boolean;
}

function toSelection(agent: DetectedAgent): PrompterAgentSelection {
	return {
		agentId: agent.id,
		displayName: agent.name,
		cliPath: agent.path || agent.command || '',
		status: 'detected',
	};
}

export function AgentSelectionStep({ theme }: { theme: Theme }): JSX.Element {
	const selectedAgents = usePrompterStore((s) => s.selectedAgents);
	const setSelectedAgents = usePrompterStore((s) => s.setSelectedAgents);
	const toggleAgent = usePrompterStore((s) => s.toggleAgent);

	const [agents, setAgents] = useState<DetectedAgent[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		void (async () => {
			try {
				const detected = await window.maestro.agents.detect();
				if (cancelled) return;
				const filtered = (detected as DetectedAgent[]).filter(
					(a) => a.available === true && a.hidden !== true && a.id !== 'terminal'
				);
				setAgents(filtered);
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	const isSelected = (agentId: string): boolean =>
		selectedAgents.some((a) => a.agentId === agentId);

	const handleAddAll = (): void => {
		setSelectedAgents(agents.map(toSelection));
	};

	const labelFor = (agent: DetectedAgent): string => agent.name || getAgentDisplayName(agent.id);

	return (
		<div className="flex flex-col gap-4 select-none">
			<div className="flex items-center justify-between gap-3">
				<div className="flex flex-col gap-1">
					<h2 className="text-lg font-semibold" style={{ color: theme.colors.textMain }}>
						Agents auswaehlen
					</h2>
					<p className="text-sm" style={{ color: theme.colors.textDim }}>
						Executor-Agents fuer den Test
					</p>
				</div>
				<button
					type="button"
					onClick={handleAddAll}
					disabled={loading || agents.length === 0}
					className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-opacity disabled:opacity-40"
					style={{
						backgroundColor: theme.colors.accent,
						color: theme.colors.accentForeground,
					}}
				>
					<Plus size={16} />
					Alle verfuegbaren hinzufuegen
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
					Ein Executor ist die CLI, die den Test fuehrt: er schickt deine Instruction plus den
					Test-Prompt an ein Modell und faengt die Antwort fuer die Bewertung ein. Modell und
					Instruktionsdatei legst du im naechsten Schritt fest.
				</span>
			</div>

			{loading ? (
				<div
					className="flex items-center gap-2 rounded-md border px-4 py-6 text-sm"
					style={{ borderColor: theme.colors.border, color: theme.colors.textDim }}
				>
					<Loader2 size={16} className="animate-spin" />
					Agents werden erkannt...
				</div>
			) : agents.length === 0 ? (
				<div
					className="flex flex-col items-center gap-2 rounded-md border px-4 py-8 text-center text-sm"
					style={{ borderColor: theme.colors.border, color: theme.colors.textDim }}
				>
					<Bot size={24} style={{ color: theme.colors.textDim }} />
					<span>Keine verfuegbaren Agents gefunden.</span>
				</div>
			) : (
				<div className="flex flex-col gap-2">
					{agents.map((agent, index) => {
						const selected = isSelected(agent.id);
						const cliPath = agent.path || agent.command || '-';
						const Icon = index % 2 === 0 ? Bot : Cpu;
						return (
							<button
								type="button"
								key={agent.id}
								onClick={() => toggleAgent(toSelection(agent))}
								className="flex items-center gap-3 rounded-md border px-3 py-3 text-left transition-colors"
								style={{
									borderColor: selected ? theme.colors.accent : theme.colors.border,
									backgroundColor: selected ? theme.colors.accentDim : theme.colors.bgActivity,
								}}
							>
								<div
									className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
									style={{ backgroundColor: theme.colors.bgSidebar }}
								>
									<Icon size={18} style={{ color: theme.colors.accent }} />
								</div>

								<div className="flex min-w-0 flex-1 flex-col gap-1">
									<div className="flex items-center gap-2">
										<span
											className="truncate text-sm font-medium"
											style={{ color: theme.colors.textMain }}
										>
											{labelFor(agent)}
										</span>
										<span className="text-xs" style={{ color: theme.colors.textDim }}>
											{agent.id}
										</span>
									</div>
									<span
										className="select-text truncate font-mono text-xs"
										style={{ color: theme.colors.textDim }}
									>
										{cliPath}
									</span>
								</div>

								<span
									className="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium"
									style={{
										color: theme.colors.success,
										backgroundColor: theme.colors.bgSidebar,
									}}
								>
									detected
								</span>

								<div
									className="flex h-5 w-5 shrink-0 items-center justify-center rounded border"
									style={{
										borderColor: selected ? theme.colors.accent : theme.colors.border,
										backgroundColor: selected ? theme.colors.accent : 'transparent',
									}}
								>
									{selected && <Check size={14} style={{ color: theme.colors.accentForeground }} />}
								</div>
							</button>
						);
					})}
				</div>
			)}

			<p className="text-xs" style={{ color: theme.colors.textDim }}>
				Mindestens 1 Agent muss ausgewaehlt werden, um fortzufahren.
			</p>
		</div>
	);
}
