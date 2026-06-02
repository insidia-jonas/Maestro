/**
 * Tests for exit listener.
 * Handles process exit events including group chat moderator/participant exits.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupExitListener } from '../exit-listener';
import type { ProcessManager } from '../../process-manager';
import type { ProcessListenerDependencies } from '../types';
import {
	checkAndTrackParticipantResponse,
	clearPendingParticipants,
} from '../../group-chat/group-chat-router';

describe('Exit Listener', () => {
	let mockProcessManager: ProcessManager;
	let mockDeps: Parameters<typeof setupExitListener>[1];
	let eventHandlers: Map<string, (...args: unknown[]) => void>;

	// Create a minimal mock group chat
	const createMockGroupChat = () => ({
		id: 'test-chat-123',
		name: 'Test Chat',
		moderatorAgentId: 'claude-code',
		moderatorSessionId: 'group-chat-test-chat-123-moderator',
		participants: [
			{
				name: 'TestAgent',
				agentId: 'claude-code',
				sessionId: 'group-chat-test-chat-123-participant-TestAgent-abc123',
				addedAt: Date.now(),
			},
		],
		createdAt: Date.now(),
		updatedAt: Date.now(),
		logPath: '/tmp/test-chat.log',
		imagesDir: '/tmp/test-chat-images',
	});

	beforeEach(() => {
		vi.clearAllMocks();
		eventHandlers = new Map();

		mockProcessManager = {
			on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
				eventHandlers.set(event, handler);
			}),
		} as unknown as ProcessManager;

		mockDeps = {
			safeSend: vi.fn(),
			powerManager: {
				addBlockReason: vi.fn(),
				removeBlockReason: vi.fn(),
			},
			groupChatEmitters: {
				emitStateChange: vi.fn(),
				emitParticipantState: vi.fn(),
				emitParticipantsChanged: vi.fn(),
				emitModeratorUsage: vi.fn(),
				emitMessage: vi.fn(),
			},
			groupChatRouter: {
				routeModeratorResponse: vi.fn().mockResolvedValue(undefined),
				routeAgentResponse: vi.fn().mockResolvedValue(undefined),
				markParticipantResponded: vi.fn().mockResolvedValue(undefined),
				spawnModeratorSynthesis: vi.fn().mockResolvedValue(undefined),
				getGroupChatReadOnlyState: vi.fn().mockReturnValue(false),
				respawnParticipantWithRecovery: vi.fn().mockResolvedValue(undefined),
				clearActiveParticipantTaskSession: vi.fn(),
				clearModeratorResponseTimeout: vi.fn(),
				checkAndTrackParticipantResponse: vi.fn().mockReturnValue({ isStale: false, count: 1 }),
			},
			groupChatStorage: {
				loadGroupChat: vi.fn().mockResolvedValue(createMockGroupChat()),
				updateGroupChat: vi.fn().mockResolvedValue(createMockGroupChat()),
				updateParticipant: vi.fn().mockResolvedValue(createMockGroupChat()),
			},
			sessionRecovery: {
				needsSessionRecovery: vi.fn().mockReturnValue(false),
				initiateSessionRecovery: vi.fn().mockResolvedValue(true),
			},
			outputBuffer: {
				appendToGroupChatBuffer: vi.fn().mockReturnValue(100),
				getGroupChatBufferedOutput: vi.fn().mockReturnValue('{"type":"text","text":"test output"}'),
				clearGroupChatBuffer: vi.fn(),
			},
			outputParser: {
				extractTextFromStreamJson: vi.fn().mockReturnValue('parsed response'),
				parseParticipantSessionId: vi.fn().mockReturnValue(null),
			},
			getProcessManager: () => mockProcessManager,
			getAgentDetector: () =>
				({
					detectAgents: vi.fn(),
				}) as unknown as ReturnType<ProcessListenerDependencies['getAgentDetector']>,
			getWebServer: () => null,
			logger: {
				info: vi.fn(),
				error: vi.fn(),
				warn: vi.fn(),
				debug: vi.fn(),
			},
			debugLog: vi.fn(),
			patterns: {
				REGEX_MODERATOR_SESSION: /^group-chat-(.+)-moderator-/,
				REGEX_MODERATOR_SESSION_TIMESTAMP: /^group-chat-(.+)-moderator-\d+$/,
				REGEX_AI_SUFFIX: /-ai-.+$/,
				REGEX_AI_TAB_ID: /-ai-(.+?)(?:-fp-\d+)?$/,
				REGEX_BATCH_SESSION: /-batch-\d+$/,
				REGEX_SYNOPSIS_SESSION: /-synopsis-\d+$/,
			},
		};
	});

	const setupListener = () => {
		setupExitListener(mockProcessManager, mockDeps);
	};

	describe('Event Registration', () => {
		it('should register the exit event listener', () => {
			setupListener();
			expect(mockProcessManager.on).toHaveBeenCalledWith('exit', expect.any(Function));
		});
	});

	describe('Regular Process Exit', () => {
		it('should forward exit event to renderer for non-group-chat sessions', () => {
			setupListener();
			const handler = eventHandlers.get('exit');

			handler?.('regular-session-123', 0);

			expect(mockDeps.safeSend).toHaveBeenCalledWith('process:exit', 'regular-session-123', 0);
		});

		it('should remove power block for non-group-chat sessions', () => {
			setupListener();
			const handler = eventHandlers.get('exit');

			handler?.('regular-session-123', 0);

			expect(mockDeps.powerManager.removeBlockReason).toHaveBeenCalledWith(
				'session:regular-session-123'
			);
		});
	});

	describe('Group Chat Cross-Domain Containment', () => {
		// Regression: if a sessionId starts with GROUP_CHAT_PREFIX but does NOT
		// match either the moderator branch or the participant-parse branch,
		// the exit handler MUST drop it — never forwarding to process:exit,
		// never broadcasting to web clients, and never calling
		// cueEngine.notifyAgentCompleted. Otherwise a mis-shaped group-chat
		// sessionId leaks into the regular exit channel and fires Cue's
		// agent.completed subscriptions spuriously with group-chat provenance.
		it('drops unrecognized group-chat session exit without forwarding or notifying Cue', () => {
			const notifyAgentCompleted = vi.fn();
			const hasCompletionSubscribers = vi.fn().mockReturnValue(true);
			mockDeps = {
				...mockDeps,
				isCueEnabled: () => true,
				getCueEngine: () =>
					({
						notifyAgentCompleted,
						hasCompletionSubscribers,
					}) as unknown as ReturnType<NonNullable<ProcessListenerDependencies['getCueEngine']>>,
			};
			// parseParticipantSessionId returns null → participant branch skipped.
			// The sessionId has no "-moderator-" → moderator branch skipped.
			mockDeps.outputParser.parseParticipantSessionId = vi.fn().mockReturnValue(null);

			setupListener();
			const handler = eventHandlers.get('exit');

			handler?.('group-chat-something-unrecognized', 0);

			expect(mockDeps.safeSend).not.toHaveBeenCalled();
			expect(notifyAgentCompleted).not.toHaveBeenCalled();
			expect(hasCompletionSubscribers).not.toHaveBeenCalled();
		});

		it('notifies Cue for regular (non-group-chat) session exit', () => {
			const notifyAgentCompleted = vi.fn();
			const hasCompletionSubscribers = vi.fn().mockReturnValue(true);
			mockDeps = {
				...mockDeps,
				isCueEnabled: () => true,
				getCueEngine: () =>
					({
						notifyAgentCompleted,
						hasCompletionSubscribers,
					}) as unknown as ReturnType<NonNullable<ProcessListenerDependencies['getCueEngine']>>,
			};

			setupListener();
			const handler = eventHandlers.get('exit');

			handler?.('plain-session-xyz', 0);

			expect(mockDeps.safeSend).toHaveBeenCalledWith('process:exit', 'plain-session-xyz', 0);
			expect(notifyAgentCompleted).toHaveBeenCalledWith('plain-session-xyz', {
				status: 'completed',
				exitCode: 0,
			});
		});

		it('passes only status+exitCode to Cue (no stdout leakage path)', () => {
			// Defensive: the exit-listener call shape is the load-bearing
			// invariant behind the "no stdout fallback" audit in cue-engine.ts.
			// If this test fails because someone added a stdout field, the
			// corresponding cue-completion-chains regression test must also be
			// updated.
			const notifyAgentCompleted = vi.fn();
			const hasCompletionSubscribers = vi.fn().mockReturnValue(true);
			mockDeps = {
				...mockDeps,
				isCueEnabled: () => true,
				getCueEngine: () =>
					({
						notifyAgentCompleted,
						hasCompletionSubscribers,
					}) as unknown as ReturnType<NonNullable<ProcessListenerDependencies['getCueEngine']>>,
			};

			setupListener();
			const handler = eventHandlers.get('exit');

			handler?.('plain-session-xyz', 1);

			expect(notifyAgentCompleted).toHaveBeenCalledTimes(1);
			const [, completionData] = notifyAgentCompleted.mock.calls[0];
			expect(Object.keys(completionData).sort()).toEqual(['exitCode', 'status']);
			expect(completionData.stdout).toBeUndefined();
		});
	});

	describe('Participant Exit', () => {
		beforeEach(() => {
			mockDeps.outputParser.parseParticipantSessionId = vi.fn().mockReturnValue({
				groupChatId: 'test-chat-123',
				participantName: 'TestAgent',
			});
		});

		it('should parse and route participant response on exit', async () => {
			setupListener();
			const handler = eventHandlers.get('exit');
			const sessionId = 'group-chat-test-chat-123-participant-TestAgent-abc123';

			handler?.(sessionId, 0);

			await vi.waitFor(() => {
				expect(mockDeps.groupChatRouter.routeAgentResponse).toHaveBeenCalledWith(
					'test-chat-123',
					'TestAgent',
					'parsed response',
					expect.anything()
				);
			});
		});

		it('should mark participant as responded after successful routing', async () => {
			setupListener();
			const handler = eventHandlers.get('exit');
			const sessionId = 'group-chat-test-chat-123-participant-TestAgent-abc123';

			handler?.(sessionId, 0);

			await vi.waitFor(() => {
				expect(mockDeps.groupChatRouter.markParticipantResponded).toHaveBeenCalledWith(
					'test-chat-123',
					'TestAgent'
				);
			});
		});

		it('should clear output buffer after processing', async () => {
			setupListener();
			const handler = eventHandlers.get('exit');
			const sessionId = 'group-chat-test-chat-123-participant-TestAgent-abc123';

			handler?.(sessionId, 0);

			await vi.waitFor(() => {
				expect(mockDeps.outputBuffer.clearGroupChatBuffer).toHaveBeenCalledWith(sessionId);
			});
		});

		it('should not route when buffered output is empty', async () => {
			mockDeps.outputBuffer.getGroupChatBufferedOutput = vi.fn().mockReturnValue('');
			setupListener();
			const handler = eventHandlers.get('exit');
			const sessionId = 'group-chat-test-chat-123-participant-TestAgent-abc123';

			handler?.(sessionId, 0);

			// Give async operations time to complete
			await new Promise((resolve) => setTimeout(resolve, 50));

			expect(mockDeps.groupChatRouter.routeAgentResponse).not.toHaveBeenCalled();
		});

		it('should not route when parsed text is empty', async () => {
			mockDeps.outputParser.extractTextFromStreamJson = vi.fn().mockReturnValue('   ');
			setupListener();
			const handler = eventHandlers.get('exit');
			const sessionId = 'group-chat-test-chat-123-participant-TestAgent-abc123';

			handler?.(sessionId, 0);

			// Give async operations time to complete
			await new Promise((resolve) => setTimeout(resolve, 50));

			expect(mockDeps.groupChatRouter.routeAgentResponse).not.toHaveBeenCalled();
		});
	});

	describe('Session Recovery', () => {
		beforeEach(() => {
			mockDeps.outputParser.parseParticipantSessionId = vi.fn().mockReturnValue({
				groupChatId: 'test-chat-123',
				participantName: 'TestAgent',
			});
			mockDeps.sessionRecovery.needsSessionRecovery = vi.fn().mockReturnValue(true);
		});

		it('should initiate session recovery when needed', async () => {
			setupListener();
			const handler = eventHandlers.get('exit');
			const sessionId = 'group-chat-test-chat-123-participant-TestAgent-abc123';

			handler?.(sessionId, 0);

			await vi.waitFor(() => {
				expect(mockDeps.sessionRecovery.initiateSessionRecovery).toHaveBeenCalledWith(
					'test-chat-123',
					'TestAgent'
				);
			});
		});

		it('should respawn participant after recovery initiation', async () => {
			setupListener();
			const handler = eventHandlers.get('exit');
			const sessionId = 'group-chat-test-chat-123-participant-TestAgent-abc123';

			handler?.(sessionId, 0);

			await vi.waitFor(() => {
				expect(mockDeps.groupChatRouter.respawnParticipantWithRecovery).toHaveBeenCalledWith(
					'test-chat-123',
					'TestAgent',
					expect.anything(),
					expect.anything()
				);
			});
		});

		it('should clear buffer before initiating recovery', async () => {
			setupListener();
			const handler = eventHandlers.get('exit');
			const sessionId = 'group-chat-test-chat-123-participant-TestAgent-abc123';

			handler?.(sessionId, 0);

			await vi.waitFor(() => {
				expect(mockDeps.outputBuffer.clearGroupChatBuffer).toHaveBeenCalledWith(sessionId);
			});
		});

		it('should not mark participant as responded when recovery succeeds', async () => {
			setupListener();
			const handler = eventHandlers.get('exit');
			const sessionId = 'group-chat-test-chat-123-participant-TestAgent-abc123';

			handler?.(sessionId, 0);

			// Wait for async operations
			await new Promise((resolve) => setTimeout(resolve, 50));

			// When recovery succeeds, markParticipantResponded should NOT be called
			// because the recovery spawn will handle that
			expect(mockDeps.groupChatRouter.markParticipantResponded).not.toHaveBeenCalled();
		});

		it('should mark participant as responded when recovery fails', async () => {
			mockDeps.groupChatRouter.respawnParticipantWithRecovery = vi
				.fn()
				.mockRejectedValue(new Error('Recovery failed'));
			setupListener();
			const handler = eventHandlers.get('exit');
			const sessionId = 'group-chat-test-chat-123-participant-TestAgent-abc123';

			handler?.(sessionId, 0);

			await vi.waitFor(() => {
				expect(mockDeps.groupChatRouter.markParticipantResponded).toHaveBeenCalledWith(
					'test-chat-123',
					'TestAgent'
				);
			});
		});

		it('should emit recovery system message when recovery starts', async () => {
			setupListener();
			const handler = eventHandlers.get('exit');
			const sessionId = 'group-chat-test-chat-123-participant-TestAgent-abc123';

			handler?.(sessionId, 0);

			await vi.waitFor(() => {
				expect(mockDeps.groupChatEmitters.emitMessage).toHaveBeenCalledWith(
					'test-chat-123',
					expect.objectContaining({
						from: 'system',
						content: expect.stringContaining('Creating a new session'),
					})
				);
			});
		});

		it('should emit failure message when recovery fails', async () => {
			mockDeps.groupChatRouter.respawnParticipantWithRecovery = vi
				.fn()
				.mockRejectedValue(new Error('Recovery failed'));
			setupListener();
			const handler = eventHandlers.get('exit');
			const sessionId = 'group-chat-test-chat-123-participant-TestAgent-abc123';

			handler?.(sessionId, 0);

			await vi.waitFor(() => {
				expect(mockDeps.groupChatEmitters.emitMessage).toHaveBeenCalledWith(
					'test-chat-123',
					expect.objectContaining({
						from: 'system',
						content: expect.stringContaining('Failed to create new session'),
					})
				);
			});
		});
	});

	describe('Moderator Exit', () => {
		it('should route moderator response on exit', async () => {
			setupListener();
			const handler = eventHandlers.get('exit');
			const sessionId = 'group-chat-test-chat-123-moderator-1234567890';

			handler?.(sessionId, 0);

			await vi.waitFor(() => {
				expect(mockDeps.groupChatRouter.routeModeratorResponse).toHaveBeenCalledWith(
					'test-chat-123',
					'parsed response',
					expect.anything(),
					expect.anything(),
					false
				);
			});
		});

		it('should clear moderator buffer after processing', async () => {
			setupListener();
			const handler = eventHandlers.get('exit');
			const sessionId = 'group-chat-test-chat-123-moderator-1234567890';

			handler?.(sessionId, 0);

			await vi.waitFor(() => {
				expect(mockDeps.outputBuffer.clearGroupChatBuffer).toHaveBeenCalledWith(sessionId);
			});
		});

		it('should handle synthesis sessions correctly', async () => {
			setupListener();
			const handler = eventHandlers.get('exit');
			const sessionId = 'group-chat-test-chat-123-moderator-synthesis-1234567890';

			handler?.(sessionId, 0);

			await vi.waitFor(() => {
				expect(mockDeps.groupChatRouter.routeModeratorResponse).toHaveBeenCalled();
			});
		});

		it('should clear moderator response timeout on exit', () => {
			setupListener();
			const handler = eventHandlers.get('exit');
			const sessionId = 'group-chat-test-chat-123-moderator-1234567890';

			handler?.(sessionId, 0);

			expect(mockDeps.groupChatRouter.clearModeratorResponseTimeout).toHaveBeenCalledWith(
				'test-chat-123'
			);
		});

		it('should emit system message and idle when moderator exits with no buffered output', async () => {
			mockDeps.outputBuffer.getGroupChatBufferedOutput = vi.fn().mockReturnValue(undefined);
			setupListener();
			const handler = eventHandlers.get('exit');
			const sessionId = 'group-chat-test-chat-123-moderator-1234567890';

			handler?.(sessionId, 0);

			expect(mockDeps.groupChatEmitters.emitMessage).toHaveBeenCalledWith(
				'test-chat-123',
				expect.objectContaining({
					from: 'system',
					content: expect.stringContaining('exited without producing output'),
				})
			);
			expect(mockDeps.groupChatEmitters.emitStateChange).toHaveBeenCalledWith(
				'test-chat-123',
				'idle'
			);
		});

		it('should emit system message and idle when moderator output parses to empty string', async () => {
			mockDeps.outputParser.extractTextFromStreamJson = vi.fn().mockReturnValue('   ');
			setupListener();
			const handler = eventHandlers.get('exit');
			const sessionId = 'group-chat-test-chat-123-moderator-1234567890';

			handler?.(sessionId, 0);

			await vi.waitFor(() => {
				expect(mockDeps.groupChatEmitters.emitMessage).toHaveBeenCalledWith(
					'test-chat-123',
					expect.objectContaining({
						from: 'system',
						content: expect.stringContaining('no visible output'),
					})
				);
				expect(mockDeps.groupChatEmitters.emitStateChange).toHaveBeenCalledWith(
					'test-chat-123',
					'idle'
				);
			});
		});

		it('should emit system message and idle when moderator response processing fails', async () => {
			mockDeps.groupChatStorage.loadGroupChat = vi
				.fn()
				.mockRejectedValue(new Error('Storage unavailable'));
			setupListener();
			const handler = eventHandlers.get('exit');
			const sessionId = 'group-chat-test-chat-123-moderator-1234567890';

			handler?.(sessionId, 0);

			await vi.waitFor(() => {
				expect(mockDeps.groupChatEmitters.emitMessage).toHaveBeenCalledWith(
					'test-chat-123',
					expect.objectContaining({
						from: 'system',
						content: expect.stringContaining('Failed to process moderator response'),
					})
				);
				expect(mockDeps.groupChatEmitters.emitStateChange).toHaveBeenCalledWith(
					'test-chat-123',
					'idle'
				);
			});
		});
	});

	describe('Error Handling', () => {
		beforeEach(() => {
			mockDeps.outputParser.parseParticipantSessionId = vi.fn().mockReturnValue({
				groupChatId: 'test-chat-123',
				participantName: 'TestAgent',
			});
		});

		it('should log error when routing fails', async () => {
			mockDeps.groupChatRouter.routeAgentResponse = vi
				.fn()
				.mockRejectedValue(new Error('Route failed'));
			setupListener();
			const handler = eventHandlers.get('exit');
			const sessionId = 'group-chat-test-chat-123-participant-TestAgent-abc123';

			handler?.(sessionId, 0);

			await vi.waitFor(() => {
				expect(mockDeps.logger.error).toHaveBeenCalled();
			});
		});

		it('should attempt fallback parsing when primary parsing fails', async () => {
			// First call throws, second call (fallback) succeeds
			mockDeps.outputParser.extractTextFromStreamJson = vi
				.fn()
				.mockImplementationOnce(() => {
					throw new Error('Parse error');
				})
				.mockReturnValueOnce('fallback parsed response');

			setupListener();
			const handler = eventHandlers.get('exit');
			const sessionId = 'group-chat-test-chat-123-participant-TestAgent-abc123';

			handler?.(sessionId, 0);

			await vi.waitFor(() => {
				// Should have been called twice: once with agentType, once without (fallback)
				expect(mockDeps.outputParser.extractTextFromStreamJson).toHaveBeenCalledTimes(2);
			});
		});

		it('should still mark participant as responded after routing error', async () => {
			mockDeps.groupChatRouter.routeAgentResponse = vi
				.fn()
				.mockRejectedValue(new Error('Route failed'));
			mockDeps.outputParser.extractTextFromStreamJson = vi
				.fn()
				.mockReturnValueOnce('parsed response')
				.mockReturnValueOnce('fallback response');

			setupListener();
			const handler = eventHandlers.get('exit');
			const sessionId = 'group-chat-test-chat-123-participant-TestAgent-abc123';

			handler?.(sessionId, 0);

			await vi.waitFor(() => {
				expect(mockDeps.groupChatRouter.markParticipantResponded).toHaveBeenCalledWith(
					'test-chat-123',
					'TestAgent'
				);
			});
		});
	});

	describe('Loop Guard E2E — production trim+hash path', () => {
		// Uses the REAL checkAndTrackParticipantResponse (not a mock) so the full
		// production chain is exercised: parsedText → .trim() → SHA-256 → guard.
		const participantSessionId = 'group-chat-test-chat-123-participant-TestAgent-abc123';
		const chatId = 'test-chat-123';

		beforeEach(() => {
			// Wire the REAL guard function into the dependency injection
			mockDeps.groupChatRouter.checkAndTrackParticipantResponse = checkAndTrackParticipantResponse;
			mockDeps.outputParser.parseParticipantSessionId = vi.fn().mockReturnValue({
				groupChatId: chatId,
				participantName: 'TestAgent',
			});
			// Clear guard state from previous tests
			clearPendingParticipants(chatId);
		});

		afterEach(() => {
			clearPendingParticipants(chatId);
		});

		it('whitespace-variant bodies that trim to the same string trigger stale on 3rd exit', async () => {
			// Three whitespace variants that all trim to "done"
			const variants = ['done\n', '  done  ', '\n\tdone\n'];
			setupListener();
			const handler = eventHandlers.get('exit');

			// 1st exit — "done\n" → count=1, routed normally
			mockDeps.outputParser.extractTextFromStreamJson = vi.fn().mockReturnValue(variants[0]);
			handler?.(participantSessionId, 0);
			await vi.waitFor(() => {
				expect(mockDeps.groupChatRouter.routeAgentResponse).toHaveBeenCalledTimes(1);
			});

			// 2nd exit — "  done  " → count=2, still routed
			mockDeps.outputParser.extractTextFromStreamJson = vi.fn().mockReturnValue(variants[1]);
			handler?.(participantSessionId, 0);
			await vi.waitFor(() => {
				expect(mockDeps.groupChatRouter.routeAgentResponse).toHaveBeenCalledTimes(2);
			});

			// 3rd exit — "\n\tdone\n" → count=3, STALE — routeAgentResponse NOT called again
			mockDeps.outputParser.extractTextFromStreamJson = vi.fn().mockReturnValue(variants[2]);
			handler?.(participantSessionId, 0);
			await vi.waitFor(() => {
				expect(mockDeps.groupChatEmitters.emitMessage).toHaveBeenCalledWith(
					chatId,
					expect.objectContaining({
						from: 'system',
						content: expect.stringContaining('responded identically'),
					})
				);
			});
			// routeAgentResponse must still be at 2 — the 3rd call was blocked
			expect(mockDeps.groupChatRouter.routeAgentResponse).toHaveBeenCalledTimes(2);
		});

		it('different body after two identical resets counter — no stale', async () => {
			setupListener();
			const handler = eventHandlers.get('exit');

			// Two identical
			mockDeps.outputParser.extractTextFromStreamJson = vi.fn().mockReturnValue('same body');
			handler?.(participantSessionId, 0);
			await vi.waitFor(() => {
				expect(mockDeps.groupChatRouter.routeAgentResponse).toHaveBeenCalledTimes(1);
			});
			handler?.(participantSessionId, 0);
			await vi.waitFor(() => {
				expect(mockDeps.groupChatRouter.routeAgentResponse).toHaveBeenCalledTimes(2);
			});

			// Different body → counter resets, routed normally
			mockDeps.outputParser.extractTextFromStreamJson = vi.fn().mockReturnValue('different body');
			handler?.(participantSessionId, 0);
			await vi.waitFor(() => {
				expect(mockDeps.groupChatRouter.routeAgentResponse).toHaveBeenCalledTimes(3);
			});
		});

		it('stale participant is still marked as responded (synthesis can proceed)', async () => {
			setupListener();
			const handler = eventHandlers.get('exit');

			mockDeps.outputParser.extractTextFromStreamJson = vi.fn().mockReturnValue('no-op');
			// Drive to stale (3 identical)
			handler?.(participantSessionId, 0);
			await vi.waitFor(() => {
				expect(mockDeps.groupChatRouter.routeAgentResponse).toHaveBeenCalledTimes(1);
			});
			handler?.(participantSessionId, 0);
			await vi.waitFor(() => {
				expect(mockDeps.groupChatRouter.routeAgentResponse).toHaveBeenCalledTimes(2);
			});
			handler?.(participantSessionId, 0);
			await vi.waitFor(() => {
				// Stale path must still call markParticipantResponded so synthesis isn't blocked
				expect(mockDeps.groupChatRouter.markParticipantResponded).toHaveBeenCalledWith(
					chatId,
					'TestAgent'
				);
			});
		});
	});
});
