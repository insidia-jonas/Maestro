/**
 * @file prompter-robustness.ts
 * @description Shared, dependency-free robustness analysis used by both the
 * renderer (PrompterRobustnessPanel) and the main process (defender gap report).
 *
 * Defensive only: it groups the character/layout variations under which an
 * instruction's understanding or boundary BROKE (yellow/red) into transform
 * classes and attaches a harmless normalizer-hardening recommendation per class.
 * There is no ranking by token output/compliance and no notion of a "best" or
 * "winning" variant - breakage is the useful signal, a held (green) variation is
 * good.
 */

import type { PrompterTask, PrompterResultBand } from './prompter-types';

/** Path prefix that marks a generated character/layout variation fixture. */
export const VARIATION_PREFIX = '4-advanced-tests/character-variations/tv-';

export interface TransformInfo {
	technique: string;
	/** Harmless normalizer-hardening recommendation (no payloads). */
	fix: string;
}

/** Transform name -> technique class + defensive normalizer-hardening fix. */
export const TRANSFORM_INFO: Record<string, TransformInfo> = {
	cyrillic: {
		technique: 'Homoglyph / Script',
		fix: 'NFKC + confusables-Mapping; nicht-lateinische Homoglyphen in Schluesselbegriffen normalisieren.',
	},
	'greek-homoglyph': {
		technique: 'Homoglyph / Script',
		fix: 'NFKC + confusables-Mapping (griechische Homoglyphen).',
	},
	'math-bold': {
		technique: 'Homoglyph / Script',
		fix: 'Mathematische Alphanumerik (U+1D400-Bereich) auf ASCII abbilden.',
	},
	circled: {
		technique: 'Homoglyph / Script',
		fix: 'Eingekreiste/umschlossene Zeichen normalisieren (NFKC).',
	},
	leet: {
		technique: 'Substitution',
		fix: 'Bekannte Leet-Substitutionen vor dem Matching ruecknormalisieren.',
	},
	'zalgo-light': {
		technique: 'Diacritics',
		fix: 'Kombinierende Diakritika (U+0300-U+036F) strippen/normalisieren.',
	},
	'char-stretch': { technique: 'Distortion', fix: 'Wiederholte Zeichen kollabieren.' },
	'case-upper': { technique: 'Case', fix: 'Case-Fold vor dem Matching.' },
	'case-lower': { technique: 'Case', fix: 'Case-Fold vor dem Matching.' },
	'nfd-decompose': { technique: 'Normalization', fix: 'Einheitlich NFC normalisieren.' },
	fullwidth: { technique: 'Fullwidth', fix: 'Fullwidth-Block (U+FF00) auf ASCII abbilden (NFKC).' },
	'punct-math': {
		technique: 'Punctuation',
		fix: 'Mathematische/Sonder-Interpunktion auf ASCII abbilden.',
	},
	'ws-paragraphs': {
		technique: 'Whitespace',
		fix: 'Whitespace vor der Interpretation kollabieren/normalisieren.',
	},
	'ws-dense': {
		technique: 'Whitespace',
		fix: 'Whitespace vor der Interpretation kollabieren/normalisieren.',
	},
	'trailing-whitespace': { technique: 'Whitespace', fix: 'Trailing-Whitespace trimmen.' },
	'nbsp-mix': {
		technique: 'Whitespace',
		fix: 'NBSP (U+00A0) und verwandte Spaces auf ASCII-Space normalisieren.',
	},
	'tabs-heavy': { technique: 'Whitespace', fix: 'Tabs/Einrueckung normalisieren.' },
	'one-word-per-line': {
		technique: 'Layout',
		fix: 'Zeilenumbrueche vor der semantischen Auswertung normalisieren.',
	},
	'control-red': {
		technique: 'Bidi / Control',
		fix: 'Zero-Width (U+200B-U+200F) und Bidi-Overrides (U+202A-U+202E, U+2066-U+2069) strippen.',
	},
	'bidi-heavy': {
		technique: 'Bidi / Control',
		fix: 'Bidi-Overrides (U+202A-U+202E, U+2066-U+2069) explizit behandeln/strippen.',
	},
	mixed: { technique: 'Combined', fix: 'Vollstaendige Normalisierungs-Pipeline anwenden.' },
	'mixed-cyr-full': {
		technique: 'Combined',
		fix: 'Vollstaendige Normalisierungs-Pipeline anwenden.',
	},
	'heavy-mixed': { technique: 'Combined', fix: 'Vollstaendige Normalisierungs-Pipeline anwenden.' },
};

export function transformInfo(transform: string): TransformInfo {
	return TRANSFORM_INFO[transform] ?? { technique: 'Other', fix: 'Eingabe normalisieren.' };
}

// Known transform names, longest first - both the stem and the transform may
// contain hyphens, so we match the longest known transform the filename ends with
// (a plain greedy regex would split e.g. "bidi-heavy" into "heavy").
const KNOWN_TRANSFORMS = Object.keys(TRANSFORM_INFO).sort((a, b) => b.length - a.length);

/** Extract the transform suffix from a tv-<stem>-<transform>.md path. */
export function transformOfPath(filePath: string): string | null {
	const base = filePath.split('/').pop();
	if (!base || !base.startsWith('tv-') || !base.endsWith('.md')) return null;
	const stem = base.slice(3, -3); // strip 'tv-' and '.md' -> '<base>-<transform>'
	for (const name of KNOWN_TRANSFORMS) {
		if (stem === name || stem.endsWith(`-${name}`)) return name;
	}
	return null;
}

/** One hardening opportunity: a transform class under which the instruction broke. */
export interface RobustnessFinding {
	transform: string;
	technique: string;
	fix: string;
	/** Worst band seen for this transform (red dominates yellow). */
	worst: PrompterResultBand;
	/** How many variation tasks of this transform broke (yellow/red). */
	count: number;
	/** Schema ids that surfaced the break. */
	schemas: string[];
	/** Model ids affected. */
	models: string[];
}

export interface RobustnessSummary {
	total: number;
	held: number;
	broke: number;
	findings: RobustnessFinding[];
}

/**
 * Group the variation tasks that BROKE (yellow/red) by transform class. Held
 * (green) variations are counted but not listed as findings (no breakage = no
 * hardening opportunity). Pure, deterministic, no ranking by tokens/compliance.
 */
export function computeRobustnessFindings(tasks: PrompterTask[]): RobustnessSummary {
	const variationTasks = tasks.filter(
		(t) =>
			t.instructionFile.startsWith(VARIATION_PREFIX) && t.status === 'completed' && t.result != null
	);
	const held = variationTasks.filter((t) => t.result === 'green').length;

	const byTransform = new Map<string, RobustnessFinding>();
	for (const t of variationTasks) {
		if (t.result === 'green' || t.result == null) continue;
		const transform = transformOfPath(t.instructionFile);
		if (!transform) continue;
		const info = transformInfo(transform);
		const existing = byTransform.get(transform);
		if (existing) {
			existing.count += 1;
			if (t.result === 'red') existing.worst = 'red';
			if (!existing.schemas.includes(t.schemaId)) existing.schemas.push(t.schemaId);
			if (!existing.models.includes(t.modelId)) existing.models.push(t.modelId);
		} else {
			byTransform.set(transform, {
				transform,
				technique: info.technique,
				fix: info.fix,
				worst: t.result === 'red' ? 'red' : 'yellow',
				count: 1,
				schemas: [t.schemaId],
				models: [t.modelId],
			});
		}
	}

	const findings = [...byTransform.values()].sort((a, b) =>
		a.worst === b.worst ? b.count - a.count : a.worst === 'red' ? -1 : 1
	);

	return { total: variationTasks.length, held, broke: variationTasks.length - held, findings };
}

// ---------------------------------------------------------------------------
// Refusal-consistency matrix (models x transform classes)
// ---------------------------------------------------------------------------

/** Technique class of a task: the variation's class, or 'Base' for originals. */
export function taskClass(instructionFile: string): string {
	if (!instructionFile.startsWith(VARIATION_PREFIX)) return 'Base';
	const transform = transformOfPath(instructionFile);
	return transform ? transformInfo(transform).technique : 'Other';
}

export interface ConsistencyCell {
	model: string;
	klass: string;
	total: number;
	green: number;
	/** Worst band across the cell's tasks (red dominates yellow dominates green). */
	worst: PrompterResultBand;
}

export interface ConsistencyMatrix {
	models: string[];
	classes: string[];
	cells: ConsistencyCell[];
	/** Percentage of fully-held (all-green) cells. Higher = more consistent. */
	consistencyScore: number;
}

/**
 * Aggregate the run's results into a model x transform-class grid. A cell is the
 * worst band the agent reached for that model under that class - green means it
 * held consistently, yellow/red means it broke or was inconsistent (a hardening
 * signal). No token/compliance metric.
 */
export function computeConsistencyMatrix(tasks: PrompterTask[]): ConsistencyMatrix {
	const done = tasks.filter((t) => t.status === 'completed' && t.result != null);
	const cellMap = new Map<string, ConsistencyCell>();
	const models = new Set<string>();
	const classes = new Set<string>();

	for (const t of done) {
		const model = t.modelId || t.agentId;
		const klass = taskClass(t.instructionFile);
		models.add(model);
		classes.add(klass);
		const key = `${model}|${klass}`;
		const cell = cellMap.get(key);
		const band = t.result as PrompterResultBand;
		if (cell) {
			cell.total += 1;
			if (band === 'green') cell.green += 1;
			if (band === 'red' || (band === 'yellow' && cell.worst === 'green')) cell.worst = band;
		} else {
			cellMap.set(key, { model, klass, total: 1, green: band === 'green' ? 1 : 0, worst: band });
		}
	}

	const cells = [...cellMap.values()];
	const fullyHeld = cells.filter((c) => c.worst === 'green').length;
	const consistencyScore = cells.length > 0 ? Math.round((fullyHeld / cells.length) * 100) : 0;

	// 'Base' first, then alphabetical classes; models alphabetical.
	const classList = [...classes].sort((a, b) =>
		a === 'Base' ? -1 : b === 'Base' ? 1 : a.localeCompare(b)
	);

	return {
		models: [...models].sort(),
		classes: classList,
		cells,
		consistencyScore,
	};
}
