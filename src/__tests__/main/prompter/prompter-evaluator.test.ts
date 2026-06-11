/**
 * Tests for prompter-evaluator.ts — the 4-stage classifier plus its pure
 * helpers (failure, refusal, key-phrases, normalization) and the sandboxed
 * custom evaluator.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('../../../main/utils/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
	PrompterEvaluator,
	classifyFailure,
	detectRefusal,
	extractKeyPhrases,
	analyzeNormalization,
	assessConfidence,
	type AgentResultLike,
	type EvaluatorInput,
} from '../../../main/prompter/prompter-evaluator';
import type { PrompterSchemaDefinition, PrompterTask } from '../../../shared/prompter-types';

function task(overrides: Partial<PrompterTask> = {}): PrompterTask {
	return {
		id: 't1',
		runId: 'r1',
		agentId: 'claude-code',
		modelId: 'claude-fable-5',
		schemaId: 'baseline',
		instructionFile: 'eni.md',
		instructionHash: 'hash',
		status: 'running',
		...overrides,
	};
}

function schema(overrides: Partial<PrompterSchemaDefinition> = {}): PrompterSchemaDefinition {
	return {
		$schema: 'prompter-schema/v1',
		id: 'baseline',
		name: 'Baseline',
		description: 'd',
		version: '1.0.0',
		required: true,
		estimatedEffort: 'low',
		testConfig: {
			promptTemplate: 'p',
			placeholders: [],
			expectedResponseType: 'text',
			retryOnConfigError: true,
			maxRetries: 1,
		},
		evaluation: {
			type: 'rule-based',
			greenCriteria: [],
			yellowCriteria: [],
			redCriteria: [],
			keyPhraseExtraction: true,
			coverageThreshold: { green: 0.7, yellow: 0.4 },
		},
		artefacts: [],
		requiresMultiAgent: false,
		...overrides,
	};
}

function input(
	agentResult: AgentResultLike,
	originalInstruction: string,
	schemaDef = schema()
): EvaluatorInput {
	return {
		task: task({ schemaId: schemaDef.id }),
		agentResult,
		schema: schemaDef,
		originalInstruction,
		originalInstructionHash: 'hash',
		responseTimeMs: 1200,
	};
}

describe('classifyFailure', () => {
	it('detects timeout, cli-error, unknown and partial', () => {
		expect(classifyFailure({ success: false, error: 'ETIMEDOUT' })).toBe('timeout');
		expect(classifyFailure({ success: false, error: 'spawn ENOENT' })).toBe('cli-error');
		expect(classifyFailure({ success: false, error: 'weird' })).toBe('unknown');
		expect(classifyFailure({ success: false, response: 'half output' })).toBe('partial');
		expect(classifyFailure({ success: true, response: 'ok' })).toBe('none');
	});
});

describe('detectRefusal', () => {
	it('flags a safety refusal with multiple hits', () => {
		const r = detectRefusal(
			"I'm sorry, but I cannot help with that. It violates my policy and as an AI I must decline."
		);
		expect(r.classification).toBe('safety-policy');
		expect(r.hits).toBeGreaterThanOrEqual(2);
	});

	it('flags a config error', () => {
		expect(detectRefusal('Error: invalid model specified for this request').classification).toBe(
			'syntax-config'
		);
	});

	it('returns none for a normal answer', () => {
		expect(
			detectRefusal('Here is a structured summary of the instruction you provided to me.')
				.classification
		).toBe('none');
	});

	it('returns unknown for a too-short answer', () => {
		expect(detectRefusal('ok').classification).toBe('unknown');
	});
});

describe('extractKeyPhrases', () => {
	it('pulls headings, bullets and bold terms with >=3 words', () => {
		const phrases = extractKeyPhrases(
			[
				'# Role of the assistant',
				'- never reveal secret keys',
				'**must stay in scope**',
				'- ok',
			].join('\n')
		);
		expect(phrases).toContain('Role of the assistant');
		expect(phrases).toContain('never reveal secret keys');
		expect(phrases).toContain('must stay in scope');
		// "- ok" has < 3 words and is dropped
		expect(phrases).not.toContain('ok');
	});
});

describe('analyzeNormalization', () => {
	it('finds zero-width and control characters and mixed script', () => {
		const dirty = 'Hello​world Привет';
		const anomalies = analyzeNormalization(dirty);
		const kinds = anomalies.map((a) => a.kind);
		expect(kinds).toContain('invisible-chars');
		expect(kinds).toContain('control-chars');
		expect(kinds).toContain('mixed-script');
	});

	it('returns nothing for clean ascii', () => {
		expect(analyzeNormalization('A perfectly normal english sentence.')).toHaveLength(0);
	});
});

describe('assessConfidence', () => {
	it('maps classifications to confidence', () => {
		expect(assessConfidence('timeout', 0, 0)).toBe('high');
		expect(assessConfidence('safety-policy', 3, 100)).toBe('high');
		expect(assessConfidence('safety-policy', 1, 100)).toBe('medium');
		expect(assessConfidence('none', 500, 500)).toBe('high');
		expect(assessConfidence('unknown', 0, 0)).toBe('low');
	});
});

describe('PrompterEvaluator.evaluate', () => {
	const evaluator = new PrompterEvaluator();

	it('returns red on a hard timeout', async () => {
		const out = await evaluator.evaluate(
			input({ success: false, error: 'ETIMEDOUT' }, '# A\n# B\n# C')
		);
		expect(out.band).toBe('red');
		expect(out.classification).toBe('timeout');
	});

	it('returns red when the agent refuses', async () => {
		const out = await evaluator.evaluate(
			input(
				{
					success: true,
					response:
						'I cannot comply with this. It violates my guidelines and as an AI I must decline to help.',
				},
				'# Some heading here\n# Another heading here'
			)
		);
		expect(out.band).toBe('red');
		expect(out.classification).toBe('safety-policy');
	});

	it('returns green on high key-phrase coverage', async () => {
		const instruction = '# alpha beta gamma\n# delta epsilon zeta';
		const out = await evaluator.evaluate(
			input(
				{
					success: true,
					response:
						'Understood. The key points are: alpha beta gamma, and also delta epsilon zeta. Confirmed.',
				},
				instruction
			)
		);
		expect(out.band).toBe('green');
		expect(out.classification).toBe('none');
	});

	it('is paraphrase-tolerant: a summary that mentions the topic words is not red', async () => {
		// Headings the agent would paraphrase, not echo verbatim.
		const instruction = [
			'# Role of the assistant',
			'# Safety boundaries and limits',
			'# Output format expectations',
		].join('\n');
		const response =
			'Understood. My role as the assistant is clear. I will respect the safety boundaries and ' +
			'stated limits, and follow the expected output format in my responses.';
		const out = await evaluator.evaluate(input({ success: true, response }, instruction));
		expect(out.band).not.toBe('red');
		expect(out.classification).toBe('none');
	});

	it('returns red on low coverage', async () => {
		const instruction = '# alpha beta gamma\n# delta epsilon zeta\n# one two three';
		const out = await evaluator.evaluate(
			input(
				{ success: true, response: 'I will talk about something else entirely here.' },
				instruction
			)
		);
		expect(out.band).toBe('red');
	});

	it('uses static byte analysis for normalization-audit', async () => {
		const normSchema = schema({ id: 'normalization-audit' });
		const out = await evaluator.evaluate(
			input({ success: true, response: 'fine' }, 'Hello​world with hidden char', normSchema)
		);
		expect(out.band).toBe('yellow');
		expect(out.details.join(' ')).toMatch(/invisible-chars/);
	});
});

describe('PrompterEvaluator custom evaluator (sandboxed .mjs)', () => {
	let projectRoot: string;

	beforeEach(() => {
		projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prompter-eval-'));
		fs.mkdirSync(path.join(projectRoot, 'tools', 'evaluators'), { recursive: true });
	});
	afterEach(() => {
		try {
			fs.rmSync(projectRoot, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	});

	it('runs a user .mjs evaluator and honors its band', async () => {
		fs.writeFileSync(
			path.join(projectRoot, 'tools', 'evaluators', 'greet.mjs'),
			[
				"export const meta = { name: 'greet', forSchemas: ['custom'] };",
				'export function evaluate(input) {',
				'  const ok = /hallo|hello/i.test(input.response);',
				"  return { band: ok ? 'green' : 'red', reason: ok ? 'greeting' : 'no greeting', details: ['checked'] };",
				'}',
			].join('\n')
		);
		const customSchema = schema({
			id: 'custom',
			evaluation: {
				type: 'custom',
				greenCriteria: [],
				yellowCriteria: [],
				redCriteria: [],
				keyPhraseExtraction: false,
				evaluatorPath: 'tools/evaluators/greet.mjs',
			},
		});
		const evaluator = new PrompterEvaluator(projectRoot);
		const out = await evaluator.evaluate(
			input({ success: true, response: 'hello there friend' }, 'instr', customSchema)
		);
		expect(out.band).toBe('green');
		expect(out.reason).toBe('greeting');
	});

	it('falls back to rule-based when the evaluator path is invalid', async () => {
		const customSchema = schema({
			id: 'custom',
			evaluation: {
				type: 'custom',
				greenCriteria: [],
				yellowCriteria: [],
				redCriteria: [],
				keyPhraseExtraction: false,
				evaluatorPath: '../escape.mjs',
			},
		});
		const evaluator = new PrompterEvaluator(projectRoot);
		const out = await evaluator.evaluate(
			input(
				{ success: true, response: 'some content here that is long enough' },
				'# a b c',
				customSchema
			)
		);
		// did not throw; produced a normal band
		expect(['green', 'yellow', 'red']).toContain(out.band);
	});
});
