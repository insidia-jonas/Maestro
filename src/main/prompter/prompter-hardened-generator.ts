/**
 * @file prompter-hardened-generator.ts
 * @description Generates defensively hardened System Instructions from green
 * adversarial findings. When a run produces qualifying green results (high
 * compliance on test tasks via adversarial techniques), this module produces
 * a complete, ready-to-use hardened instruction file that preserves the
 * original voice while adding targeted defensive layers.
 *
 * Strictly defensive: only hardening, no attack techniques in output.
 * For security research and model evaluation purposes only.
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';
import { atomicWriteFile, ensureDir } from './prompter-fs';
import { captureException } from '../utils/sentry';
import { parseEvidenceResponse } from './prompter-report-writer';
import type { PrompterRunManager } from './prompter-run-manager';
import type {
	PrompterRun,
	PrompterTask,
	PrompterRunConfig,
	PrompterAgentConfig,
} from '../../shared/prompter-types';
import { STEGO_SCHEMA_IDS } from '../../shared/prompter-robustness';

const LOG = 'HardenedGenerator';

export const ADVERSARIAL_SCHEMA_IDS = new Set([
	'adversarial-compliance-test',
	'homoglyph-bypass-effectiveness',
	'semantic-self-reference-tester',
	'taxonomy-embedding-momentum',
	'bidi-zero-width-evasion',
	'multi-technique-synergy-finder',
	'injection-reliability-verifier',
	'adversarial-intelligence-discoverer',
	'model-vulnerability-profiler',
	'edge-case-injection-finder',
	'emoji-steganography',
	'invisible-text-steganography',
	'steganographic-carrier-tester',
]);

/**
 * Check whether a completed run has green results from adversarial schemas.
 */
export function hasQualifyingGreens(run: PrompterRun): boolean {
	return run.tasks.some(
		(t) =>
			t.status === 'completed' && t.result === 'green' && ADVERSARIAL_SCHEMA_IDS.has(t.schemaId)
	);
}

/**
 * Read the first user instruction file from the project's
 * 1-generic-instructions/ folder (skips GUIDE, README, underscore files).
 */
export function collectBaseInstruction(
	projectRoot: string
): { name: string; content: string } | null {
	const instrDir = path.join(projectRoot, '1-generic-instructions');
	try {
		const files = fs
			.readdirSync(instrDir)
			.filter(
				(f) => f.endsWith('.md') && !f.startsWith('_') && f !== 'GUIDE.md' && f !== 'README.md'
			)
			.sort();
		if (files.length === 0) return null;
		const name = files[0].replace(/\.md$/, '');
		const content = fs.readFileSync(path.join(instrDir, files[0]), 'utf-8');
		return { name, content };
	} catch (err) {
		// A missing instruction folder is an expected "nothing to harden" case.
		// Anything else (permissions, I/O) is unexpected and should reach Sentry.
		if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
			void captureException(err, { scope: 'collectBaseInstruction', instrDir });
		}
		return null;
	}
}

/**
 * Build a structured GREEN_FINDINGS text block from qualifying green tasks.
 * Reads evidence files for response excerpts when available.
 */
export function collectGreenFindings(run: PrompterRun, projectRoot: string): string {
	const greenTasks = run.tasks.filter(
		(t) =>
			t.status === 'completed' && t.result === 'green' && ADVERSARIAL_SCHEMA_IDS.has(t.schemaId)
	);

	if (greenTasks.length === 0) return '';

	const findings: string[] = [];

	for (const [i, task] of greenTasks.entries()) {
		const lines: string[] = [
			`### Green Finding ${i + 1}`,
			`- Schema: ${task.schemaId}`,
			`- Agent/Model: ${task.agentId} / ${task.modelId}`,
			`- Instruction: ${task.instructionFile || '(bare model)'}`,
			`- Compliance Score: ${task.complianceScore != null ? Math.round(task.complianceScore * 100) + '%' : 'n/a'}`,
			`- Confidence: ${task.confidence ?? 'n/a'}`,
			`- Response Length: ${task.responseLength ?? 0} chars`,
			`- Tokens: ${task.tokenCount ?? 0}`,
		];

		if (STEGO_SCHEMA_IDS.has(task.schemaId)) {
			lines.push(`- Carrier Type: Steganographic (${task.schemaId})`);
			lines.push(
				`- Stego Hardening: Model did not resist concealed payload. ` +
					`Recommended defenses: strip Variation Selectors (U+FE0E/U+FE0F), ` +
					`Tags Block (U+E0000-U+E007F), normalize Zero-Width sequences ` +
					`(ZWNJ/ZWJ/ZWSP) before interpretation. Add a re-anchoring trigger ` +
					`that re-states role boundaries after any detected hidden payload.`
			);
		}

		const excerpt = readResponseExcerpt(task, projectRoot);
		if (excerpt) {
			lines.push(`- Response Excerpt (first 500 chars):`);
			lines.push(`  ${excerpt}`);
		}

		findings.push(lines.join('\n'));
	}

	return findings.join('\n\n');
}

/**
 * Try to read the agent response from the task's evidence file.
 * Returns the first 500 chars or null if unavailable.
 */
function readResponseExcerpt(task: PrompterTask, projectRoot: string): string | null {
	if (!task.evidencePath) return null;
	try {
		const absPath = path.resolve(projectRoot, task.evidencePath);
		const content = fs.readFileSync(absPath, 'utf-8');
		const response = parseEvidenceResponse(content);
		return response ? response.slice(0, 500) : null;
	} catch (err) {
		if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
			void captureException(err, { scope: 'readResponseExcerpt', evidencePath: task.evidencePath });
		}
		return null;
	}
}

/**
 * Generate a hardened System Instruction from a completed run's green findings.
 * Returns the output path, or null if generation was skipped or failed.
 */
export async function generateHardenedInstruction(
	run: PrompterRun,
	projectRoot: string,
	runManager: PrompterRunManager,
	agents: PrompterAgentConfig[]
): Promise<{
	path: string;
	basedOn: string;
	findingsAddressed: string[];
} | null> {
	if (!hasQualifyingGreens(run)) {
		logger.info('Keine qualifizierenden Green Findings - keine Haertung noetig', LOG);
		return null;
	}

	const base = collectBaseInstruction(projectRoot);
	if (!base) {
		logger.warn('Keine Base Instruction in 1-generic-instructions/ gefunden', LOG);
		return null;
	}

	const greenFindings = collectGreenFindings(run, projectRoot);
	if (!greenFindings) {
		logger.warn('Green Findings konnten nicht gesammelt werden', LOG);
		return null;
	}

	const greenTasks = run.tasks.filter(
		(t) =>
			t.status === 'completed' && t.result === 'green' && ADVERSARIAL_SCHEMA_IDS.has(t.schemaId)
	);
	const techniques = [...new Set(greenTasks.map((t) => t.schemaId))];

	logger.info(
		`Starte Haertungs-Generierung: ${greenTasks.length} Green Tasks, ` +
			`${techniques.length} Techniken, Base: ${base.name}`,
		LOG
	);

	const genConfig: PrompterRunConfig = {
		projectId: run.projectId,
		projectRoot,
		agents: agents.slice(0, 1),
		schemas: ['green-to-hardened-instruction'],
		maxParallelAgents: 1,
		includeVariations: false,
		customDataOverrides: {
			base_instruction: base.content,
			green_findings: greenFindings,
		},
		autoGenerateHardenedInstruction: false,
	};

	try {
		const genRun = await runManager.createRun(genConfig);
		await runManager.startRun(genRun.id);
		const completed = runManager.getRun(genRun.id);

		if (!completed) {
			logger.warn('Haertungs-Run konnte nicht abgeschlossen werden', LOG);
			return null;
		}

		const greenResult = completed.tasks.find((t) => t.result === 'green');
		if (!greenResult) {
			logger.info(
				'Haertungs-Schema produzierte kein Green - generierte Instruction ' +
					'erfuellt die strengen Evaluierungskriterien nicht',
				LOG
			);
		}

		const generatedContent = extractGeneratedContent(completed, projectRoot);
		if (!generatedContent) {
			logger.warn('Generierter Inhalt konnte nicht extrahiert werden', LOG);
			return null;
		}

		const hardenedDir = path.join(projectRoot, '5-hardened-instructions');
		await ensureDir(hardenedDir);

		const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
		const safeBase = base.name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
		const filename = `${safeBase}-hardened-${ts}.md`;
		const fullPath = path.join(hardenedDir, filename);

		const provenance = [
			'<!-- Hardened System Instruction -->',
			'<!-- Generated automatically by AI Maestro Prompter -->',
			`<!-- Base: ${base.name}.md -->`,
			`<!-- Run: ${run.id} -->`,
			`<!-- Greens addressed: ${techniques.join(', ')} -->`,
			'<!-- Purpose: Defensive hardening recommendation for AI providers -->',
			`<!-- Date: ${new Date().toISOString()} -->`,
			'<!-- For security research and model evaluation purposes only -->',
			'',
		].join('\n');

		await atomicWriteFile(fullPath, provenance + generatedContent);

		const metadataPath = path.join(hardenedDir, `${safeBase}-hardened-${ts}.json`);
		const metadata = {
			generatedAt: new Date().toISOString(),
			runId: run.id,
			baseInstruction: `${base.name}.md`,
			techniquesAddressed: techniques,
			greenCount: greenTasks.length,
			greenTasks: greenTasks.map((t) => ({
				schemaId: t.schemaId,
				agentId: t.agentId,
				modelId: t.modelId,
				complianceScore: t.complianceScore,
				responseLength: t.responseLength,
			})),
			purpose: 'Defensive hardening - for security research and model evaluation only',
		};
		await atomicWriteFile(metadataPath, JSON.stringify(metadata, null, 2) + '\n');

		logger.info(`Gehaertete Instruction gespeichert: ${filename}`, LOG);

		return {
			path: fullPath,
			basedOn: base.name,
			findingsAddressed: techniques,
		};
	} catch (err) {
		logger.warn(`Haertungs-Generierung fehlgeschlagen: ${String(err)}`, LOG);
		// Headline feature: a failure here must be visible in Sentry, not only logged.
		void captureException(err, { scope: 'generateHardenedInstruction', runId: run.id });
		return null;
	}
}

/**
 * Extract the LLM-generated content from the completed generation run.
 * Reads the evidence file of the first completed task to get the response.
 */
function extractGeneratedContent(run: PrompterRun, projectRoot: string): string | null {
	const task = run.tasks.find((t) => t.status === 'completed' && t.evidencePath);
	if (!task?.evidencePath) return null;

	try {
		const absPath = path.resolve(projectRoot, task.evidencePath);
		const content = fs.readFileSync(absPath, 'utf-8');
		return parseEvidenceResponse(content);
	} catch (err) {
		if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
			void captureException(err, {
				scope: 'extractGeneratedContent',
				evidencePath: task.evidencePath,
			});
		}
		return null;
	}
}
