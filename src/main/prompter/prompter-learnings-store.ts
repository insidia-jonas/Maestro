/**
 * @file prompter-learnings-store.ts
 * @description Cross-campaign crafter learnings persistence. Stores, per
 * instruction hash, which red-team strategies produced which results against
 * which target model families, so later runs and campaigns can prefer
 * historically effective crafters. Plain JSON files under the user home dir.
 *
 * For security research and model robustness evaluation only. Learnings drive
 * defensive hardening, not better real-world attacks.
 */

import * as fs from 'fs';
import * as path from 'path';
import { atomicWriteFile, ensureDir } from './prompter-fs';
import { logger } from '../utils/logger';
import type { CrafterLearnings, CrafterLearningEntry } from '../../shared/prompter-types';

const LOG = 'PrompterLearningsStore';
export const LEARNINGS_DIR = '.maestro/crafter-learnings';
const MAX_ENTRIES_PER_HASH = 100;

function learningsDir(): string | null {
	const homeDir = process.env.HOME || process.env.USERPROFILE || '';
	if (!homeDir) return null;
	return path.join(homeDir, LEARNINGS_DIR);
}

/** Load all persisted crafter learnings. Best-effort: returns [] on any failure. */
export function loadCrafterLearnings(): CrafterLearnings[] {
	const dir = learningsDir();
	if (!dir) return [];
	let files: string[];
	try {
		files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
	} catch {
		return []; // directory does not exist yet
	}
	const out: CrafterLearnings[] = [];
	for (const file of files) {
		try {
			out.push(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')) as CrafterLearnings);
		} catch {
			/* skip unreadable / corrupt file */
		}
	}
	return out;
}

/**
 * Merge new entries into the per-hash learnings file (capped at the most recent
 * MAX_ENTRIES_PER_HASH, atomic write). Best-effort: failures are logged, not thrown.
 */
export async function appendCrafterLearnings(
	instructionHash: string,
	instructionName: string,
	entries: CrafterLearningEntry[]
): Promise<void> {
	if (entries.length === 0) return;
	const dir = learningsDir();
	if (!dir) return;
	try {
		await ensureDir(dir);
		const filePath = path.join(dir, `${instructionHash}.json`);
		let existing: CrafterLearnings = {
			instructionHash,
			instructionName,
			updatedAt: Date.now(),
			entries: [],
		};
		try {
			existing = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CrafterLearnings;
		} catch {
			/* new file */
		}
		existing.entries.push(...entries);
		existing.entries = existing.entries.slice(-MAX_ENTRIES_PER_HASH);
		existing.updatedAt = Date.now();
		await atomicWriteFile(filePath, JSON.stringify(existing, null, 2) + '\n');
		logger.info(
			`${entries.length} Learnings fuer ${instructionHash.slice(0, 12)} persistiert`,
			LOG
		);
	} catch (err) {
		logger.warn(
			`Learnings-Persistierung fehlgeschlagen (${instructionHash.slice(0, 12)}): ${String(err)}`,
			LOG
		);
	}
}
