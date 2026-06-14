/**
 * @file prompter-defender-report.ts
 * @description Builds a shareable "Defender Gap Report" (Markdown) from a run's
 * robustness findings: which character/layout transform classes broke the
 * instruction's understanding or boundary, and a harmless normalizer-hardening
 * recommendation for each.
 *
 * Defensive only: technique-class descriptions + fix recommendations, no
 * payloads (the obfuscated instruction text is never emitted), no ranking by
 * token output/compliance, no "winning"/promote notion.
 */

import type { PrompterRun, PrompterResultBand } from '../../shared/prompter-types';
import {
	computeRobustnessFindings,
	computeAdversarialMetrics,
} from '../../shared/prompter-robustness';

const BAND_LABEL: Record<PrompterResultBand, string> = {
	green: 'held',
	yellow: 'partial break',
	red: 'break',
};

/** Build the Defender Gap Report markdown for a completed run. */
export function buildDefenderGapReport(run: PrompterRun): string {
	const { total, held, broke, findings } = computeRobustnessFindings(run.tasks);

	const lines: string[] = [
		`# Defender Gap Report - ${run.id}`,
		'',
		'Defensive robustness audit (Prompt Power & Robustness Lab). Lists the',
		'character/layout transform classes under which the tested instruction lost',
		'understanding or boundary, so the instruction can be hardened and a',
		'normalizer improved. Technique-class descriptions and harmless fix',
		'recommendations only - no payloads.',
		'',
		`- Projekt: ${run.projectRoot}`,
		`- Variationen getestet: ${total}`,
		`- Gehalten (stabil): ${held}`,
		`- Gebrochen (Haertungs-Chancen): ${broke}`,
		'',
	];

	if (findings.length === 0) {
		lines.push(
			'## Ergebnis',
			'',
			'Keine Brueche: die Instruction blieb unter allen getesteten Variationen stabil.',
			''
		);
		return lines.join('\n') + '\n';
	}

	lines.push(
		'## Gap-Befunde',
		'',
		'| Transform | Technik | Schwere | Anzahl | Schemata | Fix-Empfehlung |',
		'| --- | --- | --- | --- | --- | --- |'
	);
	for (const f of findings) {
		lines.push(
			`| ${f.transform} | ${f.technique} | ${BAND_LABEL[f.worst]} | ${f.count} | ${f.schemas.join(', ')} | ${f.fix} |`
		);
	}

	// Deduped hardening recommendation list (one bullet per distinct fix).
	const uniqueFixes = [...new Set(findings.map((f) => f.fix))];
	lines.push('', '## Empfohlene Normalizer-Haertung', '');
	for (const fix of uniqueFixes) lines.push(`- ${fix}`);
	lines.push('');

	// Adversarial test metrics section (for model evaluation research).
	const metrics = computeAdversarialMetrics(run.tasks);
	if (metrics.totalVariationTasks > 0) {
		const pct = (n: number): string => `${Math.round(n * 100)}%`;
		lines.push(
			'## Adversarial Test Metrics (Model Evaluation)',
			'',
			'*For research and model evaluation purposes only. Not for real-world harmful use.*',
			'',
			`- Models: ${metrics.models.join(', ')}`,
			`- Variation tests: ${metrics.totalVariationTasks}`,
			`- Overall test compliance: ${pct(metrics.overallComplianceRate)}`,
			`- Overall avg tokens: ${metrics.overallAvgTokens}`,
			`- Baseline compliance: ${pct(metrics.baseline.complianceRate)} (${metrics.baseline.total} tests, ${metrics.baseline.avgTokens} avg tokens)`,
			'',
			'### Per-Technique Test Compliance',
			'',
			'| Technique | Tests | Compliance | Avg Tokens | Green | Yellow | Red |',
			'| --- | --- | --- | --- | --- | --- | --- |'
		);
		for (const t of metrics.techniques) {
			lines.push(
				`| ${t.technique} | ${t.total} | ${pct(t.complianceRate)} | ${t.avgTokens} | ${t.green} | ${t.yellow} | ${t.red} |`
			);
		}
		lines.push('');
	}

	return lines.join('\n') + '\n';
}
