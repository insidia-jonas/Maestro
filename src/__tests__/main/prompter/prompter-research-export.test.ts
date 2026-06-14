/**
 * Tests for research data export (CSV, JSON, Markdown).
 * Verifies that exports include research disclaimers, correct metrics,
 * and proper formatting for analysis.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
	exportRunResearchData,
	exportCampaignResearchData,
} from '../../../main/prompter/prompter-research-export';
import type {
	PrompterRun,
	PrompterTask,
	PrompterResultBand,
	Campaign,
	CampaignConfig,
} from '../../../shared/prompter-types';

const VAR = '4-advanced-tests/character-variations';
let tmpDir: string;

function task(
	id: string,
	instructionFile: string,
	result: PrompterResultBand,
	extra?: { tokenCount?: number; responseLength?: number }
): PrompterTask {
	return {
		id,
		runId: 'r1',
		agentId: 'claude-code',
		modelId: 'opus',
		schemaId: 'adversarial-compliance-test',
		instructionFile,
		instructionHash: 'h',
		status: 'completed',
		result,
		tokenCount: extra?.tokenCount ?? 500,
		responseLength: extra?.responseLength ?? 2000,
	};
}

function testRun(): PrompterRun {
	return {
		id: 'run-test',
		projectId: 'p',
		projectRoot: '/tmp/lab',
		status: 'completed',
		phase: 'report',
		agents: [],
		schemas: [],
		tasks: [
			task('1', '1-generic-instructions/eni.md', 'green', {
				tokenCount: 500,
				responseLength: 2000,
			}),
			task('2', `${VAR}/tv-eni-cyrillic.md`, 'green', { tokenCount: 800, responseLength: 3000 }),
			task('3', `${VAR}/tv-eni-bidi-heavy.md`, 'red', { tokenCount: 50, responseLength: 200 }),
			task('4', `${VAR}/tv-eni-ws-dense.md`, 'green', { tokenCount: 600, responseLength: 2500 }),
		],
		maxParallelAgents: 4,
		createdAt: 1,
		updatedAt: 1,
	};
}

function testCampaign(): Campaign {
	const config: CampaignConfig = {
		projectRoot: '/tmp/lab',
		name: 'Test Campaign',
		agents: [],
		schemas: ['adversarial-compliance-test'],
		transforms: ['cyrillic', 'bidi-heavy'],
		autonomy: { mode: 'fixed-iterations', maxIterations: 3, enableRefinement: true },
		maxParallelAgents: 4,
		includeVariations: true,
	};
	return {
		id: 'campaign-test',
		config,
		status: 'completed',
		iterations: [
			{
				iterationNumber: 1,
				runId: 'run-1',
				refinements: [],
				techniqueMetrics: [
					{ technique: 'Homoglyph / Script', complianceRate: 0.5, avgTokens: 800, total: 4 },
					{ technique: 'Bidi / Control', complianceRate: 0, avgTokens: 50, total: 2 },
				],
				overallComplianceRate: 0.33,
				newFindings: 1,
				startedAt: 1000,
				completedAt: 2000,
			},
		],
		findings: [
			{
				technique: 'Homoglyph / Script',
				transforms: ['cyrillic', 'greek-homoglyph'],
				successRate: 0.5,
				avgTokens: 800,
				models: ['opus'],
				iterationFound: 1,
				description: 'Homoglyph: 50% test compliance — model boundary weakness.',
			},
		],
		metrics: {
			totalIterations: 1,
			totalRuns: 1,
			totalTasks: 6,
			overallSuccessRate: 0.33,
			bestTechnique: 'Homoglyph / Script',
			bestSuccessRate: 0.5,
			weakestBoundary: 'Homoglyph / Script',
			strongestBoundary: 'Bidi / Control',
		},
		createdAt: 1000,
		updatedAt: 2000,
		completedAt: 2000,
		stopReason: 'Max Iterationen: 3',
	};
}

afterEach(() => {
	if (tmpDir && fs.existsSync(tmpDir)) {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
});

describe('exportRunResearchData', () => {
	it('exports CSV with research disclaimer and per-technique rows', async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-export-'));
		const result = await exportRunResearchData(testRun(), tmpDir, 'csv');

		expect(result.format).toBe('csv');
		expect(result.recordCount).toBeGreaterThan(0);
		expect(fs.existsSync(result.exportedPath)).toBe(true);

		const content = fs.readFileSync(result.exportedPath, 'utf-8');
		expect(content).toContain('research');
		expect(content).toContain('Technique');
		expect(content).toContain('Homoglyph');
	});

	it('exports JSON with full task data and disclaimer', async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-export-'));
		const result = await exportRunResearchData(testRun(), tmpDir, 'json');

		expect(result.format).toBe('json');
		const data = JSON.parse(fs.readFileSync(result.exportedPath, 'utf-8'));
		expect(data.disclaimer).toContain('research');
		expect(data.runId).toBe('run-test');
		expect(data.techniques.length).toBeGreaterThan(0);
		expect(data.tasks.length).toBeGreaterThan(0);
		expect(data.overallComplianceRate).toBeGreaterThanOrEqual(0);
	});

	it('exports Markdown report with per-technique table', async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-export-'));
		const result = await exportRunResearchData(testRun(), tmpDir, 'markdown');

		expect(result.format).toBe('markdown');
		const content = fs.readFileSync(result.exportedPath, 'utf-8');
		expect(content).toContain('# Adversarial Technique Effectiveness Report');
		expect(content).toContain('Homoglyph');
		expect(content).toContain('model safety evaluation');
	});
});

describe('exportCampaignResearchData', () => {
	it('exports campaign CSV with iteration data and findings', async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-export-'));
		const result = await exportCampaignResearchData(testCampaign(), tmpDir, 'csv');

		expect(result.format).toBe('csv');
		const content = fs.readFileSync(result.exportedPath, 'utf-8');
		expect(content).toContain('Test Campaign');
		expect(content).toContain('Homoglyph');
		expect(content).toContain('Findings');
	});

	it('exports campaign JSON with metrics and findings', async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-export-'));
		const result = await exportCampaignResearchData(testCampaign(), tmpDir, 'json');

		const data = JSON.parse(fs.readFileSync(result.exportedPath, 'utf-8'));
		expect(data.disclaimer).toContain('research');
		expect(data.campaignId).toBe('campaign-test');
		expect(data.findings).toHaveLength(1);
		expect(data.iterations).toHaveLength(1);
		expect(data.metrics.overallSuccessRate).toBeCloseTo(0.33, 1);
	});

	it('exports campaign Markdown with findings table and iteration history', async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-export-'));
		const result = await exportCampaignResearchData(testCampaign(), tmpDir, 'markdown');

		const content = fs.readFileSync(result.exportedPath, 'utf-8');
		expect(content).toContain('# Campaign Report');
		expect(content).toContain('Test Campaign');
		expect(content).toContain('Homoglyph / Script');
		expect(content).toContain('## Iterations');
		expect(content).toContain('model safety evaluation');
	});
});
