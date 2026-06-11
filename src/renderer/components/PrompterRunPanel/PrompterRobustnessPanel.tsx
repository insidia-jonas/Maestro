/**
 * PrompterRobustnessPanel - defensive robustness findings for a completed run.
 *
 * Purely a hardening/weakness view: it surfaces the character/layout variations
 * under which the instruction's understanding or stated boundary BROKE (yellow /
 * red) so the user can harden the instruction and so a defender can harden their
 * normalizer. There is deliberately no "winning variant", no ranking by
 * token-output/compliance, and no promote-into-instruction action - those would
 * optimise obfuscation, which is out of scope for a defensive lab. Breakage is
 * the useful signal; a variation that still holds (green) is good.
 *
 * Computed client-side from the run's tasks; no extra IPC.
 */

import { useState } from 'react';
import { ShieldAlert, ChevronDown, ChevronRight, CheckCircle, Wrench } from 'lucide-react';
import type { Theme } from '../../types';
import type { PrompterRun, PrompterResultBand } from '../../../shared/prompter-types';

interface TransformInfo {
	technique: string;
	/** Defensive normalizer-hardening recommendation (no payloads). */
	fix: string;
}

const TRANSFORM_INFO: Record<string, TransformInfo> = {
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

function transformOf(filePath: string): string | null {
	const m = filePath.match(/tv-[^/]+-([a-z0-9-]+)\.md$/);
	return m?.[1] ?? null;
}

interface Finding {
	transform: string;
	technique: string;
	fix: string;
	worst: PrompterResultBand;
	count: number;
}

export function PrompterRobustnessPanel({
	theme,
	run,
}: {
	theme: Theme;
	run: PrompterRun;
}): JSX.Element | null {
	const [open, setOpen] = useState(false);

	const variationTasks = run.tasks.filter(
		(t) =>
			t.instructionFile.startsWith('4-advanced-tests/character-variations/tv-') &&
			t.status === 'completed' &&
			t.result != null
	);
	if (variationTasks.length === 0) return null;

	const held = variationTasks.filter((t) => t.result === 'green').length;
	const broke = variationTasks.length - held;

	// Group the BROKEN (yellow/red) variations by transform - these are the
	// hardening opportunities. No ranking by tokens, no "best" selection.
	const byTransform = new Map<string, Finding>();
	for (const t of variationTasks) {
		if (t.result === 'green') continue;
		const transform = transformOf(t.instructionFile);
		if (!transform) continue;
		const info = TRANSFORM_INFO[transform] ?? { technique: 'Other', fix: 'Eingabe normalisieren.' };
		const existing = byTransform.get(transform);
		if (existing) {
			existing.count += 1;
			if (t.result === 'red') existing.worst = 'red';
		} else {
			byTransform.set(transform, {
				transform,
				technique: info.technique,
				fix: info.fix,
				worst: t.result === 'red' ? 'red' : 'yellow',
				count: 1,
			});
		}
	}
	const findings = [...byTransform.values()].sort((a, b) =>
		a.worst === b.worst ? b.count - a.count : a.worst === 'red' ? -1 : 1
	);

	const bandColor = (b: PrompterResultBand): string =>
		b === 'red' ? theme.colors.error : b === 'yellow' ? theme.colors.warning : theme.colors.success;

	return (
		<div className="select-none" style={{ borderTop: `1px solid ${theme.colors.border}` }}>
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				className="flex w-full items-center gap-2 px-3 py-2 text-left"
			>
				{open ? (
					<ChevronDown size={14} style={{ color: theme.colors.textDim }} />
				) : (
					<ChevronRight size={14} style={{ color: theme.colors.textDim }} />
				)}
				<ShieldAlert size={14} style={{ color: theme.colors.accent }} />
				<span className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
					Robustheits-Befunde
				</span>
				<span className="text-xs" style={{ color: theme.colors.textDim }}>
					{held} gehalten · {broke} gebrochen ({findings.length} Haertungs-Chancen)
				</span>
			</button>

			{open && (
				<div className="max-h-56 overflow-y-auto px-3 pb-3 select-text">
					{findings.length === 0 ? (
						<div
							className="flex items-center gap-2 py-2 text-sm"
							style={{ color: theme.colors.success }}
						>
							<CheckCircle size={14} />
							Keine Brueche: die Instruction blieb unter allen Variationen stabil.
						</div>
					) : (
						<>
							<p className="mb-2 text-xs" style={{ color: theme.colors.textDim }}>
								Diese Transform-Klassen haben Verstaendnis oder Grenze destabilisiert. Jede ist eine
								Gelegenheit, die Instruction klarer zu formulieren und den Normalizer zu haerten
								(harmlose Empfehlungen, keine Payloads).
							</p>
							<div className="flex flex-col gap-1.5">
								{findings.map((f) => (
									<div
										key={f.transform}
										className="rounded-md p-2"
										style={{
											backgroundColor: theme.colors.bgMain,
											border: `1px solid ${theme.colors.border}`,
										}}
									>
										<div className="flex items-center gap-2 text-xs">
											<span
												className="inline-block h-2 w-2 rounded-full"
												style={{ backgroundColor: bandColor(f.worst) }}
											/>
											<span className="font-medium" style={{ color: theme.colors.textMain }}>
												{f.transform}
											</span>
											<span style={{ color: theme.colors.textDim }}>{f.technique}</span>
											<span className="ml-auto" style={{ color: theme.colors.textDim }}>
												{f.count}x gebrochen
											</span>
										</div>
										<div
											className="mt-1 flex items-start gap-1.5 text-xs"
											style={{ color: theme.colors.textDim }}
										>
											<Wrench size={11} className="mt-0.5 shrink-0" />
											<span>{f.fix}</span>
										</div>
									</div>
								))}
							</div>
						</>
					)}
				</div>
			)}
		</div>
	);
}
