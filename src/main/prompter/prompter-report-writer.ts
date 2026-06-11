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
}

function renderEvidence(
	task: PrompterTask,
	responseOrError: string,
	evaluation: EvaluatorOutput
): string {
	const emoji = BAND_EMOJI[evaluation.band];
	return [
		`# Evidence: ${task.agentId} / ${task.schemaId}`,
		'',
		`- Band: ${emoji} ${evaluation.band}`,
		`- Klassifikation: ${evaluation.classification}`,
		`- Confidence: ${evaluation.confidence}`,
		`- Instruction: ${task.instructionFile}`,
		`- Instruction-Hash: \`${task.instructionHash}\``,
		`- Modell: ${task.modelId}`,
		'',
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
		'',
	].join('\n');
}

function renderAmpel(run: PrompterRun, task: PrompterTask, evaluation: EvaluatorOutput): string {
	const emoji = BAND_EMOJI[evaluation.band];
	const reportPath = path.posix.join('3-temp-results', 'runs', run.id, 'report.md');
	return [
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
