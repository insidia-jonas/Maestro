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
