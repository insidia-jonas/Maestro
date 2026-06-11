/**
 * @file prompter-fs.ts
 * @description Small filesystem helpers shared across the Prompter main-process
 * modules: SHA-256 hashing and atomic file writes (write-to-temp → rename), as
 * required by the playbook for reproducible hashes and crash-safe evidence.
 *
 * `atomicWriteJson` in src/main/utils/atomic-json-store.ts covers JSON; this
 * adds the same guarantee for arbitrary text/markdown content.
 */

import * as fs from 'fs';
import * as path from 'path';
import crypto from 'crypto';

/** SHA-256 hex digest of a string or buffer. */
export function sha256(content: string | Buffer): string {
	return crypto.createHash('sha256').update(content).digest('hex');
}

/** Ensure a directory exists (recursive mkdir, no-op if present). */
export async function ensureDir(dir: string): Promise<void> {
	await fs.promises.mkdir(dir, { recursive: true });
}

/**
 * Atomically write text content: write to `${filePath}.tmp` then rename onto
 * the final path. Retries the rename a few times on EPERM/EBUSY (Windows file
 * locks). The parent directory must already exist.
 */
export async function atomicWriteFile(filePath: string, content: string): Promise<void> {
	const tmp = `${filePath}.tmp`;
	await fs.promises.writeFile(tmp, content, 'utf-8');
	for (let attempt = 0; ; attempt++) {
		try {
			await fs.promises.rename(tmp, filePath);
			return;
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			if ((code === 'EPERM' || code === 'EBUSY') && attempt < 5) {
				await new Promise((r) => setTimeout(r, 20 * (attempt + 1)));
				continue;
			}
			// Clean up the temp file on a terminal failure.
			try {
				await fs.promises.unlink(tmp);
			} catch {
				/* ignore */
			}
			throw err;
		}
	}
}

/** Read the first `n` lines of a file (for previews). */
export function readFirstLines(filePath: string, n: number): string {
	try {
		const content = fs.readFileSync(filePath, 'utf-8');
		return content.split(/\r?\n/).slice(0, n).join('\n');
	} catch {
		return '';
	}
}

/** Recursively list all files under `dir` (absolute paths). */
export function walkFiles(dir: string): string[] {
	const out: string[] = [];
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...walkFiles(full));
		} else if (entry.isFile()) {
			out.push(full);
		}
	}
	return out;
}
