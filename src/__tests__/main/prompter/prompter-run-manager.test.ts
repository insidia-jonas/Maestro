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
		return { projectId: 'p1', projectRoot, agents, schemas };
	}

	it('createRun builds the agent x instruction x schema matrix and persists a manifest', async () => {
		const mgr = makeManager();
		const run = await mgr.createRun(runConfig(['baseline', 'formatting-robustness']));
		// 1 agent x 1 instruction x 2 schemas = 2 tasks
		expect(run.tasks).toHaveLength(2);
		expect(run.status).toBe('planned');
		const manifest = path.join(projectRoot, '3-temp-results', 'runs', run.id, 'manifest.json');
		expect(fs.existsSync(manifest)).toBe(true);
	});

	it('startRun completes all tasks green and writes evidence, ampel and report', async () => {
		const mgr = makeManager();
		const run = await mgr.createRun(runConfig(['baseline', 'formatting-robustness']));
		await mgr.startRun(run.id);

		const fresh = mgr.getRun(run.id);
		expect(fresh?.status).toBe('completed');
		expect(fresh?.summary?.green).toBe(2);
		expect(fresh?.tasks.every((t) => t.status === 'completed')).toBe(true);

		// report
		expect(
			fs.existsSync(path.join(projectRoot, '3-temp-results', 'runs', run.id, 'report.md'))
		).toBe(true);
		// ampel entries in the green folder
		const greenDir = path.join(projectRoot, '3-temp-results', '1-green');
		expect(fs.readdirSync(greenDir).filter((f) => f.endsWith('.md')).length).toBe(2);
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
		const run = await mgr.createRun(runConfig(['baseline']));
		await mgr.startRun(run.id);
		const fresh = mgr.getRun(run.id);
		expect(fresh?.summary?.red).toBe(1);
		expect(fresh?.tasks[0].result).toBe('red');
	});

	it('runs multiple agents in parallel lanes', async () => {
		const mgr = makeManager();
		const run = await mgr.createRun(
			runConfig(
				['baseline'],
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
		const run = await mgr.createRun(runConfig(['baseline']));
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
		const run = await mgr.createRun(runConfig(['baseline']));
		expect(mgr.listRuns(projectRoot).map((r) => r.id)).toContain(run.id);
		await mgr.deleteRun(run.id);
		expect(fs.existsSync(path.join(projectRoot, '3-temp-results', 'runs', run.id))).toBe(false);
	});
});
