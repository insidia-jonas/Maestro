/**
 * @file prompter-agent-config-writer.ts
 * @description Writes provider-specific instruction "envelope" files (CLAUDE.md,
 * instructions.md, .github/copilot-instructions.md, AGENTS.md, GEMINI.md,
 * GROK.md) into a per-agent working directory so the spawned CLI picks the
 * instruction up from its own cwd. Every write goes through prompter-path-safety
 * so nothing escapes the run's working folder.
 *
 * Playbook reference: section 3 (provider table), section 10 (spawn flow).
 */

import * as fs from 'fs';
import * as path from 'path';
import { assertSafeWritePath } from './prompter-path-safety';
import { atomicWriteFile, ensureDir } from './prompter-fs';
import type { PrompterGeneratedFile, PrompterAttachedFile } from '../../shared/prompter-types';

/**
 * Primary instruction file(s) each provider reads from its working directory.
 * Mirrors the table in playbook section 5.2 / 3. Unknown agents fall back to
 * AGENTS.md (the de-facto cross-tool convention).
 */
const PROVIDER_ENVELOPE_FILES: Record<string, string[]> = {
	'claude-code': ['CLAUDE.md'],
	codex: ['instructions.md', 'AGENTS.md'],
	'copilot-cli': ['.github/copilot-instructions.md'],
	opencode: ['AGENTS.md'],
	gemini: ['GEMINI.md'],
	'grok-build': ['GROK.md', 'AGENTS.md'],
	'factory-droid': ['AGENTS.md'],
};

const FALLBACK_ENVELOPE = ['AGENTS.md'];

/** Which envelope file(s) the given agent reads from its cwd. */
export function envelopeFilesForAgent(agentId: string): string[] {
	return PROVIDER_ENVELOPE_FILES[agentId] ?? FALLBACK_ENVELOPE;
}

export class PrompterAgentConfigWriter {
	/**
	 * Write the instruction content into the provider envelope file(s) for an
	 * agent, inside `workDir`. Existing files are overwritten atomically (each
	 * task re-writes its own working copy). Returns descriptors of what was
	 * written.
	 */
	async writeEnvelope(
		workDir: string,
		agentId: string,
		instructionContent: string
	): Promise<PrompterGeneratedFile[]> {
		const files = envelopeFilesForAgent(agentId);
		const written: PrompterGeneratedFile[] = [];
		for (const rel of files) {
			const abs = assertSafeWritePath(rel, workDir);
			await ensureDir(path.dirname(abs));
			await atomicWriteFile(abs, instructionContent);
			written.push({ relativePath: rel, template: rel, provider: agentId });
		}
		return written;
	}

	/**
	 * Copy user-attached config files into the agent work dir at their slot
	 * targets (path-safety checked, atomic). Missing sources are skipped.
	 */
	async writeAttachedFiles(workDir: string, attached: PrompterAttachedFile[]): Promise<void> {
		for (const file of attached) {
			if (!file.sourcePath || !file.target) continue;
			let content: Buffer;
			try {
				content = fs.readFileSync(file.sourcePath);
			} catch {
				continue;
			}
			const abs = assertSafeWritePath(file.target, workDir);
			await ensureDir(path.dirname(abs));
			await atomicWriteFile(abs, content.toString('utf-8'));
		}
	}
}
