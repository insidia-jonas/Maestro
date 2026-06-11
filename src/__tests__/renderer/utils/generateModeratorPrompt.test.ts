/**
 * Tests for generateModeratorPrompt — the group-chat wizard's moderator prompt
 * generator and filename/slug helpers.
 */

import { describe, it, expect } from 'vitest';
import {
	generateModeratorPrompt,
	slugifyGroupName,
	moderatorPromptFilename,
} from '../../../renderer/utils/generateModeratorPrompt';

describe('slugifyGroupName', () => {
	it('lowercases and hyphenates', () => {
		expect(slugifyGroupName('INSIDIA OSINT — Build')).toBe('insidia-osint-build');
	});
	it('strips leading/trailing separators and falls back to "group"', () => {
		expect(slugifyGroupName('  !!!  ')).toBe('group');
		expect(slugifyGroupName('')).toBe('group');
	});
});

describe('moderatorPromptFilename', () => {
	it('builds moderator-<slug>.md', () => {
		expect(moderatorPromptFilename('My Group')).toBe('moderator-my-group.md');
	});
});

describe('generateModeratorPrompt', () => {
	const base = {
		groupName: 'OSINT-DEV',
		moderatorModel: 'opus',
		participants: [
			{ name: 'osint-backend', agentId: 'claude-code', cwd: '/opt/osint' },
			{ name: 'osint-gemini', agentId: 'gemini-cli', cwd: '/home/rto/research' },
		],
		description: 'Python/FastAPI OSINT platform.',
	};

	it('includes the group name, model and project description', () => {
		const md = generateModeratorPrompt(base);
		expect(md).toContain('OSINT-DEV');
		expect(md).toContain('Modell: opus');
		expect(md).toContain('Python/FastAPI OSINT platform.');
	});

	it('lists each participant as an @mention with a role', () => {
		const md = generateModeratorPrompt(base);
		expect(md).toContain('@osint-backend');
		expect(md).toContain('Server / API / Persistenz');
		expect(md).toContain('@osint-gemini');
	});

	it('weaves the Gemini agent into topology, a Teilnehmer block and routing', () => {
		const md = generateModeratorPrompt(base);
		// Dedicated Teilnehmer entry (same shape as the hand-written files)
		expect(md).toContain('@osint-gemini (Gemini 3 Pro, LOKAL) — Research & Dokumentation');
		expect(md).toContain('Google-Search-Grounding');
		// Topology note
		expect(md).toContain('Research-/Doku-Agent');
		// Routing row with research signal words
		expect(md).toContain('| @osint-gemini |');
	});

	it('lists the gemini agent only once in Teilnehmer (no duplicate block)', () => {
		const md = generateModeratorPrompt(base);
		const occurrences = md.split('## @osint-gemini').length - 1;
		expect(occurrences).toBe(1);
	});

	it('omits the Gemini parts when no gemini agent is present', () => {
		const md = generateModeratorPrompt({
			...base,
			participants: [{ name: 'osint-backend', agentId: 'claude-code' }],
		});
		expect(md).not.toContain('Research & Dokumentation');
		expect(md).not.toContain('Research-/Doku-Agent');
	});

	it('handles an empty roster without throwing', () => {
		const md = generateModeratorPrompt({ groupName: 'Empty', participants: [] });
		expect(md).toContain('Noch keine Teilnehmer angedockt.');
		expect(md).toContain('Keine Projektbeschreibung angegeben.');
	});

	it('normalizes spaced participant names into hyphenated mentions', () => {
		const md = generateModeratorPrompt({
			groupName: 'G',
			participants: [{ name: 'My Backend', agentId: 'claude-code' }],
		});
		expect(md).toContain('@My-Backend');
	});
});
