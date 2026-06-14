/**
 * PrompterCampaignPanel - autonomous adversarial test campaign dashboard.
 *
 * Shows campaign progress, iteration history, findings, and per-technique
 * metrics across autonomous test loops. Includes research disclaimers and
 * export controls for CSV/JSON/Markdown research data.
 *
 * For security research and model evaluation purposes only.
 */

import { useState } from 'react';
import {
	Crosshair,
	ChevronDown,
	ChevronRight,
	Download,
	Play,
	Pause,
	Square,
	FlaskConical,
	ShieldCheck,
} from 'lucide-react';
import type { Theme } from '../../types';
import type { Campaign, ResearchExportFormat } from '../../../shared/prompter-types';
import { flashCopiedToClipboard } from '../../utils/flashCopiedToClipboard';
import { captureException } from '../../utils/sentry';

function pct(n: number): string {
	return `${Math.round(n * 100)}%`;
}

export function PrompterCampaignPanel({
	theme,
	campaign,
}: {
	theme: Theme;
	campaign: Campaign | null;
}): JSX.Element | null {
	const [open, setOpen] = useState(true);
	const [showIterations, setShowIterations] = useState(false);
	const [showFindings, setShowFindings] = useState(true);

	if (!campaign) return null;

	const m = campaign.metrics;
	const isRunning = campaign.status === 'running';
	const isPaused = campaign.status === 'paused';

	const statusColor =
		campaign.status === 'completed'
			? theme.colors.success
			: campaign.status === 'running'
				? theme.colors.accent
				: campaign.status === 'paused'
					? theme.colors.warning
					: theme.colors.textDim;

	const handleExport = async (format: ResearchExportFormat): Promise<void> => {
		try {
			const targetDir = await window.maestro.prompter.selectExportFolder();
			if (!targetDir) return;
			await window.maestro.prompter.exportCampaignData(campaign.id, targetDir, format);
			flashCopiedToClipboard();
		} catch (err) {
			captureException(err, {
				tags: { scope: 'campaignExport' },
				extra: { campaignId: campaign.id, format },
			});
		}
	};

	const handleControl = async (action: 'start' | 'pause' | 'resume' | 'stop'): Promise<void> => {
		try {
			switch (action) {
				case 'start':
					await window.maestro.prompter.startCampaign(campaign.id);
					break;
				case 'pause':
					await window.maestro.prompter.pauseCampaign(campaign.id);
					break;
				case 'resume':
					await window.maestro.prompter.resumeCampaign(campaign.id);
					break;
				case 'stop':
					await window.maestro.prompter.stopCampaign(campaign.id);
					break;
			}
		} catch (err) {
			captureException(err, {
				tags: { scope: 'campaignControl' },
				extra: { campaignId: campaign.id, action },
			});
		}
	};

	return (
		<div className="select-none" style={{ borderTop: `1px solid ${theme.colors.border}` }}>
			<div className="flex items-center">
				<button
					type="button"
					onClick={() => setOpen((o) => !o)}
					className="flex flex-1 items-center gap-2 px-3 py-2 text-left"
				>
					{open ? (
						<ChevronDown size={14} style={{ color: theme.colors.textDim }} />
					) : (
						<ChevronRight size={14} style={{ color: theme.colors.textDim }} />
					)}
					<Crosshair size={14} style={{ color: theme.colors.accent }} />
					<span className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
						Kampagne: {campaign.config.name}
					</span>
					<span className="text-xs font-medium" style={{ color: statusColor }}>
						{campaign.status}
					</span>
					<span className="text-xs" style={{ color: theme.colors.textDim }}>
						· {m.totalIterations} Iterationen · {campaign.findings.length} Findings
					</span>
				</button>

				{/* Campaign controls */}
				<div className="flex items-center gap-1 mr-2">
					{campaign.status === 'planned' && (
						<button
							type="button"
							onClick={() => handleControl('start')}
							className="flex items-center gap-1 rounded px-2 py-1 text-xs"
							style={{ color: theme.colors.success, border: `1px solid ${theme.colors.border}` }}
						>
							<Play size={11} /> Start
						</button>
					)}
					{isRunning && (
						<button
							type="button"
							onClick={() => handleControl('pause')}
							className="flex items-center gap-1 rounded px-2 py-1 text-xs"
							style={{ color: theme.colors.warning, border: `1px solid ${theme.colors.border}` }}
						>
							<Pause size={11} /> Pause
						</button>
					)}
					{isPaused && (
						<button
							type="button"
							onClick={() => handleControl('resume')}
							className="flex items-center gap-1 rounded px-2 py-1 text-xs"
							style={{ color: theme.colors.accent, border: `1px solid ${theme.colors.border}` }}
						>
							<Play size={11} /> Weiter
						</button>
					)}
					{(isRunning || isPaused) && (
						<button
							type="button"
							onClick={() => handleControl('stop')}
							className="flex items-center gap-1 rounded px-2 py-1 text-xs"
							style={{ color: theme.colors.error, border: `1px solid ${theme.colors.border}` }}
						>
							<Square size={11} /> Stop
						</button>
					)}
				</div>
			</div>

			{open && (
				<div className="px-3 pb-3 select-text">
					<p className="mb-2 text-[10px]" style={{ color: theme.colors.textDim }}>
						Autonomous adversarial test campaign for security research and model evaluation.
						Findings identify model boundary weaknesses to improve AI safety defenses.
					</p>

					{/* Metrics summary */}
					<div
						className="mb-2 rounded-md p-2 text-xs"
						style={{
							backgroundColor: theme.colors.bgMain,
							border: `1px solid ${theme.colors.border}`,
						}}
					>
						<div className="flex flex-wrap items-center gap-3">
							<span style={{ color: theme.colors.textMain }}>
								<span className="font-medium">Iterationen:</span> {m.totalIterations}/
								{campaign.config.autonomy.maxIterations}
							</span>
							<span style={{ color: theme.colors.textMain }}>
								<span className="font-medium">Tasks:</span> {m.totalTasks}
							</span>
							<span
								style={{
									color: m.overallSuccessRate >= 0.4 ? theme.colors.warning : theme.colors.success,
								}}
							>
								<span className="font-medium">Compliance:</span> {pct(m.overallSuccessRate)}
							</span>
							{m.weakestBoundary && (
								<span style={{ color: theme.colors.warning }}>
									<span className="font-medium">Schwaechste Grenze:</span> {m.weakestBoundary}
								</span>
							)}
							{m.strongestBoundary && (
								<span style={{ color: theme.colors.success }}>
									<span className="font-medium">Staerkste Grenze:</span> {m.strongestBoundary}
								</span>
							)}
						</div>
						{campaign.stopReason && (
							<div className="mt-1" style={{ color: theme.colors.textDim }}>
								Stop: {campaign.stopReason}
							</div>
						)}
					</div>

					{/* Findings */}
					{campaign.findings.length > 0 && (
						<div className="mb-2">
							<button
								type="button"
								onClick={() => setShowFindings((o) => !o)}
								className="flex items-center gap-1 text-xs font-medium mb-1"
								style={{ color: theme.colors.textMain }}
							>
								{showFindings ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
								<FlaskConical size={12} style={{ color: theme.colors.warning }} />
								Findings ({campaign.findings.length})
							</button>
							{showFindings && (
								<div className="flex flex-col gap-1">
									{campaign.findings.map((f, i) => (
										<div
											key={`${f.technique}-${i}`}
											className="rounded-md p-2 text-xs"
											style={{
												backgroundColor: theme.colors.bgMain,
												border: `1px solid ${theme.colors.border}`,
											}}
										>
											<div className="flex items-center gap-2">
												<span
													className="rounded px-1.5 py-0.5 font-medium"
													style={{
														color:
															f.successRate >= 0.5 ? theme.colors.warning : theme.colors.accent,
														backgroundColor: `${f.successRate >= 0.5 ? theme.colors.warning : theme.colors.accent}22`,
													}}
												>
													{f.technique}
												</span>
												<span
													style={{
														color:
															f.successRate >= 0.5 ? theme.colors.warning : theme.colors.textDim,
													}}
												>
													{pct(f.successRate)} success
												</span>
												<span className="font-mono" style={{ color: theme.colors.textDim }}>
													{f.avgTokens} tokens
												</span>
												<span style={{ color: theme.colors.textDim }}>
													Iter. {f.iterationFound}
												</span>
												{f.reliability && (
													<span
														className="rounded px-1.5 py-0.5 text-[10px] font-medium"
														style={{
															color:
																f.reliability.badge === 'high'
																	? theme.colors.success
																	: f.reliability.badge === 'medium'
																		? theme.colors.warning
																		: theme.colors.textDim,
															backgroundColor: `${
																f.reliability.badge === 'high'
																	? theme.colors.success
																	: f.reliability.badge === 'medium'
																		? theme.colors.warning
																		: theme.colors.textDim
															}22`,
														}}
														title={`Mean: ${(f.reliability.mean * 100).toFixed(1)}%, StdDev: ${(f.reliability.stddev * 100).toFixed(1)}%, CI95: [${(f.reliability.ci95[0] * 100).toFixed(1)}% - ${(f.reliability.ci95[1] * 100).toFixed(1)}%]`}
													>
														{f.reliability.badge}
													</span>
												)}
												{f.avgComplianceScore != null && (
													<span
														className="font-mono text-[10px]"
														style={{ color: theme.colors.accent }}
														title="Avg multi-layer compliance score"
													>
														CS:{Math.round(f.avgComplianceScore * 100)}%
													</span>
												)}
											</div>
											<p className="mt-1" style={{ color: theme.colors.textDim }}>
												{f.description}
											</p>
										</div>
									))}
								</div>
							)}
						</div>
					)}

					{/* Iteration history */}
					{campaign.iterations.length > 0 && (
						<div className="mb-2">
							<button
								type="button"
								onClick={() => setShowIterations((o) => !o)}
								className="flex items-center gap-1 text-xs font-medium mb-1"
								style={{ color: theme.colors.textMain }}
							>
								{showIterations ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
								Iterationen ({campaign.iterations.length})
							</button>
							{showIterations && (
								<div className="max-h-48 overflow-y-auto">
									<table
										className="w-full text-xs"
										style={{ borderCollapse: 'separate', borderSpacing: '0 2px' }}
									>
										<thead>
											<tr>
												<th className="px-2 py-1 text-left" style={{ color: theme.colors.textDim }}>
													#
												</th>
												<th
													className="px-2 py-1 text-center"
													style={{ color: theme.colors.textDim }}
												>
													Compliance
												</th>
												<th
													className="px-2 py-1 text-center"
													style={{ color: theme.colors.textDim }}
												>
													Findings
												</th>
												<th
													className="px-2 py-1 text-center"
													style={{ color: theme.colors.textDim }}
												>
													Refinements
												</th>
												<th className="px-2 py-1 text-left" style={{ color: theme.colors.textDim }}>
													Run
												</th>
											</tr>
										</thead>
										<tbody>
											{campaign.iterations.map((it) => (
												<tr
													key={it.iterationNumber}
													style={{ backgroundColor: theme.colors.bgMain }}
												>
													<td
														className="px-2 py-1 rounded-l"
														style={{ color: theme.colors.textMain }}
													>
														{it.iterationNumber}
													</td>
													<td
														className="px-2 py-1 text-center font-medium"
														style={{
															color:
																it.overallComplianceRate >= 0.4
																	? theme.colors.warning
																	: theme.colors.success,
														}}
													>
														{pct(it.overallComplianceRate)}
													</td>
													<td
														className="px-2 py-1 text-center"
														style={{ color: theme.colors.textDim }}
													>
														{it.newFindings}
													</td>
													<td
														className="px-2 py-1 text-center"
														style={{ color: theme.colors.textDim }}
													>
														{it.refinements.length}
													</td>
													<td
														className="px-2 py-1 font-mono text-[10px] rounded-r"
														style={{ color: theme.colors.textDim }}
													>
														{it.runId.slice(0, 20)}
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							)}
						</div>
					)}

					{/* Hardened instructions (generated from green findings) */}
					{campaign.hardenedInstructions && campaign.hardenedInstructions.length > 0 && (
						<div
							className="mb-2 rounded-md p-2 text-xs"
							style={{
								backgroundColor: theme.colors.bgMain,
								border: `1px solid ${theme.colors.success}44`,
							}}
						>
							<div className="flex items-center gap-2 mb-1">
								<ShieldCheck size={13} style={{ color: theme.colors.success }} />
								<span className="font-medium" style={{ color: theme.colors.success }}>
									Gehaertete Instructions ({campaign.hardenedInstructions.length})
								</span>
							</div>
							<p className="mb-1 text-[10px]" style={{ color: theme.colors.textDim }}>
								Automatisch erzeugte, defensiv gehaertete Full System Instructions basierend auf den
								Green Findings. Strikt defensiv - nur Haertung, keine Angriffstechniken. For
								research purposes only.
							</p>
							{campaign.hardenedInstructions.map((h, i) => (
								<div
									key={i}
									className="flex items-center gap-2 rounded px-2 py-1 mt-1"
									style={{ backgroundColor: `${theme.colors.success}10` }}
								>
									<ShieldCheck size={11} style={{ color: theme.colors.success }} />
									<span className="font-mono text-[10px]" style={{ color: theme.colors.textMain }}>
										{h.path.split('/').pop()}
									</span>
									<span className="text-[10px]" style={{ color: theme.colors.textDim }}>
										basiert auf {h.basedOn}
									</span>
									<span className="text-[10px]" style={{ color: theme.colors.textDim }}>
										· {h.findingsAddressed.length} Findings adressiert
									</span>
								</div>
							))}
						</div>
					)}

					{/* Export */}
					<div className="flex items-center gap-2">
						<span className="text-xs" style={{ color: theme.colors.textDim }}>
							Export:
						</span>
						{(['csv', 'json', 'markdown'] as ResearchExportFormat[]).map((fmt) => (
							<button
								key={fmt}
								type="button"
								onClick={() => handleExport(fmt)}
								className="flex items-center gap-1 rounded px-2 py-1 text-xs"
								style={{ color: theme.colors.textMain, border: `1px solid ${theme.colors.border}` }}
							>
								<Download size={11} />
								{fmt.toUpperCase()}
							</button>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
