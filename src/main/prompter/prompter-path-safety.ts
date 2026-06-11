/**
 * @file prompter-path-safety.ts
 * @description Sandbox path validation for the Prompter feature. Every write,
 * delete or read the Prompter performs MUST stay inside the user-selected
 * project folder. This module is the single chokepoint for that guarantee:
 * it blocks path traversal (`../`) and symlink escape (a symlink that resolves
 * outside the sandbox).
 *
 * Security-critical. Zero repo dependencies on purpose — pure Node path/fs.
 * Playbook reference: sections 8 (Task B), 18 (Sicherheit), 20 (Review-Gate).
 */

import * as path from 'path';
import * as fs from 'fs';

/** Thrown when a path would escape its sandbox root. */
export class PathSafetyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PathSafetyError';
	}
}

/**
 * Returns true when `targetPath` resolves to `sandboxRoot` itself or to a path
 * strictly inside it. Comparison is done on resolved (absolute, normalised)
 * paths with a separator boundary so that `/a/bc` is NOT considered inside
 * `/a/b`.
 *
 * This is a purely lexical check (no fs access) — use together with
 * `checkNoSymlinkEscape` for the full guarantee.
 */
export function isPathInsideSandbox(targetPath: string, sandboxRoot: string): boolean {
	const resolvedRoot = path.resolve(sandboxRoot);
	const resolvedTarget = path.resolve(targetPath);
	if (resolvedTarget === resolvedRoot) return true;
	// Append a separator to the root so prefix matching respects path boundaries.
	const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
	return resolvedTarget.startsWith(rootWithSep);
}

/**
 * Resolve `userPath` (which may be relative — then it is resolved against
 * `sandboxRoot`) and verify it stays inside the sandbox. Returns the resolved
 * absolute path or throws `PathSafetyError`.
 *
 * Does NOT touch the filesystem; pair with `checkNoSymlinkEscape` before an
 * actual write when symlinks are a concern.
 */
export function resolveAndValidatePath(userPath: string, sandboxRoot: string): string {
	const resolvedRoot = path.resolve(sandboxRoot);
	const resolved = path.isAbsolute(userPath)
		? path.resolve(userPath)
		: path.resolve(resolvedRoot, userPath);
	if (!isPathInsideSandbox(resolved, resolvedRoot)) {
		throw new PathSafetyError(
			`Path escapes sandbox: "${userPath}" resolves to "${resolved}" outside "${resolvedRoot}"`
		);
	}
	return resolved;
}

/**
 * Verify that `targetPath` does not escape `sandboxRoot` through a symlink.
 *
 * `targetPath` may not exist yet (we're about to create it), so we walk up to
 * the deepest ancestor that DOES exist, take its real (symlink-resolved) path,
 * and confirm that real path is still inside the real sandbox root. If any
 * component along the way is a symlink pointing outside the sandbox, this
 * throws `PathSafetyError`.
 */
export function checkNoSymlinkEscape(targetPath: string, sandboxRoot: string): void {
	const resolvedRoot = path.resolve(sandboxRoot);
	let realRoot: string;
	try {
		realRoot = fs.realpathSync(resolvedRoot);
	} catch {
		// Sandbox root itself doesn't exist yet — nothing to resolve against.
		// Fall back to the lexical guarantee.
		if (!isPathInsideSandbox(targetPath, resolvedRoot)) {
			throw new PathSafetyError(`Path escapes sandbox: "${targetPath}"`);
		}
		return;
	}

	// Find the deepest existing ancestor of targetPath.
	let probe = path.resolve(targetPath);
	const segments: string[] = [];
	// Guard against an unbounded loop on malformed input.
	for (let i = 0; i < 4096; i++) {
		if (fs.existsSync(probe)) break;
		const parent = path.dirname(probe);
		if (parent === probe) break; // reached filesystem root
		segments.unshift(path.basename(probe));
		probe = parent;
	}

	let realExisting: string;
	try {
		realExisting = fs.realpathSync(probe);
	} catch {
		realExisting = probe;
	}

	// Reconstruct the would-be real path of the target from the resolved
	// existing ancestor plus the not-yet-created segments.
	const realTarget = segments.length ? path.join(realExisting, ...segments) : realExisting;

	const rootWithSep = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
	if (realTarget !== realRoot && !realTarget.startsWith(rootWithSep)) {
		throw new PathSafetyError(
			`Symlink escape: "${targetPath}" resolves to "${realTarget}" outside "${realRoot}"`
		);
	}
}

/**
 * Full guard for a write/delete target: resolve + lexical sandbox check +
 * symlink-escape check. Returns the safe absolute path or throws.
 */
export function assertSafeWritePath(userPath: string, sandboxRoot: string): string {
	const resolved = resolveAndValidatePath(userPath, sandboxRoot);
	checkNoSymlinkEscape(resolved, sandboxRoot);
	return resolved;
}
