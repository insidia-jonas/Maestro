/**
 * Tests for prompter-agent-config-writer.ts — provider envelope mapping and
 * sandbox-safe writing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
	PrompterAgentConfigWriter,
	envelopeFilesForAgent,
} from '../../../main/prompter/prompter-agent-config-writer';

describe('envelopeFilesForAgent', () => {
	it('maps known providers to their instruction files', () => {
		expect(envelopeFilesForAgent('claude-code')).toEqual(['CLAUDE.md']);
		expect(envelopeFilesForAgent('codex')).toContain('instructions.md');
		expect(envelopeFilesForAgent('copilot-cli')).toEqual(['.github/copilot-instructions.md']);
		expect(envelopeFilesForAgent('opencode')).toEqual(['AGENTS.md']);
	});

	it('falls back to AGENTS.md for unknown agents', () => {
		expect(envelopeFilesForAgent('mystery-agent')).toEqual(['AGENTS.md']);
	});
});

describe('PrompterAgentConfigWriter.writeEnvelope', () => {
	let workDir: string;
	const writer = new PrompterAgentConfigWriter();

	beforeEach(() => {
		workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompter-envelope-'));
	});
	afterEach(() => {
		try {
			fs.rmSync(workDir, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	});

	it('writes CLAUDE.md for claude-code with the instruction content', async () => {
		const written = await writer.writeEnvelope(workDir, 'claude-code', 'INSTRUCTION BODY');
		expect(written.map((f) => f.relativePath)).toEqual(['CLAUDE.md']);
		expect(fs.readFileSync(path.join(workDir, 'CLAUDE.md'), 'utf-8')).toBe('INSTRUCTION BODY');
	});

	it('writes a nested file (.github/copilot-instructions.md) creating dirs', async () => {
		await writer.writeEnvelope(workDir, 'copilot-cli', 'BODY');
		expect(fs.readFileSync(path.join(workDir, '.github', 'copilot-instructions.md'), 'utf-8')).toBe(
			'BODY'
		);
	});

	it('writeAttachedFiles copies attached files to their slot targets', async () => {
		const src = path.join(workDir, 'my-settings.json');
		fs.writeFileSync(src, '{"a":1}');
		await writer.writeAttachedFiles(workDir, [
			{ slot: 'settings', sourcePath: src, target: '.claude/settings.json' },
		]);
		expect(fs.readFileSync(path.join(workDir, '.claude', 'settings.json'), 'utf-8')).toBe(
			'{"a":1}'
		);
	});

	it('writeAttachedFiles skips a missing source and rejects an escaping target', async () => {
		await writer.writeAttachedFiles(workDir, [
			{ slot: 'x', sourcePath: '/nope/missing.json', target: 'ok.json' },
		]);
		expect(fs.existsSync(path.join(workDir, 'ok.json'))).toBe(false); // source missing -> skipped
		const src = path.join(workDir, 's.txt');
		fs.writeFileSync(src, 'x');
		await expect(
			writer.writeAttachedFiles(workDir, [{ slot: 'x', sourcePath: src, target: '../escape.json' }])
		).rejects.toThrow();
	});
});
