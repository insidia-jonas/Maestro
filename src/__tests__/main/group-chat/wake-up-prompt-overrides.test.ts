/**
 * @file wake-up-prompt-overrides.test.ts
 * @description Unit tests for the wake-up prompt override registry.
 *
 * Tests cover:
 * - Registering and reading moderator/participant prompt overrides
 * - Name normalization (spaces vs hyphens, case-insensitivity)
 * - Skipping empty/whitespace-only prompts
 * - Clearing overrides
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
	setWakeUpPromptOverrides,
	getWakeUpModeratorPrompt,
	getWakeUpParticipantPrompt,
	clearWakeUpPromptOverrides,
} from '../../../main/group-chat/wake-up-prompt-overrides';

const CHAT_ID = 'chat-1';

describe('wake-up-prompt-overrides', () => {
	beforeEach(() => {
		clearWakeUpPromptOverrides(CHAT_ID);
		clearWakeUpPromptOverrides('chat-2');
	});

	it('registers and returns the moderator prompt', () => {
		setWakeUpPromptOverrides(CHAT_ID, 'Focus on the release checklist.', []);
		expect(getWakeUpModeratorPrompt(CHAT_ID)).toBe('Focus on the release checklist.');
	});

	it('registers and returns per-participant prompts', () => {
		setWakeUpPromptOverrides(CHAT_ID, undefined, [
			{ participantName: 'Backend Agent', prompt: 'Only touch the API layer.' },
			{ participantName: 'Docs', prompt: 'Write in German.' },
		]);
		expect(getWakeUpParticipantPrompt(CHAT_ID, 'Backend Agent')).toBe('Only touch the API layer.');
		expect(getWakeUpParticipantPrompt(CHAT_ID, 'Docs')).toBe('Write in German.');
		expect(getWakeUpModeratorPrompt(CHAT_ID)).toBeUndefined();
	});

	it('matches participant names across normalization and case', () => {
		setWakeUpPromptOverrides(CHAT_ID, undefined, [
			{ participantName: 'Backend Agent', prompt: 'Only touch the API layer.' },
		]);
		// Mention-normalized (hyphenated) and case-insensitive lookups must match
		expect(getWakeUpParticipantPrompt(CHAT_ID, 'Backend-Agent')).toBe('Only touch the API layer.');
		expect(getWakeUpParticipantPrompt(CHAT_ID, 'backend agent')).toBe('Only touch the API layer.');
	});

	it('skips empty or whitespace-only prompts', () => {
		setWakeUpPromptOverrides(CHAT_ID, '   ', [{ participantName: 'Docs', prompt: '  ' }]);
		expect(getWakeUpModeratorPrompt(CHAT_ID)).toBeUndefined();
		expect(getWakeUpParticipantPrompt(CHAT_ID, 'Docs')).toBeUndefined();
	});

	it('clears overrides for a chat without affecting others', () => {
		setWakeUpPromptOverrides(CHAT_ID, 'A', []);
		setWakeUpPromptOverrides('chat-2', 'B', []);
		clearWakeUpPromptOverrides(CHAT_ID);
		expect(getWakeUpModeratorPrompt(CHAT_ID)).toBeUndefined();
		expect(getWakeUpModeratorPrompt('chat-2')).toBe('B');
	});

	it('replaces previous overrides on re-registration', () => {
		setWakeUpPromptOverrides(CHAT_ID, 'old', [{ participantName: 'Docs', prompt: 'old' }]);
		setWakeUpPromptOverrides(CHAT_ID, 'new', []);
		expect(getWakeUpModeratorPrompt(CHAT_ID)).toBe('new');
		expect(getWakeUpParticipantPrompt(CHAT_ID, 'Docs')).toBeUndefined();
	});
});
