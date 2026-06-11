/**
 * @file prompter-project-service.ts
 * @description Plans, creates, scans and deletes Prompter project folders. All
 * write/delete paths go through prompter-path-safety so nothing can escape the
 * chosen project folder. The folder layout follows playbook section 3.
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';
import {
	assertSafeWritePath,
	isPathInsideSandbox,
	resolveAndValidatePath,
	checkNoSymlinkEscape,
} from './prompter-path-safety';
import { sha256, atomicWriteFile, ensureDir, readFirstLines, walkFiles } from './prompter-fs';
import { PrompterSchemaRegistry } from './prompter-schema-registry';
import {
	INSTRUCTION_GUIDE_CONTENT,
	SCHEMA_GUIDE_CONTENT,
	EVALUATOR_GUIDE_CONTENT,
	SCHEMA_TEMPLATE_JSON,
	SAMPLE_SYSTEM_PROMPT,
	SAMPLE_AGENT_CONFIG,
	INSTRUCTIONS_README,
	SCHEMAS_README,
	RESULTS_README,
	ADVANCED_README,
	TOOLS_README,
	RUNBOOK_CONTENT,
	FINAL_REPORT_TEMPLATE,
	RUN_REPORT_TEMPLATE,
	PROJECT_README,
} from './prompter-generated-content';
import type {
	ProjectPlan,
	ProjectPlanConflict,
	PrompterProject,
	InstructionFile,
} from '../../shared/prompter-types';

const LOG = 'PrompterProjectService';
const TOOL_VERSION = '1.0.0';
const PROJECT_MANIFEST = '.prompter-project.json';

const INSTRUCTION_DIR = '1-generic-instructions';
const EXCLUDED_INSTRUCTION_NAMES = new Set(['GUIDE.md', 'README.md']);
const INSTRUCTION_EXTENSIONS = new Set(['.md', '.txt', '.json', '.yaml', '.yml']);

/** All folders to create, relative to the project root. */
const FOLDERS: string[] = [
	'1-generic-instructions',
	'1-generic-instructions/examples',
	'2-test-schemas',
	'3-temp-results',
	'3-temp-results/1-green',
	'3-temp-results/2-yellow',
	'3-temp-results/3-red',
	'3-temp-results/runs',
	'4-advanced-tests',
	'4-advanced-tests/approved-fixtures',
	'documentation',
	'documentation/templates',
	'tools',
	'tools/evaluators',
	'tools/local-only',
];

interface GeneratedFile {
	relativePath: string;
	content: string;
}

/** Static (non-schema) files written into a new project. */
const STATIC_FILES: GeneratedFile[] = [
	{ relativePath: 'README.md', content: PROJECT_README },
	{ relativePath: '1-generic-instructions/README.md', content: INSTRUCTIONS_README },
	{ relativePath: '1-generic-instructions/GUIDE.md', content: INSTRUCTION_GUIDE_CONTENT },
	{
		relativePath: '1-generic-instructions/examples/sample-system-prompt.md',
		content: SAMPLE_SYSTEM_PROMPT,
	},
	{
		relativePath: '1-generic-instructions/examples/sample-agent-config.md',
		content: SAMPLE_AGENT_CONFIG,
	},
	{ relativePath: '2-test-schemas/README.md', content: SCHEMAS_README },
	{ relativePath: '2-test-schemas/SCHEMA-GUIDE.md', content: SCHEMA_GUIDE_CONTENT },
	{ relativePath: '2-test-schemas/_template.schema.json', content: SCHEMA_TEMPLATE_JSON },
	{ relativePath: '3-temp-results/README.md', content: RESULTS_README },
	{ relativePath: '3-temp-results/1-green/.gitkeep', content: '' },
	{ relativePath: '3-temp-results/2-yellow/.gitkeep', content: '' },
	{ relativePath: '3-temp-results/3-red/.gitkeep', content: '' },
	{ relativePath: '4-advanced-tests/README.md', content: ADVANCED_README },
	{ relativePath: '4-advanced-tests/approved-fixtures/.gitkeep', content: '' },
	{ relativePath: 'documentation/FINAL-REPORT.md', content: FINAL_REPORT_TEMPLATE },
	{ relativePath: 'documentation/RUNBOOK.md', content: RUNBOOK_CONTENT },
	{
		relativePath: 'documentation/templates/run-report.template.md',
		content: RUN_REPORT_TEMPLATE,
	},
	{
		relativePath: 'documentation/templates/final-report.template.md',
		content: FINAL_REPORT_TEMPLATE,
	},
	{ relativePath: 'tools/README.md', content: TOOLS_README },
	{ relativePath: 'tools/evaluators/EVALUATOR-GUIDE.md', content: EVALUATOR_GUIDE_CONTENT },
	{ relativePath: 'tools/local-only/.gitkeep', content: '' },
];

export class PrompterProjectService {
	private schemaRegistry: PrompterSchemaRegistry;

	constructor(schemaRegistry?: PrompterSchemaRegistry) {
		this.schemaRegistry = schemaRegistry ?? new PrompterSchemaRegistry();
	}

	/** Resolve the project root for a (targetDir, projectName) pair, validated. */
	private resolveProjectRoot(targetDir: string, projectName: string): string {
		const base = path.resolve(targetDir);
		// projectName must not contain path traversal - resolve it inside base.
		const root = resolveAndValidatePath(projectName, base);
		if (!isPathInsideSandbox(root, base)) {
			throw new Error('Project name escapes the chosen folder');
		}
		return root;
	}

	/** All file relative paths a fresh project would contain (static + schemas). */
	private allFiles(): string[] {
		const schemaFiles = this.schemaRegistry
			.getBuiltinSchemas()
			.map((s) => `2-test-schemas/${s.id}.schema.json`);
		return [...STATIC_FILES.map((f) => f.relativePath), ...schemaFiles];
	}

	/**
	 * Dry-run plan: which folders/files would be created, which already exist,
	 * and any conflicts (a planned dir path that exists as a file, etc.). Writes
	 * nothing.
	 */
	planProject(targetDir: string, projectName: string): ProjectPlan {
		const projectRoot = this.resolveProjectRoot(targetDir, projectName);
		const foldersToCreate: string[] = [];
		const filesToCreate: string[] = [];
		const existingFiles: string[] = [];
		const conflicts: ProjectPlanConflict[] = [];

		const allFolders = ['', ...FOLDERS];
		for (const rel of allFolders) {
			const abs = rel ? path.join(projectRoot, rel) : projectRoot;
			if (fs.existsSync(abs)) {
				const stat = fs.statSync(abs);
				if (!stat.isDirectory()) {
					conflicts.push({ path: rel || '.', reason: 'exists-as-file' });
				}
			} else {
				foldersToCreate.push(rel || '.');
			}
		}

		for (const rel of this.allFiles()) {
			const abs = path.join(projectRoot, rel);
			if (fs.existsSync(abs)) {
				const stat = fs.statSync(abs);
				if (stat.isDirectory()) {
					conflicts.push({ path: rel, reason: 'exists-as-dir' });
				} else {
					existingFiles.push(rel);
				}
			} else {
				filesToCreate.push(rel);
			}
		}

		return { projectRoot, foldersToCreate, filesToCreate, existingFiles, conflicts };
	}

	/**
	 * Create the folder structure, guide files and builtin schema files. Existing
	 * files are never overwritten. Returns the project descriptor.
	 */
	async createProject(targetDir: string, projectName: string): Promise<PrompterProject> {
		const projectRoot = this.resolveProjectRoot(targetDir, projectName);
		await ensureDir(projectRoot);
		// Guard against a symlinked project root that points outside targetDir.
		checkNoSymlinkEscape(projectRoot, path.resolve(targetDir));

		// Folders
		for (const rel of FOLDERS) {
			const abs = assertSafeWritePath(rel, projectRoot);
			await ensureDir(abs);
		}

		// Static files (only when missing)
		for (const file of STATIC_FILES) {
			await this.writeIfMissing(projectRoot, file.relativePath, file.content);
		}

		// Builtin schemas
		for (const schema of this.schemaRegistry.getBuiltinSchemas()) {
			await this.writeIfMissing(
				projectRoot,
				`2-test-schemas/${schema.id}.schema.json`,
				JSON.stringify(schema, null, 2) + '\n'
			);
		}

		// Project manifest
		const project: PrompterProject = {
			id: `proj-${sha256(projectRoot).slice(0, 12)}`,
			name: projectName,
			rootPath: projectRoot,
			createdAt: Date.now(),
			toolVersion: TOOL_VERSION,
		};
		await this.writeIfMissing(
			projectRoot,
			PROJECT_MANIFEST,
			JSON.stringify(project, null, 2) + '\n'
		);

		logger.info(`Created Prompter project at ${projectRoot}`, LOG);
		return project;
	}

	private async writeIfMissing(
		projectRoot: string,
		relativePath: string,
		content: string
	): Promise<void> {
		const abs = assertSafeWritePath(relativePath, projectRoot);
		if (fs.existsSync(abs)) return;
		await ensureDir(path.dirname(abs));
		await atomicWriteFile(abs, content);
	}

	/**
	 * Delete the whole project folder (after a path-safety check). The caller is
	 * responsible for user confirmation.
	 */
	async deleteProject(projectRoot: string): Promise<void> {
		const resolved = path.resolve(projectRoot);
		// Sanity: only delete something that looks like a Prompter project.
		if (!fs.existsSync(path.join(resolved, PROJECT_MANIFEST))) {
			throw new Error('Refusing to delete: not a Prompter project (no manifest)');
		}
		// Symlink-escape guard relative to the parent so the realpath is verified.
		checkNoSymlinkEscape(resolved, path.dirname(resolved));
		await fs.promises.rm(resolved, { recursive: true, force: true });
		logger.info(`Deleted Prompter project at ${resolved}`, LOG);
	}

	/**
	 * Recursively scan 1-generic-instructions/ for instruction files, excluding
	 * GUIDE.md/README.md and underscore-prefixed files. Returns hash + preview.
	 */
	scanInstructions(projectRoot: string): InstructionFile[] {
		const dir = assertSafeWritePath(INSTRUCTION_DIR, projectRoot);
		const files = walkFiles(dir);
		const out: InstructionFile[] = [];
		for (const full of files) {
			const base = path.basename(full);
			if (EXCLUDED_INSTRUCTION_NAMES.has(base)) continue;
			if (base.startsWith('_')) continue;
			if (!INSTRUCTION_EXTENSIONS.has(path.extname(full).toLowerCase())) continue;
			// Defense in depth: walkFiles already skips symlink entries, but verify
			// the resolved file still lives inside the instructions folder so a
			// symlink swapped in mid-scan cannot leak an out-of-sandbox file.
			try {
				checkNoSymlinkEscape(full, dir);
			} catch {
				continue;
			}
			let buf: Buffer;
			try {
				buf = fs.readFileSync(full);
			} catch {
				continue;
			}
			out.push({
				path: path.relative(dir, full),
				hash: sha256(buf),
				sizeBytes: buf.length,
				preview: readFirstLines(full, 5),
			});
		}
		return out.sort((a, b) => a.path.localeCompare(b.path));
	}

	/**
	 * Copy an external file into 1-generic-instructions/ and return its descriptor.
	 * The destination stays inside the project folder (path-safety enforced).
	 */
	async importInstruction(projectRoot: string, sourcePath: string): Promise<InstructionFile> {
		const src = path.resolve(sourcePath);
		if (!fs.existsSync(src) || !fs.statSync(src).isFile()) {
			throw new Error(`Source file not found: ${sourcePath}`);
		}
		const destRel = path.join(INSTRUCTION_DIR, path.basename(src));
		const dest = assertSafeWritePath(destRel, projectRoot);
		await ensureDir(path.dirname(dest));
		const content = fs.readFileSync(src);
		await atomicWriteFile(dest, content.toString('utf-8'));
		const dir = path.join(projectRoot, INSTRUCTION_DIR);
		return {
			path: path.relative(dir, dest),
			hash: sha256(content),
			sizeBytes: content.length,
			preview: readFirstLines(dest, 5),
		};
	}

	/** Load (or reload) project + shared custom schemas into the registry. */
	getSchemaRegistry(projectRoot?: string): PrompterSchemaRegistry {
		if (projectRoot) {
			this.schemaRegistry.loadCustomSchemas(projectRoot);
		}
		return this.schemaRegistry;
	}
}
