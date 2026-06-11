/**
 * Tests for prompter-path-safety.ts — the Prompter sandbox guard. Lexical
 * traversal checks are pure; symlink-escape checks run against a real temp dir.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
	isPathInsideSandbox,
	resolveAndValidatePath,
	checkNoSymlinkEscape,
	assertSafeWritePath,
	PathSafetyError,
} from '../../../main/prompter/prompter-path-safety';

describe('isPathInsideSandbox', () => {
	const root = '/home/user/project';

	it('accepts the root itself and paths inside it', () => {
		expect(isPathInsideSandbox(root, root)).toBe(true);
		expect(isPathInsideSandbox(`${root}/a/b.txt`, root)).toBe(true);
		expect(isPathInsideSandbox(`${root}/deep/nested/file.md`, root)).toBe(true);
	});

	it('rejects traversal and sibling-prefix paths', () => {
		expect(isPathInsideSandbox(`${root}/../other`, root)).toBe(false);
		expect(isPathInsideSandbox('/home/user/project-evil', root)).toBe(false);
		expect(isPathInsideSandbox('/etc/passwd', root)).toBe(false);
		expect(isPathInsideSandbox(`${root}/a/../../escape`, root)).toBe(false);
	});
});

describe('resolveAndValidatePath', () => {
	const root = '/home/user/project';

	it('resolves relative paths against the sandbox root', () => {
		expect(resolveAndValidatePath('a/b.txt', root)).toBe(path.resolve(root, 'a/b.txt'));
	});

	it('throws PathSafetyError on traversal', () => {
		expect(() => resolveAndValidatePath('../escape', root)).toThrow(PathSafetyError);
		expect(() => resolveAndValidatePath('/etc/passwd', root)).toThrow(PathSafetyError);
		expect(() => resolveAndValidatePath('a/../../b', root)).toThrow(PathSafetyError);
	});
});

describe('checkNoSymlinkEscape / assertSafeWritePath', () => {
	let sandbox: string;
	let outside: string;

	beforeEach(() => {
		const base = fs.mkdtempSync(path.join(os.tmpdir(), 'prompter-pathsafety-'));
		sandbox = path.join(base, 'sandbox');
		outside = path.join(base, 'outside');
		fs.mkdirSync(sandbox, { recursive: true });
		fs.mkdirSync(outside, { recursive: true });
	});

	afterEach(() => {
		try {
			fs.rmSync(path.dirname(sandbox), { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	});

	it('allows a normal path inside the sandbox', () => {
		expect(() => checkNoSymlinkEscape(path.join(sandbox, 'sub/file.md'), sandbox)).not.toThrow();
		expect(assertSafeWritePath('sub/file.md', sandbox)).toBe(path.join(sandbox, 'sub', 'file.md'));
	});

	it('blocks a symlink that points outside the sandbox', () => {
		const link = path.join(sandbox, 'escape-link');
		fs.symlinkSync(outside, link);
		// Writing "through" the symlink would land in `outside`.
		expect(() => checkNoSymlinkEscape(path.join(link, 'evil.txt'), sandbox)).toThrow(
			PathSafetyError
		);
	});

	it('allows a symlink that points within the sandbox', () => {
		const realSub = path.join(sandbox, 'real');
		fs.mkdirSync(realSub);
		const link = path.join(sandbox, 'inner-link');
		fs.symlinkSync(realSub, link);
		expect(() => checkNoSymlinkEscape(path.join(link, 'ok.txt'), sandbox)).not.toThrow();
	});
});
