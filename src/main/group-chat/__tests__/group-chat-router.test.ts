/**
 * Tests for group-chat-router loop-guard:
 * checkAndTrackParticipantResponse() and clearPendingParticipants() cleanup.
 */

import { createHash } from 'crypto';
import { describe, it, expect, beforeEach } from 'vitest';
import { checkAndTrackParticipantResponse, clearPendingParticipants } from '../group-chat-router';

/** Helper: SHA-256 hex of a trimmed string (mirrors exit-listener behaviour). */
function hashOf(text: string): string {
	return createHash('sha256').update(text.trim()).digest('hex');
}

describe('checkAndTrackParticipantResponse', () => {
	const chatId = 'test-chat-loop-guard';
	const participant = 'TestAgent';

	beforeEach(() => {
		// Ensure a clean slate — clears the internal Map entry for this chatId
		clearPendingParticipants(chatId);
	});

	// --- Core counter behaviour ---

	it('first response is never stale (count = 1)', () => {
		const result = checkAndTrackParticipantResponse(chatId, participant, hashOf('hello world'));
		expect(result).toEqual({ isStale: false, count: 1 });
	});

	it('second identical response is allowed (count = 2, at MAX_IDENTICAL_RESPONSES)', () => {
		const hash = hashOf('repeated body');
		checkAndTrackParticipantResponse(chatId, participant, hash);
		const result = checkAndTrackParticipantResponse(chatId, participant, hash);
		expect(result).toEqual({ isStale: false, count: 2 });
	});

	it('third identical response is stale (count = 3, exceeds limit)', () => {
		const hash = hashOf('no-op template');
		checkAndTrackParticipantResponse(chatId, participant, hash);
		checkAndTrackParticipantResponse(chatId, participant, hash);
		const result = checkAndTrackParticipantResponse(chatId, participant, hash);
		expect(result).toEqual({ isStale: true, count: 3 });
	});

	it('fourth+ identical response stays stale', () => {
		const hash = hashOf('stuck');
		for (let i = 0; i < 3; i++) {
			checkAndTrackParticipantResponse(chatId, participant, hash);
		}
		const result = checkAndTrackParticipantResponse(chatId, participant, hash);
		expect(result).toEqual({ isStale: true, count: 4 });
	});

	// --- Counter reset on different body ---

	it('different body resets counter to 1', () => {
		const hashA = hashOf('response A');
		const hashB = hashOf('response B');
		checkAndTrackParticipantResponse(chatId, participant, hashA);
		checkAndTrackParticipantResponse(chatId, participant, hashA);
		const result = checkAndTrackParticipantResponse(chatId, participant, hashB);
		expect(result).toEqual({ isStale: false, count: 1 });
	});

	it('after reset, identical sequence restarts fresh', () => {
		const hashA = hashOf('first');
		const hashB = hashOf('second');
		// Build up to 2 with hashA
		checkAndTrackParticipantResponse(chatId, participant, hashA);
		checkAndTrackParticipantResponse(chatId, participant, hashA);
		// Switch — resets
		checkAndTrackParticipantResponse(chatId, participant, hashB);
		// Back to hashA — should be fresh count=1, not stale
		const result = checkAndTrackParticipantResponse(chatId, participant, hashA);
		expect(result).toEqual({ isStale: false, count: 1 });
	});

	// --- Whitespace trimming ---

	it('leading/trailing whitespace produces the same hash (trim-equivalence)', () => {
		const body = 'I acknowledge the task';
		const hash1 = hashOf(body);
		const hash2 = hashOf(`  ${body}  `);
		const hash3 = hashOf(`\n\t${body}\n`);
		expect(hash1).toBe(hash2);
		expect(hash1).toBe(hash3);

		// Verify the function treats them as identical
		checkAndTrackParticipantResponse(chatId, participant, hash1);
		checkAndTrackParticipantResponse(chatId, participant, hash2);
		const result = checkAndTrackParticipantResponse(chatId, participant, hash3);
		expect(result).toEqual({ isStale: true, count: 3 });
	});

	// --- Agent-agnostic: different participant names ---

	it('tracks participants independently within the same chat', () => {
		const hash = hashOf('same body');
		checkAndTrackParticipantResponse(chatId, 'grok-agent', hash);
		checkAndTrackParticipantResponse(chatId, 'grok-agent', hash);
		checkAndTrackParticipantResponse(chatId, 'grok-agent', hash); // stale

		// Different participant with the same body starts fresh
		const result = checkAndTrackParticipantResponse(chatId, 'codex-agent', hash);
		expect(result).toEqual({ isStale: false, count: 1 });
	});

	it('works identically for grok, codex, copilot, and claude participants', () => {
		const agents = ['grok-build', 'codex', 'copilot-cli', 'claude-code'];
		const hash = hashOf('template response');

		for (const agent of agents) {
			clearPendingParticipants(chatId);
			checkAndTrackParticipantResponse(chatId, agent, hash);
			checkAndTrackParticipantResponse(chatId, agent, hash);
			const result = checkAndTrackParticipantResponse(chatId, agent, hash);
			expect(result).toEqual({ isStale: true, count: 3 });
		}
	});

	// --- Cross-chat isolation ---

	it('different chatIds are isolated', () => {
		const hash = hashOf('body');
		checkAndTrackParticipantResponse('chat-A', participant, hash);
		checkAndTrackParticipantResponse('chat-A', participant, hash);

		// Same participant+hash in a different chat — fresh
		const result = checkAndTrackParticipantResponse('chat-B', participant, hash);
		expect(result).toEqual({ isStale: false, count: 1 });

		// Clean up
		clearPendingParticipants('chat-A');
		clearPendingParticipants('chat-B');
	});

	// --- Cleanup via clearPendingParticipants ---

	it('clearPendingParticipants resets tracking for the chat', () => {
		const hash = hashOf('will be cleared');
		checkAndTrackParticipantResponse(chatId, participant, hash);
		checkAndTrackParticipantResponse(chatId, participant, hash);

		clearPendingParticipants(chatId);

		// After clear, same hash should start fresh
		const result = checkAndTrackParticipantResponse(chatId, participant, hash);
		expect(result).toEqual({ isStale: false, count: 1 });
	});

	it('clearPendingParticipants on unknown chatId is a no-op', () => {
		// Should not throw
		expect(() => clearPendingParticipants('nonexistent-chat')).not.toThrow();
	});
});
