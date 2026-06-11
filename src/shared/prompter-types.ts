/**
 * @file prompter-types.ts
 * @description Shared type definitions for the Prompter (Prompt Power & Robustness Lab)
 * feature. Used by main, preload and renderer. This module has NO imports from
 * src/main/ or src/renderer/ (and none from src/cli/) so it stays a leaf in the
 * dependency graph. Types that reference main/cli shapes (e.g. AgentResult) live
 * in the main-process modules that own them, not here.
 *
 * Playbook reference: 05-PLAYBOOK-PROMPTER sections 7, 11, 14, 15.
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
 * Instructions come before model-config so the user reviews instruction files
 * before configuring models. Schema-selection lets the user pick which test
 * schemas to run (baseline probes pre-selected).
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

/**
 * Default schemas pre-selected in the schema picker. The user can add or
 * remove schemas; these are just the starting set.
 */
export const PROMPTER_DEFAULT_SCHEMAS: readonly string[] = [
	'baseline',
	'safety-boundary',
	'refusal-consistency',
] as const;

// ---------------------------------------------------------------------------
// Variation transform categories (for the wizard's transform picker)
// ---------------------------------------------------------------------------

export interface TransformCategory {
	key: string;
	label: string;
	description: string;
	transforms: string[];
}

export const VARIATION_CATEGORIES: readonly TransformCategory[] = [
	{
		key: 'homoglyph',
		label: 'Homoglyph / Script',
		description:
			'Visually similar characters from Cyrillic, Greek, Math-Bold, and Circled alphabets',
		transforms: ['cyrillic', 'greek-homoglyph', 'math-bold', 'circled'],
	},
	{
		key: 'substitution',
		label: 'Substitution / Distortion',
		description: 'Leetspeak, Zalgo diacritics, and character stretching',
		transforms: ['leet', 'zalgo-light', 'char-stretch'],
	},
	{
		key: 'case-norm',
		label: 'Case / Normalization',
		description: 'Upper/lowercase extremes and Unicode NFD decomposition',
		transforms: ['case-upper', 'case-lower', 'nfd-decompose'],
	},
	{
		key: 'fullwidth-punct',
		label: 'Fullwidth / Punctuation',
		description: 'Fullwidth Unicode block and math-style punctuation',
		transforms: ['fullwidth', 'punct-math'],
	},
	{
		key: 'whitespace',
		label: 'Whitespace / Layout',
		description: 'Extreme spacing, dense lines, tabs, trailing whitespace, NBSP, fragmentation',
		transforms: [
			'ws-paragraphs',
			'ws-dense',
			'trailing-whitespace',
			'nbsp-mix',
			'tabs-heavy',
			'one-word-per-line',
		],
	},
	{
		key: 'bidi-control',
		label: 'Bidi / Control Characters',
		description: 'Bidirectional overrides and zero-width control characters',
		transforms: ['control-red', 'bidi-heavy'],
	},
	{
		key: 'combined',
		label: 'Combined Stress',
		description: 'Multiple transforms stacked for maximum stress testing',
		transforms: ['mixed', 'mixed-cyr-full', 'heavy-mixed'],
	},
] as const;

export const ALL_TRANSFORM_NAMES: readonly string[] = VARIATION_CATEGORIES.flatMap(
	(c) => c.transforms
);

export interface PrompterProjectDraft {
	/** Base directory chosen by the user (the project folder is created inside). */
	targetDir: string;
	/** Project folder name; default "prompt-power-lab". */
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

/** A CLI-specific config-file slot a user can attach a file to per agent. */
export interface AgentFileSlot {
	key: string;
	label: string;
	/** Target path relative to the agent work dir. */
	target: string;
}

/**
 * Per-agent CLI config-file slots (skills/settings/agent files). The user picks
 * a file for any slot; it is copied to the slot's target in the run work dir so
 * the CLI reads it. The main instruction stays the envelope selection; these are
 * extra config.
 */
export const AGENT_FILE_SLOTS: Record<string, AgentFileSlot[]> = {
	'claude-code': [
		{ key: 'settings', label: 'Settings (.claude/settings.json)', target: '.claude/settings.json' },
		{ key: 'skill', label: 'Skill (.claude/skills/SKILL.md)', target: '.claude/skills/SKILL.md' },
		{ key: 'agents', label: 'AGENTS.md', target: 'AGENTS.md' },
	],
	codex: [
		{ key: 'agents', label: 'AGENTS.md', target: 'AGENTS.md' },
		{ key: 'config', label: 'config.toml', target: 'config.toml' },
	],
	'copilot-cli': [
		{
			key: 'instructions',
			label: '.github/copilot-instructions.md',
			target: '.github/copilot-instructions.md',
		},
	],
	opencode: [
		{ key: 'agents', label: 'AGENTS.md', target: 'AGENTS.md' },
		{ key: 'config', label: 'opencode.json', target: 'opencode.json' },
	],
	gemini: [
		{ key: 'settings', label: '.gemini/settings.json', target: '.gemini/settings.json' },
		{ key: 'instructions', label: 'GEMINI.md', target: 'GEMINI.md' },
	],
	'grok-build': [{ key: 'instructions', label: 'GROK.md', target: 'GROK.md' }],
};

/** The CLI config-file slots available for an agent (empty if none). */
export function agentFileSlots(agentId: string): AgentFileSlot[] {
	return AGENT_FILE_SLOTS[agentId] ?? [];
}

/** A user-attached config file copied into the agent's run working dir. */
export interface PrompterAttachedFile {
	/** Slot key (e.g. 'settings', 'skill', 'agents'). */
	slot: string;
	/** Absolute source path chosen by the user. */
	sourcePath: string;
	/** Target path relative to the agent work dir (e.g. '.claude/settings.json'). */
	target: string;
}

export interface PrompterAgentConfig {
	agentId: string;
	modelId: string;
	modelSource: 'discovery' | 'manual';
	/** Path relative to 1-generic-instructions/ (or '*' all, or 'none' bare model). */
	instructionFile: string;
	providerConfigOverrides: Record<string, unknown>;
	generatedFiles: PrompterGeneratedFile[];
	/** CLI-specific config files (skills/settings/agent files) attached per agent. */
	attachedFiles?: PrompterAttachedFile[];
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
	/** Response token count (when available from the agent). */
	tokenCount?: number;
	/** Response character length. */
	responseLength?: number;
	/** Refusal classification from the evaluator. */
	classification?: RefusalClassification;
	/** Evaluator confidence level. */
	confidence?: 'high' | 'medium' | 'low';
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
	/** Aggregate token count across all completed tasks. */
	totalTokens: number;
	/** Average response length in characters. */
	avgResponseLength: number;
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
	/**
	 * Generate character/layout variations of each base instruction (into
	 * 4-advanced-tests/character-variations/) and include them as test inputs.
	 * Defaults to true.
	 */
	includeVariations?: boolean;
	/**
	 * Which variation transforms to apply. When omitted or empty and
	 * `includeVariations` is true, ALL transforms are used.
	 */
	selectedTransforms?: string[];
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
// Instruction Export
// ============================================================================

/** Provider-specific envelope format for exporting a hardened instruction. */
export type InstructionExportFormat =
	| 'raw'
	| 'claude-code'
	| 'codex'
	| 'copilot-cli'
	| 'opencode'
	| 'gemini'
	| 'grok-build'
	| 'agents';

export interface InstructionExportResult {
	/** Absolute path of the exported file. */
	exportedPath: string;
	/** Envelope filename used (e.g. CLAUDE.md, AGENTS.md). */
	envelopeFile: string;
	/** Format that was used. */
	format: InstructionExportFormat;
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
	selectedTransformIds: string[];
	savedAt: number;
}
