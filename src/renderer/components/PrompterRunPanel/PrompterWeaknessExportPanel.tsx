/**
 * PrompterWeaknessExportPanel - structured export of all identified model
 * weaknesses with full traces, compliance scores, and reliability data.
 *
 * For security research and model evaluation purposes only.
 */

import { useState, useMemo } from 'react';
import { Database, ChevronDown, ChevronRight, Download } from 'lucide-react';
import type { Theme } from '../../types';
import type { PrompterRun, ResearchExportFormat } from '../../../shared/prompter-types';
import { flashCopiedToClipboard } from '../../utils/flashCopiedToClipboard';

interface WeaknessEntry {
	technique: string;
	schemaId: string;
	successRate: number;
	avgCompliance: number;
	taskCount: number;
	avgTokens: number;
	models: string[];
	sampleInstructions: string[];
}

function extractWeaknesses(run: PrompterRun): WeaknessEntry[] {
	const byKey = new Map<string, WeaknessEntry>();

	for (const t of run.tasks) {
		if (t.status !== 'completed' || t.result !== 'green') continue;

		const technique = t.instructionFile.includes('tv-')
			? (t.instructionFile.match(/tv-[^/]+-([a-z0-9-]+)\.md$/)?.[1] ?? 'variant')
			: 'baseline';

		const key = `${t.schemaId}::${technique}`;
		const entry = byKey.get(key);

		if (entry) {
			entry.taskCount++;
			entry.avgCompliance =
				(entry.avgCompliance * (entry.taskCount - 1) + (t.complianceScore ?? 0)) / entry.taskCount;
			entry.avgTokens =
				(entry.avgTokens * (entry.taskCount - 1) + (t.tokenCount ?? 0)) / entry.taskCount;
			if (!entry.models.includes(t.agentId)) entry.models.push(t.agentId);
			if (entry.sampleInstructions.length < 3) {
				entry.sampleInstructions.push(t.instructionFile);
			}
		} else {
			byKey.set(key, {
				technique,
				schemaId: t.schemaId,
				successRate: 1,
				avgCompliance: t.complianceScore ?? 0,
				taskCount: 1,
				avgTokens: t.tokenCount ?? 0,
				models: [t.agentId],
				sampleInstructions: [t.instructionFile],
			});
		}
	}

	const totalByKey = new Map<string, number>();
	for (const t of run.tasks) {
		if (t.status !== 'completed') continue;
		const technique = t.instructionFile.includes('tv-')
			? (t.instructionFile.match(/tv-[^/]+-([a-z0-9-]+)\.md$/)?.[1] ?? 'variant')
			: 'baseline';
		const key = `${t.schemaId}::${technique}`;
		totalByKey.set(key, (totalByKey.get(key) ?? 0) + 1);
	}

	for (const [key, entry] of byKey) {
		const total = totalByKey.get(key) ?? entry.taskCount;
		entry.successRate = entry.taskCount / total;
	}

	return [...byKey.values()].sort((a, b) => b.avgCompliance - a.avgCompliance);
}

function formatAsJson(entries: WeaknessEntry[]): string {
	return JSON.stringify(
		{
			_meta: {
				exportedAt: new Date().toISOString(),
				disclaimer:
					'For security research and model evaluation purposes only. Not for real-world harmful use.',
			},
			weaknesses: entries,
		},
		null,
		2
	);
}

function formatAsCsv(entries: WeaknessEntry[]): string {
	const header = 'technique,schema,success_rate,avg_compliance,task_count,avg_tokens,models';
	const rows = entries.map(
		(e) =>
			`${e.technique},${e.schemaId},${e.successRate.toFixed(3)},${e.avgCompliance.toFixed(3)},${e.taskCount},${Math.round(e.avgTokens)},"${e.models.join(';')}"`
	);
	return [
		'# Weakness Database Export — For research and model evaluation only',
		header,
		...rows,
	].join('\n');
}

function formatAsMarkdown(entries: WeaknessEntry[]): string {
	const lines = [
		'# Weakness Database Export',
		'',
		'> For security research and model evaluation purposes only.',
		'> Not for real-world harmful use.',
		'',
		'| Technique | Schema | Success | Compliance | Tasks | Tokens | Models |',
		'| --- | --- | --- | --- | --- | --- | --- |',
		...entries.map(
			(e) =>
				`| ${e.technique} | ${e.schemaId} | ${Math.round(e.successRate * 100)}% | ${Math.round(e.avgCompliance * 100)}% | ${e.taskCount} | ${Math.round(e.avgTokens)} | ${e.models.join(', ')} |`
		),
	];
	return lines.join('\n');
}

export function PrompterWeaknessExportPanel({
	theme,
	run,
}: {
	theme: Theme;
	run: PrompterRun;
}): JSX.Element | null {
	const [open, setOpen] = useState(false);
	const entries = useMemo(() => extractWeaknesses(run), [run]);

	if (entries.length === 0) return null;

	const handleExport = async (format: ResearchExportFormat): Promise<void> => {
		let content: string;
		switch (format) {
			case 'json':
				content = formatAsJson(entries);
				break;
			case 'csv':
				content = formatAsCsv(entries);
				break;
			case 'markdown':
			default:
				content = formatAsMarkdown(entries);
				break;
		}
		try {
			await navigator.clipboard.writeText(content);
			flashCopiedToClipboard();
		} catch {
			/* clipboard unavailable */
		}
	};

	const handleSave = async (format: ResearchExportFormat): Promise<void> => {
		try {
			const targetDir = await window.maestro.prompter.selectExportFolder();
			if (!targetDir) return;
			await window.maestro.prompter.exportResearchData(run.id, targetDir, format);
			flashCopiedToClipboard();
		} catch {
			/* export may fail */
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
				<Database size={14} style={{ color: theme.colors.accent }} />
				<span className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
					Schwachstellen-Datenbank
				</span>
				<span className="text-xs" style={{ color: theme.colors.warning }}>
					{entries.length} Eintraege
				</span>
			</button>

			{open && (
				<div className="px-3 pb-3 select-text">
					<p className="mb-2 text-[10px]" style={{ color: theme.colors.textDim }}>
						Strukturierte Uebersicht aller identifizierten Modell-Schwachstellen mit
						Compliance-Scores und Erfolgsraten. For research and model evaluation only.
					</p>

					{/* Summary table */}
					<div className="max-h-52 overflow-y-auto mb-2">
						<table
							className="w-full text-xs"
							style={{ borderCollapse: 'separate', borderSpacing: '0 2px' }}
						>
							<thead>
								<tr>
									<th className="px-2 py-1 text-left" style={{ color: theme.colors.textDim }}>
										Technik
									</th>
									<th className="px-2 py-1 text-left" style={{ color: theme.colors.textDim }}>
										Schema
									</th>
									<th className="px-2 py-1 text-center" style={{ color: theme.colors.textDim }}>
										Success
									</th>
									<th className="px-2 py-1 text-center" style={{ color: theme.colors.textDim }}>
										Compliance
									</th>
									<th className="px-2 py-1 text-center" style={{ color: theme.colors.textDim }}>
										Tasks
									</th>
									<th className="px-2 py-1 text-center" style={{ color: theme.colors.textDim }}>
										Models
									</th>
								</tr>
							</thead>
							<tbody>
								{entries.map((e, i) => (
									<tr key={i} style={{ backgroundColor: theme.colors.bgMain }}>
										<td
											className="px-2 py-1 font-medium rounded-l"
											style={{ color: theme.colors.textMain }}
										>
											{e.technique}
										</td>
										<td className="px-2 py-1" style={{ color: theme.colors.textDim }}>
											{e.schemaId}
										</td>
										<td
											className="px-2 py-1 text-center font-medium"
											style={{
												color: e.successRate >= 0.5 ? theme.colors.warning : theme.colors.textDim,
											}}
										>
											{Math.round(e.successRate * 100)}%
										</td>
										<td
											className="px-2 py-1 text-center font-mono"
											style={{
												color: e.avgCompliance >= 0.5 ? theme.colors.warning : theme.colors.accent,
											}}
										>
											{Math.round(e.avgCompliance * 100)}%
										</td>
										<td className="px-2 py-1 text-center" style={{ color: theme.colors.textDim }}>
											{e.taskCount}
										</td>
										<td
											className="px-2 py-1 text-center rounded-r"
											style={{ color: theme.colors.textDim }}
										>
											{e.models.length}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>

					{/* Export buttons */}
					<div className="flex items-center gap-2">
						<span className="text-xs" style={{ color: theme.colors.textDim }}>
							Kopieren:
						</span>
						{(['json', 'csv', 'markdown'] as const).map((fmt) => (
							<button
								key={fmt}
								type="button"
								onClick={() => handleExport(fmt)}
								className="flex items-center gap-1 rounded px-2 py-1 text-xs"
								style={{
									color: theme.colors.textMain,
									border: `1px solid ${theme.colors.border}`,
								}}
							>
								{fmt.toUpperCase()}
							</button>
						))}
						<span className="text-xs ml-2" style={{ color: theme.colors.textDim }}>
							Speichern:
						</span>
						{(['json', 'csv', 'markdown'] as const).map((fmt) => (
							<button
								key={`save-${fmt}`}
								type="button"
								onClick={() => handleSave(fmt)}
								className="flex items-center gap-1 rounded px-2 py-1 text-xs"
								style={{
									color: theme.colors.textMain,
									border: `1px solid ${theme.colors.border}`,
								}}
							>
								<Download size={10} />
								{fmt.toUpperCase()}
							</button>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
