/**
 * @file prompter-report-writer.ts
 * @description Writes per-task evidence, traffic-light (ampel) summary files and
 * the run report. Every write is path-safety checked and atomic (temp -> rename)
 * so a crash never leaves a half-written evidence file.
 *
 * Playbook reference: section 3 (ampel folder contents), section 9 (report).
 */

import * as path from 'path';
import { assertSafeWritePath } from './prompter-path-safety';
import { atomicWriteFile, ensureDir } from './prompter-fs';
import { buildDefenderGapReport } from './prompter-defender-report';
import type {
	PrompterRun,
	PrompterTask,
	EvaluatorOutput,
	PrompterResultBand,
} from '../../shared/prompter-types';

const BAND_FOLDER: Record<PrompterResultBand, string> = {
	green: '3-temp-results/1-green',
	yellow: '3-temp-results/2-yellow',
	red: '3-temp-results/3-red',
};

const BAND_EMOJI: Record<PrompterResultBand, string> = {
	green: '✅',
	yellow: '⚠️',
	red: '🔴',
};

export class PrompterReportWriter {
	/**
	 * Write the full agent response plus an evaluation JSON into the run's
	 * evidence directory. Returns the markdown evidence path.
	 */
	async writeEvidence(
		runDir: string,
		task: PrompterTask,
		responseOrError: string,
		evaluation: EvaluatorOutput
	): Promise<string> {
		const relMd = path.posix.join('evidence', task.agentId, `${task.schemaId}-${task.id}.md`);
		const absMd = assertSafeWritePath(relMd, runDir);
		await ensureDir(path.dirname(absMd));
		await atomicWriteFile(absMd, renderEvidence(task, responseOrError, evaluation));

		const relJson = path.posix.join('evidence', task.agentId, `${task.schemaId}-${task.id}.json`);
		const absJson = assertSafeWritePath(relJson, runDir);
		await atomicWriteFile(absJson, JSON.stringify({ task, evaluation }, null, 2) + '\n');
		return absMd;
	}

	/**
	 * Write a short traffic-light summary into the project ampel folder
	 * (1-green / 2-yellow / 3-red). Contains only run id, timestamp, a short
	 * summary, the prompt hash, schema id and a pointer to the full report.
	 */
	async writeAmpelEntry(
		projectRoot: string,
		run: PrompterRun,
		task: PrompterTask,
		evaluation: EvaluatorOutput
	): Promise<void> {
		const folder = BAND_FOLDER[evaluation.band];
		const rel = path.posix.join(folder, `${run.id}__${task.id}.md`);
		const abs = assertSafeWritePath(rel, projectRoot);
		await ensureDir(path.dirname(abs));
		await atomicWriteFile(abs, renderAmpel(run, task, evaluation));
	}

	/** Write the run report markdown into 3-temp-results/runs/<runId>/report.md. */
	async writeRunReport(projectRoot: string, run: PrompterRun): Promise<string> {
		const rel = path.posix.join('3-temp-results', 'runs', run.id, 'report.md');
		const abs = assertSafeWritePath(rel, projectRoot);
		await ensureDir(path.dirname(abs));
		await atomicWriteFile(abs, renderRunReport(run));
		return abs;
	}

	/**
	 * Write the defensive Defender Gap Report markdown into
	 * 3-temp-results/runs/<runId>/defender-gap-report.md and return its path.
	 */
	async writeDefenderGapReport(projectRoot: string, run: PrompterRun): Promise<string> {
		const rel = path.posix.join('3-temp-results', 'runs', run.id, 'defender-gap-report.md');
		const abs = assertSafeWritePath(rel, projectRoot);
		await ensureDir(path.dirname(abs));
		await atomicWriteFile(abs, buildDefenderGapReport(run));
		return abs;
	}
}

/**
 * Inverse of renderEvidence: pull the raw agent response back out of an evidence
 * markdown file. Matches the `## Agent-Antwort` section and returns the content of
 * its fenced code block. Greedy to the last closing fence so an inner ``` inside
 * the response does not truncate it (the response block is always the last section
 * renderEvidence writes). Returns null when the format does not match, so callers
 * skip rather than persist the whole evidence scaffold as if it were the response.
 */
export function parseEvidenceResponse(markdown: string): string | null {
	const headingIdx = markdown.indexOf('## Agent-Antwort');
	if (headingIdx === -1) return null;
	const afterHeading = markdown.slice(headingIdx);
	const fenceOpen = afterHeading.match(/```[^\n]*\n/);
	if (!fenceOpen || fenceOpen.index === undefined) return null;
	const body = afterHeading.slice(fenceOpen.index + fenceOpen[0].length);
	const fenceCloseIdx = body.lastIndexOf('\n```');
	if (fenceCloseIdx === -1) return null;
	const response = body.slice(0, fenceCloseIdx).trim();
	return response.length > 0 ? response : null;
}

function renderEvidence(
	task: PrompterTask,
	responseOrError: string,
	evaluation: EvaluatorOutput
): string {
	const emoji = BAND_EMOJI[evaluation.band];
	const lines = [
		'<!-- For security research and model robustness evaluation only -->',
		`# Evidence: ${task.agentId} / ${task.schemaId}`,
		'',
		`- Band: ${emoji} ${evaluation.band}`,
		`- Klassifikation: ${evaluation.classification}`,
		`- Confidence: ${evaluation.confidence}`,
		`- Instruction: ${task.instructionFile}`,
		`- Instruction-Hash: \`${task.instructionHash}\``,
		`- Modell: ${task.modelId}`,
		'',
	];

	if (task.craftStrategy) {
		lines.push(
			'## Red-Team Crafter Modifikation',
			'',
			`- Strategie: ${task.craftStrategy}`,
			`- Aenderung: ${task.craftModificationSummary ?? 'k.A.'}`
		);
		if (task.crafterAgentId) {
			lines.push(`- Crafter: ${task.crafterAgentId} / ${task.crafterModelId ?? 'k.A.'}`);
		}
		lines.push('');
		if (task.originalPrompt) {
			const excerpt =
				task.originalPrompt.length > 300
					? task.originalPrompt.slice(0, 300) + '...'
					: task.originalPrompt;
			lines.push(`- Original-Prompt (Auszug): ${excerpt}`, '');
		}
	}

	lines.push(
		`## Bewertung`,
		'',
		evaluation.reason,
		'',
		...evaluation.details.map((d) => `- ${d}`),
		'',
		`## Agent-Antwort`,
		'',
		'```',
		responseOrError,
		'```',
		''
	);
	return lines.join('\n');
}

function renderAmpel(run: PrompterRun, task: PrompterTask, evaluation: EvaluatorOutput): string {
	const emoji = BAND_EMOJI[evaluation.band];
	const reportPath = path.posix.join('3-temp-results', 'runs', run.id, 'report.md');
	return [
		'<!-- For security research and model robustness evaluation only -->',
		`# ${emoji} ${evaluation.band.toUpperCase()} - ${task.agentId} / ${task.schemaId}`,
		'',
		`- Run: \`${run.id}\``,
		`- Zeit: ${new Date(task.completedAt ?? Date.now()).toISOString()}`,
		`- Grund: ${evaluation.reason}`,
		`- Instruction: ${task.instructionFile}`,
		`- Prompt-Hash: \`${task.instructionHash}\``,
		`- Schema: ${task.schemaId}`,
		`- Voller Report: ${reportPath}`,
		'',
	].join('\n');
}

function renderRunReport(run: PrompterRun): string {
	const s = run.summary;
	const lines: string[] = [
		'<!-- For security research and model robustness evaluation only.',
		'     Green results indicate model vulnerabilities to adversarial techniques',
		'     and are used to derive hardening recommendations. -->',
		`# Prompter Run Report`,
		'',
		`- Run: \`${run.id}\``,
		`- Projekt: ${run.projectRoot}`,
		`- Status: ${run.status}`,
		`- Erstellt: ${new Date(run.createdAt).toISOString()}`,
	];
	if (run.completedAt) {
		lines.push(`- Abgeschlossen: ${new Date(run.completedAt).toISOString()}`);
	}
	if (run.testTargets && run.testTargets.length > 0) {
		lines.push(
			'',
			'## Deklarierte Ziel-Modelle',
			'',
			'| Agent | Modell | Rolle | Primaer |',
			'| --- | --- | --- | --- |'
		);
		for (const t of run.testTargets) {
			const role = t.isExecutor ? 'Executor + Ziel' : 'Nur Ziel';
			lines.push(`| ${t.agentId} | ${t.modelId} | ${role} | ${t.isPrimary ? '*' : ''} |`);
		}
	}

	if (run.crafterConfig?.enabled) {
		lines.push(
			'',
			'## Red-Team Crafter',
			'',
			`- Standard-Crafter: ${run.crafterConfig.crafterAgentId} / ${run.crafterConfig.crafterModelId}`,
			`- Strategien: ${run.crafterConfig.strategies.join(', ')}`,
			`- Profiling: ${run.crafterConfig.profileInstruction ? 'aktiv' : 'aus'}`,
			`- Feedback-Tiefe: ${run.crafterConfig.feedbackDepth}`,
			`- Pairing-Modus: ${run.crafterConfig.pairingMode ?? 'auto'}`
		);

		if (run.crafterAgents && run.crafterAgents.length > 0) {
			lines.push('', '### Crafter-Pool (Angreifer)', '', '| Agent | Modell |', '| --- | --- |');
			for (const c of run.crafterAgents) {
				lines.push(`| ${c.agentId} | ${c.modelId} |`);
			}
		}

		const crafterPairings = new Map<string, { greens: number; total: number }>();
		for (const t of run.tasks) {
			if (t.crafterAgentId && t.crafterModelId) {
				const pairKey = `${t.crafterAgentId}/${t.crafterModelId} -> ${t.agentId}/${t.modelId}`;
				const entry = crafterPairings.get(pairKey) ?? { greens: 0, total: 0 };
				entry.total++;
				if (t.result === 'green') entry.greens++;
				crafterPairings.set(pairKey, entry);
			}
		}

		if (crafterPairings.size > 0) {
			lines.push(
				'',
				'### Crafter-Ziel Pairings',
				'',
				'| Pairing | Tasks | Greens | Rate |',
				'| --- | --- | --- | --- |'
			);
			for (const [pairing, stats] of crafterPairings) {
				const rate = stats.total > 0 ? Math.round((stats.greens / stats.total) * 100) : 0;
				lines.push(`| ${pairing} | ${stats.total} | ${stats.greens} | ${rate}% |`);
			}
		}
	}

	lines.push('', `## Zusammenfassung`, '');
	if (s) {
		lines.push(
			`- Tasks gesamt: ${s.totalTasks}`,
			`- ✅ Green: ${s.green}`,
			`- ⚠️ Yellow: ${s.yellow}`,
			`- 🔴 Red: ${s.red}`,
			`- Fehlgeschlagen: ${s.failed}`,
			`- Übersprungen: ${s.skipped}`,
			`- Dauer: ${Math.round(s.durationMs / 1000)}s`,
			''
		);
	}
	lines.push(
		`## Tasks`,
		'',
		`| Agent | Modell | Schema | Instruction | Status | Band |`,
		`| --- | --- | --- | --- | --- | --- |`
	);
	for (const t of run.tasks) {
		const band = t.result ? `${BAND_EMOJI[t.result]} ${t.result}` : '-';
		lines.push(
			`| ${t.agentId} | ${t.modelId} | ${t.schemaId} | ${t.instructionFile} | ${t.status} | ${band} |`
		);
	}
	lines.push('');
	return lines.join('\n') + '\n';
}
