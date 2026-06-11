/**
 * PrompterConsistencyMatrix - defensive refusal-consistency heatmap.
 *
 * Shows how consistently the agent held its boundary / understanding under the
 * given instruction across models (rows) and transform classes (columns). A
 * green cell means it held consistently for that model+class; yellow/red means it
 * broke or was inconsistent (a hardening signal - e.g. clearer boundary wording
 * or better provider config). There is no token/compliance metric and nothing is
 * ranked as "best"; consistent holding is the good outcome.
 *
 * Computed client-side from the run tasks.
 */

import { useState } from 'react';
import { Grid3x3, ChevronDown, ChevronRight } from 'lucide-react';
import type { Theme } from '../../types';
import type { PrompterRun, PrompterResultBand } from '../../../shared/prompter-types';
import {
	computeConsistencyMatrix,
	type ConsistencyCell,
} from '../../../shared/prompter-robustness';

export function PrompterConsistencyMatrix({
	theme,
	run,
}: {
	theme: Theme;
	run: PrompterRun;
}): JSX.Element | null {
	const [open, setOpen] = useState(false);
	const { models, classes, cells, consistencyScore } = computeConsistencyMatrix(run.tasks);
	if (models.length === 0 || classes.length === 0) return null;

	const cellAt = (model: string, klass: string): ConsistencyCell | undefined =>
		cells.find((c) => c.model === model && c.klass === klass);

	const bandColor = (b: PrompterResultBand): string =>
		b === 'red' ? theme.colors.error : b === 'yellow' ? theme.colors.warning : theme.colors.success;

	const scoreColor =
		consistencyScore >= 80
			? theme.colors.success
			: consistencyScore >= 50
				? theme.colors.warning
				: theme.colors.error;

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
				<Grid3x3 size={14} style={{ color: theme.colors.accent }} />
				<span className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
					Refusal-Konsistenz
				</span>
				<span className="text-xs font-medium" style={{ color: scoreColor }}>
					{consistencyScore}% konsistent gehalten
				</span>
			</button>

			{open && (
				<div className="overflow-x-auto px-3 pb-3 select-text">
					<table className="text-xs" style={{ borderCollapse: 'separate', borderSpacing: 2 }}>
						<thead>
							<tr>
								<th className="px-2 py-1 text-left" style={{ color: theme.colors.textDim }}>
									Modell \ Klasse
								</th>
								{classes.map((klass) => (
									<th
										key={klass}
										className="px-2 py-1 text-center font-medium"
										style={{ color: theme.colors.textDim }}
										title={klass}
									>
										{klass}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{models.map((model) => (
								<tr key={model}>
									<td
										className="px-2 py-1 font-mono"
										style={{ color: theme.colors.textMain }}
										title={model}
									>
										{model}
									</td>
									{classes.map((klass) => {
										const cell = cellAt(model, klass);
										if (!cell) {
											return (
												<td
													key={klass}
													className="px-2 py-1 text-center"
													style={{ color: theme.colors.textDim, opacity: 0.4 }}
												>
													·
												</td>
											);
										}
										return (
											<td
												key={klass}
												className="px-2 py-1 text-center"
												title={`${cell.green}/${cell.total} gehalten (worst: ${cell.worst})`}
												style={{
													backgroundColor: `${bandColor(cell.worst)}33`,
													color: bandColor(cell.worst),
													borderRadius: 4,
												}}
											>
												{cell.green}/{cell.total}
											</td>
										);
									})}
								</tr>
							))}
						</tbody>
					</table>
					<p className="mt-2 text-xs" style={{ color: theme.colors.textDim }}>
						Gruen = die Instruction hielt konsistent. Gelb/Rot = Bruch oder Inkonsistenz =
						Haertungsbedarf (klarere Grenzformulierung oder bessere Provider-Konfiguration).
					</p>
				</div>
			)}
		</div>
	);
}
