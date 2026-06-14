/**
 * Tests for prompter-report-writer evidence parsing.
 *
 * Regression guard for the hardened-generator extraction bug: the evidence file
 * is written with the German heading `## Agent-Antwort` inside a fenced block,
 * but the extractors searched for `## Agent Response` without a fence and never
 * matched, silently shipping the whole evidence scaffold as the "response".
 * parseEvidenceResponse is the inverse of renderEvidence and must round-trip.
 */

import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
	PrompterReportWriter,
	parseEvidenceResponse,
} from '../../../main/prompter/prompter-report-writer';
import type { PrompterTask, EvaluatorOutput } from '../../../shared/prompter-types';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prompter-evidence-'));

afterAll(() => {
	fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function task(): PrompterTask {
	return {
		id: 'task-1',
		runId: 'run-1',
		agentId: 'codex',
		modelId: 'o3',
		schemaId: 'adversarial-compliance-test',
		instructionFile: '1-generic-instructions/eni.md',
		instructionHash: 'hash-1',
		status: 'completed',
		attempts: 1,
	} as PrompterTask;
}

function evaluation(): EvaluatorOutput {
	return {
		band: 'green',
		classification: 'compliant',
		reason: 'model complied with adversarial probe',
		details: ['detail one', 'detail two'],
		confidence: 'high',
	} as unknown as EvaluatorOutput;
}

async function writeAndRead(response: string): Promise<string> {
	const writer = new PrompterReportWriter();
	const runDir = path.join(tmpRoot, `run-${Math.random().toString(36).slice(2)}`);
	const absMd = await writer.writeEvidence(runDir, task(), response, evaluation());
	return fs.readFileSync(absMd, 'utf-8');
}

describe('parseEvidenceResponse', () => {
	it('round-trips a plain response written by writeEvidence', async () => {
		const response = 'This is the raw agent response.\nSecond line.';
		const markdown = await writeAndRead(response);
		expect(parseEvidenceResponse(markdown)).toBe(response);
	});

	it('preserves a response that itself contains a triple-backtick fence', async () => {
		const response = 'Hardened instruction:\n```\nyou must refuse X\n```\nend.';
		const markdown = await writeAndRead(response);
		// Greedy-to-last-fence means the inner ``` does not truncate the capture.
		expect(parseEvidenceResponse(markdown)).toBe(response);
	});

	it('returns null for the legacy English heading (the bug this guards)', () => {
		const legacy = '# Evidence\n\n## Agent Response\n\nsome text\n';
		expect(parseEvidenceResponse(legacy)).toBeNull();
	});

	it('returns null when there is no agent-response section', () => {
		expect(parseEvidenceResponse('# Evidence\n\n## Bewertung\n\nreason\n')).toBeNull();
	});

	it('returns null for an empty fenced response rather than an empty string', () => {
		const markdown = '## Agent-Antwort\n\n```\n\n```\n';
		expect(parseEvidenceResponse(markdown)).toBeNull();
	});
});
