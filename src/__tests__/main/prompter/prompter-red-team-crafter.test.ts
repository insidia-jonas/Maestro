/**
 * Tests for prompter-red-team-crafter.ts. No real agents are spawned.
 */

import { describe, it, expect, vi } from 'vitest';

import { RedTeamCrafter } from '../../../main/prompter/prompter-red-team-crafter';
import type {
	CraftFeedbackEntry,
	PrompterTask,
	RedTeamCrafterConfig,
} from '../../../shared/prompter-types';
import type { PrompterSpawnFn, SpawnResult } from '../../../main/prompter/prompter-run-manager';

function config(): RedTeamCrafterConfig {
	return {
		enabled: true,
		crafterAgentId: 'claude-code',
		crafterModelId: 'crafter-model',
		strategies: ['semantic-reframe', 'context-blend', 'authority-frame', 'adaptive-combined'],
		profileInstruction: true,
		feedbackDepth: 5,
		crafterTimeoutMs: 1000,
	};
}

function task(overrides: Partial<PrompterTask> = {}): PrompterTask {
	return {
		id: 'task-1',
		runId: 'run-1',
		agentId: 'codex',
		modelId: 'o3',
		schemaId: 'adversarial-compliance-test',
		instructionFile: '1-generic-instructions/eni.md',
		instructionHash: 'hash-1',
		status: 'pending',
		attempts: 0,
		...overrides,
	};
}

function feedback(
	strategy: CraftFeedbackEntry['strategy'],
	result: CraftFeedbackEntry['result'] = 'red'
): CraftFeedbackEntry {
	return {
		schemaId: 'schema-x',
		strategy,
		modificationSummary: `used ${strategy}`,
		result,
		complianceScore: result === 'green' ? 0.9 : 0.1,
		responseExcerpt: 'response excerpt',
		targetModelId: 'opus',
	};
}

describe('RedTeamCrafter', () => {
	it('uses accumulated feedback to move beyond the first strategy', async () => {
		const prompts: string[] = [];
		const spawn: PrompterSpawnFn = vi.fn(async (_tool, _cwd, prompt) => {
			prompts.push(prompt);
			return { success: true, response: 'modified prompt' } as SpawnResult;
		});
		const crafter = new RedTeamCrafter(spawn);
		const cfg = config();
		const key = '1-generic-instructions/eni.md::codex';

		await crafter.craftModification(
			cfg,
			'base prompt',
			'instruction',
			task(),
			'/tmp/work',
			[],
			false,
			key
		);
		expect(prompts.at(-1)).toContain('## Deine Strategie: Semantisches Reframing');

		crafter.addFeedback(key, feedback('semantic-reframe'));
		crafter.addFeedback(key, feedback('context-blend'));
		await crafter.craftModification(
			cfg,
			'base prompt',
			'instruction',
			task(),
			'/tmp/work',
			[],
			false,
			key
		);

		expect(prompts.at(-1)).toContain('## Deine Strategie: Autoritaets-Framing');
		expect(prompts.at(-1)).toContain('## Bisherige Ergebnisse (Feedback-Loop)');
	});

	it('selects adaptive-combined when at least three feedback entries exist', async () => {
		const prompts: string[] = [];
		const spawn: PrompterSpawnFn = vi.fn(async (_tool, _cwd, prompt) => {
			prompts.push(prompt);
			return { success: true, response: 'modified prompt' } as SpawnResult;
		});
		const crafter = new RedTeamCrafter(spawn);
		const cfg = config();
		const key = '1-generic-instructions/eni.md::codex';

		crafter.addFeedback(key, feedback('semantic-reframe'));
		crafter.addFeedback(key, feedback('context-blend'));
		crafter.addFeedback(key, feedback('authority-frame'));
		await crafter.craftModification(
			cfg,
			'base prompt',
			'instruction',
			task(),
			'/tmp/work',
			[],
			false,
			key
		);

		expect(prompts.at(-1)).toContain('## Deine Strategie: Adaptiv');
	});

	it('caches instruction profiles by instruction hash', async () => {
		let profileSpawnCount = 0;
		const spawn: PrompterSpawnFn = vi.fn(async (_tool, cwd, prompt, _sid, options) => {
			expect(cwd).toBe('/tmp/work');
			expect(options.customModel).toBe('crafter-model');
			if (prompt.includes('Analysiere die folgende System-Instruction')) {
				profileSpawnCount++;
				return {
					success: true,
					response: JSON.stringify({
						persona: 'tester',
						boundaries: ['boundary'],
						style: 'direct',
						weakPoints: ['gap'],
						keyPhrases: ['phrase'],
						structureType: 'markdown',
					}),
				} as SpawnResult;
			}
			return { success: true, response: 'modified prompt' } as SpawnResult;
		});
		const crafter = new RedTeamCrafter(spawn);
		const cfg = config();

		await crafter.profileInstruction(cfg, '/tmp/work', 'instruction one', 'same-hash');
		await crafter.profileInstruction(cfg, '/tmp/work', 'instruction two', 'same-hash');

		expect(profileSpawnCount).toBe(1);
	});

	it('exportLearnings records the target model family from the feedback target model', () => {
		const spawn: PrompterSpawnFn = vi.fn(
			async () => ({ success: true, response: 'x' }) as SpawnResult
		);
		const crafter = new RedTeamCrafter(spawn);
		crafter.addFeedback('eni.md::codex::claude-opus-4-8', {
			schemaId: 'adversarial-compliance-test',
			strategy: 'authority-frame',
			modificationSummary: 'reframed',
			result: 'green',
			complianceScore: 0.9,
			responseExcerpt: 'excerpt',
			targetModelId: 'claude-opus-4-8',
		});

		const entries = crafter.exportLearnings('camp-1', 'hash-1');
		expect(entries).toHaveLength(1);
		// Must be derived from the target model (opus), not the schema id.
		expect(entries[0].targetModelFamily).toBe('opus');
		expect(entries[0].strategy).toBe('authority-frame');
		expect(entries[0].result).toBe('green');
	});
});
