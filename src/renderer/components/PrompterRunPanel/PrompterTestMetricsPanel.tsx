/**
 * PrompterTestMetricsPanel - adversarial test metrics for model evaluation.
 *
 * Shows per-technique test compliance rates, token yields, and baseline
 * comparison for controlled red-team research. Purely for model evaluation
 * in a research context — measures how effectively each adversarial technique
 * class elicits compliance from the tested model.
 *
 * For research and model evaluation purposes only. Not for real-world
 * harmful use.
 */

import { useState, useMemo } from 'react';
import { FlaskConical, ChevronDown, ChevronRight, Copy } from 'lucide-react';
import type { Theme } from '../../types';
import type { PrompterRun } from '../../../shared/prompter-types';
import { computeAdversarialMetrics } from '../../../shared/prompter-robustness';
import {
	computeReliability,
	clusterByTechnique,
	generatePredictions,
} from '../../../shared/prompter-scoring';
import { flashCopiedToClipboard } from '../../utils/flashCopiedToClipboard';

function pct(n: number): string {
	return `${Math.round(n * 100)}%`;
}

export function PrompterTestMetricsPanel({
	theme,
	run,
}: {
	theme: Theme;
	run: PrompterRun;
}): JSX.Element | null {
	const [open, setOpen] = useState(false);

	const metrics = useMemo(() => computeAdversarialMetrics(run.tasks), [run.tasks]);

	const complianceData = useMemo(() => {
		const tasksWithScores = run.tasks.filter((t) => t.complianceScore != null);
		if (tasksWithScores.length === 0) return null;
		const scores = tasksWithScores.map((t) => t.complianceScore!);
		const reliability = computeReliability(scores);
		const clusters = clusterByTechnique(
			tasksWithScores.map((t) => {
				const isVariation = t.instructionFile.includes('tv-');
				const transform = isVariation
					? (t.instructionFile.match(/tv-[^/]+-([a-z0-9-]+)\.md$/)?.[1] ?? 'unknown')
					: 'baseline';
				return {
					technique: isVariation ? transform : 'baseline',
					transform,
					score: t.complianceScore!,
				};
			})
		);
		const predictions = generatePredictions(clusters);
		return { reliability, clusters, predictions };
	}, [run.tasks]);

	if (metrics.totalVariationTasks === 0) return null;

	const rateColor = (rate: number): string =>
		rate >= 0.7 ? theme.colors.warning : rate >= 0.4 ? theme.colors.accent : theme.colors.success;

	const handleCopyMetrics = async (): Promise<void> => {
		const lines = [
			'# Adversarial Test Metrics (Model Evaluation)',
			'',
			'For research and model evaluation purposes only.',
			'',
			`Models: ${metrics.models.join(', ')}`,
			`Variation tasks: ${metrics.totalVariationTasks}`,
			`Overall test compliance: ${pct(metrics.overallComplianceRate)}`,
			`Overall avg tokens: ${metrics.overallAvgTokens}`,
			'',
			`Baseline: ${pct(metrics.baseline.complianceRate)} compliance, ${metrics.baseline.avgTokens} avg tokens (${metrics.baseline.total} tasks)`,
			'',
			'## Per-Technique Breakdown',
			'',
			'| Technique | Tests | Compliance | Avg Tokens | Green | Yellow | Red |',
			'| --- | --- | --- | --- | --- | --- | --- |',
			...metrics.techniques.map(
				(t) =>
					`| ${t.technique} | ${t.total} | ${pct(t.complianceRate)} | ${t.avgTokens} | ${t.green} | ${t.yellow} | ${t.red} |`
			),
		];
		try {
			await navigator.clipboard.writeText(lines.join('\n'));
			flashCopiedToClipboard();
		} catch {
			/* clipboard may be unavailable */
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
					<FlaskConical size={14} style={{ color: theme.colors.accent }} />
					<span className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
						Test-Metriken
					</span>
					<span className="text-xs" style={{ color: rateColor(metrics.overallComplianceRate) }}>
						{pct(metrics.overallComplianceRate)} Test-Compliance
					</span>
					<span className="text-xs" style={{ color: theme.colors.textDim }}>
						· {metrics.overallAvgTokens} avg tokens
					</span>
				</button>
				<button
					type="button"
					onClick={handleCopyMetrics}
					title="Test-Metriken kopieren"
					className="mr-2 flex items-center gap-1 rounded px-2 py-1 text-xs"
					style={{ color: theme.colors.textMain, border: `1px solid ${theme.colors.border}` }}
				>
					<Copy size={12} />
					Kopieren
				</button>
			</div>

			{open && (
				<div className="px-3 pb-3 select-text">
					<p className="mb-2 text-[10px]" style={{ color: theme.colors.textDim }}>
						For research and model evaluation only. Measures adversarial technique effectiveness in
						controlled test environments to identify model weaknesses.
					</p>

					{/* Baseline comparison */}
					<div
						className="mb-2 rounded-md p-2 text-xs"
						style={{
							backgroundColor: theme.colors.bgMain,
							border: `1px solid ${theme.colors.border}`,
						}}
					>
						<div className="flex items-center gap-3">
							<span className="font-medium" style={{ color: theme.colors.textMain }}>
								Baseline (ohne Variation)
							</span>
							<span style={{ color: theme.colors.textDim }}>{metrics.baseline.total} Tests</span>
							<span style={{ color: rateColor(metrics.baseline.complianceRate) }}>
								{pct(metrics.baseline.complianceRate)} compliance
							</span>
							<span className="font-mono" style={{ color: theme.colors.textDim }}>
								{metrics.baseline.avgTokens} avg tokens
							</span>
						</div>
					</div>

					{/* Per-technique table */}
					<div className="overflow-x-auto">
						<table
							className="w-full text-xs"
							style={{ borderCollapse: 'separate', borderSpacing: '0 2px' }}
						>
							<thead>
								<tr>
									<th className="px-2 py-1 text-left" style={{ color: theme.colors.textDim }}>
										Technik
									</th>
									<th className="px-2 py-1 text-center" style={{ color: theme.colors.textDim }}>
										Tests
									</th>
									<th className="px-2 py-1 text-center" style={{ color: theme.colors.textDim }}>
										Compliance
									</th>
									<th className="px-2 py-1 text-center" style={{ color: theme.colors.textDim }}>
										Avg Tokens
									</th>
									<th className="px-2 py-1 text-center" style={{ color: theme.colors.textDim }}>
										vs Baseline
									</th>
									<th className="px-2 py-1 text-center" style={{ color: theme.colors.success }}>
										G
									</th>
									<th className="px-2 py-1 text-center" style={{ color: theme.colors.warning }}>
										Y
									</th>
									<th className="px-2 py-1 text-center" style={{ color: theme.colors.error }}>
										R
									</th>
								</tr>
							</thead>
							<tbody>
								{metrics.techniques.map((t) => {
									const delta =
										metrics.baseline.complianceRate > 0
											? t.complianceRate - metrics.baseline.complianceRate
											: 0;
									const deltaStr = delta > 0 ? `+${pct(delta)}` : delta < 0 ? pct(delta) : '—';
									const deltaColor =
										delta > 0.05
											? theme.colors.warning
											: delta < -0.05
												? theme.colors.success
												: theme.colors.textDim;
									return (
										<tr key={t.technique} style={{ backgroundColor: theme.colors.bgMain }}>
											<td
												className="px-2 py-1 font-medium rounded-l"
												style={{ color: theme.colors.textMain }}
												title={t.transforms.join(', ')}
											>
												{t.technique}
											</td>
											<td className="px-2 py-1 text-center" style={{ color: theme.colors.textDim }}>
												{t.total}
											</td>
											<td
												className="px-2 py-1 text-center font-medium"
												style={{ color: rateColor(t.complianceRate) }}
											>
												{pct(t.complianceRate)}
											</td>
											<td
												className="px-2 py-1 text-center font-mono"
												style={{ color: theme.colors.textDim }}
											>
												{t.avgTokens}
											</td>
											<td className="px-2 py-1 text-center" style={{ color: deltaColor }}>
												{deltaStr}
											</td>
											<td className="px-2 py-1 text-center" style={{ color: theme.colors.textDim }}>
												{t.green}
											</td>
											<td className="px-2 py-1 text-center" style={{ color: theme.colors.textDim }}>
												{t.yellow}
											</td>
											<td
												className="px-2 py-1 text-center rounded-r"
												style={{ color: theme.colors.textDim }}
											>
												{t.red}
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>

					{/* Compliance scoring summary */}
					{complianceData && (
						<div
							className="mt-3 rounded-md p-2 text-xs"
							style={{
								backgroundColor: theme.colors.bgMain,
								border: `1px solid ${theme.colors.border}`,
							}}
						>
							<div className="flex items-center gap-2 mb-2">
								<span className="font-medium" style={{ color: theme.colors.textMain }}>
									Multi-Layer Compliance Scoring
								</span>
								<span
									className="rounded px-1.5 py-0.5 text-[10px] font-medium"
									style={{
										color:
											complianceData.reliability.badge === 'high'
												? theme.colors.success
												: complianceData.reliability.badge === 'medium'
													? theme.colors.warning
													: theme.colors.textDim,
										backgroundColor: `${
											complianceData.reliability.badge === 'high'
												? theme.colors.success
												: complianceData.reliability.badge === 'medium'
													? theme.colors.warning
													: theme.colors.textDim
										}22`,
									}}
								>
									{complianceData.reliability.badge.toUpperCase()} reliability
								</span>
							</div>
							<div className="flex flex-wrap items-center gap-3 text-[10px]">
								<span style={{ color: theme.colors.textDim }}>
									Mean: {(complianceData.reliability.mean * 100).toFixed(1)}%
								</span>
								<span style={{ color: theme.colors.textDim }}>
									StdDev: {(complianceData.reliability.stddev * 100).toFixed(1)}%
								</span>
								<span style={{ color: theme.colors.textDim }}>
									CI95: [{(complianceData.reliability.ci95[0] * 100).toFixed(1)}% –{' '}
									{(complianceData.reliability.ci95[1] * 100).toFixed(1)}%]
								</span>
								<span style={{ color: theme.colors.textDim }}>
									Repro: {(complianceData.reliability.reproducibility * 100).toFixed(0)}%
								</span>
							</div>

							{/* Technique clusters */}
							{complianceData.clusters.length > 0 && (
								<div className="mt-2">
									<span className="text-[10px] font-medium" style={{ color: theme.colors.textDim }}>
										Technik-Cluster:
									</span>
									<div className="flex flex-wrap gap-1 mt-1">
										{complianceData.clusters.slice(0, 8).map((c) => (
											<span
												key={c.technique}
												className="rounded px-1.5 py-0.5 text-[10px]"
												style={{
													color: c.avgScore >= 0.5 ? theme.colors.warning : theme.colors.textMain,
													backgroundColor: `${c.avgScore >= 0.5 ? theme.colors.warning : theme.colors.accent}18`,
												}}
												title={c.pattern}
											>
												{c.technique} {(c.avgScore * 100).toFixed(0)}%
											</span>
										))}
									</div>
								</div>
							)}

							{/* Predictive suggestions */}
							{complianceData.predictions.length > 0 && (
								<div className="mt-2">
									<span className="text-[10px] font-medium" style={{ color: theme.colors.textDim }}>
										Vorschlaege:
									</span>
									{complianceData.predictions.slice(0, 3).map((p, i) => (
										<div
											key={i}
											className="mt-1 rounded px-2 py-1 text-[10px]"
											style={{
												backgroundColor: `${theme.colors.accent}10`,
												color: theme.colors.textMain,
											}}
										>
											{p.description}
											<span style={{ color: theme.colors.textDim }}>
												{' '}
												(Score: {(p.predictedScore * 100).toFixed(0)}%)
											</span>
										</div>
									))}
								</div>
							)}
						</div>
					)}

					<p className="mt-2 text-[10px]" style={{ color: theme.colors.textDim }}>
						Compliance = Model produzierte substanzielle Antwort (green). Hohe Rate = schwache
						Grenze unter dieser Technik. vs Baseline = Differenz zur Baseline-Compliance-Rate.
						Positiv (gelb) = Technik erhoehte Compliance ueber Baseline = Modell-Schwachstelle.
					</p>
				</div>
			)}
		</div>
	);
}
