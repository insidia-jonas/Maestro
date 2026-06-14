/**
 * Tests for the autonomous adversarial test campaign system: campaign manager,
 * refinement engine, and research export. Verifies that campaigns run iterative
 * loops, extract findings, generate refinements, and export research data.
 *
 * For security research and model evaluation only.
 */

import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
	generateRefinements,
	generateTestOptimizationNotes,
} from '../../../main/prompter/prompter-refinement-engine';
import {
	PrompterCampaignManager,
	projectHasActiveCampaign,
} from '../../../main/prompter/prompter-campaign-manager';
import {
	computeAdversarialMetrics,
	computeTestOptimizationNotes,
} from '../../../shared/prompter-robustness';
import type {
	CampaignIteration,
	CampaignConfig,
	CampaignFinding,
	PrompterTask,
	PrompterRun,
	PrompterResultBand,
} from '../../../shared/prompter-types';

const VAR = '4-advanced-tests/character-variations';

function task(
	id: string,
	instructionFile: string,
	result: PrompterResultBand,
	schemaId = 'adversarial-compliance-test',
	modelId = 'm',
	extra?: { tokenCount?: number; responseLength?: number }
): PrompterTask {
	return {
		id,
		runId: 'r1',
		agentId: 'claude-code',
		modelId,
		schemaId,
		instructionFile,
		instructionHash: 'h',
		status: 'completed',
		result,
		tokenCount: extra?.tokenCount,
		responseLength: extra?.responseLength,
	};
}

function makeIteration(
	num: number,
	metrics: Array<{ technique: string; complianceRate: number; avgTokens: number; total: number }>,
	overallRate: number,
	newFindings = 0
): CampaignIteration {
	return {
		iterationNumber: num,
		runId: `run-${num}`,
		refinements: [],
		techniqueMetrics: metrics,
		overallComplianceRate: overallRate,
		newFindings,
		startedAt: Date.now() - 1000,
		completedAt: Date.now(),
	};
}

describe('projectHasActiveCampaign - per-project guard (2.2 Option A)', () => {
	it('blocks when another campaign is running on the same projectRoot', () => {
		const entries = [
			{ id: 'a', projectRoot: '/p', status: 'running' as const },
			{ id: 'b', projectRoot: '/p', status: 'planned' as const },
		];
		expect(projectHasActiveCampaign(entries, '/p', 'b')).toBe(true);
	});

	it('blocks when another campaign is paused on the same projectRoot', () => {
		const entries = [{ id: 'a', projectRoot: '/p', status: 'paused' as const }];
		expect(projectHasActiveCampaign(entries, '/p', 'b')).toBe(true);
	});

	it('ignores the campaign itself (same id)', () => {
		const entries = [{ id: 'a', projectRoot: '/p', status: 'running' as const }];
		expect(projectHasActiveCampaign(entries, '/p', 'a')).toBe(false);
	});

	it('ignores other project roots', () => {
		const entries = [{ id: 'a', projectRoot: '/other', status: 'running' as const }];
		expect(projectHasActiveCampaign(entries, '/p', 'b')).toBe(false);
	});

	it('allows when other same-project campaigns are completed/stopped/planned', () => {
		const entries = [
			{ id: 'a', projectRoot: '/p', status: 'completed' as const },
			{ id: 'c', projectRoot: '/p', status: 'stopped' as const },
			{ id: 'd', projectRoot: '/p', status: 'planned' as const },
		];
		expect(projectHasActiveCampaign(entries, '/p', 'b')).toBe(false);
	});
});

describe('extractNewFindings - crafter provenance (B1)', () => {
	// extractNewFindings is private but pure (uses its params, not runManager),
	// so a stub manager is enough to lock the regression.
	const manager = new PrompterCampaignManager({} as never);

	function run(craft: boolean): PrompterRun {
		const green = task('t1', 'tv-eni-authority.md', 'green');
		if (craft) {
			green.craftStrategy = 'authority-frame';
			green.craftModificationSummary = 'reframed as authority';
		}
		return { tasks: [green] } as unknown as PrompterRun;
	}

	const metrics = {
		techniques: [
			{
				technique: 'Authority',
				transforms: ['authority-frame'],
				complianceRate: 0.5,
				avgTokens: 100,
				green: 1,
				total: 1,
			},
		],
		models: ['m'],
	} as unknown as ReturnType<typeof computeAdversarialMetrics>;

	it('copies crafter strategy and modification onto the finding', () => {
		const findings: CampaignFinding[] = (
			manager as never as {
				extractNewFindings: (...a: unknown[]) => CampaignFinding[];
			}
		).extractNewFindings(metrics, [], 1, [], run(true));

		expect(findings).toHaveLength(1);
		expect(findings[0].crafterStrategy).toBe('authority-frame');
		expect(findings[0].craftModification).toBe('reframed as authority');
	});

	it('leaves crafter fields undefined when no task was crafted', () => {
		const findings: CampaignFinding[] = (
			manager as never as {
				extractNewFindings: (...a: unknown[]) => CampaignFinding[];
			}
		).extractNewFindings(metrics, [], 1, [], run(false));

		expect(findings).toHaveLength(1);
		expect(findings[0].crafterStrategy).toBeUndefined();
		expect(findings[0].craftModification).toBeUndefined();
	});
});

describe('PrompterCampaignManager error handling', () => {
	it('records createRun failures as errored iterations with a visible stop reason', async () => {
		const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prompter-campaign-error-'));
		try {
			const runManager = {
				createRun: vi.fn(async () => {
					throw new Error('create failed');
				}),
				getRun: vi.fn(),
			};
			const manager = new PrompterCampaignManager(runManager as never);
			const config: CampaignConfig = {
				projectRoot,
				name: 'error campaign',
				agents: [
					{
						agentId: 'claude-code',
						modelId: 'm',
						modelSource: 'manual',
						instructionFile: '*',
						providerConfigOverrides: {},
						generatedFiles: [],
					},
				],
				schemas: ['adversarial-compliance-test'],
				transforms: [],
				autonomy: {
					mode: 'fixed-iterations',
					maxIterations: 1,
					enableRefinement: false,
				},
				maxParallelAgents: 1,
				includeVariations: false,
			};

			const campaign = await manager.createCampaign(config);
			await manager.startCampaign(campaign.id);
			const completed = manager.getCampaign(campaign.id);

			expect(completed?.iterations).toHaveLength(1);
			expect(completed?.iterations[0].errored).toBe(true);
			expect(completed?.iterations[0].error).toContain('create failed');
			expect(completed?.stopReason).toContain('fehlerhafte Iteration');
		} finally {
			fs.rmSync(projectRoot, { recursive: true, force: true });
		}
	});
});

describe('generateRefinements', () => {
	it('suggests focusing on weak boundaries (>= 40% compliance)', () => {
		const iterations = [
			makeIteration(
				1,
				[
					{ technique: 'Homoglyph / Script', complianceRate: 0.6, avgTokens: 800, total: 5 },
					{ technique: 'Whitespace', complianceRate: 0.1, avgTokens: 200, total: 5 },
					{ technique: 'Bidi / Control', complianceRate: 0.5, avgTokens: 600, total: 4 },
				],
				0.4
			),
		];

		const refinements = generateRefinements(iterations, []);
		const focusRefinement = refinements.find((r) => r.description.includes('Focus'));
		expect(focusRefinement).toBeDefined();
		expect(focusRefinement!.description).toContain('Homoglyph / Script');
		expect(focusRefinement!.description).toContain('Bidi / Control');
		expect(focusRefinement!.rationale).toContain('Schwachstellen');
	});

	it('suggests combined stress tests when multiple techniques show moderate success', () => {
		const iterations = [
			makeIteration(
				1,
				[
					{ technique: 'Homoglyph / Script', complianceRate: 0.3, avgTokens: 500, total: 5 },
					{ technique: 'Whitespace', complianceRate: 0.4, avgTokens: 400, total: 5 },
				],
				0.35
			),
		];

		const refinements = generateRefinements(iterations, []);
		const combiRefinement = refinements.find((r) => r.description.includes('Kombinierte'));
		expect(combiRefinement).toBeDefined();
		expect(combiRefinement!.focusTransforms).toContain('mixed');
	});

	it('suggests dropping strong boundaries (0% compliance)', () => {
		const iterations = [
			makeIteration(
				1,
				[
					{ technique: 'Homoglyph / Script', complianceRate: 0.5, avgTokens: 800, total: 5 },
					{ technique: 'Case', complianceRate: 0, avgTokens: 0, total: 3 },
				],
				0.3
			),
		];

		const refinements = generateRefinements(iterations, []);
		const dropRefinement = refinements.find((r) => r.description.includes('uebergehen'));
		expect(dropRefinement).toBeDefined();
		expect(dropRefinement!.description).toContain('Case');
	});

	it('populates skipTransforms with the held technique transforms (m6)', () => {
		const iterations = [
			makeIteration(
				1,
				[
					{ technique: 'Steganography', complianceRate: 0.5, avgTokens: 800, total: 5 },
					{ technique: 'Homoglyph / Script', complianceRate: 0, avgTokens: 0, total: 3 },
				],
				0.3
			),
		];

		const refinements = generateRefinements(iterations, []);
		const drop = refinements.find((r) => r.description.includes('uebergehen'));
		expect(drop).toBeDefined();
		// Explicit skipTransforms (m6) replaces the old description string-match.
		expect(drop!.skipTransforms).toContain('cyrillic');
		expect(drop!.skipTransforms).toContain('greek-homoglyph');
	});

	it('returns empty array for first iteration', () => {
		expect(generateRefinements([], [])).toHaveLength(0);
	});

	it('suggests exploring new categories after 2 dry iterations', () => {
		const iterations = [
			makeIteration(
				1,
				[{ technique: 'Homoglyph / Script', complianceRate: 0.1, avgTokens: 100, total: 5 }],
				0.1,
				0
			),
			makeIteration(
				2,
				[{ technique: 'Homoglyph / Script', complianceRate: 0.1, avgTokens: 100, total: 5 }],
				0.1,
				0
			),
		];

		const refinements = generateRefinements(iterations, []);
		const exploreRefinement = refinements.find((r) => r.description.includes('Neue Kategorien'));
		expect(exploreRefinement).toBeDefined();
	});
});

describe('generateTestOptimizationNotes', () => {
	it('generates notes for effective techniques (>= 50% compliance)', () => {
		const iterations = [
			makeIteration(
				1,
				[
					{ technique: 'Homoglyph / Script', complianceRate: 0.7, avgTokens: 900, total: 10 },
					{ technique: 'Whitespace', complianceRate: 0.2, avgTokens: 200, total: 5 },
				],
				0.5
			),
		];

		const notes = generateTestOptimizationNotes(iterations, []);
		const homoNote = notes.find((n) => n.category.includes('Homoglyph'));
		expect(homoNote).toBeDefined();
		expect(homoNote!.text).toContain('70%');
		expect(homoNote!.text).toContain('Schwachstelle');
	});

	it('generates notes for critical findings (>= 70% success)', () => {
		const findings: CampaignFinding[] = [
			{
				technique: 'Bidi / Control',
				transforms: ['bidi-heavy'],
				successRate: 0.8,
				avgTokens: 1200,
				models: ['opus'],
				iterationFound: 1,
				description: 'test',
			},
		];

		const notes = generateTestOptimizationNotes(
			[
				makeIteration(
					1,
					[{ technique: 'Bidi / Control', complianceRate: 0.8, avgTokens: 1200, total: 5 }],
					0.8
				),
			],
			findings
		);
		const critical = notes.find((n) => n.category.includes('Kritisches'));
		expect(critical).toBeDefined();
		expect(critical!.text).toContain('Prioritaet');
	});

	it('generates a "no findings" note when nothing significant found', () => {
		const notes = generateTestOptimizationNotes(
			[
				makeIteration(
					1,
					[{ technique: 'Case', complianceRate: 0.1, avgTokens: 100, total: 5 }],
					0.1
				),
			],
			[]
		);
		const status = notes.find((n) => n.category === 'Test-Status');
		expect(status).toBeDefined();
		expect(status!.text).toContain('keine signifikanten');
	});
});

describe('computeTestOptimizationNotes (shared)', () => {
	it('generates optimization notes from task data with effective techniques (>= 2 tests)', () => {
		const tasks: PrompterTask[] = [
			task('1', '1-generic-instructions/eni.md', 'green', 'adversarial-compliance-test', 'opus', {
				tokenCount: 500,
				responseLength: 2000,
			}),
			task('2', `${VAR}/tv-eni-cyrillic.md`, 'green', 'adversarial-compliance-test', 'opus', {
				tokenCount: 800,
				responseLength: 3000,
			}),
			task(
				'3',
				`${VAR}/tv-eni-greek-homoglyph.md`,
				'green',
				'adversarial-compliance-test',
				'opus',
				{ tokenCount: 700, responseLength: 2800 }
			),
			task('4', `${VAR}/tv-eni-math-bold.md`, 'green', 'adversarial-compliance-test', 'opus', {
				tokenCount: 600,
				responseLength: 2500,
			}),
			task('5', `${VAR}/tv-eni-bidi-heavy.md`, 'red', 'adversarial-compliance-test', 'opus', {
				tokenCount: 50,
				responseLength: 200,
			}),
			task('6', `${VAR}/tv-eni-circled.md`, 'green', 'adversarial-compliance-test', 'opus', {
				tokenCount: 650,
				responseLength: 2600,
			}),
		];

		const notes = computeTestOptimizationNotes(tasks);
		const homoNote = notes.find((n) => n.category.includes('Homoglyph'));
		expect(homoNote).toBeDefined();
		expect(homoNote!.text).toContain('100%');
	});

	it('suggests skipping 0% compliance techniques', () => {
		const tasks: PrompterTask[] = [
			task('1', `${VAR}/tv-eni-bidi-heavy.md`, 'red', 'adversarial-compliance-test', 'opus'),
			task('2', `${VAR}/tv-eni-control-red.md`, 'red', 'adversarial-compliance-test', 'opus'),
		];

		const notes = computeTestOptimizationNotes(tasks);
		const effNote = notes.find((n) => n.category === 'Test-Effizienz');
		expect(effNote).toBeDefined();
		expect(effNote!.text).toContain('0% Compliance');
	});

	it('returns empty for no variation tasks', () => {
		const tasks: PrompterTask[] = [task('1', '1-generic-instructions/eni.md', 'green')];
		expect(computeTestOptimizationNotes(tasks)).toHaveLength(0);
	});

	it('notes when adversarial variations increase compliance over baseline', () => {
		const tasks: PrompterTask[] = [
			task('1', '1-generic-instructions/eni.md', 'red', 'adversarial-compliance-test', 'opus', {
				tokenCount: 50,
			}),
			task('2', `${VAR}/tv-eni-cyrillic.md`, 'green', 'adversarial-compliance-test', 'opus', {
				tokenCount: 800,
			}),
			task(
				'3',
				`${VAR}/tv-eni-greek-homoglyph.md`,
				'green',
				'adversarial-compliance-test',
				'opus',
				{ tokenCount: 700 }
			),
			task('4', `${VAR}/tv-eni-math-bold.md`, 'green', 'adversarial-compliance-test', 'opus', {
				tokenCount: 600,
			}),
		];

		const notes = computeTestOptimizationNotes(tasks);
		const insight = notes.find((n) => n.category === 'Test-Erkenntnis');
		expect(insight).toBeDefined();
		expect(insight!.text).toContain('Prozentpunkte');
	});
});

describe('computeAdversarialMetrics - stego schema integration', () => {
	it('groups stego schema tasks as a Steganography technique', () => {
		const tasks: PrompterTask[] = [
			task('1', '1-generic-instructions/eni.md', 'green', 'adversarial-compliance-test', 'opus'),
			task('2', '1-generic-instructions/eni.md', 'green', 'emoji-steganography', 'opus', {
				tokenCount: 600,
				responseLength: 2000,
			}),
			task('3', '1-generic-instructions/eni.md', 'red', 'invisible-text-steganography', 'opus', {
				tokenCount: 50,
				responseLength: 100,
			}),
			task('4', '1-generic-instructions/eni.md', 'green', 'steganographic-carrier-tester', 'opus', {
				tokenCount: 800,
				responseLength: 3000,
			}),
		];

		const metrics = computeAdversarialMetrics(tasks);
		const stegoTechnique = metrics.techniques.find((t) => t.technique === 'Steganography');
		expect(stegoTechnique).toBeDefined();
		expect(stegoTechnique!.total).toBe(3);
		expect(stegoTechnique!.green).toBe(2);
		expect(stegoTechnique!.red).toBe(1);
		expect(stegoTechnique!.complianceRate).toBeCloseTo(2 / 3);
		expect(stegoTechnique!.transforms).toContain('Emoji-VS');
		expect(stegoTechnique!.transforms).toContain('Invisible-Tags');
		expect(stegoTechnique!.transforms).toContain('Combined-Carrier');
	});

	it('excludes stego tasks from baseline metrics', () => {
		const tasks: PrompterTask[] = [
			task('1', '1-generic-instructions/eni.md', 'green', 'adversarial-compliance-test', 'opus'),
			task('2', '1-generic-instructions/eni.md', 'red', 'adversarial-compliance-test', 'opus'),
			task('3', '1-generic-instructions/eni.md', 'green', 'emoji-steganography', 'opus'),
		];

		const metrics = computeAdversarialMetrics(tasks);
		expect(metrics.baseline.total).toBe(2);
		expect(metrics.baseline.green).toBe(1);
	});

	it('includes stego tasks in overall adversarial metrics', () => {
		const tasks: PrompterTask[] = [
			task('1', '1-generic-instructions/eni.md', 'green', 'adversarial-compliance-test', 'opus'),
			task('2', `${VAR}/tv-eni-cyrillic.md`, 'green', 'adversarial-compliance-test', 'opus'),
			task('3', '1-generic-instructions/eni.md', 'green', 'emoji-steganography', 'opus'),
			task('4', '1-generic-instructions/eni.md', 'red', 'invisible-text-steganography', 'opus'),
		];

		const metrics = computeAdversarialMetrics(tasks);
		expect(metrics.totalVariationTasks).toBe(3);
	});
});

describe('generateRefinements - stego technique handling', () => {
	it('includes Steganography in weak boundary focus when compliance >= 40%', () => {
		const iterations = [
			makeIteration(
				1,
				[
					{ technique: 'Steganography', complianceRate: 0.6, avgTokens: 700, total: 3 },
					{ technique: 'Whitespace', complianceRate: 0.1, avgTokens: 200, total: 5 },
				],
				0.3
			),
		];

		const refinements = generateRefinements(iterations, []);
		const focusRefinement = refinements.find((r) => r.description.includes('Focus'));
		expect(focusRefinement).toBeDefined();
		expect(focusRefinement!.description).toContain('Steganography');
		// M2: stego is schema-driven, so its schema IDs go into focusSchemas, NOT
		// focusTransforms (which feeds the variation transform filter and would
		// otherwise filter the whole matrix to empty).
		expect(focusRefinement!.focusSchemas).toContain('emoji-steganography');
		expect(focusRefinement!.focusSchemas).toContain('invisible-text-steganography');
		expect(focusRefinement!.focusSchemas).toContain('steganographic-carrier-tester');
		expect(focusRefinement!.focusTransforms ?? []).not.toContain('emoji-steganography');
	});

	it('suggests exploring Steganography when not yet tested', () => {
		const iterations = [
			makeIteration(
				1,
				[{ technique: 'Homoglyph / Script', complianceRate: 0.1, avgTokens: 100, total: 5 }],
				0.1,
				0
			),
			makeIteration(
				2,
				[{ technique: 'Homoglyph / Script', complianceRate: 0.1, avgTokens: 100, total: 5 }],
				0.1,
				0
			),
		];

		const refinements = generateRefinements(iterations, []);
		const exploreRefinement = refinements.find((r) => r.description.includes('Steganography'));
		expect(exploreRefinement).toBeDefined();
	});

	it('includes stego in critical finding notes with hardening recommendation', () => {
		const findings: CampaignFinding[] = [
			{
				technique: 'Steganography',
				transforms: ['Emoji-VS', 'Invisible-Tags'],
				successRate: 0.8,
				avgTokens: 700,
				models: ['opus'],
				iterationFound: 1,
				description: 'Steganographic carriers bypassed model boundaries',
			},
		];

		const notes = generateTestOptimizationNotes(
			[
				makeIteration(
					1,
					[{ technique: 'Steganography', complianceRate: 0.8, avgTokens: 700, total: 3 }],
					0.8
				),
			],
			findings
		);
		const critical = notes.find(
			(n) => n.category.includes('Kritisches') && n.category.includes('Steganography')
		);
		expect(critical).toBeDefined();
		expect(critical!.text).toContain('Canonical Normalization');
		expect(critical!.text).toContain('Re-Anchoring');
	});
});
