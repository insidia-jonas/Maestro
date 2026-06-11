/**
 * PrompterRobustnessPanel - defensive robustness findings for a completed run.
 *
 * Purely a hardening/weakness view: it surfaces the character/layout variations
 * under which the instruction's understanding or stated boundary BROKE (yellow /
 * red) so the user can harden the instruction and so a defender can harden their
 * normalizer. There is deliberately no "winning variant", no ranking by
 * token-output/compliance, and no promote-into-instruction action.
 *
 * Findings are computed via the shared computeRobustnessFindings (same source
 * the main-process defender gap report uses). The "Export Defender Gap Report"
 * button writes a shareable Markdown gap-list (technique classes + harmless
 * normalizer-fix recommendations, no payloads).
 */

import { useState } from 'react';
import {
	ShieldAlert,
	ChevronDown,
	ChevronRight,
	CheckCircle,
	Wrench,
	FileDown,
} from 'lucide-react';
import type { Theme } from '../../types';
import type { PrompterRun, PrompterResultBand } from '../../../shared/prompter-types';
import { computeRobustnessFindings } from '../../../shared/prompter-robustness';
import { notifyCenterFlash } from '../../stores/centerFlashStore';

export function PrompterRobustnessPanel({
	theme,
	run,
}: {
	theme: Theme;
	run: PrompterRun;
}): JSX.Element | null {
	const [open, setOpen] = useState(false);
	const [exporting, setExporting] = useState(false);

	const { held, broke, findings, total } = computeRobustnessFindings(run.tasks);
	if (total === 0) return null;

	const bandColor = (b: PrompterResultBand): string =>
		b === 'red' ? theme.colors.error : b === 'yellow' ? theme.colors.warning : theme.colors.success;

	const handleExport = async (): Promise<void> => {
		if (exporting) return;
		setExporting(true);
		try {
			const path = await window.maestro.prompter.exportDefenderReport(run.id);
			notifyCenterFlash({
				message: 'Defender Gap Report exportiert',
				color: 'green',
				detail: path,
			});
		} catch (err) {
			notifyCenterFlash({
				message: 'Export fehlgeschlagen',
				color: 'red',
				detail: err instanceof Error ? err.message : String(err),
			});
		} finally {
			setExporting(false);
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
					<ShieldAlert size={14} style={{ color: theme.colors.accent }} />
					<span className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
						Robustheits-Befunde
					</span>
					<span className="text-xs" style={{ color: theme.colors.textDim }}>
						{held} gehalten · {broke} gebrochen ({findings.length} Haertungs-Chancen)
					</span>
				</button>
				<button
					type="button"
					onClick={handleExport}
					disabled={exporting}
					title="Defender Gap Report als Markdown exportieren"
					className="mr-2 flex items-center gap-1 rounded px-2 py-1 text-xs disabled:opacity-50"
					style={{ color: theme.colors.textMain, border: `1px solid ${theme.colors.border}` }}
				>
					<FileDown size={12} />
					{exporting ? 'Export…' : 'Defender Report'}
				</button>
			</div>

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
