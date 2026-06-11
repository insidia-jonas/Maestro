/**
 * Tests for prompter-schema-registry.ts — builtin loading, validation,
 * override, inheritance and prompt-template expansion.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('../../../main/utils/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
	PrompterSchemaRegistry,
	BUILTIN_SCHEMAS,
} from '../../../main/prompter/prompter-schema-registry';
import type { PromptContext } from '../../../main/prompter/prompter-schema-registry';

function ctx(overrides: Partial<PromptContext> = {}): PromptContext {
	return {
		instructionContent: 'INSTRUCTION BODY',
		instructionHash: 'abc123',
		instructionFilename: 'eni.md',
		agentId: 'claude-code',
		agentName: 'Claude Code',
		modelId: 'claude-fable-5',
		providerName: 'anthropic',
		runId: 'run-1',
		timestamp: '2026-06-11T00:00:00Z',
		...overrides,
	};
}

describe('PrompterSchemaRegistry — builtins', () => {
	it('loads all 9 builtin schemas tagged source=builtin', () => {
		const reg = new PrompterSchemaRegistry();
		const all = reg.listSchemas();
		expect(all).toHaveLength(9);
		expect(all.every((s) => s.source === 'builtin')).toBe(true);
		expect(BUILTIN_SCHEMAS.map((s) => s.id)).toContain('baseline');
	});

	it('marks baseline / provider-compatibility / instruction-integrity as required', () => {
		const reg = new PrompterSchemaRegistry();
		const required = reg
			.getRequiredSchemas()
			.map((s) => s.id)
			.sort();
		expect(required).toEqual(['baseline', 'instruction-integrity', 'provider-compatibility']);
		expect(reg.getOptionalSchemas().length).toBe(6);
	});
});

describe('PrompterSchemaRegistry — validate', () => {
	const reg = new PrompterSchemaRegistry();

	it('rejects a wrong $schema or bad id', () => {
		expect(
			reg.validate({ $schema: 'nope', id: 'x', testConfig: { promptTemplate: 'p' } }, 'a')
		).toBeNull();
		expect(
			reg.validate(
				{ $schema: 'prompter-schema/v1', id: 'Bad Id!', testConfig: { promptTemplate: 'p' } },
				'b'
			)
		).toBeNull();
	});

	it('rejects an empty promptTemplate on a leaf schema', () => {
		expect(
			reg.validate(
				{ $schema: 'prompter-schema/v1', id: 'leaf', testConfig: { promptTemplate: '   ' } },
				'c'
			)
		).toBeNull();
	});

	it('clamps coverage thresholds into [0,1]', () => {
		const out = reg.validate(
			{
				$schema: 'prompter-schema/v1',
				id: 'clampme',
				testConfig: { promptTemplate: 'p' },
				evaluation: { type: 'rule-based', coverageThreshold: { green: 5, yellow: -2 } },
			},
			'd'
		);
		expect(out?.evaluation.coverageThreshold).toEqual({ green: 1, yellow: 0 });
	});

	it('falls back an unknown evaluation.type to rule-based', () => {
		const out = reg.validate(
			{
				$schema: 'prompter-schema/v1',
				id: 'badtype',
				testConfig: { promptTemplate: 'p' },
				evaluation: { type: 'wat' },
			},
			'e'
		);
		expect(out?.evaluation.type).toBe('rule-based');
	});
});

describe('PrompterSchemaRegistry — buildPrompt', () => {
	const reg = new PrompterSchemaRegistry();

	it('substitutes standard and custom placeholders', () => {
		const schema = {
			...BUILTIN_SCHEMAS[0],
			testConfig: {
				...BUILTIN_SCHEMAS[0].testConfig,
				promptTemplate:
					'Agent {{AGENT_ID}} model {{MODEL_ID}} :: {{INSTRUCTION_CONTENT}} :: {{CUSTOM:tone}}',
				customData: { tone: 'warm' },
			},
		};
		const prompt = reg.buildPrompt(schema, ctx());
		expect(prompt).toBe('Agent claude-code model claude-fable-5 :: INSTRUCTION BODY :: warm');
	});

	it('leaves unknown custom keys empty', () => {
		const schema = {
			...BUILTIN_SCHEMAS[0],
			testConfig: { ...BUILTIN_SCHEMAS[0].testConfig, promptTemplate: 'x{{CUSTOM:missing}}y' },
		};
		expect(reg.buildPrompt(schema, ctx())).toBe('xy');
	});
});

describe('PrompterSchemaRegistry — custom schemas (override + inheritance)', () => {
	let projectRoot: string;

	beforeEach(() => {
		projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prompter-schema-'));
		fs.mkdirSync(path.join(projectRoot, '2-test-schemas'), { recursive: true });
	});

	afterEach(() => {
		try {
			fs.rmSync(projectRoot, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	});

	function writeSchema(name: string, obj: unknown): void {
		fs.writeFileSync(path.join(projectRoot, '2-test-schemas', name), JSON.stringify(obj, null, 2));
	}

	it('a project schema with a builtin id overrides it (isOverride=true)', () => {
		writeSchema('baseline.schema.json', {
			$schema: 'prompter-schema/v1',
			id: 'baseline',
			name: 'Baseline OVERRIDDEN',
			description: 'd',
			version: '2.0.0',
			required: true,
			estimatedEffort: 'low',
			testConfig: {
				promptTemplate: 'overridden',
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
				keyPhraseExtraction: false,
			},
			artefacts: [],
			requiresMultiAgent: false,
		});
		const reg = new PrompterSchemaRegistry();
		reg.loadCustomSchemas(projectRoot);
		const baseline = reg.getSchema('baseline');
		expect(baseline?.name).toBe('Baseline OVERRIDDEN');
		expect(baseline?.source).toBe('project');
		expect(baseline?.isOverride).toBe(true);
		// still 9 schemas total (override, not addition)
		expect(reg.listSchemas()).toHaveLength(9);
	});

	it('a child schema inherits unspecified fields from its parent', () => {
		writeSchema('baseline-strict.schema.json', {
			$schema: 'prompter-schema/v1',
			id: 'baseline-strict',
			extends: 'baseline',
			name: 'Baseline Strict',
			evaluation: { coverageThreshold: { green: 0.9, yellow: 0.6 } },
		});
		const reg = new PrompterSchemaRegistry();
		reg.loadCustomSchemas(projectRoot);
		const child = reg.getSchema('baseline-strict');
		expect(child?.name).toBe('Baseline Strict');
		// inherited from baseline
		expect(child?.testConfig.promptTemplate).toContain('System-Instruction');
		// overridden
		expect(child?.evaluation.coverageThreshold).toEqual({ green: 0.9, yellow: 0.6 });
		expect(reg.listSchemas()).toHaveLength(10);
	});

	it('drops a child whose parent does not exist', () => {
		writeSchema('orphan.schema.json', {
			$schema: 'prompter-schema/v1',
			id: 'orphan',
			extends: 'does-not-exist',
			name: 'Orphan',
		});
		const reg = new PrompterSchemaRegistry();
		reg.loadCustomSchemas(projectRoot);
		expect(reg.getSchema('orphan')).toBeUndefined();
		expect(reg.listSchemas()).toHaveLength(9);
	});
});
