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
	| 'target-models'
	| 'schema-selection'
	| 'custom-data'
	| 'review';

/**
 * Ordered list of wizard steps - single source of truth for navigation.
 * Instructions come before model-config so the user reviews instruction files
 * before configuring models. Schema-selection lets the user pick which test
 * schemas to run. Custom-data lets the user fill {{CUSTOM:*}} placeholders.
 */
export const PROMPTER_WIZARD_STEPS: readonly PrompterWizardStep[] = [
	'project-folder',
	'create-structure',
	'agent-selection',
	'instructions',
	'model-config',
	'target-models',
	'schema-selection',
	'custom-data',
	'review',
] as const;

/**
 * Default schemas pre-selected in the schema picker. The user can add or
 * remove schemas; these are just the starting set.
 */
export const PROMPTER_DEFAULT_SCHEMAS: readonly string[] = [
	'adversarial-compliance-test',
	'homoglyph-bypass-effectiveness',
	'semantic-self-reference-tester',
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
}

/** A declared test target: agent + model combo the project tests against. */
export interface TestTarget {
	agentId: string;
	modelId: string;
	displayName?: string;
	isPrimary?: boolean;
	/** True when this target was also configured as an executor agent. */
	isExecutor?: boolean;
	/** Manual pairing: preferred crafter agent for this target. */
	preferredCrafterAgentId?: string;
	/** Manual pairing: preferred crafter model for this target. */
	preferredCrafterModelId?: string;
}

/** An agent+model combo that acts as an attacker / crafter in the Red-Team pipeline. */
export interface CrafterAgent {
	agentId: string;
	modelId: string;
	displayName?: string;
}

// ============================================================================
// Red-Team Crafter (intelligent prompt modification for model evaluation)
// ============================================================================

/**
 * Modification strategy the crafter agent uses to adapt test prompts.
 * For security research and model robustness evaluation only.
 */
export type RedTeamStrategy =
	| 'semantic-reframe'
	| 'context-blend'
	| 'authority-frame'
	| 'task-decompose'
	| 'persona-mirror'
	| 'multi-vector'
	| 'adaptive-combined';

export const RED_TEAM_STRATEGIES: { key: RedTeamStrategy; label: string; description: string }[] = [
	{
		key: 'semantic-reframe',
		label: 'Semantisches Reframing',
		description: 'Prompt umformulieren fuer natuerliche Einpassung in den Instruction-Kontext',
	},
	{
		key: 'context-blend',
		label: 'Kontext-Einbettung',
		description: 'Prompt als legitime Aufgabe der Instruction einrahmen',
	},
	{
		key: 'authority-frame',
		label: 'Autoritaets-Framing',
		description: 'Meta-Instruktionen und System-Level-Framing hinzufuegen',
	},
	{
		key: 'task-decompose',
		label: 'Task-Zerlegung',
		description: 'Versteckte Aufgabe in harmlos klingende Teilschritte zerlegen',
	},
	{
		key: 'persona-mirror',
		label: 'Persona-Spiegelung',
		description: 'Stil und Persona der Base-Instruction imitieren',
	},
	{
		key: 'multi-vector',
		label: 'Multi-Vektor',
		description: 'Mehrere Strategien gleichzeitig kombinieren',
	},
	{
		key: 'adaptive-combined',
		label: 'Adaptiv',
		description: 'Crafter waehlt selbst basierend auf bisherigem Feedback',
	},
];

/** Configuration for the Red-Team Crafter agent that intelligently modifies test prompts. */
export interface RedTeamCrafterConfig {
	enabled: boolean;
	/** Agent CLI used to run the crafter (e.g. claude-code). Falls back to first from crafterAgents pool. */
	crafterAgentId: string;
	/** Model for the crafter agent (e.g. claude-opus-4-8). Falls back to first from crafterAgents pool. */
	crafterModelId: string;
	/** Which strategies the crafter is allowed to use. */
	strategies: RedTeamStrategy[];
	/** Run an instruction analysis before the first task? */
	profileInstruction: boolean;
	/** How many previous results to include in feedback context (default 5). */
	feedbackDepth: number;
	/** Timeout for crafter spawn calls in ms (default 120000). */
	crafterTimeoutMs: number;
	/** Pairing mode: how to assign crafters to targets from the pool. */
	pairingMode?: CrafterPairingMode;
}

/** How crafters from the pool are assigned to targets. */
export type CrafterPairingMode = 'round-robin' | 'best-performer' | 'manual' | 'auto';

/** Cached analysis of an instruction's structure, boundaries, and weak points. */
export interface InstructionProfile {
	persona: string;
	boundaries: string[];
	style: string;
	weakPoints: string[];
	keyPhrases: string[];
	structureType: string;
}

/** One entry in the adaptive feedback chain within a run. */
export interface CraftFeedbackEntry {
	schemaId: string;
	strategy: RedTeamStrategy;
	modificationSummary: string;
	result: PrompterResultBand;
	complianceScore?: number;
	responseExcerpt: string;
	/** Target model this feedback was produced against (for learnings matching). */
	targetModelId: string;
}

/** Result of a single crafter modification call. */
export interface CraftResult {
	modifiedPrompt: string;
	strategy: RedTeamStrategy;
	modificationSummary: string;
	profileUsed?: InstructionProfile;
}

export interface PrompterProject {
	id: string;
	name: string;
	/** Absolute path of the created project root. */
	rootPath: string;
	createdAt: number;
	toolVersion: string;
	/** Declared test targets for this project (agent + model combos). */
	testTargets?: TestTarget[];
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
	| 'adversarial-compliance-test'
	| 'homoglyph-bypass-effectiveness'
	| 'semantic-self-reference-tester'
	| 'taxonomy-embedding-momentum'
	| 'bidi-zero-width-evasion'
	| 'multi-technique-synergy-finder'
	| 'injection-reliability-verifier'
	| 'adversarial-intelligence-discoverer'
	| 'model-vulnerability-profiler'
	| 'edge-case-injection-finder'
	| 'attention-attractor-obfuscation'
	| 'emoji-steganography'
	| 'invisible-text-steganography'
	| 'steganographic-carrier-tester'
	| 'green-to-hardened-instruction';

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
	customDataDefaults?: Record<string, string>;
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
		| 'literal'
		| 'customData';
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

export type PrompterRunPhase = 'scaffold' | 'schema-test' | 'evaluate' | 'write-results' | 'report';

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
	/** Multi-layered compliance score (0..1 overall). */
	complianceScore?: number;
	/** Red-Team Crafter: which strategy was used to modify this task's prompt. */
	craftStrategy?: RedTeamStrategy;
	/** Red-Team Crafter: summary of what was changed. */
	craftModificationSummary?: string;
	/** Red-Team Crafter: the prompt before crafter modification (for comparison). */
	originalPrompt?: string;
	/** Red-Team Crafter: which crafter agent+model was used (when pool is active). */
	crafterAgentId?: string;
	crafterModelId?: string;
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
	/** Dynamic customData passed through to buildPrompt (for generator runs). */
	customDataOverrides?: Record<string, string>;
	/** Auto-generate hardened instruction from qualifying green results. */
	autoGenerateHardenedInstruction?: boolean;
	/** Red-Team Crafter configuration (when intelligent prompt modification is enabled). */
	crafterConfig?: RedTeamCrafterConfig;
	/** Pool of crafter agents (attacker side). When set, crafters are selected per task. */
	crafterAgents?: CrafterAgent[];
	/** Variation transforms selected for this run. */
	selectedTransforms?: string[];
	/** Declared test targets for report metadata. */
	testTargets?: TestTarget[];
	/** Hardened instruction files generated after this run. */
	hardenedInstructions?: Array<{
		path: string;
		basedOn: string;
		findingsAddressed: string[];
		generatedAt: number;
	}>;
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
	/**
	 * Dynamic customData overrides merged into schema.testConfig.customData
	 * at prompt-build time. Used by the hardened-instruction generator to
	 * inject base_instruction and green_findings into the schema template.
	 */
	customDataOverrides?: Record<string, string>;
	/**
	 * After this run completes, auto-generate a hardened System Instruction
	 * from green adversarial findings (if any exist). Default: true.
	 */
	autoGenerateHardenedInstruction?: boolean;
	/** Declared test targets (for report metadata and target-aware task matrix). */
	testTargets?: TestTarget[];
	/** Red-Team Crafter configuration for intelligent prompt modification. */
	crafterConfig?: RedTeamCrafterConfig;
	/** Pool of crafter agents (attacker side) for intelligent pairing. */
	crafterAgents?: CrafterAgent[];
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
 * Multi-layered compliance score: measures how fully a response fulfilled the
 * test objective (coverage × structure × behavior). For adversarial testing
 * research only - quantifies model compliance under test conditions.
 */
export interface ComplianceScoreResult {
	/** Overall weighted score 0..1. */
	overall: number;
	/** Key-phrase / semantic coverage of the test objective. */
	coverage: number;
	/** Structural completeness (code blocks, steps, headings, depth). */
	structure: number;
	/** Behavioral fullness (length, detail, absence of hedging/refusals). */
	behavior: number;
	/** Score confidence. */
	confidence: 'high' | 'medium' | 'low';
	/** Human-readable breakdown for research documentation. */
	breakdown: string[];
}

/**
 * Statistical reliability metrics from multi-run verification.
 * For research use: verifies whether a finding is reproducible across runs.
 */
export interface ReliabilityResult {
	runs: number;
	mean: number;
	stddev: number;
	successRate: number;
	ci95: [number, number];
	reproducibility: number;
	badge: 'high' | 'medium' | 'low' | 'insufficient';
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
	/** Multi-layered compliance score (when computed). */
	complianceScore?: ComplianceScoreResult;
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
// Campaigns (autonomous adversarial test loops for model evaluation research)
// ============================================================================

export type CampaignStopMode = 'until-findings' | 'fixed-iterations' | 'until-threshold';

export type CampaignStatus = 'planned' | 'running' | 'paused' | 'completed' | 'stopped';

export interface CampaignAutonomyConfig {
	mode: CampaignStopMode;
	maxIterations: number;
	/** Stop after this many effective findings (mode = 'until-findings'). */
	findingsTarget?: number;
	/** Stop when overall compliance >= this (mode = 'until-threshold'). */
	successRateThreshold?: number;
	/** Between iterations, analyze results and refine test prompts. */
	enableRefinement: boolean;
}

export interface CampaignConfig {
	projectRoot: string;
	name: string;
	agents: PrompterAgentConfig[];
	schemas: string[];
	transforms: string[];
	autonomy: CampaignAutonomyConfig;
	maxParallelAgents: number;
	includeVariations: boolean;
	/** Red-Team Crafter configuration for intelligent prompt modification. */
	crafterConfig?: RedTeamCrafterConfig;
	/** Pool of crafter agents (attacker side) for the campaign. */
	crafterAgents?: CrafterAgent[];
	/** Enable auto-hardening between iterations (not just at end). */
	autoHardenBetweenIterations?: boolean;
}

export interface CampaignRefinement {
	iterationNumber: number;
	description: string;
	/** Which transforms to focus on in the next iteration. */
	focusTransforms?: string[];
	/**
	 * Which schema IDs to focus on in the next iteration. Used for schema-driven
	 * techniques like Steganography, which are NOT transform-driven. Kept separate
	 * from focusTransforms so they are never fed into the variation transform
	 * filter (which matches transform names, never schema IDs).
	 */
	focusSchemas?: string[];
	/**
	 * Transforms to drop from the next iteration (e.g. boundaries the model held
	 * perfectly). Explicit field so the campaign does not have to infer skip intent
	 * by string-matching translated descriptions.
	 */
	skipTransforms?: string[];
	/** Notes about why this refinement was suggested. */
	rationale: string;
}

export interface CampaignFinding {
	technique: string;
	transforms: string[];
	successRate: number;
	avgTokens: number;
	models: string[];
	iterationFound: number;
	description: string;
	/** Statistical reliability of this finding across runs. */
	reliability?: ReliabilityResult;
	/** Average multi-layered compliance score for this technique. */
	avgComplianceScore?: number;
	/** Representative response excerpts from green tasks (first 500 chars each). */
	responseExcerpts?: string[];
	/** Per-layer evaluation breakdown (coverage / structure / behavior). */
	evaluationBreakdown?: {
		coverage: number;
		structure: number;
		behavior: number;
		confidence: string;
	};
	/** Red-Team Crafter: which strategy led to this finding. */
	crafterStrategy?: RedTeamStrategy;
	/** Red-Team Crafter: what the crafter changed to produce this finding. */
	craftModification?: string;
}

export interface CampaignIteration {
	iterationNumber: number;
	runId: string;
	refinements: CampaignRefinement[];
	/** Per-technique metrics computed after this iteration. */
	techniqueMetrics: Array<{
		technique: string;
		complianceRate: number;
		avgTokens: number;
		total: number;
	}>;
	overallComplianceRate: number;
	newFindings: number;
	startedAt: number;
	completedAt?: number;
	/**
	 * True when the underlying run failed unexpectedly (e.g. startRun threw). Such
	 * iterations must NOT count toward the "no new findings" dry-iteration cutoff,
	 * so an infrastructure failure cannot masquerade as "model held".
	 */
	errored?: boolean;
	/** Error message when errored is true. */
	error?: string;
}

export interface CampaignMetrics {
	totalIterations: number;
	totalRuns: number;
	totalTasks: number;
	overallSuccessRate: number;
	bestTechnique: string;
	bestSuccessRate: number;
	weakestBoundary: string;
	strongestBoundary: string;
}

export interface Campaign {
	id: string;
	config: CampaignConfig;
	status: CampaignStatus;
	iterations: CampaignIteration[];
	findings: CampaignFinding[];
	metrics: CampaignMetrics;
	createdAt: number;
	updatedAt: number;
	completedAt?: number;
	/** Reason the campaign stopped (user, threshold, max iterations, findings target). */
	stopReason?: string;
	/** Paths to hardened instruction files generated from green findings. */
	hardenedInstructions?: Array<{
		path: string;
		basedOn: string;
		findingsAddressed: string[];
		generatedAt: number;
	}>;
}

/** Payload for campaign-level events (main -> renderer). */
export interface CampaignUpdatedEvent {
	campaignId: string;
	status: CampaignStatus;
	currentIteration: number;
	totalIterations: number;
	findings: number;
	overallComplianceRate: number;
	/**
	 * Full campaign snapshot at emit time. Lets the renderer reflect live
	 * progress (iterations, findings, metrics, hardened instructions) instead of
	 * only the status. Plain data, structured-cloneable across the IPC bridge.
	 */
	campaign: Campaign;
}

// ============================================================================
// Crafter Learnings (cross-campaign persistence)
// ============================================================================

/** Persisted learnings from crafter runs, keyed by instruction hash. */
export interface CrafterLearnings {
	instructionHash: string;
	instructionName: string;
	updatedAt: number;
	entries: CrafterLearningEntry[];
}

export interface CrafterLearningEntry {
	campaignId: string;
	strategy: RedTeamStrategy;
	targetModelFamily: string;
	result: PrompterResultBand;
	complianceScore?: number;
	weakPointsExploited: string[];
	recordedAt: number;
}

// ============================================================================
// Research export
// ============================================================================

export type ResearchExportFormat = 'csv' | 'json' | 'markdown';

export interface ResearchExportResult {
	exportedPath: string;
	format: ResearchExportFormat;
	recordCount: number;
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
	customDataOverrides?: Record<string, string>;
	testTargets?: TestTarget[];
	crafterConfig?: RedTeamCrafterConfig;
	crafterAgents?: CrafterAgent[];
	savedAt: number;
}
