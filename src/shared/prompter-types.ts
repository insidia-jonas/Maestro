/**
 * @file prompter-types.ts
 * @description Shared type definitions for the Prompter (Prompt Safety Lab)
 * feature. Used by main, preload and renderer. This module has NO imports from
 * src/main/ or src/renderer/ (and none from src/cli/) so it stays a leaf in the
 * dependency graph. Types that reference main/cli shapes (e.g. AgentResult) live
 * in the main-process modules that own them, not here.
 *
 * Playbook reference: 05-PLAYBOOK-PROMPTER-PROMPT-SAFETY-LAB sections 7, 11, 14, 15.
 */

// ============================================================================
// Wizard
// ============================================================================

export type PrompterWizardStep =
	| 'project-folder'
	| 'create-structure'
	| 'agent-selection'
	| 'model-config'
	| 'instructions'
	| 'schema-selection'
	| 'review';

/**
 * Ordered list of wizard steps - single source of truth for navigation.
 * Instructions come before model-config so the user attaches and reviews the
 * instruction files before configuring each agent's model.
 */
export const PROMPTER_WIZARD_STEPS: readonly PrompterWizardStep[] = [
	'project-folder',
	'create-structure',
	'agent-selection',
	'instructions',
	'model-config',
	'schema-selection',
	'review',
] as const;

export interface PrompterProjectDraft {
	/** Base directory chosen by the user (the project folder is created inside). */
	targetDir: string;
	/** Project folder name; default "prompt-safety-lab". */
	projectName: string;
	/** Show a dry-run plan before writing any files. */
	dryRun: boolean;
}

export interface PrompterProject {
	id: string;
	name: string;
	/** Absolute path of the created project root. */
	rootPath: string;
	createdAt: number;
	toolVersion: string;
}

/** Dry-run plan returned by `prompter:planProject` before anything is written. */
export interface ProjectPlan {
	projectRoot: string;
	foldersToCreate: string[];
	filesToCreate: string[];
	/** Files that already exist and would be left untouched (no overwrite). */
	existingFiles: string[];
	/** Path conflicts that need user resolution. */
	conflicts: ProjectPlanConflict[];
}

export interface ProjectPlanConflict {
	path: string;
	reason: 'exists-as-file' | 'exists-as-dir' | 'not-writable';
}

// ============================================================================
// Instructions
// ============================================================================

export interface InstructionFile {
	/** Path relative to 1-generic-instructions/. */
	path: string;
	/** SHA-256 of the file contents. */
	hash: string;
	sizeBytes: number;
	/** First few lines, for preview in the wizard. */
	preview: string;
}

// ============================================================================
// Agents & Models
// ============================================================================

export interface PrompterAgentSelection {
	agentId: string;
	displayName: string;
	cliPath: string;
	status: 'detected' | 'not-found' | 'error';
}

export interface PrompterGeneratedFile {
	relativePath: string;
	template: string;
	provider: string;
}

export interface PrompterAgentConfig {
	agentId: string;
	modelId: string;
	modelSource: 'discovery' | 'manual';
	/** Path relative to 1-generic-instructions/ (or '*' when all files apply). */
	instructionFile: string;
	providerConfigOverrides: Record<string, unknown>;
	generatedFiles: PrompterGeneratedFile[];
}

export interface PrompterModelOption {
	id: string;
	label: string;
	source: 'cli-discovery' | 'api' | 'cache' | 'manual';
}

// ============================================================================
// Schemas
// ============================================================================

export type PrompterSchemaId =
	| 'baseline'
	| 'provider-compatibility'
	| 'instruction-integrity'
	| 'formatting-robustness'
	| 'normalization-audit'
	| 'safety-boundary'
	| 'refusal-consistency'
	| 'multi-provider-diff'
	| 'regression';

export type SchemaSource = 'builtin' | 'project' | 'shared-library';

/** Lightweight schema descriptor surfaced to the wizard checklist. */
export interface PrompterSchema {
	id: string;
	name: string;
	description: string;
	required: boolean;
	estimatedEffort: 'low' | 'medium' | 'high';
	artefacts: string[];
	source?: SchemaSource;
	isOverride?: boolean;
}

export interface PlaceholderDef {
	/** e.g. '{{INSTRUCTION_CONTENT}}'. */
	key: string;
	source:
		| 'instruction-file'
		| 'instruction-hash'
		| 'agent-name'
		| 'model-name'
		| 'provider-name'
		| 'run-id'
		| 'previous-result'
		| 'literal';
	literalValue?: string;
}

export interface PrompterSchemaTestConfig {
	promptTemplate: string;
	placeholders: PlaceholderDef[];
	customData?: Record<string, string>;
	expectedResponseType: 'text' | 'structured' | 'any';
	minResponseLength?: number;
	maxResponseLength?: number;
	timeoutMs?: number;
	retryOnConfigError: boolean;
	maxRetries: number;
}

export interface PrompterSchemaEvaluation {
	type: 'rule-based' | 'comparative' | 'integrity-check' | 'custom';
	greenCriteria: string[];
	yellowCriteria: string[];
	redCriteria: string[];
	keyPhraseExtraction: boolean;
	coverageThreshold?: {
		green: number;
		yellow: number;
	};
	/** Path to a custom evaluator (.mjs) relative to the project root. */
	evaluatorPath?: string;
}

/** Full machine-readable schema definition (a .schema.json file). */
export interface PrompterSchemaDefinition {
	$schema: 'prompter-schema/v1';
	id: string;
	name: string;
	description: string;
	version: string;
	required: boolean;
	estimatedEffort: 'low' | 'medium' | 'high';
	testConfig: PrompterSchemaTestConfig;
	evaluation: PrompterSchemaEvaluation;
	artefacts: string[];
	requiresMultiAgent: boolean;
	/** Parent schema id for inheritance (max depth 2). */
	extends?: string;
	/** Where this schema was loaded from (set automatically). */
	source?: SchemaSource;
	/** True when a project/shared schema overrides a builtin of the same id. */
	isOverride?: boolean;
}

// ============================================================================
// Runs & Tasks
// ============================================================================

export type PrompterRunStatus =
	| 'planned'
	| 'preparing'
	| 'running'
	| 'paused'
	| 'stopping'
	| 'completed'
	| 'failed';

export type PrompterRunPhase =
	| 'scaffold'
	| 'baseline'
	| 'provider-config'
	| 'schema-test'
	| 'evaluate'
	| 'write-results'
	| 'report';

export type PrompterResultBand = 'green' | 'yellow' | 'red';

export type PrompterTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface PrompterTask {
	id: string;
	runId: string;
	agentId: string;
	modelId: string;
	schemaId: string;
	/** Path relative to 1-generic-instructions/. */
	instructionFile: string;
	instructionHash: string;
	status: PrompterTaskStatus;
	result?: PrompterResultBand;
	startedAt?: number;
	completedAt?: number;
	error?: string;
	evidencePath?: string;
	/** How many retries have been attempted (rate-limit / config-error). */
	attempts?: number;
}

export interface PrompterRunSummary {
	totalTasks: number;
	completedTasks: number;
	green: number;
	yellow: number;
	red: number;
	failed: number;
	skipped: number;
	durationMs: number;
}

export interface PrompterRun {
	id: string;
	projectId: string;
	projectRoot: string;
	status: PrompterRunStatus;
	phase: PrompterRunPhase;
	agents: PrompterAgentConfig[];
	schemas: string[];
	tasks: PrompterTask[];
	maxParallelAgents: number;
	createdAt: number;
	updatedAt: number;
	completedAt?: number;
	summary?: PrompterRunSummary;
}

/** Payload to create a run (before it is started). */
export interface PrompterRunConfig {
	projectId: string;
	projectRoot: string;
	agents: PrompterAgentConfig[];
	schemas: string[];
	maxParallelAgents?: number;
}

// ============================================================================
// Evaluation
// ============================================================================

export type RefusalClassification =
	| 'none'
	| 'safety-policy'
	| 'syntax-config'
	| 'timeout'
	| 'cli-error'
	| 'partial'
	| 'unknown';

export interface EvaluatorMetrics {
	responseLength: number;
	responseTimeMs: number;
	tokenCount?: number;
	costUsd?: number;
}

/**
 * Result of evaluating a single task. Dependency-free so it can be shared.
 * The evaluator *input* (which references AgentResult) lives in the main
 * evaluator module to keep this file free of main/cli imports.
 */
export interface EvaluatorOutput {
	band: PrompterResultBand;
	classification: RefusalClassification;
	reason: string;
	details: string[];
	confidence: 'high' | 'medium' | 'low';
	metrics: EvaluatorMetrics;
}

/** Custom evaluator (.mjs) return shape (subset of EvaluatorOutput). */
export interface CustomEvaluatorResult {
	band: PrompterResultBand;
	reason: string;
	details?: string[];
	metrics?: Record<string, unknown>;
}

export interface PrompterEvaluation {
	taskId: string;
	band: PrompterResultBand;
	classification: RefusalClassification;
	reason: string;
	details: string[];
	confidence: 'high' | 'medium' | 'low';
	promptHash: string;
	responseHash: string;
	evaluatedAt: number;
}

// ============================================================================
// Persistence (crash recovery)
// ============================================================================

export interface PersistedRunState {
	run: PrompterRun;
	lastPersistedAt: number;
	version: number;
	checkpoint: {
		completedTaskIds: string[];
		currentTaskId?: string;
		currentPhase: PrompterRunPhase;
	};
}

// ============================================================================
// Events (Main → Renderer)
// ============================================================================

export interface PrompterRunUpdatedEvent {
	runId: string;
	status: PrompterRunStatus;
	phase: PrompterRunPhase;
	summary: PrompterRunSummary;
}

export interface PrompterTaskUpdatedEvent {
	runId: string;
	task: PrompterTask;
}

export interface PrompterLogEvent {
	runId: string;
	level: 'info' | 'warn' | 'error';
	message: string;
	timestamp: number;
	taskId?: string;
}

// ============================================================================
// Wizard resume (serializable subset of the wizard store)
// ============================================================================

export interface SerializableWizardState {
	wizardStep: PrompterWizardStep;
	projectDraft: PrompterProjectDraft | null;
	createdProject: PrompterProject | null;
	selectedAgentIds: string[];
	agentConfigs: PrompterAgentConfig[];
	selectedSchemaIds: string[];
	savedAt: number;
}
