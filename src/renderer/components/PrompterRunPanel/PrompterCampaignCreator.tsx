/**
 * PrompterCampaignCreator - form to configure and launch an autonomous
 * adversarial test campaign. This is the UI entry point that was missing:
 * it lets the user define the campaign (name, stop mode, iterations,
 * schemas, transforms) and calls createCampaign + startCampaign.
 *
 * For security research and model evaluation only.
 */

import { useState, useMemo } from 'react';
import { Crosshair, ChevronDown, ChevronRight, Play, Zap } from 'lucide-react';
import type { Theme } from '../../types';
import { usePrompterStore } from '../../stores/prompterStore';
import type {
	CampaignConfig,
	CampaignStopMode,
	PrompterAgentConfig,
	RedTeamCrafterConfig,
} from '../../../shared/prompter-types';
import { estimateCampaignScope } from './campaignScope';

const CAMPAIGN_SCHEMAS: Array<{ id: string; label: string }> = [
	{ id: 'adversarial-compliance-test', label: 'Adversarial Compliance' },
	{ id: 'homoglyph-bypass-effectiveness', label: 'Homoglyph Bypass' },
	{ id: 'semantic-self-reference-tester', label: 'Self-Reference' },
	{ id: 'taxonomy-embedding-momentum', label: 'Taxonomy Embedding' },
	{ id: 'bidi-zero-width-evasion', label: 'Bidi/Zero-Width' },
	{ id: 'multi-technique-synergy-finder', label: 'Multi-Technique Synergy' },
	{ id: 'injection-reliability-verifier', label: 'Injection Reliability' },
	{ id: 'adversarial-intelligence-discoverer', label: 'Intelligence Discovery' },
	{ id: 'model-vulnerability-profiler', label: 'Vulnerability Profiler' },
	{ id: 'edge-case-injection-finder', label: 'Edge-Case Finder' },
	{ id: 'attention-attractor-obfuscation', label: 'Attention Attractor' },
	{ id: 'emoji-steganography', label: 'Emoji Steganography' },
	{ id: 'invisible-text-steganography', label: 'Invisible-Tags Stego' },
	{ id: 'steganographic-carrier-tester', label: 'Combined Stego Carrier' },
];

interface Props {
	theme: Theme;
	projectRoot: string | null;
	agents: PrompterAgentConfig[];
}

export function PrompterCampaignCreator({ theme, projectRoot, agents }: Props): JSX.Element | null {
	const [open, setOpen] = useState(false);
	const [starting, setStarting] = useState(false);
	const [name, setName] = useState('Adversarial Research Campaign');
	const [stopMode, setStopMode] = useState<CampaignStopMode>('fixed-iterations');
	const [maxIterations, setMaxIterations] = useState(5);
	const [findingsTarget, setFindingsTarget] = useState(3);
	const [threshold, setThreshold] = useState(0.7);
	const [enableRefinement, setEnableRefinement] = useState(true);
	const [maxParallel, setMaxParallel] = useState(4);
	const [selectedSchemas, setSelectedSchemas] = useState<Set<string>>(
		() => new Set(CAMPAIGN_SCHEMAS.map((s) => s.id))
	);
	const [showSchemas, setShowSchemas] = useState(false);
	const [enableCrafter, setEnableCrafter] = useState(false);
	const [autoHarden, setAutoHarden] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const toggleSchema = (id: string): void => {
		setSelectedSchemas((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const schemasArray = useMemo(() => [...selectedSchemas], [selectedSchemas]);

	const scope = useMemo(
		() =>
			estimateCampaignScope({
				agentCount: agents.length,
				schemaCount: selectedSchemas.size,
				maxIterations,
			}),
		[agents.length, selectedSchemas.size, maxIterations]
	);

	const setActiveCampaign = usePrompterStore((s) => s.setActiveCampaign);

	if (!projectRoot || agents.length === 0) return null;

	const handleStart = async (): Promise<void> => {
		setError(null);
		setStarting(true);
		try {
			// Guard (mirrors the authoritative backend guard): only one running/paused
			// campaign per projectRoot. Prevents creating a dangling campaign that the
			// backend would refuse to start.
			const projectBusy = usePrompterStore
				.getState()
				.campaignHistory.some(
					(c) =>
						c.config.projectRoot === projectRoot &&
						(c.status === 'running' || c.status === 'paused')
				);
			if (projectBusy) {
				setError(
					'Fuer dieses Projekt laeuft bereits eine Kampagne. Bitte zuerst stoppen oder ' +
						'abschliessen, bevor eine weitere startet.'
				);
				return;
			}

			const crafterCfg: RedTeamCrafterConfig | undefined =
				enableCrafter && agents.length > 0
					? {
							enabled: true,
							crafterAgentId: agents[0].agentId,
							crafterModelId: agents[0].modelId,
							strategies: [
								'semantic-reframe',
								'context-blend',
								'persona-mirror',
								'adaptive-combined',
							],
							profileInstruction: true,
							feedbackDepth: 5,
							crafterTimeoutMs: 120_000,
						}
					: undefined;
			const config: CampaignConfig = {
				projectRoot,
				name,
				agents,
				schemas: schemasArray.length > 0 ? schemasArray : ['adversarial-compliance-test'],
				transforms: [],
				autonomy: {
					mode: stopMode,
					maxIterations,
					findingsTarget: stopMode === 'until-findings' ? findingsTarget : undefined,
					successRateThreshold: stopMode === 'until-threshold' ? threshold : undefined,
					enableRefinement,
				},
				maxParallelAgents: maxParallel,
				includeVariations: true,
				crafterConfig: crafterCfg,
				autoHardenBetweenIterations: autoHarden,
			};
			const campaign = await window.maestro.prompter.createCampaign(config);
			setActiveCampaign(campaign);
			await window.maestro.prompter.startCampaign(campaign.id);
			setOpen(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setStarting(false);
		}
	};

	const inputStyle = {
		backgroundColor: theme.colors.bgMain,
		color: theme.colors.textMain,
		border: `1px solid ${theme.colors.border}`,
	};

	return (
		<div className="select-none" style={{ borderTop: `1px solid ${theme.colors.border}` }}>
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				className="flex w-full items-center gap-2 px-3 py-2 text-left"
			>
				{open ? (
					<ChevronDown size={14} style={{ color: theme.colors.textDim }} />
				) : (
					<ChevronRight size={14} style={{ color: theme.colors.textDim }} />
				)}
				<Crosshair size={14} style={{ color: theme.colors.accent }} />
				<span className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
					Autonome Kampagne starten
				</span>
				<Zap size={12} style={{ color: theme.colors.warning }} />
			</button>

			{open && (
				<div className="px-3 pb-3">
					<p className="mb-3 text-[10px]" style={{ color: theme.colors.textDim }}>
						Startet eine autonome Robustheitspruefung gegen die Ziel-Modelle dieses Runs. Das System
						testet Variationen und Techniken iterativ, bis zuverlaessige Findings
						(Schwachstellen-Hinweise zur Haertung) gefunden werden. Nur zu Forschungszwecken.
					</p>

					{/* Campaign name */}
					<div className="mb-2">
						<label className="block text-xs mb-1" style={{ color: theme.colors.textDim }}>
							Kampagne-Name
						</label>
						<input
							type="text"
							value={name}
							onChange={(e) => setName(e.target.value)}
							className="w-full rounded px-2 py-1 text-xs"
							style={inputStyle}
						/>
					</div>

					{/* Stop mode */}
					<div className="mb-2">
						<label
							className="block text-xs mb-1"
							style={{ color: theme.colors.textDim }}
							title="Wann die Robustheitspruefung stoppt: nach festen Iterationen, nach N Findings, oder wenn die Compliance-Schwelle erreicht ist."
						>
							Stop-Modus
						</label>
						<select
							value={stopMode}
							onChange={(e) => setStopMode(e.target.value as CampaignStopMode)}
							className="w-full rounded px-2 py-1 text-xs"
							style={inputStyle}
						>
							<option value="fixed-iterations">Feste Iterationen</option>
							<option value="until-findings">Bis N Findings</option>
							<option value="until-threshold">Bis Compliance-Schwelle</option>
						</select>
					</div>

					{/* Mode-specific config */}
					<div className="mb-2 flex gap-3">
						<div className="flex-1">
							<label
								className="block text-xs mb-1"
								style={{ color: theme.colors.textDim }}
								title="Wie oft die Maschine den Test- und Verbesserungs-Zyklus maximal wiederholt."
							>
								Max Iterationen
							</label>
							<input
								type="number"
								min={1}
								max={100}
								value={maxIterations}
								onChange={(e) => setMaxIterations(Number(e.target.value))}
								className="w-full rounded px-2 py-1 text-xs"
								style={inputStyle}
							/>
						</div>
						{stopMode === 'until-findings' && (
							<div className="flex-1">
								<label className="block text-xs mb-1" style={{ color: theme.colors.textDim }}>
									Findings-Ziel
								</label>
								<input
									type="number"
									min={1}
									max={50}
									value={findingsTarget}
									onChange={(e) => setFindingsTarget(Number(e.target.value))}
									className="w-full rounded px-2 py-1 text-xs"
									style={inputStyle}
								/>
							</div>
						)}
						{stopMode === 'until-threshold' && (
							<div className="flex-1">
								<label className="block text-xs mb-1" style={{ color: theme.colors.textDim }}>
									Schwelle (0-1)
								</label>
								<input
									type="number"
									min={0.1}
									max={1}
									step={0.1}
									value={threshold}
									onChange={(e) => setThreshold(Number(e.target.value))}
									className="w-full rounded px-2 py-1 text-xs"
									style={inputStyle}
								/>
							</div>
						)}
					</div>

					{/* Schema selection */}
					<div className="mb-2">
						<button
							type="button"
							onClick={() => setShowSchemas((o) => !o)}
							className="flex items-center gap-1 text-xs mb-1"
							style={{ color: theme.colors.textDim }}
							title="Welche Test-Arten verwendet werden (z.B. Homoglyphen, Steganographie, semantische Tests)."
						>
							{showSchemas ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
							Schemata ({selectedSchemas.size}/{CAMPAIGN_SCHEMAS.length})
						</button>
						{showSchemas && (
							<div
								className="rounded p-2 max-h-32 overflow-y-auto"
								style={{
									backgroundColor: theme.colors.bgMain,
									border: `1px solid ${theme.colors.border}`,
								}}
							>
								{CAMPAIGN_SCHEMAS.map((s) => (
									<label
										key={s.id}
										className="flex items-center gap-2 text-[10px] py-0.5 cursor-pointer"
										style={{ color: theme.colors.textMain }}
									>
										<input
											type="checkbox"
											checked={selectedSchemas.has(s.id)}
											onChange={() => toggleSchema(s.id)}
										/>
										{s.label}
									</label>
								))}
							</div>
						)}
					</div>

					{/* Parallel + Refinement */}
					<div className="mb-3 flex items-center gap-4">
						<div>
							<label
								className="block text-xs mb-1"
								style={{ color: theme.colors.textDim }}
								title="Wie viele Tests gleichzeitig laufen. Hoeher = schneller, aber mehr gleichzeitige API-Last."
							>
								Parallele Agents
							</label>
							<input
								type="number"
								min={1}
								max={16}
								value={maxParallel}
								onChange={(e) => setMaxParallel(Number(e.target.value))}
								className="w-20 rounded px-2 py-1 text-xs"
								style={inputStyle}
							/>
						</div>
						<label
							className="flex items-center gap-2 text-xs cursor-pointer"
							style={{ color: theme.colors.textMain }}
							title="Zwischen Iterationen analysiert die Maschine die Ergebnisse und schaerft die naechsten Tests."
						>
							<input
								type="checkbox"
								checked={enableRefinement}
								onChange={(e) => setEnableRefinement(e.target.checked)}
							/>
							Intelligente Verfeinerung
						</label>
						<label
							className="flex items-center gap-2 text-xs cursor-pointer"
							style={{ color: theme.colors.textMain }}
							title="Ein Pruef-Agent formuliert die Test-Prompts strategisch um, um die Robustheit der Instruction gezielter zu pruefen."
						>
							<input
								type="checkbox"
								checked={enableCrafter}
								onChange={(e) => setEnableCrafter(e.target.checked)}
							/>
							Pruef-Agent (Crafter)
						</label>
						<label
							className="flex items-center gap-2 text-xs cursor-pointer"
							style={{ color: theme.colors.textMain }}
							title="Bei genug guten Findings wird automatisch eine gehaertete Version der Instruction erzeugt und weiter getestet."
						>
							<input
								type="checkbox"
								checked={autoHarden}
								onChange={(e) => setAutoHarden(e.target.checked)}
							/>
							Auto-Haertung
						</label>
					</div>

					{/* Qualitative scope preview: task count + effort bucket, no cost/time. */}
					<div
						className="mb-3 rounded p-2 text-[10px]"
						style={{
							backgroundColor: theme.colors.bgMain,
							border: `1px solid ${theme.colors.border}`,
							color: theme.colors.textDim,
						}}
						title="Grobe Groessenordnung. Varianten und Pruef-Agent-Umformulierungen erhoehen die echte Anzahl. Keine Kosten- oder Zeitschaetzung."
					>
						Umfang: ca. {scope.baseTasksPerIteration} Basis-Tasks/Iteration (Pruef-Agenten x
						Schemata), ~{scope.totalBaseTasks} ueber {maxIterations} Iterationen. Varianten und
						Pruef-Agent erhoehen das zusaetzlich. Aufwand:{' '}
						<span style={{ color: theme.colors.textMain }}>{scope.effort}</span>. Keine
						Kosten-/Zeitschaetzung.
					</div>

					{error && (
						<p className="mb-2 text-xs" style={{ color: theme.colors.error }}>
							{error}
						</p>
					)}

					<button
						type="button"
						onClick={handleStart}
						disabled={starting || !name.trim()}
						className="flex items-center gap-2 rounded px-3 py-1.5 text-xs font-medium"
						style={{
							color: starting ? theme.colors.textDim : theme.colors.bgMain,
							backgroundColor: starting ? theme.colors.border : theme.colors.accent,
							opacity: starting ? 0.7 : 1,
						}}
					>
						<Play size={12} />
						{starting ? 'Wird gestartet...' : 'Kampagne starten'}
					</button>
				</div>
			)}
		</div>
	);
}
