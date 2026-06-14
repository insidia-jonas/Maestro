/**
 * Tests for the cross-campaign crafter learnings store and its round-trip with
 * the crafter's export/load (the wiring that makes bestFromLearnings effective
 * across campaigns).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
	loadCrafterLearnings,
	appendCrafterLearnings,
	LEARNINGS_DIR,
} from '../../../main/prompter/prompter-learnings-store';
import type { CrafterLearningEntry } from '../../../shared/prompter-types';

let tmpHome: string;
let prevHome: string | undefined;

beforeEach(() => {
	tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'prompter-learnings-'));
	prevHome = process.env.HOME;
	process.env.HOME = tmpHome;
});

afterEach(() => {
	process.env.HOME = prevHome;
	fs.rmSync(tmpHome, { recursive: true, force: true });
});

function entry(overrides: Partial<CrafterLearningEntry> = {}): CrafterLearningEntry {
	return {
		campaignId: 'c1',
		strategy: 'authority-frame',
		targetModelFamily: 'opus',
		result: 'green',
		complianceScore: 0.9,
		weakPointsExploited: [],
		recordedAt: 0,
		...overrides,
	};
}

describe('crafter learnings store', () => {
	it('returns empty when nothing has been persisted', () => {
		expect(loadCrafterLearnings()).toEqual([]);
	});

	it('round-trips appended entries by instruction hash', async () => {
		await appendCrafterLearnings('hash-a', 'eni.md', [entry()]);
		const loaded = loadCrafterLearnings();
		expect(loaded).toHaveLength(1);
		expect(loaded[0].instructionHash).toBe('hash-a');
		expect(loaded[0].entries).toHaveLength(1);
		expect(loaded[0].entries[0].strategy).toBe('authority-frame');
		// File actually lives under the configured learnings dir.
		expect(fs.existsSync(path.join(tmpHome, LEARNINGS_DIR, 'hash-a.json'))).toBe(true);
	});

	it('merges into an existing hash file and caps at 100 entries', async () => {
		await appendCrafterLearnings('hash-a', 'eni.md', [entry()]);
		const many = Array.from({ length: 120 }, () => entry());
		await appendCrafterLearnings('hash-a', 'eni.md', many);
		const loaded = loadCrafterLearnings();
		expect(loaded).toHaveLength(1);
		expect(loaded[0].entries).toHaveLength(100);
	});

	it('is a no-op for empty entries', async () => {
		await appendCrafterLearnings('hash-a', 'eni.md', []);
		expect(loadCrafterLearnings()).toEqual([]);
	});
});
