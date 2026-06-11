/**
 * @file prompter-run-manager.ts
 * @description Orchestrates a Prompter run end-to-end: builds the task matrix
 * (agents x instructions x schemas), runs per-agent lanes (agents in parallel,
 * tasks serial within a lane, capped at maxParallelAgents), spawns agents via
 * the shared spawnAgent() abstraction, evaluates each result, writes evidence +
 * ampel + report, persists a manifest for crash recovery, and emits IPC events.
 *
 * Spawning goes through src/cli/services/agent-spawner.spawnAgent (the same
 * machinery Auto-Run uses), loaded lazily via dynamic import so the cli chain
 * stays out of the main hot path. Prompter never touches ProcessManager directly
 * and runs only in batch mode.
 *
 * Playbook reference: sections 9-13.
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';
import { generateUUID } from '../../shared/uuid';
import { getAgentDisplayName } from '../../shared/agentMetadata';
import { atomicWriteFile, ensureDir } from './prompter-fs';
import { assertSafeWritePath, checkNoSymlinkEscape } from './prompter-path-safety';
import { PrompterProjectService } from './prompter-project-service';
import { PrompterAgentConfigWriter } from './prompter-agent-config-writer';
import { PrompterEvaluator } from './prompter-evaluator';
import { PrompterReportWriter } from './prompter-report-writer';
import type { PromptContext } from './prompter-schema-registry';
import type {
	PrompterRun,
	PrompterRunConfig,
	PrompterTask,
	PrompterRunSummary,
	PrompterRunUpdatedEvent,
	PrompterTaskUpdatedEvent,
	PrompterLogEvent,
	PersistedRunState,
	PrompterRunPhase,
	PrompterRunStatus,
	InstructionFile,
} from '../../shared/prompter-types';

const LOG = 'PrompterRunManager';
const PERSIST_VERSION = 1;
const PERSIST_MIN_INTERVAL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const RATE_LIMIT_BACKOFFS_MS = [30_000, 60_000, 120_000];

/** Minimal structural view of the spawner result (no static cli import). */
export interface SpawnResult {
	success: boolean;
	response?: string;
	agentSessionId?: string;
	usageStats?: Record<string, unknown>;
	error?: string;
}

export interface SpawnOptions {
	customModel?: string;
	customArgs?: string;
	appendSystemPrompt?: string;
}

export type PrompterSpawnFn = (
	toolType: string,
	cwd: string,
	prompt: string,
	sessionId: string | undefined,
	options: SpawnOptions
) => Promise<SpawnResult>;

export type PrompterEventSink = (
	event:
		| { type: 'run'; payload: PrompterRunUpdatedEvent }
		| { type: 'task'; payload: PrompterTaskUpdatedEvent }
		| { type: 'log'; payload: PrompterLogEvent }
) => void;

export interface RunManagerDeps {
	projectService: PrompterProjectService;
	configWriter: PrompterAgentConfigWriter;
	reportWriter: PrompterReportWriter;
	/** Spawn an agent. Inject in tests; production passes the real spawnAgent. */
	spawn: PrompterSpawnFn;
	/** Optional sink for run/task/log events (the IPC handler wires this). */
	emit?: PrompterEventSink;
	/** Injectable cancellable sleep for tests (default: real setTimeout). */
	delay?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

interface RunState {
	run: PrompterRun;
	abortController: AbortController;
	runDir: string;
	resumeWaiters: Array<() => void>;
	lastPersistAt: number;
}

export class PrompterRunManager {
	private activeRuns = new Map<string, RunState>();
	/** runId -> projectRoot, so getRun/deleteRun can find a run's manifest. */
	private runIndex = new Map<string, string>();

	constructor(private deps: RunManagerDeps) {}

	// ------------------------------------------------------------------ create

	/** Build a run (status 'planned') with its full task matrix and persist it. */
	async createRun(config: PrompterRunConfig): Promise<PrompterRun> {
		const instructions = this.deps.projectService.scanInstructions(config.projectRoot);
		if (instructions.length === 0) {
			throw new Error('Keine Instruction-Dateien in 1-generic-instructions/ gefunden');
		}

		const now = Date.now();
		const runId = `run-${now}-${generateUUID().slice(0, 8)}`;
		const tasks = this.buildTaskMatrix(runId, config, instructions);
		const run: PrompterRun = {
			id: runId,
			projectId: config.projectId,
			projectRoot: config.projectRoot,
			status: 'planned',
			phase: 'scaffold',
			agents: config.agents,
			schemas: config.schemas,
			tasks,
			maxParallelAgents: config.maxParallelAgents ?? 4,
			createdAt: now,
			updatedAt: now,
		};
		run.summary = this.computeSummary(run);

		const state = this.toState(run, config.projectRoot);
		this.activeRuns.set(runId, state);
		this.runIndex.set(runId, config.projectRoot);
		await this.persist(state, { force: true });
		return run;
	}

	private buildTaskMatrix(
		runId: string,
		config: PrompterRunConfig,
		instructions: InstructionFile[]
	): PrompterTask[] {
		const tasks: PrompterTask[] = [];
		for (const agent of config.agents) {
			for (const instruction of instructions) {
				for (const schemaId of config.schemas) {
					tasks.push({
						id: `task-${tasks.length}-${generateUUID().slice(0, 8)}`,
						runId,
						agentId: agent.agentId,
						modelId: agent.modelId,
						schemaId,
						instructionFile: instruction.path,
						instructionHash: instruction.hash,
						status: 'pending',
						attempts: 0,
					});
				}
			}
		}
		return tasks;
	}

	// ------------------------------------------------------------------- start

	/** Start (or resume from disk) a run: scaffold, run lanes, write the report. */
	async startRun(runId: string): Promise<void> {
		const state = this.getState(runId);
		if (!state) throw new Error(`Run nicht gefunden: ${runId}`);
		const { run } = state;

		run.status = 'running';
		run.phase = 'scaffold';
		this.emitRun(state);
		await this.scaffoldRun(state);
		await this.persist(state, { force: true });

		run.phase = 'schema-test';
		this.emitRun(state);

		const lanes = Array.from(this.groupByAgent(run.tasks).entries());
		await this.runWithConcurrency(lanes, run.maxParallelAgents, ([agentId, tasks]) =>
			this.runAgentLane(state, agentId, tasks)
		);

		// run.status may have been mutated to 'paused'/'stopping' inside the lane
		// callbacks (which TS flow analysis can't see), so read it widened.
		if ((run.status as PrompterRunStatus) === 'paused') {
			// A pause that was never resumed leaves the run paused on disk.
			await this.persist(state, { force: true });
			return;
		}

		run.status = 'completed';
		run.phase = 'report';
		run.completedAt = Date.now();
		run.summary = this.computeSummary(run);
		this.emitRun(state);
		try {
			await this.deps.reportWriter.writeRunReport(run.projectRoot, run);
		} catch (error) {
			this.log(state, 'error', `Report konnte nicht geschrieben werden: ${String(error)}`);
		}
		await this.persist(state, { force: true });
		this.emitRun(state);
	}

	private async scaffoldRun(state: RunState): Promise<void> {
		const { run } = state;
		await ensureDir(state.runDir);
		checkNoSymlinkEscape(state.runDir, path.join(run.projectRoot, '3-temp-results', 'runs'));
		for (const agent of run.agents) {
			await ensureDir(this.workDir(state, agent.agentId));
			await ensureDir(
				assertSafeWritePath(path.posix.join('evidence', agent.agentId), state.runDir)
			);
		}
	}

	private async runAgentLane(
		state: RunState,
		agentId: string,
		tasks: PrompterTask[]
	): Promise<void> {
		const agentConfig = state.run.agents.find((a) => a.agentId === agentId);
		for (const task of tasks) {
			while (state.run.status === 'paused') {
				await this.waitForResume(state);
			}
			if (state.run.status === 'stopping' || state.abortController.signal.aborted) {
				if (task.status === 'pending') {
					task.status = 'skipped';
					this.emitTask(state, task);
				}
				continue;
			}
			if (task.status === 'completed') continue; // already done (resume case)
			await this.executeTask(state, task, agentConfig?.modelId ?? task.modelId);
		}
	}

	// ---------------------------------------------------------------- one task

	private async executeTask(state: RunState, task: PrompterTask, modelId: string): Promise<void> {
		const { run } = state;
		task.status = 'running';
		task.startedAt = Date.now();
		this.emitTask(state, task);
		await this.persist(state);

		try {
			// Validate the instruction path before reading: blocks traversal and a
			// symlink swapped in after scan time (TOCTOU) from escaping the sandbox.
			const instrAbs = assertSafeWritePath(
				task.instructionFile,
				path.join(run.projectRoot, '1-generic-instructions')
			);
			const instructionContent = fs.readFileSync(instrAbs, 'utf-8');

			const registry = this.deps.projectService.getSchemaRegistry(run.projectRoot);
			const schema = registry.getSchema(task.schemaId);
			if (!schema) throw new Error(`Unbekanntes Schema: ${task.schemaId}`);

			const workDir = this.workDir(state, task.agentId);
			await this.deps.configWriter.writeEnvelope(workDir, task.agentId, instructionContent);

			const ctx: PromptContext = {
				instructionContent,
				instructionHash: task.instructionHash,
				instructionFilename: path.basename(task.instructionFile),
				agentId: task.agentId,
				agentName: getAgentDisplayName(task.agentId),
				modelId,
				providerName: task.agentId,
				runId: run.id,
				timestamp: new Date(task.startedAt).toISOString(),
			};
			const prompt = registry.buildPrompt(schema, ctx);
			const timeoutMs = schema.testConfig.timeoutMs ?? DEFAULT_TIMEOUT_MS;

			const { result, rateLimitExhausted } = await this.spawnWithRetries(
				state,
				task,
				modelId,
				workDir,
				prompt,
				instructionContent,
				timeoutMs
			);

			if (rateLimitExhausted) {
				// Rate-limit after all retries: failed, band yellow, reason rate-limit.
				task.status = 'failed';
				task.result = 'yellow';
				task.error = 'rate-limit';
				task.completedAt = Date.now();
				this.log(
					state,
					'warn',
					`${task.agentId}/${task.schemaId}: Rate-Limit nach Retries`,
					task.id
				);
			} else {
				const evaluator = new PrompterEvaluator(run.projectRoot);
				const evaluation = await evaluator.evaluate({
					task,
					agentResult: result,
					schema,
					originalInstruction: instructionContent,
					originalInstructionHash: task.instructionHash,
					responseTimeMs: Date.now() - task.startedAt,
				});

				const evidencePath = await this.deps.reportWriter.writeEvidence(
					state.runDir,
					task,
					result.response || result.error || '',
					evaluation
				);
				task.completedAt = Date.now();
				await this.deps.reportWriter.writeAmpelEntry(run.projectRoot, run, task, evaluation);

				task.result = evaluation.band;
				task.evidencePath = evidencePath;
				task.status =
					evaluation.classification === 'timeout' || evaluation.classification === 'cli-error'
						? 'failed'
						: 'completed';
				if (!result.success && !task.error) task.error = result.error;
				this.log(
					state,
					evaluation.band === 'red' ? 'warn' : 'info',
					`${task.agentId}/${task.schemaId}: ${evaluation.band} - ${evaluation.reason}`,
					task.id
				);
			}
		} catch (error) {
			task.status = 'failed';
			task.result = 'red';
			task.error = error instanceof Error ? error.message : String(error);
			task.completedAt = Date.now();
			this.log(state, 'error', `Task ${task.id} fehlgeschlagen: ${task.error}`, task.id);
		}

		this.emitTask(state, task);
		run.summary = this.computeSummary(run);
		this.emitRun(state);
		await this.persist(state, { force: true });
	}

	private async spawnWithRetries(
		state: RunState,
		task: PrompterTask,
		modelId: string,
		workDir: string,
		prompt: string,
		instructionContent: string,
		timeoutMs: number
	): Promise<{ result: SpawnResult; rateLimitExhausted: boolean }> {
		const options: SpawnOptions = {
			customModel: modelId,
			appendSystemPrompt: instructionContent,
		};
		let backoffIndex = 0;
		while (true) {
			if (state.run.status === 'stopping' || state.abortController.signal.aborted) {
				return { result: { success: false, error: 'Run gestoppt' }, rateLimitExhausted: false };
			}
			task.attempts = (task.attempts ?? 0) + 1;
			const result = await this.spawnWithTimeout(task.agentId, workDir, prompt, options, timeoutMs);

			const haystack = `${result.error || ''} ${result.response || ''}`;
			const rateLimited = /rate[- ]?limit/i.test(haystack);
			if (rateLimited && backoffIndex < RATE_LIMIT_BACKOFFS_MS.length) {
				const backoff = RATE_LIMIT_BACKOFFS_MS[backoffIndex];
				backoffIndex++;
				this.log(
					state,
					'warn',
					`Rate-Limit bei ${task.agentId}; Backoff ${backoff / 1000}s (Retry ${backoffIndex}/${RATE_LIMIT_BACKOFFS_MS.length})`,
					task.id
				);
				await this.sleep(backoff, state.abortController.signal);
				continue;
			}
			if (rateLimited) {
				return { result, rateLimitExhausted: true };
			}
			return { result, rateLimitExhausted: false };
		}
	}

	private spawnWithTimeout(
		agentId: string,
		cwd: string,
		prompt: string,
		options: SpawnOptions,
		timeoutMs: number
	): Promise<SpawnResult> {
		return new Promise<SpawnResult>((resolve) => {
			let settled = false;
			const timer = setTimeout(() => {
				if (!settled) {
					settled = true;
					resolve({ success: false, error: 'ETIMEDOUT' });
				}
			}, timeoutMs);
			this.deps.spawn(agentId, cwd, prompt, undefined, options).then(
				(r) => {
					if (!settled) {
						settled = true;
						clearTimeout(timer);
						resolve(r);
					}
				},
				(e) => {
					if (!settled) {
						settled = true;
						clearTimeout(timer);
						resolve({ success: false, error: e instanceof Error ? e.message : String(e) });
					}
				}
			);
		});
	}

	// --------------------------------------------------------- pause/resume/stop

	async pauseRun(runId: string): Promise<void> {
		const state = this.activeRuns.get(runId);
		if (!state) return;
		state.run.status = 'paused';
		state.run.updatedAt = Date.now();
		this.emitRun(state);
		await this.persist(state, { force: true });
	}

	async resumeRun(runId: string): Promise<void> {
		const state = this.activeRuns.get(runId);
		if (!state || state.run.status !== 'paused') return;
		state.run.status = 'running';
		state.run.updatedAt = Date.now();
		const waiters = state.resumeWaiters;
		state.resumeWaiters = [];
		waiters.forEach((w) => w());
		this.emitRun(state);
		await this.persist(state, { force: true });
	}

	async stopRun(runId: string): Promise<void> {
		const state = this.activeRuns.get(runId);
		if (!state) return;
		state.run.status = 'stopping';
		state.run.updatedAt = Date.now();
		state.abortController.abort();
		const waiters = state.resumeWaiters;
		state.resumeWaiters = [];
		waiters.forEach((w) => w());
		this.emitRun(state);
		await this.persist(state, { force: true });
	}

	// ----------------------------------------------------------- query/delete

	getRun(runId: string): PrompterRun | null {
		const active = this.activeRuns.get(runId);
		if (active) return active.run;
		const projectRoot = this.runIndex.get(runId);
		if (!projectRoot) return null;
		return this.readRun(projectRoot, runId);
	}

	listRuns(projectRoot: string): PrompterRun[] {
		const runsDir = path.join(projectRoot, '3-temp-results', 'runs');
		if (!fs.existsSync(runsDir)) return [];
		const runs: PrompterRun[] = [];
		for (const runId of fs.readdirSync(runsDir)) {
			const run = this.readRun(projectRoot, runId);
			if (run) {
				runs.push(run);
				this.runIndex.set(runId, projectRoot);
			}
		}
		return runs.sort((a, b) => b.createdAt - a.createdAt);
	}

	async deleteRun(runId: string): Promise<void> {
		const projectRoot = this.runIndex.get(runId) ?? this.activeRuns.get(runId)?.run.projectRoot;
		if (!projectRoot) throw new Error(`Run nicht gefunden: ${runId}`);
		const runDir = this.runDirFor(projectRoot, runId);
		checkNoSymlinkEscape(runDir, path.join(projectRoot, '3-temp-results', 'runs'));
		await fs.promises.rm(runDir, { recursive: true, force: true });
		this.activeRuns.delete(runId);
		this.runIndex.delete(runId);
		logger.info(`Run gelöscht: ${runId}`, LOG);
	}

	// ------------------------------------------------------------- recovery

	/**
	 * Scan the given project roots for runs that were active at crash time.
	 * Mark them paused (no auto-resume) and their running task failed. Returns
	 * the recovered runs for the UI to surface in a banner.
	 */
	recoverInterruptedRuns(projectRoots: string[]): PrompterRun[] {
		const interrupted: PrompterRun[] = [];
		for (const projectRoot of projectRoots) {
			const runsDir = path.join(projectRoot, '3-temp-results', 'runs');
			if (!fs.existsSync(runsDir)) continue;
			for (const runId of fs.readdirSync(runsDir)) {
				const run = this.readRun(projectRoot, runId);
				if (!run) continue;
				this.runIndex.set(runId, projectRoot);
				if (run.status === 'running' || run.status === 'preparing') {
					run.status = 'paused';
					const current = run.tasks.find((t) => t.status === 'running');
					if (current) {
						current.status = 'failed';
						current.error = 'Durch App-Absturz unterbrochen - Run erneut starten';
					}
					// Drop orphaned half-written *.tmp evidence files (playbook 13).
					this.cleanTempFiles(this.runDirFor(projectRoot, runId));
					const state = this.toState(run, projectRoot);
					this.activeRuns.set(runId, state);
					// Persist the corrected state (best-effort; must not throw on startup).
					void this.persist(state, { force: true }).catch((error) => {
						logger.warn(`Recovery persist failed for ${runId}`, LOG, { error });
					});
					interrupted.push(run);
				}
			}
		}
		return interrupted;
	}

	// ------------------------------------------------------------- internals

	/** Recursively delete orphaned *.tmp files (half-written, crash-interrupted). */
	private cleanTempFiles(dir: string): void {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				this.cleanTempFiles(full);
			} else if (entry.isFile() && entry.name.endsWith('.tmp')) {
				try {
					fs.rmSync(full, { force: true });
				} catch {
					/* ignore */
				}
			}
		}
	}

	private getState(runId: string): RunState | null {
		const active = this.activeRuns.get(runId);
		if (active) return active;
		const projectRoot = this.runIndex.get(runId);
		if (!projectRoot) return null;
		const run = this.readRun(projectRoot, runId);
		if (!run) return null;
		const state = this.toState(run, projectRoot);
		this.activeRuns.set(runId, state);
		return state;
	}

	private toState(run: PrompterRun, projectRoot: string): RunState {
		return {
			run,
			abortController: new AbortController(),
			runDir: this.runDirFor(projectRoot, run.id),
			resumeWaiters: [],
			lastPersistAt: 0,
		};
	}

	private runDirFor(projectRoot: string, runId: string): string {
		return path.join(projectRoot, '3-temp-results', 'runs', runId);
	}

	private workDir(state: RunState, agentId: string): string {
		return assertSafeWritePath(path.posix.join('work', agentId), state.runDir);
	}

	private groupByAgent(tasks: PrompterTask[]): Map<string, PrompterTask[]> {
		const groups = new Map<string, PrompterTask[]>();
		for (const task of tasks) {
			const list = groups.get(task.agentId);
			if (list) list.push(task);
			else groups.set(task.agentId, [task]);
		}
		return groups;
	}

	/** Run `items` through `worker` with at most `limit` concurrent (>=1). */
	private async runWithConcurrency<T>(
		items: T[],
		limit: number,
		worker: (item: T) => Promise<void>
	): Promise<void> {
		if (items.length === 0) return;
		const max = Math.max(1, Math.min(limit || 4, items.length));
		let index = 0;
		const runNext = async (): Promise<void> => {
			while (true) {
				const i = index++;
				if (i >= items.length) return;
				await worker(items[i]);
			}
		};
		await Promise.allSettled(Array.from({ length: max }, () => runNext()));
	}

	private waitForResume(state: RunState): Promise<void> {
		if (state.run.status !== 'paused') return Promise.resolve();
		return new Promise<void>((resolve) => {
			const onAbort = () => resolve();
			state.resumeWaiters.push(() => {
				state.abortController.signal.removeEventListener('abort', onAbort);
				resolve();
			});
			state.abortController.signal.addEventListener('abort', onAbort, { once: true });
		});
	}

	private sleep(ms: number, signal?: AbortSignal): Promise<void> {
		if (this.deps.delay) return this.deps.delay(ms, signal);
		return new Promise<void>((resolve) => {
			const timer = setTimeout(resolve, ms);
			signal?.addEventListener(
				'abort',
				() => {
					clearTimeout(timer);
					resolve();
				},
				{ once: true }
			);
		});
	}

	private computeSummary(run: PrompterRun): PrompterRunSummary {
		const t = run.tasks;
		return {
			totalTasks: t.length,
			completedTasks: t.filter((x) => x.status === 'completed').length,
			green: t.filter((x) => x.result === 'green').length,
			yellow: t.filter((x) => x.result === 'yellow').length,
			red: t.filter((x) => x.result === 'red').length,
			failed: t.filter((x) => x.status === 'failed').length,
			skipped: t.filter((x) => x.status === 'skipped').length,
			durationMs: (run.completedAt ?? Date.now()) - run.createdAt,
		};
	}

	private buildPersisted(run: PrompterRun): PersistedRunState {
		const completedTaskIds = run.tasks.filter((t) => t.status === 'completed').map((t) => t.id);
		const current = run.tasks.find((t) => t.status === 'running');
		return {
			run,
			lastPersistedAt: Date.now(),
			version: PERSIST_VERSION,
			checkpoint: {
				completedTaskIds,
				currentTaskId: current?.id,
				currentPhase: run.phase as PrompterRunPhase,
			},
		};
	}

	private readRun(projectRoot: string, runId: string): PrompterRun | null {
		const manifestPath = path.join(this.runDirFor(projectRoot, runId), 'manifest.json');
		if (!fs.existsSync(manifestPath)) return null;
		try {
			// Refuse to read a manifest reached through a symlink that escapes the
			// project's runs folder (e.g. a symlinked run-id directory).
			checkNoSymlinkEscape(manifestPath, path.join(projectRoot, '3-temp-results', 'runs'));
			const persisted = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as PersistedRunState;
			return persisted.run;
		} catch (error) {
			logger.warn(`Manifest konnte nicht gelesen werden: ${manifestPath}`, LOG, { error });
			return null;
		}
	}

	/** Persist the manifest. Throttled to 1/sec unless `force`. */
	private async persist(state: RunState, opts: { force?: boolean } = {}): Promise<void> {
		if (!opts.force && Date.now() - state.lastPersistAt < PERSIST_MIN_INTERVAL_MS) return;
		state.lastPersistAt = Date.now();
		await ensureDir(state.runDir);
		const manifestPath = path.join(state.runDir, 'manifest.json');
		await atomicWriteFile(
			manifestPath,
			JSON.stringify(this.buildPersisted(state.run), null, 2) + '\n'
		);
	}

	private emitRun(state: RunState): void {
		state.run.updatedAt = Date.now();
		this.deps.emit?.({
			type: 'run',
			payload: {
				runId: state.run.id,
				status: state.run.status,
				phase: state.run.phase,
				summary: state.run.summary ?? this.computeSummary(state.run),
			},
		});
	}

	private emitTask(state: RunState, task: PrompterTask): void {
		this.deps.emit?.({ type: 'task', payload: { runId: state.run.id, task } });
	}

	private log(
		state: RunState,
		level: 'info' | 'warn' | 'error',
		message: string,
		taskId?: string
	): void {
		logger[level](message, LOG);
		this.deps.emit?.({
			type: 'log',
			payload: { runId: state.run.id, level, message, timestamp: Date.now(), taskId },
		});
	}
}
