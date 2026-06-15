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
import { captureException } from '../utils/sentry';
import { generateUUID } from '../../shared/uuid';
import { getAgentDisplayName } from '../../shared/agentMetadata';
import { atomicWriteFile, ensureDir } from './prompter-fs';
import { assertSafeWritePath, checkNoSymlinkEscape } from './prompter-path-safety';
import { PrompterProjectService } from './prompter-project-service';
import { PrompterAgentConfigWriter } from './prompter-agent-config-writer';
import { PrompterEvaluator } from './prompter-evaluator';
import { PrompterReportWriter } from './prompter-report-writer';
import type { PromptContext } from './prompter-schema-registry';
import { RedTeamCrafter } from './prompter-red-team-crafter';
import { loadCrafterLearnings, appendCrafterLearnings } from './prompter-learnings-store';
import { STEGO_SCHEMA_IDS } from '../../shared/prompter-robustness';
import { VARIATION_TRANSFORM_NAMES } from './prompter-variation-generator';
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
	CrafterAgent,
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
	crafter?: RedTeamCrafter;
}

export class PrompterRunManager {
	private activeRuns = new Map<string, RunState>();
	/** runId -> projectRoot, so getRun/deleteRun can find a run's manifest. */
	private runIndex = new Map<string, string>();

	constructor(private deps: RunManagerDeps) {}

	// ------------------------------------------------------------------ create

	/** Build a run (status 'planned') with its full task matrix and persist it. */
	async createRun(config: PrompterRunConfig): Promise<PrompterRun> {
		const instructions = await this.deps.projectService.collectRunInputs(
			config.projectRoot,
			config.includeVariations ?? true,
			config.selectedTransforms
		);

		const now = Date.now();
		const runId = `run-${now}-${generateUUID().slice(0, 8)}`;
		const tasks = this.buildTaskMatrix(runId, config, instructions);
		if (tasks.length === 0) {
			throw new Error(
				'Keine Tasks: lege Instruction-Dateien in 1-generic-instructions/ ab oder waehle "Keine (nacktes Modell)" fuer einen Agent.'
			);
		}
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
			customDataOverrides: config.customDataOverrides,
			autoGenerateHardenedInstruction: config.autoGenerateHardenedInstruction,
			crafterConfig: config.crafterConfig,
			crafterAgents: config.crafterAgents,
			selectedTransforms: config.selectedTransforms,
			testTargets: config.testTargets,
		};
		run.summary = this.computeSummary(run);

		const state = this.toState(run, config.projectRoot);
		this.activeRuns.set(runId, state);
		this.runIndex.set(runId, config.projectRoot);
		await this.persist(state, { force: true });
		return run;
	}

	/** Resolve an instruction-routing selection ('*' / 'none' / path) to inputs. */
	private resolveInstructionInputs(
		selection: string,
		instructions: InstructionFile[]
	): InstructionFile[] {
		// A bare input (no instruction) probes the model directly.
		const BARE: InstructionFile = { path: '', hash: '', sizeBytes: 0, preview: '' };
		if (selection === 'none') return [BARE];
		if (selection === '*' || !selection) return instructions;
		return instructions.filter((i) => i.path === selection || i.path.endsWith(`/${selection}`));
	}

	private buildTaskMatrix(
		runId: string,
		config: PrompterRunConfig,
		instructions: InstructionFile[]
	): PrompterTask[] {
		const tasks: PrompterTask[] = [];
		// One (agentId, modelId) pair is tested once: executors first, then any
		// declared target-only models that are not already covered by an executor.
		const seenPairs = new Set<string>();
		const pushTasks = (agentId: string, modelId: string, selection: string): void => {
			for (const instruction of this.resolveInstructionInputs(selection, instructions)) {
				for (const schemaId of config.schemas) {
					tasks.push({
						id: `task-${tasks.length}-${generateUUID().slice(0, 8)}`,
						runId,
						agentId,
						modelId,
						schemaId,
						instructionFile: instruction.path,
						instructionHash: instruction.hash,
						status: 'pending',
						attempts: 0,
					});
				}
			}
		};

		for (const agent of config.agents) {
			seenPairs.add(`${agent.agentId}::${agent.modelId}`);
			pushTasks(agent.agentId, agent.modelId, agent.instructionFile || '*');
		}

		// Independent target-only models: declared targets whose agent+model pair is
		// not an executor. They are really tested (own tasks), routed by the target's
		// own instructionFile, so the run is a true cross-model comparison.
		for (const target of config.testTargets ?? []) {
			const pair = `${target.agentId}::${target.modelId}`;
			if (seenPairs.has(pair)) continue;
			seenPairs.add(pair);
			pushTasks(target.agentId, target.modelId, target.instructionFile || '*');
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

		if (run.autoGenerateHardenedInstruction !== false && !run.customDataOverrides) {
			await this.maybeGenerateHardenedInstruction(state);
		}

		await this.persistRunLearnings(state);

		await this.persist(state, { force: true });
		this.emitRun(state);
	}

	/**
	 * Persist this run's crafter learnings to the cross-campaign store, so future
	 * runs/campaigns can load them. No-op when no crafter was active or no crafted
	 * green was produced. Single-instruction assumption: learnings are keyed by the
	 * first crafted-green instruction of the run.
	 */
	private async persistRunLearnings(state: RunState): Promise<void> {
		const { run, crafter } = state;
		if (!crafter) return;
		const greenCrafted = run.tasks.find((t) => t.result === 'green' && t.craftStrategy);
		if (!greenCrafted) return;
		const entries = crafter.exportLearnings(run.id, greenCrafted.instructionHash);
		await appendCrafterLearnings(
			greenCrafted.instructionHash,
			path.basename(greenCrafted.instructionFile),
			entries
		);
	}

	private async scaffoldRun(state: RunState): Promise<void> {
		const { run } = state;
		await ensureDir(state.runDir);
		checkNoSymlinkEscape(state.runDir, path.join(run.projectRoot, '3-temp-results', 'runs'));
		// Every agent that appears in the task matrix needs a work + evidence dir,
		// including independent target-only agents that are not executors.
		const agentIds = new Set(run.tasks.map((t) => t.agentId));
		for (const agentId of agentIds) {
			await ensureDir(this.workDir(state, agentId));
			await ensureDir(assertSafeWritePath(path.posix.join('evidence', agentId), state.runDir));
		}
	}

	private async runAgentLane(
		state: RunState,
		_agentId: string,
		tasks: PrompterTask[]
	): Promise<void> {
		// Each (model, instruction file) runs as ONE conversation: the instruction
		// is delivered on the first turn, then the probes resume that session. The
		// model is part of the key so a target-only model in the same agent lane
		// never resumes another model's session.
		for (const [, groupTasks] of this.groupBySession(tasks)) {
			let sessionId: string | undefined;
			for (const task of groupTasks) {
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
				if (task.status === 'completed') {
					// Preserve the conversation chain when a grouped run is recovered after
					// one or more probes already completed in the same model+instruction group.
					if (task.agentSessionId) sessionId = task.agentSessionId;
					continue; // already done (resume case)
				}
				sessionId = await this.executeTask(state, task, sessionId);
			}
		}
	}

	private groupBySession(tasks: PrompterTask[]): Map<string, PrompterTask[]> {
		const groups = new Map<string, PrompterTask[]>();
		for (const task of tasks) {
			const key = `${task.modelId}::${task.instructionFile}`;
			const list = groups.get(key);
			if (list) list.push(task);
			else groups.set(key, [task]);
		}
		return groups;
	}

	// ---------------------------------------------------------------- one task

	/**
	 * Run one probe turn. `resumeSessionId` continues the per-input conversation
	 * (undefined for the first turn, which establishes the instruction). Returns
	 * the session id to carry to the next probe in the same input group.
	 */
	private async executeTask(
		state: RunState,
		task: PrompterTask,
		resumeSessionId: string | undefined
	): Promise<string | undefined> {
		const { run } = state;
		// Each task carries its own model (executor model or an independent target
		// model), so spawning uses task.modelId rather than a single lane model.
		const modelId = task.modelId;
		let nextSessionId = resumeSessionId;
		task.status = 'running';
		task.startedAt = Date.now();
		this.emitTask(state, task);
		await this.persist(state);

		try {
			// An empty instructionFile means "bare model" (no instruction): probe the
			// model directly, no envelope, no system prompt.
			const isBare = task.instructionFile === '';
			let instructionContent = '';
			if (!isBare) {
				// task.instructionFile is project-root-relative (base instruction or a
				// generated variation). Validate the path before reading: blocks
				// traversal and a symlink swapped in after scan time (TOCTOU).
				const instrAbs = assertSafeWritePath(task.instructionFile, run.projectRoot);
				instructionContent = fs.readFileSync(instrAbs, 'utf-8');
			}

			const registry = this.deps.projectService.getSchemaRegistry(run.projectRoot);
			const schema = registry.getSchema(task.schemaId);
			if (!schema) throw new Error(`Unbekanntes Schema: ${task.schemaId}`);

			const workDir = this.workDir(state, task.agentId);
			if (!isBare) {
				await this.deps.configWriter.writeEnvelope(workDir, task.agentId, instructionContent);
			}
			// Copy any user-attached CLI config files (skills/settings/agent files).
			const agentCfg = run.agents.find((a) => a.agentId === task.agentId);
			if (agentCfg?.attachedFiles?.length) {
				await this.deps.configWriter.writeAttachedFiles(workDir, agentCfg.attachedFiles);
			}

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
				customData: run.customDataOverrides,
			};
			let finalPrompt = registry.buildPrompt(schema, ctx);
			const timeoutMs = schema.testConfig.timeoutMs ?? DEFAULT_TIMEOUT_MS;

			// Red-Team Crafter: intelligent prompt modification (when enabled)
			if (run.crafterConfig?.enabled) {
				const crafter = this.getRunCrafter(state);
				const feedbackKey = `${task.instructionFile}::${task.agentId}::${task.modelId}`;
				try {
					if (run.crafterConfig.profileInstruction) {
						await crafter.profileInstruction(
							run.crafterConfig,
							workDir,
							instructionContent,
							task.instructionHash
						);
					}
					const crafterOverride = this.selectCrafterForTask(state, task);
					const craftResult = await crafter.craftModification(
						run.crafterConfig,
						finalPrompt,
						instructionContent,
						task,
						workDir,
						this.activeTransformsForTask(run, task),
						STEGO_SCHEMA_IDS.has(task.schemaId),
						feedbackKey,
						crafterOverride
					);
					if (craftResult) {
						task.originalPrompt = finalPrompt;
						task.craftStrategy = craftResult.strategy;
						task.craftModificationSummary = craftResult.modificationSummary;
						task.crafterAgentId = crafterOverride?.agentId ?? run.crafterConfig.crafterAgentId;
						task.crafterModelId = crafterOverride?.modelId ?? run.crafterConfig.crafterModelId;
						finalPrompt = craftResult.modifiedPrompt;
						this.log(
							state,
							'info',
							`[CRAFTER] ${task.agentId}/${task.schemaId}: ${craftResult.modificationSummary}`,
							task.id
						);
					}
				} catch (err) {
					this.log(
						state,
						'warn',
						`[CRAFTER] Fehler: ${err instanceof Error ? err.message : String(err)}`,
						task.id
					);
				}
			}

			const truncate = (s: string, max = 500) =>
				s.length > max ? s.slice(0, max) + `... [${s.length} chars total]` : s;

			this.log(
				state,
				'info',
				`[DEBUG] ${task.agentId}/${task.schemaId} prompt (${finalPrompt.length} chars): ${truncate(finalPrompt)}`,
				task.id
			);
			if (instructionContent) {
				this.log(
					state,
					'info',
					`[DEBUG] ${task.agentId}/${task.schemaId} instruction: ${path.basename(task.instructionFile)} (${instructionContent.length} chars)`,
					task.id
				);
			}

			const { result, rateLimitExhausted } = await this.spawnWithRetries(
				state,
				task,
				modelId,
				workDir,
				finalPrompt,
				instructionContent,
				timeoutMs,
				resumeSessionId
			);

			this.log(
				state,
				result.success ? 'info' : 'warn',
				`[DEBUG] ${task.agentId}/${task.schemaId} spawn result: success=${result.success}, ` +
					`response=${result.response ? truncate(result.response) : '(none)'}, ` +
					`error=${result.error ? truncate(result.error) : '(none)'}, ` +
					`sessionId=${result.agentSessionId ?? '(none)'}`,
				task.id
			);

			// Carry the (new or resumed) session id forward to the next probe.
			if (result.agentSessionId) {
				task.agentSessionId = result.agentSessionId;
				nextSessionId = result.agentSessionId;
			}

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
				const resolvedCustomData = {
					...(schema.testConfig.customData ?? {}),
					...(run.customDataOverrides ?? {}),
				};
				const resolvedCustomTask = resolvedCustomData.task || undefined;
				const evaluator = new PrompterEvaluator(run.projectRoot);
				const evaluation = await evaluator.evaluate({
					task,
					agentResult: result,
					schema,
					originalInstruction: instructionContent,
					originalInstructionHash: task.instructionHash,
					responseTimeMs: Date.now() - task.startedAt,
					resolvedCustomTask,
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
				task.tokenCount = evaluation.metrics.tokenCount;
				task.responseLength = evaluation.metrics.responseLength;
				task.classification = evaluation.classification;
				task.confidence = evaluation.confidence;
				task.complianceScore = evaluation.complianceScore?.overall;
				task.status =
					evaluation.classification === 'timeout' || evaluation.classification === 'cli-error'
						? 'failed'
						: 'completed';
				if (!result.success && !task.error) task.error = result.error;
				this.addCrafterFeedback(state, task, result.response || result.error || '');
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
		return nextSessionId;
	}

	private async spawnWithRetries(
		state: RunState,
		task: PrompterTask,
		modelId: string,
		workDir: string,
		prompt: string,
		instructionContent: string,
		timeoutMs: number,
		resumeSessionId: string | undefined
	): Promise<{ result: SpawnResult; rateLimitExhausted: boolean }> {
		const options: SpawnOptions = {
			customModel: modelId,
			// Empty for a bare-model probe: send no system instruction.
			// TODO(prompter): for claude-code the instruction is currently delivered
			// twice: as the CLAUDE.md envelope written by writeEnvelope() in
			// runTask() AND via appendSystemPrompt (--append-system-prompt). The
			// desktop path (src/main/ipc/handlers/process.ts) uses only
			// --append-system-prompt. Settle on one canonical delivery path for
			// Prompter Claude runs so the model does not see the instruction twice.
			appendSystemPrompt: instructionContent || undefined,
		};
		let backoffIndex = 0;
		while (true) {
			if (state.run.status === 'stopping' || state.abortController.signal.aborted) {
				return { result: { success: false, error: 'Run gestoppt' }, rateLimitExhausted: false };
			}
			task.attempts = (task.attempts ?? 0) + 1;
			const result = await this.spawnWithTimeout(
				task.agentId,
				workDir,
				prompt,
				resumeSessionId,
				options,
				timeoutMs
			);

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
		sessionId: string | undefined,
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
			this.deps.spawn(agentId, cwd, prompt, sessionId, options).then(
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

	// -------------------------------------------------------- post-run hardening

	private async maybeGenerateHardenedInstruction(state: RunState): Promise<void> {
		const { run } = state;
		try {
			const { hasQualifyingGreens, generateHardenedInstruction } =
				await import('./prompter-hardened-generator');
			if (!hasQualifyingGreens(run)) {
				this.log(state, 'info', 'Keine Green Findings von adversariellen Schemata');
				return;
			}
			this.log(state, 'info', 'Green Findings erkannt - starte Haertungs-Generierung...');
			const result = await generateHardenedInstruction(run, run.projectRoot, this, run.agents);
			if (result) {
				if (!run.hardenedInstructions) run.hardenedInstructions = [];
				run.hardenedInstructions.push({
					...result,
					generatedAt: Date.now(),
				});
				this.log(state, 'info', `Gehaertete Instruction: ${path.basename(result.path)}`);
			}
		} catch (err) {
			// This outer catch covers setup failures (dynamic import,
			// hasQualifyingGreens). Generation-internal failures are caught and
			// reported inside generateHardenedInstruction itself, so they do not reach
			// here. Report this distinct setup failure to Sentry instead of only logging.
			this.log(
				state,
				'warn',
				`Haertungs-Generierung fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`
			);
			void captureException(err, { scope: 'maybeGenerateHardenedInstruction', runId: run.id });
		}
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
					run.updatedAt = Date.now();
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
			crafter: run.crafterConfig?.enabled ? this.createCrafter() : undefined,
		};
	}

	/**
	 * Create a crafter and prime it with cross-campaign learnings from disk, so
	 * crafter selection can prefer historically effective strategies/agents.
	 */
	private createCrafter(): RedTeamCrafter {
		const crafter = new RedTeamCrafter(this.deps.spawn);
		crafter.loadLearnings(loadCrafterLearnings());
		return crafter;
	}

	private getRunCrafter(state: RunState): RedTeamCrafter {
		if (!state.crafter) state.crafter = this.createCrafter();
		return state.crafter;
	}

	private addCrafterFeedback(state: RunState, task: PrompterTask, response: string): void {
		if (!state.run.crafterConfig?.enabled || !task.craftStrategy) return;
		const feedbackKey = `${task.instructionFile}::${task.agentId}::${task.modelId}`;
		const crafter = this.getRunCrafter(state);
		crafter.addFeedback(feedbackKey, {
			schemaId: task.schemaId,
			strategy: task.craftStrategy,
			modificationSummary: task.craftModificationSummary ?? '',
			result: task.result ?? 'red',
			complianceScore: task.complianceScore,
			responseExcerpt: response.slice(0, 500),
			targetModelId: task.modelId,
		});
		if (task.crafterAgentId && task.crafterModelId) {
			crafter.recordCrafterResult(
				task.crafterAgentId,
				task.crafterModelId,
				task.modelId,
				task.result ?? 'red'
			);
		}
	}

	private selectCrafterForTask(state: RunState, task: PrompterTask): CrafterAgent | undefined {
		const { run } = state;
		const pool = run.crafterAgents;
		if (!pool || pool.length === 0 || !run.crafterConfig) return undefined;
		const target = run.testTargets?.find(
			(t) => t.agentId === task.agentId && t.modelId === task.modelId
		);
		return this.getRunCrafter(state).selectCrafterFromPool(
			run.crafterConfig,
			pool,
			task,
			target?.preferredCrafterAgentId,
			target?.preferredCrafterModelId
		);
	}

	private activeTransformsForTask(run: PrompterRun, task: PrompterTask): string[] {
		const filename = path.basename(task.instructionFile);
		if (!filename.startsWith('tv-') || !filename.endsWith('.md')) return [];
		const selected = run.selectedTransforms?.length
			? new Set(run.selectedTransforms)
			: new Set(VARIATION_TRANSFORM_NAMES);
		const stemless = filename.slice(3, -3);
		const transform = [...VARIATION_TRANSFORM_NAMES]
			.sort((a, b) => b.length - a.length)
			.find((candidate) => stemless.endsWith(`-${candidate}`));
		return transform && selected.has(transform) ? [transform] : [];
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
		const completed = t.filter((x) => x.status === 'completed');
		let totalTokens = 0;
		let totalResponseLength = 0;
		for (const task of completed) {
			if (task.tokenCount) totalTokens += task.tokenCount;
			if (task.responseLength) totalResponseLength += task.responseLength;
		}
		return {
			totalTasks: t.length,
			completedTasks: completed.length,
			green: t.filter((x) => x.result === 'green').length,
			yellow: t.filter((x) => x.result === 'yellow').length,
			red: t.filter((x) => x.result === 'red').length,
			failed: t.filter((x) => x.status === 'failed').length,
			skipped: t.filter((x) => x.status === 'skipped').length,
			durationMs: (run.completedAt ?? Date.now()) - run.createdAt,
			totalTokens,
			avgResponseLength:
				completed.length > 0 ? Math.round(totalResponseLength / completed.length) : 0,
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
