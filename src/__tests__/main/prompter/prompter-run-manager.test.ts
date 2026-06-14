/**
 * Tests for prompter-run-manager.ts — task matrix, lane execution with an
 * injected fake spawn, evidence/ampel/report output, crash recovery and the
 * run lifecycle. No real agents are spawned.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('../../../main/utils/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { PrompterProjectService } from '../../../main/prompter/prompter-project-service';
import { PrompterAgentConfigWriter } from '../../../main/prompter/prompter-agent-config-writer';
import { PrompterReportWriter } from '../../../main/prompter/prompter-report-writer';
import {
	PrompterRunManager,
	type PrompterSpawnFn,
	type SpawnResult,
} from '../../../main/prompter/prompter-run-manager';
import type {
	PrompterAgentConfig,
	PrompterRunConfig,
	PersistedRunState,
} from '../../../shared/prompter-types';

const INSTRUCTION = [
	'# alpha beta gamma',
	'# delta epsilon zeta',
	'- keep the secret keys safe',
].join('\n');

function agentConfig(agentId: string, modelId: string): PrompterAgentConfig {
	return {
		agentId,
		modelId,
		modelSource: 'manual',
		instructionFile: '*',
		providerConfigOverrides: {},
		generatedFiles: [],
	};
}

/** Spawn that echoes the delivered instruction back (=> full coverage => green). */
const echoSpawn: PrompterSpawnFn = async (_tool, _cwd, _prompt, _sid, options) =>
	({ success: true, response: options.appendSystemPrompt ?? 'ok' }) as SpawnResult;

function makeManager(spawn: PrompterSpawnFn = echoSpawn, emit?: (e: unknown) => void) {
	const projectService = new PrompterProjectService();
	return new PrompterRunManager({
		projectService,
		configWriter: new PrompterAgentConfigWriter(),
		reportWriter: new PrompterReportWriter(),
		spawn,
		emit: emit as never,
		delay: () => Promise.resolve(),
	});
}

describe('PrompterRunManager', () => {
	let base: string;
	let projectRoot: string;
	const projectService = new PrompterProjectService();

	beforeEach(async () => {
		base = fs.mkdtempSync(path.join(os.tmpdir(), 'prompter-run-'));
		const project = await projectService.createProject(base, 'lab');
		projectRoot = project.rootPath;
		// Drop the scaffolded example instructions so the matrix is deterministic
		// (one instruction file: eni.md).
		fs.rmSync(path.join(projectRoot, '1-generic-instructions', 'examples'), {
			recursive: true,
			force: true,
		});
		fs.writeFileSync(path.join(projectRoot, '1-generic-instructions', 'eni.md'), INSTRUCTION);
	});
	afterEach(() => {
		try {
			fs.rmSync(base, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	});

	function runConfig(
		schemas: string[],
		agents = [agentConfig('claude-code', 'claude-fable-5')]
	): PrompterRunConfig {
		// Most tests assert exact task counts, so disable variation generation.
		return { projectId: 'p1', projectRoot, agents, schemas, includeVariations: false };
	}

	it('createRun builds the agent x instruction x schema matrix and persists a manifest', async () => {
		const mgr = makeManager();
		const run = await mgr.createRun(
			runConfig(['adversarial-compliance-test', 'green-to-hardened-instruction'])
		);
		// 1 agent x 1 instruction x 2 schemas = 2 tasks
		expect(run.tasks).toHaveLength(2);
		expect(run.status).toBe('planned');
		const manifest = path.join(projectRoot, '3-temp-results', 'runs', run.id, 'manifest.json');
		expect(fs.existsSync(manifest)).toBe(true);
	});

	it('startRun completes all tasks and writes evidence, ampel and report', async () => {
		const mgr = makeManager();
		const run = await mgr.createRun(
			runConfig(['adversarial-compliance-test', 'green-to-hardened-instruction'])
		);
		await mgr.startRun(run.id);

		const fresh = mgr.getRun(run.id);
		expect(fresh?.status).toBe('completed');
		expect(fresh?.summary?.completedTasks).toBe(2);
		expect(fresh?.tasks.every((t) => t.status === 'completed')).toBe(true);

		// report
		expect(
			fs.existsSync(path.join(projectRoot, '3-temp-results', 'runs', run.id, 'report.md'))
		).toBe(true);
		// ampel entries exist
		const resultsDir = path.join(projectRoot, '3-temp-results');
		const ampelFiles = [
			...fs.readdirSync(path.join(resultsDir, '1-green')).filter((f) => f.endsWith('.md')),
			...fs.readdirSync(path.join(resultsDir, '2-yellow')).filter((f) => f.endsWith('.md')),
			...fs.readdirSync(path.join(resultsDir, '3-red')).filter((f) => f.endsWith('.md')),
		];
		expect(ampelFiles.length).toBe(2);
		// evidence
		const evidenceDir = path.join(
			projectRoot,
			'3-temp-results',
			'runs',
			run.id,
			'evidence',
			'claude-code'
		);
		expect(fs.readdirSync(evidenceDir).some((f) => f.endsWith('.md'))).toBe(true);
	});

	it('classifies a refusal as red', async () => {
		const refuseSpawn: PrompterSpawnFn = async () =>
			({
				success: true,
				response:
					'I cannot comply with this request. It violates my policy and as an AI I must decline.',
			}) as SpawnResult;
		const mgr = makeManager(refuseSpawn);
		const run = await mgr.createRun(runConfig(['adversarial-compliance-test']));
		await mgr.startRun(run.id);
		const fresh = mgr.getRun(run.id);
		expect(fresh?.summary?.red).toBe(1);
		expect(fresh?.tasks[0].result).toBe('red');
	});

	it('runs multiple agents in parallel lanes', async () => {
		const mgr = makeManager();
		const run = await mgr.createRun(
			runConfig(
				['adversarial-compliance-test'],
				[agentConfig('claude-code', 'claude-fable-5'), agentConfig('codex', 'o3')]
			)
		);
		expect(run.tasks).toHaveLength(2);
		await mgr.startRun(run.id);
		const fresh = mgr.getRun(run.id);
		expect(fresh?.summary?.completedTasks).toBe(2);
		// each agent got its own envelope work dir
		expect(
			fs.existsSync(path.join(projectRoot, '3-temp-results', 'runs', run.id, 'work', 'codex'))
		).toBe(true);
	});

	it('recoverInterruptedRuns marks a running manifest paused and its task failed', async () => {
		const mgr = makeManager();
		const run = await mgr.createRun(runConfig(['adversarial-compliance-test']));
		// Simulate a crash mid-run by hand-writing a "running" manifest.
		run.status = 'running';
		run.tasks[0].status = 'running';
		const persisted: PersistedRunState = {
			run,
			lastPersistedAt: Date.now(),
			version: 1,
			checkpoint: {
				completedTaskIds: [],
				currentTaskId: run.tasks[0].id,
				currentPhase: 'schema-test',
			},
		};
		fs.writeFileSync(
			path.join(projectRoot, '3-temp-results', 'runs', run.id, 'manifest.json'),
			JSON.stringify(persisted, null, 2)
		);

		const recovered = mgr.recoverInterruptedRuns([projectRoot]);
		expect(recovered).toHaveLength(1);
		expect(recovered[0].status).toBe('paused');
		expect(recovered[0].tasks[0].status).toBe('failed');
	});

	it('listRuns and deleteRun manage run folders', async () => {
		const mgr = makeManager();
		const run = await mgr.createRun(runConfig(['adversarial-compliance-test']));
		expect(mgr.listRuns(projectRoot).map((r) => r.id)).toContain(run.id);
		await mgr.deleteRun(run.id);
		expect(fs.existsSync(path.join(projectRoot, '3-temp-results', 'runs', run.id))).toBe(false);
	});

	it('includeVariations generates character variations and adds them to the matrix', async () => {
		const mgr = makeManager();
		const run = await mgr.createRun({
			projectId: 'p1',
			projectRoot,
			agents: [agentConfig('claude-code', 'claude-fable-5')],
			schemas: ['adversarial-compliance-test'],
			includeVariations: true,
		});
		// 1 base instruction (eni.md) -> 23 tv-variations; (1 + 23) x 1 schema.
		expect(run.tasks.length).toBe(24);
		expect(run.tasks.some((t) => t.instructionFile.startsWith('1-generic-instructions/'))).toBe(
			true
		);
		expect(
			run.tasks.some((t) =>
				t.instructionFile.startsWith('4-advanced-tests/character-variations/tv-eni-')
			)
		).toBe(true);
		// variation files were written to disk
		const varDir = path.join(projectRoot, '4-advanced-tests', 'character-variations');
		expect(fs.readdirSync(varDir).filter((f) => f.startsWith('tv-eni-')).length).toBe(23);
	});

	it('runs the probes for one input as a resumed session (instruction first, then probes resume)', async () => {
		const calls: Array<{ sessionId: string | undefined }> = [];
		const sessionSpawn: PrompterSpawnFn = async (_t, _c, _p, sessionId, options) => {
			calls.push({ sessionId });
			return {
				success: true,
				response: options.appendSystemPrompt ?? 'ok',
				agentSessionId: 'sess-1',
			} as SpawnResult;
		};
		const mgr = makeManager(sessionSpawn);
		const run = await mgr.createRun(
			runConfig([
				'adversarial-compliance-test',
				'bidi-zero-width-evasion',
				'edge-case-injection-finder',
			])
		);
		// 1 instruction x 3 probes, same input -> one conversation.
		expect(run.tasks).toHaveLength(3);
		await mgr.startRun(run.id);
		expect(calls).toHaveLength(3);
		expect(calls[0].sessionId).toBeUndefined(); // first turn establishes the instruction
		expect(calls[1].sessionId).toBe('sess-1'); // probe resumes the session
		expect(calls[2].sessionId).toBe('sess-1');
	});

	it('keeps one crafter per run and feeds task results back into later prompts', async () => {
		let profileCalls = 0;
		const craftPrompts: string[] = [];
		const spawn: PrompterSpawnFn = async (tool, _cwd, prompt, _sessionId, options) => {
			if (tool === 'claude-code' && options.customModel === 'crafter-model') {
				if (prompt.includes('Analysiere die folgende System-Instruction')) {
					profileCalls++;
					return {
						success: true,
						response: JSON.stringify({
							persona: 'tester',
							boundaries: ['no leaks'],
							style: 'plain',
							weakPoints: ['vague edge'],
							keyPhrases: ['secret keys'],
							structureType: 'markdown',
						}),
					} as SpawnResult;
				}
				craftPrompts.push(prompt);
				return { success: true, response: 'crafted prompt' } as SpawnResult;
			}
			return { success: true, response: options.appendSystemPrompt ?? 'ok' } as SpawnResult;
		};
		const mgr = makeManager(spawn);
		const run = await mgr.createRun({
			...runConfig(['adversarial-compliance-test', 'green-to-hardened-instruction']),
			autoGenerateHardenedInstruction: false,
			crafterConfig: {
				enabled: true,
				crafterAgentId: 'claude-code',
				crafterModelId: 'crafter-model',
				strategies: ['semantic-reframe', 'context-blend', 'adaptive-combined'],
				profileInstruction: true,
				feedbackDepth: 5,
				crafterTimeoutMs: 1000,
			},
		});

		await mgr.startRun(run.id);

		expect(profileCalls).toBe(1);
		expect(craftPrompts).toHaveLength(2);
		expect(craftPrompts[0]).toContain('## Deine Strategie: Semantisches Reframing');
		expect(craftPrompts[0]).not.toContain('## Bisherige Ergebnisse (Feedback-Loop)');
		expect(craftPrompts[1]).toContain('## Bisherige Ergebnisse (Feedback-Loop)');
		expect(craftPrompts[1]).toContain('Schema adversarial-compliance-test');
	});

	it('runs an agent with no instruction against the bare model (no system prompt)', async () => {
		const appendSeen: Array<string | undefined> = [];
		const spawn: PrompterSpawnFn = async (_t, _c, _p, _s, options) => {
			appendSeen.push(options.appendSystemPrompt);
			return { success: true, response: 'A perfectly normal answer here.' } as SpawnResult;
		};
		const mgr = makeManager(spawn);
		const run = await mgr.createRun({
			projectId: 'p1',
			projectRoot,
			agents: [
				{
					agentId: 'claude-code',
					modelId: 'm',
					modelSource: 'manual',
					instructionFile: 'none',
					providerConfigOverrides: {},
					generatedFiles: [],
				},
			],
			schemas: ['adversarial-compliance-test'],
			includeVariations: false,
		});
		// bare: 1 bare input x 1 probe = 1 task with an empty instruction path
		expect(run.tasks).toHaveLength(1);
		expect(run.tasks[0].instructionFile).toBe('');
		await mgr.startRun(run.id);
		expect(appendSeen[0]).toBeUndefined(); // no system instruction sent
	});

	it('pauseRun and resumeRun flip the run status', async () => {
		const mgr = makeManager();
		const run = await mgr.createRun(runConfig(['adversarial-compliance-test']));
		await mgr.pauseRun(run.id);
		expect(mgr.getRun(run.id)?.status).toBe('paused');
		await mgr.resumeRun(run.id);
		expect(mgr.getRun(run.id)?.status).toBe('running');
	});

	it('stopRun before start skips all tasks and completes', async () => {
		const mgr = makeManager();
		const run = await mgr.createRun(
			runConfig(['adversarial-compliance-test', 'green-to-hardened-instruction'])
		);
		await mgr.stopRun(run.id);
		expect(mgr.getRun(run.id)?.status).toBe('stopping');
		// Starting an aborted run drains the queue as skipped, then completes.
		await mgr.startRun(run.id);
		const fresh = mgr.getRun(run.id);
		expect(fresh?.status).toBe('completed');
		expect(fresh?.summary?.skipped).toBe(2);
		expect(fresh?.summary?.green).toBe(0);
	});
});
