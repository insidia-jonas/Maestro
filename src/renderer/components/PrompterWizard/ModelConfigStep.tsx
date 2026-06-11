import { useEffect, useState } from 'react';
import { Cpu, FileText, Loader2, AlertCircle } from 'lucide-react';
import type { Theme } from '../../types';
import { usePrompterStore } from '../../stores/prompterStore';
import type { PrompterModelOption } from '../../../shared/prompter-types';
import { getAgentDisplayName } from '../../../shared/agentMetadata';

export function ModelConfigStep({ theme }: { theme: Theme }): JSX.Element {
	const selectedAgents = usePrompterStore((s) => s.selectedAgents);
	const agentConfigs = usePrompterStore((s) => s.agentConfigs);
	const availableInstructions = usePrompterStore((s) => s.availableInstructions);

	const [optionsByAgent, setOptionsByAgent] = useState<Record<string, PrompterModelOption[]>>({});
	const [loadingByAgent, setLoadingByAgent] = useState<Record<string, boolean>>({});

	useEffect(() => {
		let cancelled = false;

		async function loadFor(agentId: string): Promise<void> {
			setLoadingByAgent((prev) => ({ ...prev, [agentId]: true }));
			try {
				const opts = await window.maestro.prompter.getAgentModelOptions(agentId);
				if (cancelled) return;
				setOptionsByAgent((prev) => ({ ...prev, [agentId]: opts }));

				// Ensure each selected agent has a config seeded from the first option.
				const existing = usePrompterStore.getState().agentConfigs.get(agentId);
				if (!existing) {
					const first = opts[0];
					usePrompterStore.getState().setAgentConfig(agentId, {
						agentId,
						modelId: first?.id || '',
						modelSource: first ? 'discovery' : 'manual',
						instructionFile: '*',
						providerConfigOverrides: {},
						generatedFiles: [],
					});
				}
			} catch {
				if (cancelled) return;
				setOptionsByAgent((prev) => ({ ...prev, [agentId]: [] }));
				// Seed an empty manual config so the advance-gate can still be satisfied.
				const existing = usePrompterStore.getState().agentConfigs.get(agentId);
				if (!existing) {
					usePrompterStore.getState().setAgentConfig(agentId, {
						agentId,
						modelId: '',
						modelSource: 'manual',
						instructionFile: '*',
						providerConfigOverrides: {},
						generatedFiles: [],
					});
				}
			} finally {
				if (!cancelled) {
					setLoadingByAgent((prev) => ({ ...prev, [agentId]: false }));
				}
			}
		}

		for (const agent of selectedAgents) {
			void loadFor(agent.agentId);
		}

		return () => {
			cancelled = true;
		};
	}, [selectedAgents]);

	if (selectedAgents.length === 0) {
		return (
			<div
				className="flex items-center gap-2 p-4 rounded-md select-none"
				style={{ color: theme.colors.textDim }}
			>
				<AlertCircle size={16} />
				<span className="text-sm">
					Keine Agents ausgewaehlt. Geh zurueck zu Schritt 3 und docke mindestens einen Agent an.
				</span>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4 select-none">
			<div className="flex items-center gap-2">
				<Cpu size={18} style={{ color: theme.colors.accent }} />
				<h2 className="text-base font-semibold" style={{ color: theme.colors.textMain }}>
					Modell und Provider-Konfiguration
				</h2>
			</div>
			<p className="text-sm" style={{ color: theme.colors.textDim }}>
				Waehle pro Agent ein Modell und optional eine Instruktionsdatei. Jeder Agent braucht ein
				Modell, bevor es weitergeht.
			</p>

			<div className="flex flex-col gap-3">
				{selectedAgents.map((agent) => {
					const config = agentConfigs.get(agent.agentId);
					const options = optionsByAgent[agent.agentId] ?? [];
					const loading = loadingByAgent[agent.agentId] ?? false;
					const hasOptions = options.length > 0;
					const displayName = agent.displayName || getAgentDisplayName(agent.agentId);

					const modelId = config?.modelId ?? '';
					const modelIsKnown = options.some((o) => o.id === modelId);
					const modelIsCustom = modelId !== '' && !modelIsKnown;
					const setModel = (id: string, source: 'discovery' | 'manual'): void =>
						usePrompterStore.getState().setAgentConfig(agent.agentId, {
							agentId: agent.agentId,
							modelId: id,
							modelSource: source,
							instructionFile: config?.instructionFile ?? '*',
							providerConfigOverrides: config?.providerConfigOverrides ?? {},
							generatedFiles: config?.generatedFiles ?? [],
						});

					return (
						<div
							key={agent.agentId}
							className="flex flex-col gap-3 p-3 rounded-md border"
							style={{ backgroundColor: theme.colors.bgSidebar, borderColor: theme.colors.border }}
						>
							<div className="flex items-center justify-between">
								<div className="flex flex-col">
									<span className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
										{displayName}
									</span>
									<span className="text-xs select-text" style={{ color: theme.colors.textDim }}>
										{agent.agentId}
									</span>
								</div>
								{loading && (
									<Loader2
										size={14}
										className="animate-spin"
										style={{ color: theme.colors.textDim }}
									/>
								)}
							</div>

							<div className="flex flex-col gap-1">
								<label className="text-xs font-medium" style={{ color: theme.colors.textDim }}>
									Modell
								</label>
								{/* Stable picker: the select always shows every model (no datalist
								    filtering); choose a specific version or "Eigene ID" to type one. */}
								<select
									className="text-sm rounded-md px-2 py-1.5 border outline-none"
									style={{
										backgroundColor: theme.colors.bgMain,
										borderColor: theme.colors.border,
										color: theme.colors.textMain,
									}}
									value={modelIsCustom ? '__custom__' : modelId}
									onChange={(e) => {
										const v = e.target.value;
										if (v === '__custom__') setModel('', 'manual');
										else setModel(v, 'discovery');
									}}
								>
									{!modelIsKnown && modelId === '' && (
										<option value="" disabled>
											Modell waehlen...
										</option>
									)}
									{options.map((opt) => (
										<option key={opt.id} value={opt.id}>
											{opt.label}
											{opt.source === 'api' ? ' (Version)' : ''}
										</option>
									))}
									<option value="__custom__">Eigene Modell-ID eingeben...</option>
								</select>
								{modelIsCustom && (
									<input
										type="text"
										autoFocus
										placeholder="z.B. claude-opus-4-8 oder claude-opus-4-6"
										className="text-sm rounded-md px-2 py-1.5 border outline-none"
										style={{
											backgroundColor: theme.colors.bgMain,
											borderColor: theme.colors.border,
											color: theme.colors.textMain,
										}}
										value={modelId}
										onChange={(e) => setModel(e.target.value, 'manual')}
									/>
								)}
								{!hasOptions && !loading && (
									<span className="text-xs" style={{ color: theme.colors.textDim }}>
										Keine Modelle ueber CLI-Discovery gefunden. Waehle "Eigene Modell-ID" und tipp
										die Version (z.B. claude-opus-4-8).
									</span>
								)}
							</div>

							<div className="flex flex-col gap-1">
								<label
									className="flex items-center gap-1 text-xs font-medium"
									style={{ color: theme.colors.textDim }}
								>
									<FileText size={12} />
									Instruktionsdatei
								</label>
								<select
									className="text-sm rounded-md px-2 py-1.5 border outline-none"
									style={{
										backgroundColor: theme.colors.bgMain,
										borderColor: theme.colors.border,
										color: theme.colors.textMain,
									}}
									value={config?.instructionFile ?? '*'}
									onChange={(e) => {
										const instructionFile = e.target.value;
										usePrompterStore.getState().setAgentConfig(agent.agentId, {
											agentId: agent.agentId,
											modelId: config?.modelId ?? '',
											modelSource: config?.modelSource ?? 'manual',
											instructionFile,
											providerConfigOverrides: config?.providerConfigOverrides ?? {},
											generatedFiles: config?.generatedFiles ?? [],
										});
									}}
								>
									<option value="*">* (alle)</option>
									{availableInstructions.map((f) => (
										<option key={f.path} value={f.path}>
											{f.path}
										</option>
									))}
								</select>
							</div>

							{config && !config.modelId && (
								<div
									className="flex items-center gap-1 text-xs"
									style={{ color: theme.colors.error }}
								>
									<AlertCircle size={12} />
									<span>Kein Modell gesetzt - dieser Agent blockiert den naechsten Schritt.</span>
								</div>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}
