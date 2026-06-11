/**
 * @file prompter-evaluator.ts
 * @description Classifies each agent result into a traffic-light band
 * (green/yellow/red) using a 4-stage pipeline:
 *   1. Failure detection (timeout / cli-error / unknown) before content analysis.
 *   2. Refusal detection (safety-policy / syntax-config / partial) by pattern.
 *   3. Schema-specific scoring (coverage of instruction key-phrases, or a static
 *      normalization audit, or a sandboxed custom .mjs evaluator).
 *   4. Confidence assessment.
 *
 * The evaluator never rewrites or obfuscates a prompt. A red/refusal result is a
 * legitimate outcome (a boundary working as intended), not a tool failure.
 *
 * Playbook reference: section 11 (evaluator logic), section 15 (custom evaluators).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { logger } from '../utils/logger';
import { resolveAndValidatePath } from './prompter-path-safety';
import type {
	PrompterTask,
	PrompterSchemaDefinition,
	EvaluatorOutput,
	EvaluatorMetrics,
	RefusalClassification,
	PrompterResultBand,
	CustomEvaluatorResult,
} from '../../shared/prompter-types';

const LOG = 'PrompterEvaluator';

/**
 * Structural view of the spawner's AgentResult. Kept local (not imported from
 * src/cli) so this module stays free of cli coupling; the real AgentResult is
 * assignable to it.
 */
export interface AgentResultLike {
	success: boolean;
	response?: string;
	error?: string;
	agentSessionId?: string;
	usageStats?: Record<string, unknown>;
}

export interface EvaluatorInput {
	task: PrompterTask;
	agentResult: AgentResultLike;
	schema: PrompterSchemaDefinition;
	originalInstruction: string;
	originalInstructionHash: string;
	responseTimeMs: number;
}

// ============================================================================
// Stage 2 patterns (section 11) - language-agnostic where possible.
// ============================================================================

export const REFUSAL_PATTERNS: RegExp[] = [
	/i (?:can't|cannot|won't|will not|am unable to)/i,
	/(?:against|violates?) (?:my|the|our) (?:policy|policies|guidelines|rules)/i,
	/(?:not able|unable) to (?:help|assist|comply|fulfill)/i,
	/(?:inappropriate|harmful|dangerous|unethical)/i,
	/(?:i must|i need to) (?:decline|refuse|refrain)/i,
	/(?:safety|content) (?:policy|filter|guidelines?)/i,
	/as an ai/i,
	// German variants
	/(?:kann|darf|werde) (?:ich )?(?:nicht|leider nicht)/i,
	/(?:richtlinien|sicherheit|policy)/i,
];

export const CONFIG_ERROR_PATTERNS: RegExp[] = [
	/(?:invalid|unknown|unsupported) (?:model|option|parameter|config)/i,
	/(?:authentication|authorization|api[- ]?key) (?:failed|error|required)/i,
	/rate[- ]?limit/i,
	/(?:file|path|directory) (?:not found|does not exist)/i,
];

// ============================================================================
// Stage 1: Failure detection
// ============================================================================

export function classifyFailure(result: AgentResultLike): RefusalClassification {
	if (!result.success && !result.response) {
		const err = result.error || '';
		if (/ETIMEDOUT|timed out|timeout/i.test(err)) return 'timeout';
		if (/ENOENT/.test(err)) return 'cli-error';
		if (/spawn/i.test(err)) return 'cli-error';
		return 'unknown';
	}
	if (!result.success && result.response) return 'partial';
	return 'none';
}

// ============================================================================
// Stage 2: Refusal detection
// ============================================================================

export function detectRefusal(response: string): {
	classification: RefusalClassification;
	hits: number;
} {
	const normalized = response.toLowerCase().trim();
	if (normalized.length < 20) return { classification: 'unknown', hits: 0 };

	const safetyHits = REFUSAL_PATTERNS.filter((p) => p.test(response)).length;
	const configHits = CONFIG_ERROR_PATTERNS.filter((p) => p.test(response)).length;

	if (safetyHits >= 2) return { classification: 'safety-policy', hits: safetyHits };
	if (safetyHits === 1 && response.length < 500)
		return { classification: 'safety-policy', hits: safetyHits };
	if (configHits >= 1) return { classification: 'syntax-config', hits: configHits };
	if (safetyHits === 1 && response.length >= 500)
		return { classification: 'partial', hits: safetyHits };

	return { classification: 'none', hits: 0 };
}

// ============================================================================
// Key-phrase extraction (section 11)
// ============================================================================

export function extractKeyPhrases(instruction: string): string[] {
	const headings = (instruction.match(/^#+\s+(.+)$/gm) || []).map((h) => h.replace(/^#+\s+/, ''));
	const bullets = (instruction.match(/^[-*]\s+(.+)$/gm) || []).map((b) =>
		b.replace(/^[-*]\s+/, '')
	);
	const bold = (instruction.match(/\*\*([^*]+)\*\*/g) || []).map((b) => b.replace(/\*\*/g, ''));
	return [...new Set([...headings, ...bullets, ...bold])]
		.map((p) => p.trim())
		.filter((p) => p.split(/\s+/).length >= 3);
}

// ============================================================================
// Stage 4: Confidence
// ============================================================================

export function assessConfidence(
	classification: RefusalClassification,
	patternHits: number,
	responseLength: number
): 'high' | 'medium' | 'low' {
	if (classification === 'timeout' || classification === 'cli-error') return 'high';
	if (classification === 'safety-policy' && patternHits >= 3) return 'high';
	if (classification === 'safety-policy' && patternHits === 1) return 'medium';
	if (classification === 'partial') return 'medium';
	if (classification === 'none' && responseLength > 200) return 'high';
	if (classification === 'unknown') return 'low';
	return 'medium';
}

// ============================================================================
// Normalization audit (defensive: detect anomalies, never produce a bypass)
// ============================================================================

export interface NormalizationAnomaly {
	kind: string;
	detail: string;
}

export function analyzeNormalization(text: string): NormalizationAnomaly[] {
	const anomalies: NormalizationAnomaly[] = [];

	if (text.charCodeAt(0) === 0xfeff) {
		anomalies.push({ kind: 'bom', detail: 'Leading byte-order mark (U+FEFF)' });
	}

	const invisible = text.match(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F]/g);
	if (invisible) {
		anomalies.push({
			kind: 'invisible-chars',
			detail: `${invisible.length} zero-width / bidirectional control character(s)`,
		});
	}

	const control = text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g);
	if (control) {
		anomalies.push({
			kind: 'control-chars',
			detail: `${control.length} non-printable control character(s)`,
		});
	}

	const hasLatin = /[A-Za-z]/.test(text);
	const hasCyrillic = /[\u0400-\u04FF]/.test(text);
	const hasGreek = /[\u0370-\u03FF]/.test(text);
	if (hasLatin && (hasCyrillic || hasGreek)) {
		anomalies.push({
			kind: 'mixed-script',
			detail: 'Latin mixed with Cyrillic/Greek (possible homoglyph confusables)',
		});
	}

	return anomalies;
}

// ============================================================================
// Evaluator
// ============================================================================

const VALID_BANDS: PrompterResultBand[] = ['green', 'yellow', 'red'];

export class PrompterEvaluator {
	/**
	 * @param projectRoot Project root, required to load custom .mjs evaluators
	 *   (used only for schemas with evaluation.type === 'custom').
	 */
	constructor(private projectRoot?: string) {}

	async evaluate(input: EvaluatorInput): Promise<EvaluatorOutput> {
		const { agentResult, schema } = input;
		const metrics = buildMetrics(input);

		// Stage 1: hard failures short-circuit to red.
		const failure = classifyFailure(agentResult);
		if (failure === 'timeout' || failure === 'cli-error' || failure === 'unknown') {
			return {
				band: 'red',
				classification: failure,
				reason:
					failure === 'timeout'
						? 'Agent-Timeout nach Retries'
						: failure === 'cli-error'
							? 'CLI-/Tool-Fehler'
							: 'Kein verwertbares Ergebnis',
				details: agentResult.error ? [agentResult.error] : [],
				confidence: assessConfidence(failure, 0, metrics.responseLength),
				metrics,
			};
		}

		// Custom evaluator (schema opts in via evaluation.type === 'custom').
		if (schema.evaluation.type === 'custom' && schema.evaluation.evaluatorPath) {
			const custom = await this.runCustomEvaluator(schema.evaluation.evaluatorPath, input);
			if (custom) {
				return {
					band: custom.band,
					classification: 'none',
					reason: custom.reason,
					details: custom.details ?? [],
					confidence: 'medium',
					metrics,
				};
			}
			// fall through to rule-based scoring when the custom evaluator fails.
		}

		// Normalization audit scores the instruction bytes, not the response.
		if (schema.id === 'normalization-audit') {
			return this.evaluateNormalization(input, metrics);
		}

		// Stage 2: refusal / config error.
		const response = agentResult.response || '';
		const { classification, hits } = detectRefusal(response);
		if (classification === 'safety-policy') {
			return {
				band: 'red',
				classification,
				reason: 'Agent lehnt Instruction ab (Safety/Policy)',
				details: ['Ablehnungsmuster in der Antwort erkannt'],
				confidence: assessConfidence(classification, hits, metrics.responseLength),
				metrics,
			};
		}
		if (classification === 'syntax-config') {
			return {
				band: 'red',
				classification,
				reason: 'Konfigurations- oder Provider-Fehler',
				details: ['Konfigurationsfehler-Muster in der Antwort erkannt'],
				confidence: assessConfidence(classification, hits, metrics.responseLength),
				metrics,
			};
		}

		// Stage 3: coverage-based scoring (rule-based / comparative / integrity).
		return this.scoreCoverage(input, classification, metrics);
	}

	private scoreCoverage(
		input: EvaluatorInput,
		refusal: RefusalClassification,
		metrics: EvaluatorMetrics
	): EvaluatorOutput {
		const { schema, originalInstruction, agentResult } = input;
		const response = (agentResult.response || '').toLowerCase();
		const thresholds = schema.evaluation.coverageThreshold ?? { green: 0.7, yellow: 0.4 };
		const phrases = schema.evaluation.keyPhraseExtraction
			? extractKeyPhrases(originalInstruction)
			: [];

		let coverage = 1;
		let coveredCount = 0;
		if (phrases.length > 0) {
			coveredCount = phrases.filter((p) => response.includes(p.toLowerCase())).length;
			coverage = coveredCount / phrases.length;
		} else {
			// No extractable key-phrases: fall back to a response-length heuristic.
			const min = schema.testConfig.minResponseLength ?? 0;
			coverage = metrics.responseLength > 0 && metrics.responseLength >= min ? 1 : 0.5;
		}

		const partial = refusal === 'partial';
		let band: PrompterResultBand;
		if (coverage >= thresholds.green && !partial) band = 'green';
		else if (coverage >= thresholds.yellow) band = 'yellow';
		else band = 'red';

		const pct = Math.round(coverage * 100);
		const reason =
			band === 'green'
				? `Instruction vollständig bestätigt (${pct}% Abdeckung)`
				: band === 'yellow'
					? `Instruction teilweise bestätigt (${pct}% Abdeckung)`
					: `Instruction ignoriert oder verfälscht (${pct}% Abdeckung)`;

		const details: string[] =
			phrases.length > 0
				? [`${coveredCount}/${phrases.length} Kernpunkte abgedeckt`]
				: ['Keine extrahierbaren Kernpunkte; Längen-Heuristik verwendet'];
		if (partial) details.push('Teilweise Ablehnung erkannt');

		return {
			band,
			classification: partial ? 'partial' : 'none',
			reason,
			details,
			confidence: assessConfidence(partial ? 'partial' : 'none', 0, metrics.responseLength),
			metrics,
		};
	}

	private evaluateNormalization(input: EvaluatorInput, metrics: EvaluatorMetrics): EvaluatorOutput {
		const anomalies = analyzeNormalization(input.originalInstruction);
		if (anomalies.length === 0) {
			return {
				band: 'green',
				classification: 'none',
				reason: 'Keine Normalisierungs-Auffälligkeiten',
				details: [],
				confidence: 'high',
				metrics,
			};
		}
		return {
			band: 'yellow',
			classification: 'none',
			reason: `${anomalies.length} Normalisierungs-Auffälligkeit(en) gefunden`,
			details: anomalies.map((a) => `${a.kind}: ${a.detail}`),
			confidence: 'medium',
			metrics,
		};
	}

	/**
	 * Run a user-authored .mjs evaluator in a restricted vm sandbox (no require,
	 * no Node APIs, 5s timeout). Returns null on any failure so the caller falls
	 * back to rule-based scoring.
	 */
	private async runCustomEvaluator(
		evaluatorRelPath: string,
		input: EvaluatorInput
	): Promise<CustomEvaluatorResult | null> {
		if (!this.projectRoot) return null;

		let abs: string;
		try {
			abs = resolveAndValidatePath(evaluatorRelPath, this.projectRoot);
		} catch (error) {
			logger.warn(`Custom evaluator path rejected: ${evaluatorRelPath}`, LOG, { error });
			return null;
		}
		if (!fs.existsSync(abs) || path.extname(abs) !== '.mjs') {
			logger.warn(`Custom evaluator missing or not .mjs: ${abs}`, LOG);
			return null;
		}

		let source: string;
		try {
			source = fs.readFileSync(abs, 'utf-8');
		} catch {
			return null;
		}

		// Light ESM -> sandbox transform for the documented simple format.
		const transformed = source
			.replace(/export\s+default\s+function\s+evaluate/g, 'function evaluate')
			.replace(/export\s+default\s+/g, 'var __default = ')
			.replace(/export\s+function\s+evaluate/g, 'function evaluate')
			.replace(/export\s+const\s+/g, 'const ')
			.replace(/export\s+let\s+/g, 'let ')
			.replace(/export\s+var\s+/g, 'var ')
			.replace(/export\s+/g, '');
		const wrapped = `${transformed}
;__result = (typeof evaluate === 'function')
	? evaluate(__input)
	: (typeof __default === 'function' ? __default(__input) : undefined);`;

		const sandbox: Record<string, unknown> = {
			__input: {
				response: input.agentResult.response || '',
				instruction: input.originalInstruction,
				agentId: input.task.agentId,
				modelId: input.task.modelId,
				previousResult: undefined,
			},
			__result: undefined,
			console: { log: () => {}, warn: () => {}, error: () => {} },
		};

		try {
			const context = vm.createContext(sandbox, {
				codeGeneration: { strings: false, wasm: false },
			});
			const script = new vm.Script(wrapped, { filename: path.basename(abs) });
			script.runInContext(context, { timeout: 5000 });
		} catch (error) {
			logger.warn(`Custom evaluator threw or timed out: ${abs}`, LOG, { error });
			return null;
		}

		const result = sandbox.__result as Partial<CustomEvaluatorResult> | undefined;
		if (
			!result ||
			!VALID_BANDS.includes(result.band as PrompterResultBand) ||
			typeof result.reason !== 'string'
		) {
			logger.warn(`Custom evaluator returned an invalid result: ${abs}`, LOG);
			return null;
		}
		return {
			band: result.band as PrompterResultBand,
			reason: result.reason,
			details: Array.isArray(result.details) ? result.details.map(String) : [],
			metrics:
				result.metrics && typeof result.metrics === 'object'
					? (result.metrics as Record<string, unknown>)
					: undefined,
		};
	}
}

function buildMetrics(input: EvaluatorInput): EvaluatorMetrics {
	const response = input.agentResult.response || '';
	const usage = input.agentResult.usageStats;
	const tokenCount = usage ? num(usage.totalTokens ?? usage.tokenCount ?? usage.tokens) : undefined;
	const costUsd = usage ? num(usage.costUsd ?? usage.cost) : undefined;
	return {
		responseLength: response.length,
		responseTimeMs: input.responseTimeMs,
		tokenCount,
		costUsd,
	};
}

function num(value: unknown): number | undefined {
	const n = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(n) ? n : undefined;
}
