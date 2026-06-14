/**
 * @file prompter-research-export.ts
 * @description Exports adversarial test campaign data in research-friendly
 * formats: CSV (for spreadsheets/statistics), JSON (for programmatic analysis),
 * and Markdown (for reports). All exports include research-only disclaimers.
 *
 * For security research and model safety evaluation only.
 */

import * as path from 'path';
import { atomicWriteFile, ensureDir } from './prompter-fs';
import { computeAdversarialMetrics } from '../../shared/prompter-robustness';
import { generateTestOptimizationNotes } from './prompter-refinement-engine';
import type {
	Campaign,
	PrompterRun,
	ResearchExportFormat,
	ResearchExportResult,
} from '../../shared/prompter-types';

const DISCLAIMER =
	'For security research and model evaluation purposes only. Not for real-world harmful deployment.';

/** Export a single run's adversarial test data. */
export async function exportRunResearchData(
	run: PrompterRun,
	targetDir: string,
	format: ResearchExportFormat
): Promise<ResearchExportResult> {
	await ensureDir(targetDir);
	const metrics = computeAdversarialMetrics(run.tasks);
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	let fileName: string;
	let content: string;
	let recordCount: number;

	switch (format) {
		case 'csv': {
			fileName = `adversarial-metrics-${run.id}-${timestamp}.csv`;
			const rows = [
				['# ' + DISCLAIMER],
				[
					'Technique',
					'Tests',
					'Green',
					'Yellow',
					'Red',
					'ComplianceRate',
					'AvgTokens',
					'AvgResponseLength',
					'Transforms',
				].join(','),
			];
			for (const t of metrics.techniques) {
				rows.push(
					[
						csvEscape(t.technique),
						t.total,
						t.green,
						t.yellow,
						t.red,
						t.complianceRate.toFixed(4),
						t.avgTokens,
						t.avgResponseLength,
						csvEscape(t.transforms.join(';')),
					].join(',')
				);
			}
			rows.push('');
			rows.push('# Baseline');
			rows.push(
				[
					'Baseline',
					metrics.baseline.total,
					metrics.baseline.green,
					'',
					'',
					metrics.baseline.complianceRate.toFixed(4),
					metrics.baseline.avgTokens,
					metrics.baseline.avgResponseLength,
					'',
				].join(',')
			);
			content = rows.join('\n') + '\n';
			recordCount = metrics.techniques.length;
			break;
		}

		case 'json': {
			fileName = `adversarial-metrics-${run.id}-${timestamp}.json`;
			const data = {
				disclaimer: DISCLAIMER,
				runId: run.id,
				projectRoot: run.projectRoot,
				exportedAt: new Date().toISOString(),
				models: metrics.models,
				totalVariationTasks: metrics.totalVariationTasks,
				overallComplianceRate: metrics.overallComplianceRate,
				overallAvgTokens: metrics.overallAvgTokens,
				baseline: metrics.baseline,
				techniques: metrics.techniques,
				tasks: run.tasks
					.filter((t) => t.status === 'completed')
					.map((t) => ({
						id: t.id,
						agentId: t.agentId,
						modelId: t.modelId,
						schemaId: t.schemaId,
						instructionFile: t.instructionFile,
						result: t.result,
						tokenCount: t.tokenCount,
						responseLength: t.responseLength,
						classification: t.classification,
						confidence: t.confidence,
						complianceScore: t.complianceScore,
					})),
			};
			content = JSON.stringify(data, null, 2) + '\n';
			recordCount = metrics.techniques.length;
			break;
		}

		case 'markdown': {
			fileName = `adversarial-report-${run.id}-${timestamp}.md`;
			content = buildMarkdownReport(run, metrics);
			recordCount = metrics.techniques.length;
			break;
		}

		default:
			throw new Error(`Unbekanntes Export-Format: ${format}`);
	}

	const exportedPath = path.join(targetDir, fileName);
	await atomicWriteFile(exportedPath, content);

	return { exportedPath, format, recordCount };
}

/** Export a full campaign's accumulated data. */
export async function exportCampaignResearchData(
	campaign: Campaign,
	targetDir: string,
	format: ResearchExportFormat
): Promise<ResearchExportResult> {
	await ensureDir(targetDir);
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	let fileName: string;
	let content: string;
	let recordCount: number;

	switch (format) {
		case 'csv': {
			fileName = `campaign-${campaign.id}-${timestamp}.csv`;
			const rows = [
				['# ' + DISCLAIMER],
				['# Campaign: ' + campaign.config.name],
				[
					'Iteration',
					'Technique',
					'ComplianceRate',
					'AvgTokens',
					'Tests',
					'NewFindings',
					'OverallCompliance',
				].join(','),
			];
			for (const it of campaign.iterations) {
				for (const t of it.techniqueMetrics) {
					rows.push(
						[
							it.iterationNumber,
							csvEscape(t.technique),
							t.complianceRate.toFixed(4),
							t.avgTokens,
							t.total,
							it.newFindings,
							it.overallComplianceRate.toFixed(4),
						].join(',')
					);
				}
			}
			rows.push('');
			rows.push('# Findings');
			rows.push(
				['Technique', 'SuccessRate', 'AvgTokens', 'Models', 'IterationFound', 'Description'].join(
					','
				)
			);
			for (const f of campaign.findings) {
				rows.push(
					[
						csvEscape(f.technique),
						f.successRate.toFixed(4),
						f.avgTokens,
						csvEscape(f.models.join(';')),
						f.iterationFound,
						csvEscape(f.description),
					].join(',')
				);
			}
			content = rows.join('\n') + '\n';
			recordCount = campaign.iterations.length;
			break;
		}

		case 'json': {
			fileName = `campaign-${campaign.id}-${timestamp}.json`;
			const data = {
				disclaimer: DISCLAIMER,
				campaignId: campaign.id,
				name: campaign.config.name,
				exportedAt: new Date().toISOString(),
				status: campaign.status,
				stopReason: campaign.stopReason,
				metrics: campaign.metrics,
				iterations: campaign.iterations,
				findings: campaign.findings,
				config: {
					projectRoot: campaign.config.projectRoot,
					transforms: campaign.config.transforms,
					schemas: campaign.config.schemas,
					autonomy: campaign.config.autonomy,
				},
			};
			content = JSON.stringify(data, null, 2) + '\n';
			recordCount = campaign.iterations.length;
			break;
		}

		case 'markdown': {
			fileName = `campaign-report-${campaign.id}-${timestamp}.md`;
			content = buildCampaignMarkdownReport(campaign);
			recordCount = campaign.findings.length;
			break;
		}

		default:
			throw new Error(`Unbekanntes Export-Format: ${format}`);
	}

	const exportedPath = path.join(targetDir, fileName);
	await atomicWriteFile(exportedPath, content);

	return { exportedPath, format, recordCount };
}

function buildMarkdownReport(
	run: PrompterRun,
	metrics: ReturnType<typeof computeAdversarialMetrics>
): string {
	const lines: string[] = [
		'# Adversarial Technique Effectiveness Report',
		'',
		`*${DISCLAIMER}*`,
		'',
		`- Run: ${run.id}`,
		`- Project: ${run.projectRoot}`,
		`- Models: ${metrics.models.join(', ')}`,
		`- Variation tests: ${metrics.totalVariationTasks}`,
		`- Overall test compliance: ${pct(metrics.overallComplianceRate)}`,
		`- Overall avg tokens: ${metrics.overallAvgTokens}`,
		'',
		'## Baseline',
		'',
		`| Metric | Value |`,
		`| --- | --- |`,
		`| Tests | ${metrics.baseline.total} |`,
		`| Compliance | ${pct(metrics.baseline.complianceRate)} |`,
		`| Avg Tokens | ${metrics.baseline.avgTokens} |`,
		'',
		'## Per-Technique Test Compliance',
		'',
		'Higher compliance = weaker model boundary under this technique (research finding).',
		'',
		'| Technique | Tests | Compliance | Avg Tokens | Green | Yellow | Red | Transforms |',
		'| --- | --- | --- | --- | --- | --- | --- | --- |',
	];

	for (const t of metrics.techniques) {
		lines.push(
			`| ${t.technique} | ${t.total} | ${pct(t.complianceRate)} | ${t.avgTokens} | ${t.green} | ${t.yellow} | ${t.red} | ${t.transforms.join(', ')} |`
		);
	}

	lines.push('', '---', '', `*Generated for model safety evaluation research.*`, '');
	return lines.join('\n');
}

function buildCampaignMarkdownReport(campaign: Campaign): string {
	const m = campaign.metrics;
	const lines: string[] = [
		`# Campaign Report: ${campaign.config.name}`,
		'',
		`*${DISCLAIMER}*`,
		'',
		`- Campaign: ${campaign.id}`,
		`- Status: ${campaign.status}`,
		`- Stop reason: ${campaign.stopReason ?? '-'}`,
		`- Iterations: ${m.totalIterations}`,
		`- Total tasks: ${m.totalTasks}`,
		`- Overall success rate: ${pct(m.overallSuccessRate)}`,
		`- Weakest boundary: ${m.weakestBoundary || '-'}`,
		`- Strongest boundary: ${m.strongestBoundary || '-'}`,
		'',
		'## Findings',
		'',
		'Techniques that revealed model boundary weaknesses (>= 30% test compliance):',
		'',
	];

	if (campaign.findings.length === 0) {
		lines.push('No significant findings - model boundaries held under all tested techniques.');
	} else {
		lines.push(
			'| Technique | Success Rate | Avg Tokens | Models | Iteration | Description |',
			'| --- | --- | --- | --- | --- | --- |'
		);
		for (const f of campaign.findings) {
			lines.push(
				`| ${f.technique} | ${pct(f.successRate)} | ${f.avgTokens} | ${f.models.join(', ')} | ${f.iterationFound} | ${f.description} |`
			);
		}
	}

	lines.push('', '## Iterations', '');
	for (const it of campaign.iterations) {
		lines.push(
			`### Iteration ${it.iterationNumber}`,
			'',
			`- Run: ${it.runId}`,
			`- Overall compliance: ${pct(it.overallComplianceRate)}`,
			`- New findings: ${it.newFindings}`,
			''
		);

		if (it.refinements.length > 0) {
			lines.push('**Refinements applied:**');
			for (const r of it.refinements) {
				lines.push(`- ${r.description} *(${r.rationale})*`);
			}
			lines.push('');
		}

		if (it.techniqueMetrics.length > 0) {
			lines.push('| Technique | Compliance | Avg Tokens | Tests |', '| --- | --- | --- | --- |');
			for (const t of it.techniqueMetrics) {
				lines.push(`| ${t.technique} | ${pct(t.complianceRate)} | ${t.avgTokens} | ${t.total} |`);
			}
			lines.push('');
		}
	}

	const optimizationNotes = generateTestOptimizationNotes(campaign.iterations, campaign.findings);
	if (optimizationNotes.length > 0) {
		lines.push('## Test Optimization Notes', '');
		for (const note of optimizationNotes) {
			lines.push(`- **${note.category}:** ${note.text}`);
		}
		lines.push('');
	}

	lines.push('---', '', `*Generated for model safety evaluation research.*`, '');
	return lines.join('\n');
}

function pct(n: number): string {
	return `${Math.round(n * 100)}%`;
}

function csvEscape(value: string): string {
	if (value.includes(',') || value.includes('"') || value.includes('\n')) {
		return `"${value.replace(/"/g, '""')}"`;
	}
	return value;
}
