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

	it('appends a Gemini research-routing block when a gemini agent is docked', () => {
		const md = generateModeratorPrompt(base);
		expect(md).toContain('Gemini-Research-Agent');
		expect(md).toContain('Google-Search-Grounding');
		expect(md).toContain('LOKAL ohne Repo-Checkout');
	});

	it('omits the Gemini block when no gemini agent is present', () => {
		const md = generateModeratorPrompt({
			...base,
			participants: [{ name: 'osint-backend', agentId: 'claude-code' }],
		});
		expect(md).not.toContain('Gemini-Research-Agent');
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
