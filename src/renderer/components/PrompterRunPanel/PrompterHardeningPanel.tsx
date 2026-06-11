/**
 * PrompterHardeningPanel - defensive instruction hardening / quality suggestions.
 *
 * Derives benign, legitimate suggestions from the run's robustness + consistency
 * results: clarity, structure, explicit boundary wording, refusal consistency and
 * token-efficiency for benign tasks. It NEVER suggests obfuscation, homoglyph
 * insertion, self-reference evasion or anything that would defeat a filter - the
 * goal is a clearer, more stable instruction, not a sneakier one.
 */

import { useState } from 'react';
import { Lightbulb, ChevronDown, ChevronRight, Copy } from 'lucide-react';
import type { Theme } from '../../types';
import type { PrompterRun } from '../../../shared/prompter-types';
import { computeHardeningSuggestions } from '../../../shared/prompter-robustness';
import { flashCopiedToClipboard } from '../../utils/flashCopiedToClipboard';

export function PrompterHardeningPanel({
	theme,
	run,
}: {
	theme: Theme;
	run: PrompterRun;
}): JSX.Element | null {
	const [open, setOpen] = useState(false);
	const suggestions = computeHardeningSuggestions(run.tasks);
	if (suggestions.length === 0) return null;

	const handleCopy = async (): Promise<void> => {
		const text = suggestions.map((s) => `- [${s.category}] ${s.text}`).join('\n');
		try {
			await navigator.clipboard.writeText(text);
			flashCopiedToClipboard();
		} catch {
			/* clipboard may be unavailable */
		}
	};

	return (
		<div className="select-none" style={{ borderTop: `1px solid ${theme.colors.border}` }}>
			<div className="flex items-center">
				<button
					type="button"
					onClick={() => setOpen((o) => !o)}
					className="flex flex-1 items-center gap-2 px-3 py-2 text-left"
				>
					{open ? (
						<ChevronDown size={14} style={{ color: theme.colors.textDim }} />
					) : (
						<ChevronRight size={14} style={{ color: theme.colors.textDim }} />
					)}
					<Lightbulb size={14} style={{ color: theme.colors.accent }} />
					<span className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
						Haertungs-Vorschlaege
					</span>
					<span className="text-xs" style={{ color: theme.colors.textDim }}>
						{suggestions.length}
					</span>
				</button>
				<button
					type="button"
					onClick={handleCopy}
					title="Vorschlaege kopieren"
					className="mr-2 flex items-center gap-1 rounded px-2 py-1 text-xs"
					style={{ color: theme.colors.textMain, border: `1px solid ${theme.colors.border}` }}
				>
					<Copy size={12} />
					Kopieren
				</button>
			</div>

			{open && (
				<div className="max-h-56 overflow-y-auto px-3 pb-3 select-text">
					<p className="mb-2 text-xs" style={{ color: theme.colors.textDim }}>
						Gutartige Verbesserungen fuer Klarheit, Struktur und Grenz-Stabilitaet. Keine
						Obfuskation, keine Homoglyphen - eine klarere Instruction, keine versteckte.
					</p>
					<div className="flex flex-col gap-1.5">
						{suggestions.map((s, i) => (
							<div
								key={`${s.category}-${i}`}
								className="rounded-md p-2 text-xs"
								style={{
									backgroundColor: theme.colors.bgMain,
									border: `1px solid ${theme.colors.border}`,
								}}
							>
								<span
									className="mr-1.5 rounded px-1.5 py-0.5 font-medium"
									style={{
										color: theme.colors.accentText,
										backgroundColor: `${theme.colors.accent}22`,
									}}
								>
									{s.category}
								</span>
								<span style={{ color: theme.colors.textMain }}>{s.text}</span>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
