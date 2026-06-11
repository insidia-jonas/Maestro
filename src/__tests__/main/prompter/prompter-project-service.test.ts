/**
 * Tests for prompter-project-service.ts — scaffolding, planning, instruction
 * scanning and deletion against a real temp directory.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('../../../main/utils/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { PrompterProjectService } from '../../../main/prompter/prompter-project-service';

describe('PrompterProjectService', () => {
	let base: string;
	const svc = new PrompterProjectService();

	beforeEach(() => {
		base = fs.mkdtempSync(path.join(os.tmpdir(), 'prompter-project-'));
	});
	afterEach(() => {
		try {
			fs.rmSync(base, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	});

	it('planProject lists folders + files to create and writes nothing', () => {
		const plan = svc.planProject(base, 'lab');
		expect(plan.projectRoot).toBe(path.join(base, 'lab'));
		expect(plan.foldersToCreate).toContain('1-generic-instructions');
		expect(plan.filesToCreate).toContain('2-test-schemas/baseline.schema.json');
		expect(plan.filesToCreate).toContain('1-generic-instructions/GUIDE.md');
		expect(plan.conflicts).toHaveLength(0);
		// nothing written
		expect(fs.existsSync(path.join(base, 'lab'))).toBe(false);
	});

	it('createProject scaffolds the full structure incl. 9 builtin schemas', async () => {
		const project = await svc.createProject(base, 'lab');
		const root = project.rootPath;
		expect(fs.existsSync(path.join(root, '1-generic-instructions/GUIDE.md'))).toBe(true);
		expect(fs.existsSync(path.join(root, '2-test-schemas/SCHEMA-GUIDE.md'))).toBe(true);
		expect(fs.existsSync(path.join(root, '2-test-schemas/_template.schema.json'))).toBe(true);
		expect(fs.existsSync(path.join(root, 'tools/evaluators/EVALUATOR-GUIDE.md'))).toBe(true);
		expect(fs.existsSync(path.join(root, '.prompter-project.json'))).toBe(true);
		const schemaFiles = fs
			.readdirSync(path.join(root, '2-test-schemas'))
			.filter((f) => f.endsWith('.schema.json') && !f.startsWith('_'));
		expect(schemaFiles).toHaveLength(9);
	});

	it('createProject does not overwrite an existing user file', async () => {
		const project = await svc.createProject(base, 'lab');
		const guide = path.join(project.rootPath, '1-generic-instructions/GUIDE.md');
		fs.writeFileSync(guide, 'MY EDITS');
		await svc.createProject(base, 'lab'); // re-init
		expect(fs.readFileSync(guide, 'utf-8')).toBe('MY EDITS');
	});

	it('scanInstructions returns user files but excludes GUIDE/README/underscore', async () => {
		const project = await svc.createProject(base, 'lab');
		const instrDir = path.join(project.rootPath, '1-generic-instructions');
		fs.writeFileSync(path.join(instrDir, 'eni-v1.md'), '# ENI v1\nbody');
		fs.writeFileSync(path.join(instrDir, '_ignored.md'), 'ignore me');
		const files = svc.scanInstructions(project.rootPath);
		const names = files.map((f) => f.path);
		expect(names).toContain('eni-v1.md');
		expect(names).toContain('examples/sample-system-prompt.md');
		expect(names).not.toContain('GUIDE.md');
		expect(names).not.toContain('README.md');
		expect(names).not.toContain('_ignored.md');
		const eni = files.find((f) => f.path === 'eni-v1.md');
		expect(eni?.hash).toMatch(/^[a-f0-9]{64}$/);
	});

	it('deleteProject removes a project (and refuses non-projects)', async () => {
		const project = await svc.createProject(base, 'lab');
		await svc.deleteProject(project.rootPath);
		expect(fs.existsSync(project.rootPath)).toBe(false);

		const plain = path.join(base, 'not-a-project');
		fs.mkdirSync(plain);
		await expect(svc.deleteProject(plain)).rejects.toThrow();
	});

	it('rejects a project name that escapes the chosen folder', () => {
		expect(() => svc.planProject(base, '../evil')).toThrow();
	});

	it('scanInstructions never surfaces a file reached through a sandbox-escaping symlink', async () => {
		const project = await svc.createProject(base, 'lab');
		const instrDir = path.join(project.rootPath, '1-generic-instructions');
		// A real, in-sandbox instruction is included.
		fs.writeFileSync(path.join(instrDir, 'real.md'), '# real\nbody');
		// A secret outside the project, exposed via a symlink inside the folder.
		const secret = path.join(base, 'secret.md');
		fs.writeFileSync(secret, 'TOP SECRET');
		try {
			fs.symlinkSync(secret, path.join(instrDir, 'leak.md'));
		} catch {
			return; // platform without symlink support: nothing to assert
		}
		const names = svc.scanInstructions(project.rootPath).map((f) => f.path);
		expect(names).toContain('real.md');
		expect(names).not.toContain('leak.md');
	});
});
