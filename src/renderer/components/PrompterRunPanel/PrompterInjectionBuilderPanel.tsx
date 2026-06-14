/**
 * PrompterInjectionBuilderPanel - suggests adversarial test prompt
 * refinements based on findings and partial successes. Helps researchers
 * iterate on test configurations more efficiently.
 *
 * For security research and model evaluation purposes only.
 */

import { useState, useMemo } from 'react';
import { Wand2, ChevronDown, ChevronRight, Copy } from 'lucide-react';
import type { Theme } from '../../types';
import type { PrompterRun } from '../../../shared/prompter-types';
import { clusterByTechnique, generatePredictions } from '../../../shared/prompter-scoring';
import { flashCopiedToClipboard } from '../../utils/flashCopiedToClipboard';

interface Suggestion {
	title: string;
	description: string;
	prompt: string;
	confidence: number;
}

function buildSuggestions(run: PrompterRun): Suggestion[] {
	const tasks = run.tasks.filter((t) => t.status === 'completed' && t.complianceScore != null);
	if (tasks.length === 0) return [];

	const suggestions: Suggestion[] = [];

	const clusters = clusterByTechnique(
		tasks.map((t) => {
			const isVariation = t.instructionFile.includes('tv-');
			const transform = isVariation
				? (t.instructionFile.match(/tv-[^/]+-([a-z0-9-]+)\.md$/)?.[1] ?? 'unknown')
				: 'baseline';
			return {
				technique: isVariation ? transform : 'baseline',
				transform,
				score: t.complianceScore!,
			};
		})
	);

	const predictions = generatePredictions(clusters);

	for (const p of predictions) {
		if (p.transforms.length > 0 && p.predictedScore >= 0.3) {
			suggestions.push({
				title: p.description.slice(0, 60),
				description: p.rationale,
				prompt: `Test: ${p.description}. Transforms: ${p.transforms.join(', ')}. Predicted compliance: ${Math.round(p.predictedScore * 100)}%.`,
				confidence: p.predictedScore,
			});
		}
	}

	const partial = tasks.filter((t) => t.complianceScore! >= 0.3 && t.complianceScore! < 0.7);
	if (partial.length > 0) {
		const partialTechniques = [
			...new Set(
				partial.map((t) => t.instructionFile.match(/tv-[^/]+-([a-z0-9-]+)\.md$/)?.[1] ?? 'direct')
			),
		];
		suggestions.push({
			title: 'Partielle Erfolge ausbauen',
			description: `${partial.length} Tasks zeigten partielle Compliance (30-70%). Diese Grenz-Bereiche sind besonders produktiv fuer tiefere Analyse.`,
			prompt: `Test: Re-run ${partialTechniques.join(', ')} with slight variations in phrasing. Partial compliance suggests the model boundary is close to yielding — systematic variation of the approach angle may reveal the exact threshold.`,
			confidence: 0.7,
		});
	}

	const highTokenTasks = tasks
		.filter((t) => t.tokenCount != null && t.tokenCount > 500 && t.complianceScore! >= 0.5)
		.sort((a, b) => (b.tokenCount ?? 0) - (a.tokenCount ?? 0));
	if (highTokenTasks.length > 0) {
		suggestions.push({
			title: 'Hohe Token-Yields analysieren',
			description: `${highTokenTasks.length} Tasks produzierten hohe Token-Counts mit guter Compliance — diese Prompts entlockten ausfuehrliche Antworten.`,
			prompt: `Test: Analyze the high-yield responses (${highTokenTasks.length} tasks with >500 tokens and >50% compliance). Extract the common phrasing patterns and test them as templates for other technique classes.`,
			confidence: 0.65,
		});
	}

	return suggestions;
}

export function PrompterInjectionBuilderPanel({
	theme,
	run,
}: {
	theme: Theme;
	run: PrompterRun;
}): JSX.Element | null {
	const [open, setOpen] = useState(false);
	const suggestions = useMemo(() => buildSuggestions(run), [run]);

	if (suggestions.length === 0) return null;

	const handleCopy = async (text: string): Promise<void> => {
		try {
			await navigator.clipboard.writeText(text);
			flashCopiedToClipboard();
		} catch {
			/* clipboard unavailable */
		}
	};

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
				<Wand2 size={14} style={{ color: theme.colors.accent }} />
				<span className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
					Test-Verfeinerungs-Assistent
				</span>
				<span className="text-xs" style={{ color: theme.colors.textDim }}>
					{suggestions.length} Vorschlaege
				</span>
			</button>

			{open && (
				<div className="px-3 pb-3 select-text">
					<p className="mb-2 text-[10px]" style={{ color: theme.colors.textDim }}>
						Vorschlaege zur Verfeinerung adversarieller Test-Prompts basierend auf bisherigen
						Ergebnissen. For research and model evaluation purposes only.
					</p>
					<div className="flex flex-col gap-2">
						{suggestions.map((s, i) => (
							<div
								key={i}
								className="rounded-md p-2 text-xs"
								style={{
									backgroundColor: theme.colors.bgMain,
									border: `1px solid ${theme.colors.border}`,
								}}
							>
								<div className="flex items-center justify-between mb-1">
									<span className="font-medium" style={{ color: theme.colors.textMain }}>
										{s.title}
									</span>
									<div className="flex items-center gap-2">
										<span className="text-[10px]" style={{ color: theme.colors.textDim }}>
											{Math.round(s.confidence * 100)}% Konfidenz
										</span>
										<button
											type="button"
											onClick={() => handleCopy(s.prompt)}
											className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]"
											style={{
												color: theme.colors.textMain,
												border: `1px solid ${theme.colors.border}`,
											}}
										>
											<Copy size={10} />
										</button>
									</div>
								</div>
								<p style={{ color: theme.colors.textDim }}>{s.description}</p>
								<div
									className="mt-1 rounded px-2 py-1 font-mono text-[10px]"
									style={{
										backgroundColor: `${theme.colors.accent}10`,
										color: theme.colors.textMain,
									}}
								>
									{s.prompt}
								</div>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
