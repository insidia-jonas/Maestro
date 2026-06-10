/**
 * @file group-chat-router.test.ts
 * @description Unit tests for the Group Chat message router.
 *
 * Tests cover:
 * - Extracting @mentions (5.1, 5.2)
 * - Routing user messages (5.3)
 * - Routing moderator responses (5.4)
 * - Routing agent responses (5.5)
 * - Read-only mode propagation (5.6)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';

// Mock Electron's app module before importing modules that use it
let mockUserDataPath: string;
vi.mock('electron', () => ({
	app: {
		getPath: vi.fn((name: string) => {
			if (name === 'userData') {
				return mockUserDataPath;
			}
			throw new Error(`Unknown path name: ${name}`);
		}),
	},
}));

// Mock electron-store to return no custom path (use userData)
vi.mock('electron-store', () => {
	return {
		default: class MockStore {
			get() {
				return undefined;
			} // No custom sync path
			set() {}
		},
	};
});

// Mock wrapSpawnWithSsh so we can verify it's called for SSH sessions
const mockWrapSpawnWithSsh = vi.fn();
vi.mock('../../../main/utils/ssh-spawn-wrapper', () => ({
	wrapSpawnWithSsh: (...args: unknown[]) => mockWrapSpawnWithSsh(...args),
}));

const mockCaptureException = vi.fn();
vi.mock('../../../main/utils/sentry', () => ({
	captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

vi.mock('../../../main/prompt-manager', () => ({
	getPrompt: vi.fn((id: string) => {
		const fs = require('fs');
		const path = require('path');
		const promptsDir = path.resolve(__dirname, '..', '..', '..', '..', 'src', 'prompts');
		const filenameMap: Record<string, string> = {
			'group-chat-participant': 'group-chat-participant.md',
			'group-chat-participant-request': 'group-chat-participant-request.md',
			'group-chat-participant-continuation': 'group-chat-participant-continuation.md',
			'group-chat-moderator-system': 'group-chat-moderator-system.md',
			'group-chat-moderator-synthesis': 'group-chat-moderator-synthesis.md',
		};
		const filename = filenameMap[id];
		if (!filename) throw new Error(`Unknown prompt ID in test mock: ${id}`);
		return fs.readFileSync(path.join(promptsDir, filename), 'utf-8');
	}),
}));

import {
	extractMentions,
	extractAllMentions,
	extractAutoRunDirectives,
	routeUserMessage,
	routeModeratorResponse,
	routeAgentResponse,
	getGroupChatReadOnlyState,
	setGetSessionsCallback,
	setSshStore,
	isParticipantTimedOut,
	clearTimedOutParticipant,
	markParticipantResponded,
	noteParticipantStdoutActivity,
	type GroupChatSessionInfo,
} from '../../../main/group-chat/group-chat-router';
import {
	spawnModerator,
	clearAllModeratorSessions,
	type IProcessManager,
} from '../../../main/group-chat/group-chat-moderator';
import {
	addParticipant,
	setActiveParticipantSession,
	getParticipantSessionId,
	clearAllParticipantSessionsGlobal,
} from '../../../main/group-chat/group-chat-agent';
import {
	createGroupChat,
	deleteGroupChat,
	loadGroupChat,
	GroupChatParticipant,
} from '../../../main/group-chat/group-chat-storage';
import { readLog } from '../../../main/group-chat/group-chat-log';
import { AgentDetector } from '../../../main/agents';
import { groupChatEmitters } from '../../../main/ipc/handlers/groupChat';

describe('group-chat-router', () => {
	let mockProcessManager: IProcessManager;
	let mockAgentDetector: AgentDetector;
	let createdChats: string[] = [];
	let testDir: string;

	beforeEach(async () => {
		// Create a unique temp directory for each test
		testDir = path.join(
			os.tmpdir(),
			`group-chat-router-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
		);
		await fs.mkdir(testDir, { recursive: true });

		// Set the mock userData path to our test directory
		mockUserDataPath = testDir;

		// Create a fresh mock for each test
		mockProcessManager = {
			spawn: vi.fn().mockReturnValue({ pid: 12345, success: true }),
			write: vi.fn().mockReturnValue(true),
			kill: vi.fn().mockReturnValue(true),
		};

		// Create a mock agent detector that returns a mock agent config
		mockAgentDetector = {
			getAgent: vi.fn().mockResolvedValue({
				id: 'claude-code',
				name: 'Claude Code',
				binaryName: 'claude',
				command: 'claude',
				args: ['--print', '--verbose', '--output-format', 'stream-json'],
				available: true,
				path: '/usr/local/bin/claude',
				capabilities: {},
			}),
			detectAgents: vi.fn().mockResolvedValue([]),
			clearCache: vi.fn(),
			setCustomPaths: vi.fn(),
			getCustomPaths: vi.fn().mockReturnValue({}),
			discoverModels: vi.fn().mockResolvedValue([]),
			clearModelCache: vi.fn(),
		} as unknown as AgentDetector;

		// Clear any leftover sessions from previous tests
		clearAllModeratorSessions();
		clearAllParticipantSessionsGlobal();
	});

	afterEach(async () => {
		// Clean up any created chats
		for (const id of createdChats) {
			try {
				await deleteGroupChat(id);
			} catch {
				// Ignore errors
			}
		}
		createdChats = [];

		// Clear sessions
		clearAllModeratorSessions();
		clearAllParticipantSessionsGlobal();

		// Clean up temp directory
		try {
			await fs.rm(testDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}

		// Clear mocks
		vi.clearAllMocks();
		groupChatEmitters.emitMessage = undefined;
	});

	// Helper to track created chats for cleanup
	async function createTestChat(name: string, agentId: string = 'claude-code') {
		const chat = await createGroupChat(name, agentId);
		createdChats.push(chat.id);
		return chat;
	}

	// Helper to create chat with moderator spawned
	async function createTestChatWithModerator(name: string, agentId: string = 'claude-code') {
		const chat = await createTestChat(name, agentId);
		await spawnModerator(chat, mockProcessManager);
		return chat;
	}

	// ===========================================================================
	// Test 5.1: extractMentions finds @mentions
	// ===========================================================================
	describe('extractMentions', () => {
		it('extracts @mentions from text', () => {
			const participants: GroupChatParticipant[] = [
				{ name: 'Client', agentId: 'claude-code', sessionId: '1', addedAt: 0 },
				{ name: 'Server', agentId: 'claude-code', sessionId: '2', addedAt: 0 },
			];

			const mentions = extractMentions('Hey @Client and @Server, please coordinate', participants);
			expect(mentions).toEqual(['Client', 'Server']);
		});

		it('returns mentions in order of appearance', () => {
			const participants: GroupChatParticipant[] = [
				{ name: 'Alpha', agentId: 'claude-code', sessionId: '1', addedAt: 0 },
				{ name: 'Beta', agentId: 'claude-code', sessionId: '2', addedAt: 0 },
				{ name: 'Gamma', agentId: 'claude-code', sessionId: '3', addedAt: 0 },
			];

			const mentions = extractMentions('@Gamma first, then @Alpha, finally @Beta', participants);
			expect(mentions).toEqual(['Gamma', 'Alpha', 'Beta']);
		});

		it('handles single mention', () => {
			const participants: GroupChatParticipant[] = [
				{ name: 'Client', agentId: 'claude-code', sessionId: '1', addedAt: 0 },
			];

			const mentions = extractMentions('@Client: Please implement this', participants);
			expect(mentions).toEqual(['Client']);
		});

		it('returns empty array for no mentions', () => {
			const participants: GroupChatParticipant[] = [
				{ name: 'Client', agentId: 'claude-code', sessionId: '1', addedAt: 0 },
			];

			const mentions = extractMentions('No mentions here', participants);
			expect(mentions).toEqual([]);
		});

		it('handles empty text', () => {
			const participants: GroupChatParticipant[] = [
				{ name: 'Client', agentId: 'claude-code', sessionId: '1', addedAt: 0 },
			];

			const mentions = extractMentions('', participants);
			expect(mentions).toEqual([]);
		});

		it('handles empty participants list', () => {
			const mentions = extractMentions('@Client and @Server', []);
			expect(mentions).toEqual([]);
		});

		it('does not duplicate mentions', () => {
			const participants: GroupChatParticipant[] = [
				{ name: 'Client', agentId: 'claude-code', sessionId: '1', addedAt: 0 },
			];

			const mentions = extractMentions('@Client and then @Client again', participants);
			expect(mentions).toEqual(['Client']);
		});

		it('handles mentions with underscores', () => {
			const participants: GroupChatParticipant[] = [
				{ name: 'Backend_Dev', agentId: 'claude-code', sessionId: '1', addedAt: 0 },
			];

			const mentions = extractMentions('@Backend_Dev: Please help', participants);
			expect(mentions).toEqual(['Backend_Dev']);
		});

		it('handles mentions with numbers', () => {
			const participants: GroupChatParticipant[] = [
				{ name: 'Agent1', agentId: 'claude-code', sessionId: '1', addedAt: 0 },
				{ name: 'Agent2', agentId: 'claude-code', sessionId: '2', addedAt: 0 },
			];

			const mentions = extractMentions('@Agent1 and @Agent2', participants);
			expect(mentions).toEqual(['Agent1', 'Agent2']);
		});

		it('handles mentions with emojis', () => {
			const participants: GroupChatParticipant[] = [
				{ name: '✅-autorun-wizard', agentId: 'claude-code', sessionId: '1', addedAt: 0 },
				{ name: '🚀-launcher', agentId: 'claude-code', sessionId: '2', addedAt: 0 },
			];

			const mentions = extractMentions(
				'@✅-autorun-wizard and @🚀-launcher please help',
				participants
			);
			expect(mentions).toEqual(['✅-autorun-wizard', '🚀-launcher']);
		});

		it('handles mentions with mixed unicode characters', () => {
			const participants: GroupChatParticipant[] = [
				{ name: '日本語-agent', agentId: 'claude-code', sessionId: '1', addedAt: 0 },
				{ name: 'émoji-✨-test', agentId: 'claude-code', sessionId: '2', addedAt: 0 },
			];

			const mentions = extractMentions('@日本語-agent and @émoji-✨-test', participants);
			expect(mentions).toEqual(['日本語-agent', 'émoji-✨-test']);
		});
	});

	// ===========================================================================
	// Test 5.2: extractMentions ignores unknown mentions
	// ===========================================================================
	describe('extractMentions - unknown mentions', () => {
		it('ignores mentions not in participants', () => {
			const participants: GroupChatParticipant[] = [
				{ name: 'Client', agentId: 'claude-code', sessionId: '1', addedAt: 0 },
			];

			const mentions = extractMentions('Hey @Client and @Unknown', participants);
			expect(mentions).toEqual(['Client']);
		});

		it('returns empty when all mentions are unknown', () => {
			const participants: GroupChatParticipant[] = [
				{ name: 'Client', agentId: 'claude-code', sessionId: '1', addedAt: 0 },
			];

			const mentions = extractMentions('@Unknown1 and @Unknown2', participants);
			expect(mentions).toEqual([]);
		});

		it('case sensitive - ignores wrong case', () => {
			const participants: GroupChatParticipant[] = [
				{ name: 'Client', agentId: 'claude-code', sessionId: '1', addedAt: 0 },
			];

			const mentions = extractMentions('@client @CLIENT @Client', participants);
			expect(mentions).toEqual(['Client']); // Only exact match
		});

		it('only matches valid participant names', () => {
			const participants: GroupChatParticipant[] = [
				{ name: 'Client', agentId: 'claude-code', sessionId: '1', addedAt: 0 },
				{ name: 'Server', agentId: 'claude-code', sessionId: '2', addedAt: 0 },
			];

			// @Cli shouldn't match Client, @ServerX shouldn't match Server
			const mentions = extractMentions('@Cli and @ServerX and @Client', participants);
			expect(mentions).toEqual(['Client']);
		});
	});

	// ===========================================================================
	// Test 5.2b: Markdown-formatted mentions
	// AI moderators often wrap mentions in bold/italic/code markdown.
	// ===========================================================================
	describe('extractMentions - markdown formatting', () => {
		const participants: GroupChatParticipant[] = [
			{ name: 'controlplane', agentId: 'claude-code', sessionId: '1', addedAt: 0 },
			{ name: 'dataplane', agentId: 'claude-code', sessionId: '2', addedAt: 0 },
			{ name: 'Client', agentId: 'claude-code', sessionId: '3', addedAt: 0 },
		];

		it('handles bold markdown **@name**', () => {
			const mentions = extractMentions(
				'**@controlplane** — Please execute your plan.',
				participants
			);
			expect(mentions).toEqual(['controlplane']);
		});

		it('handles italic markdown _@name_', () => {
			const mentions = extractMentions('_@Client_ should review this', participants);
			expect(mentions).toEqual(['Client']);
		});

		it('handles bold+italic markdown ***@name***', () => {
			const mentions = extractMentions('***@dataplane*** is ready', participants);
			expect(mentions).toEqual(['dataplane']);
		});

		it('handles backtick markdown `@name`', () => {
			const mentions = extractMentions('`@controlplane` run the task', participants);
			expect(mentions).toEqual(['controlplane']);
		});

		it('handles strikethrough markdown ~~@name~~', () => {
			const mentions = extractMentions('~~@Client~~ was reassigned', participants);
			expect(mentions).toEqual(['Client']);
		});

		it('handles multiple markdown-formatted mentions in one message', () => {
			const mentions = extractMentions(
				'- **@controlplane** — execute plan\n- **@dataplane** — verify results',
				participants
			);
			expect(mentions).toEqual(['controlplane', 'dataplane']);
		});

		it('handles mixed formatted and plain mentions', () => {
			const mentions = extractMentions(
				'**@controlplane** and @dataplane should coordinate',
				participants
			);
			expect(mentions).toEqual(['controlplane', 'dataplane']);
		});
	});

	// ===========================================================================
	// Test 5.2c: extractAllMentions with markdown formatting
	// ===========================================================================
	describe('extractAllMentions - markdown formatting', () => {
		it('strips markdown from extracted mention names', () => {
			const mentions = extractAllMentions('**@controlplane** and _@dataplane_');
			expect(mentions).toEqual(['controlplane', 'dataplane']);
		});

		it('handles backtick-wrapped mentions', () => {
			const mentions = extractAllMentions('`@myAgent` should handle this');
			expect(mentions).toEqual(['myAgent']);
		});

		it('does not produce empty mentions from bare @**', () => {
			const mentions = extractAllMentions('@** is not a real mention');
			expect(mentions).toEqual([]);
		});
	});

	// ===========================================================================
	// Test 5.2d: extractAutoRunDirectives with markdown formatting
	// ===========================================================================
	describe('extractAutoRunDirectives - markdown formatting', () => {
		it('strips markdown from autorun directive participant names', () => {
			const result = extractAutoRunDirectives('!autorun @**controlplane**');
			expect(result.autoRunParticipants).toEqual(['controlplane']);
		});

		it('handles autorun with filename and markdown', () => {
			const result = extractAutoRunDirectives('!autorun @*controlplane*:plan.md');
			expect(result.autoRunDirectives).toEqual([
				{ participantName: 'controlplane', filename: 'plan.md' },
			]);
		});
	});

	// ===========================================================================
	// Test 5.3: routeUserMessage spawns moderator process in batch mode
	// Note: routeUserMessage now spawns a batch process per message instead of
	// writing to a persistent session.
	// ===========================================================================
	describe('routeUserMessage', () => {
		it('routes user message to moderator', async () => {
			const chat = await createTestChatWithModerator('Route Test');

			await routeUserMessage(chat.id, 'Hello', mockProcessManager, mockAgentDetector);

			// Should be in log
			const messages = await readLog(chat.logPath);
			expect(messages.some((m) => m.from === 'user')).toBe(true);
			expect(messages.some((m) => m.content === 'Hello')).toBe(true);

			// Should spawn a batch process for the moderator
			expect(mockProcessManager.spawn).toHaveBeenCalled();
		});

		it('logs message with correct sender', async () => {
			const chat = await createTestChatWithModerator('Sender Test');

			await routeUserMessage(chat.id, 'User message here', mockProcessManager, mockAgentDetector);

			const messages = await readLog(chat.logPath);
			const userMessage = messages.find((m) => m.from === 'user');
			expect(userMessage).toBeDefined();
			expect(userMessage?.content).toBe('User message here');
		});

		it('sends message to moderator session', async () => {
			const chat = await createTestChatWithModerator('Session Test');

			await routeUserMessage(chat.id, 'Test message', mockProcessManager, mockAgentDetector);

			// Check that spawn was called with prompt containing the message
			expect(mockProcessManager.spawn).toHaveBeenCalledWith(
				expect.objectContaining({
					prompt: expect.stringContaining('Test message'),
				})
			);
		});

		it('throws for non-existent chat', async () => {
			await expect(
				routeUserMessage('non-existent-id', 'Hello', mockProcessManager, mockAgentDetector)
			).rejects.toThrow(/not found/i);
		});

		it('throws when moderator is not active', async () => {
			const chat = await createTestChat('No Moderator');
			// Don't spawn moderator

			await expect(
				routeUserMessage(chat.id, 'Hello', mockProcessManager, mockAgentDetector)
			).rejects.toThrow(/not active/i);
		});

		it('works without process manager (log only)', async () => {
			const chat = await createTestChatWithModerator('Log Only Test');

			// No process manager - should still log
			await routeUserMessage(chat.id, 'Log only message');

			const messages = await readLog(chat.logPath);
			expect(messages.some((m) => m.from === 'user' && m.content === 'Log only message')).toBe(
				true
			);
		});
	});

	// ===========================================================================
	// Test 5.4: routeModeratorResponse forwards to mentioned agents
	// ===========================================================================
	describe('routeModeratorResponse', () => {
		it('spawns mentioned agents', async () => {
			const chat = await createTestChatWithModerator('Forward Test');
			await addParticipant(chat.id, 'Client', 'claude-code', mockProcessManager);

			await routeModeratorResponse(
				chat.id,
				'@Client: Please implement the login form',
				mockProcessManager,
				mockAgentDetector
			);

			const spawnCall = mockProcessManager.spawn.mock.calls.find((call) =>
				call[0]?.prompt?.includes('login form')
			);
			expect(spawnCall).toBeDefined();
		});

		it('logs moderator message', async () => {
			const chat = await createTestChatWithModerator('Log Test');
			await addParticipant(chat.id, 'Client', 'claude-code', mockProcessManager);

			await routeModeratorResponse(chat.id, '@Client: Task for you', mockProcessManager);

			const messages = await readLog(chat.logPath);
			expect(
				messages.some((m) => m.from === 'moderator' && m.content.includes('Task for you'))
			).toBe(true);
		});

		it('spawns multiple mentioned agents', async () => {
			const chat = await createTestChatWithModerator('Multi Forward Test');
			const client = await addParticipant(chat.id, 'Client', 'claude-code', mockProcessManager);
			const server = await addParticipant(chat.id, 'Server', 'claude-code', mockProcessManager);

			await routeModeratorResponse(
				chat.id,
				'@Client and @Server: Coordinate on API',
				mockProcessManager,
				mockAgentDetector
			);

			const spawnCalls = mockProcessManager.spawn.mock.calls;
			const clientSpawn = spawnCalls.find((call) => call[0]?.prompt?.includes('Client'));
			const serverSpawn = spawnCalls.find((call) => call[0]?.prompt?.includes('Server'));

			expect(clientSpawn).toBeDefined();
			expect(serverSpawn).toBeDefined();
		});

		it('ignores unknown mentions', async () => {
			const chat = await createTestChatWithModerator('Unknown Mention Test');
			await addParticipant(chat.id, 'Client', 'claude-code', mockProcessManager);

			// Clear the write mock after setup
			mockProcessManager.spawn.mockClear();

			await routeModeratorResponse(
				chat.id,
				'@Unknown: This should not route',
				mockProcessManager,
				mockAgentDetector
			);

			// Should not spawn any participant (since Unknown doesn't exist)
			expect(mockProcessManager.spawn).not.toHaveBeenCalled();
		});

		it('treats unresolved @tokens as plain text without emitting a system warning', async () => {
			const chat = await createTestChatWithModerator('Literal At Symbol Test');
			const emitMessage = vi.fn();
			groupChatEmitters.emitMessage = emitMessage;

			mockProcessManager.spawn.mockClear();

			await routeModeratorResponse(
				chat.id,
				'Please keep the literal @example value in the final message.',
				mockProcessManager,
				mockAgentDetector
			);

			expect(mockProcessManager.spawn).not.toHaveBeenCalled();
			expect(emitMessage).not.toHaveBeenCalledWith(
				chat.id,
				expect.objectContaining({
					from: 'system',
				})
			);
		});

		it('is a no-op for non-existent chat (benign race on moderator exit)', async () => {
			await expect(
				routeModeratorResponse('non-existent-id', 'Hello', mockProcessManager)
			).resolves.toBeUndefined();
		});

		it('works without process manager (log only)', async () => {
			const chat = await createTestChatWithModerator('Log Only Mod Test');
			await addParticipant(chat.id, 'Client', 'claude-code', mockProcessManager);

			mockProcessManager.write.mockClear();

			// No process manager - should still log
			await routeModeratorResponse(chat.id, '@Client: Log only');

			const messages = await readLog(chat.logPath);
			expect(messages.some((m) => m.from === 'moderator')).toBe(true);
		});
	});

	// ===========================================================================
	// Test 5.5: routeAgentResponse logs and notifies moderator
	// ===========================================================================
	describe('routeAgentResponse', () => {
		it('logs agent response', async () => {
			const chat = await createTestChatWithModerator('Agent Response Test');
			await addParticipant(chat.id, 'Client', 'claude-code', mockProcessManager);

			await routeAgentResponse(chat.id, 'Client', 'Done implementing the form', mockProcessManager);

			// Should be in log
			const messages = await readLog(chat.logPath);
			expect(messages.some((m) => m.from === 'Client')).toBe(true);
			expect(messages.some((m) => m.content === 'Done implementing the form')).toBe(true);
		});

		it('logs message with participant name as sender', async () => {
			const chat = await createTestChatWithModerator('Sender Name Test');
			await addParticipant(chat.id, 'Backend', 'claude-code', mockProcessManager);

			await routeAgentResponse(chat.id, 'Backend', 'API endpoint created', mockProcessManager);

			const messages = await readLog(chat.logPath);
			const agentMessage = messages.find((m) => m.from === 'Backend');
			expect(agentMessage).toBeDefined();
			expect(agentMessage?.content).toBe('API endpoint created');
		});

		it('does not notify moderator via process manager write', async () => {
			const chat = await createTestChatWithModerator('Format Test');
			await addParticipant(chat.id, 'Frontend', 'claude-code', mockProcessManager);

			mockProcessManager.write.mockClear();

			await routeAgentResponse(chat.id, 'Frontend', 'Component ready', mockProcessManager);

			expect(mockProcessManager.write).not.toHaveBeenCalled();
		});

		it('throws for non-existent chat', async () => {
			await expect(
				routeAgentResponse('non-existent-id', 'Client', 'Hello', mockProcessManager)
			).rejects.toThrow(/not found/i);
		});

		it('throws for unknown participant', async () => {
			const chat = await createTestChatWithModerator('Unknown Agent Test');

			await expect(
				routeAgentResponse(chat.id, 'Unknown', 'Hello', mockProcessManager)
			).rejects.toThrow(/not found/i);
		});

		it('works without process manager (log only)', async () => {
			const chat = await createTestChatWithModerator('Log Only Agent Test');
			await addParticipant(chat.id, 'Client', 'claude-code', mockProcessManager);

			mockProcessManager.write.mockClear();

			// No process manager - should still log
			await routeAgentResponse(chat.id, 'Client', 'Log only response');

			const messages = await readLog(chat.logPath);
			expect(messages.some((m) => m.from === 'Client' && m.content === 'Log only response')).toBe(
				true
			);
		});

		it('handles multiple responses from same agent', async () => {
			const chat = await createTestChatWithModerator('Multi Response Test');
			await addParticipant(chat.id, 'Client', 'claude-code', mockProcessManager);

			await routeAgentResponse(chat.id, 'Client', 'First message', mockProcessManager);
			await routeAgentResponse(chat.id, 'Client', 'Second message', mockProcessManager);

			const messages = await readLog(chat.logPath);
			const clientMessages = messages.filter((m) => m.from === 'Client');
			expect(clientMessages).toHaveLength(2);
		});
	});

	// ===========================================================================
	// Test 5.6: Read-only mode propagation
	// ===========================================================================
	describe('read-only mode propagation', () => {
		it('moderator spawns with readOnlyMode: true', async () => {
			const chat = await createTestChatWithModerator('Moderator ReadOnly Test');

			await routeUserMessage(chat.id, 'Hello', mockProcessManager, mockAgentDetector);

			// Moderator should always be spawned with readOnlyMode: true
			expect(mockProcessManager.spawn).toHaveBeenCalledWith(
				expect.objectContaining({
					readOnlyMode: true,
				})
			);
		});

		it('includes READ-ONLY MODE in prompt when readOnly flag is set', async () => {
			const chat = await createTestChatWithModerator('ReadOnly Prompt Test');

			await routeUserMessage(chat.id, 'Hello', mockProcessManager, mockAgentDetector, true);

			// Prompt should include READ-ONLY MODE indicator
			expect(mockProcessManager.spawn).toHaveBeenCalledWith(
				expect.objectContaining({
					prompt: expect.stringContaining('READ-ONLY MODE'),
				})
			);
		});

		it('logs message with readOnly flag when set', async () => {
			const chat = await createTestChatWithModerator('ReadOnly Log Test');

			await routeUserMessage(
				chat.id,
				'Read-only message',
				mockProcessManager,
				mockAgentDetector,
				true
			);

			const messages = await readLog(chat.logPath);
			const userMessage = messages.find((m) => m.from === 'user');
			expect(userMessage).toBeDefined();
			expect(userMessage?.readOnly).toBe(true);
		});

		it('stores readOnly state for the group chat', async () => {
			const chat = await createTestChatWithModerator('ReadOnly State Test');

			// Initially should be false
			expect(getGroupChatReadOnlyState(chat.id)).toBe(false);

			// After sending read-only message, state should be true
			await routeUserMessage(
				chat.id,
				'Read-only message',
				mockProcessManager,
				mockAgentDetector,
				true
			);
			expect(getGroupChatReadOnlyState(chat.id)).toBe(true);

			// After sending non-read-only message, state should be false
			await routeUserMessage(
				chat.id,
				'Normal message',
				mockProcessManager,
				mockAgentDetector,
				false
			);
			expect(getGroupChatReadOnlyState(chat.id)).toBe(false);
		});

		it('does not include READ-ONLY MODE in prompt when readOnly flag is not set', async () => {
			const chat = await createTestChatWithModerator('No ReadOnly Prompt Test');

			await routeUserMessage(
				chat.id,
				'Normal message',
				mockProcessManager,
				mockAgentDetector,
				false
			);

			// Prompt should NOT include READ-ONLY MODE indicator
			const spawnCall = mockProcessManager.spawn.mock.calls.find((call) =>
				call[0].prompt?.includes('Normal message')
			);
			expect(spawnCall).toBeDefined();
			expect(spawnCall?.[0].prompt).not.toContain('READ-ONLY MODE');
		});

		it('participants spawn with readOnlyMode matching the readOnly flag', async () => {
			const chat = await createTestChatWithModerator('Participant ReadOnly Test');
			await addParticipant(chat.id, 'Client', 'claude-code', mockProcessManager);

			// Clear spawn mock to only capture the participant batch spawn
			mockProcessManager.spawn.mockClear();

			// This should trigger participant batch process with readOnly propagated
			await routeModeratorResponse(
				chat.id,
				'@Client: Please analyze this code',
				mockProcessManager,
				mockAgentDetector,
				true // readOnly flag
			);

			// Participant should be spawned with readOnlyMode matching the flag
			const participantSpawnCall = mockProcessManager.spawn.mock.calls.find((call) =>
				call[0].sessionId?.includes('participant')
			);
			expect(participantSpawnCall).toBeDefined();
			expect(participantSpawnCall?.[0].readOnlyMode).toBe(true);
		});

		it('participants spawn with readOnlyMode: false when readOnly is not set', async () => {
			const chat = await createTestChatWithModerator('Participant No ReadOnly Test');
			await addParticipant(chat.id, 'Client', 'claude-code', mockProcessManager);

			// Clear spawn mock to only capture the participant batch spawn
			mockProcessManager.spawn.mockClear();

			// This should trigger participant batch process without readOnly
			await routeModeratorResponse(
				chat.id,
				'@Client: Please implement this feature',
				mockProcessManager,
				mockAgentDetector
				// no readOnly flag = false
			);

			// Participant should be spawned with readOnlyMode: false
			const participantSpawnCall = mockProcessManager.spawn.mock.calls.find((call) =>
				call[0].sessionId?.includes('participant')
			);
			expect(participantSpawnCall).toBeDefined();
			expect(participantSpawnCall?.[0].readOnlyMode).toBe(false);
		});

		it('auto-added participants are only started once for a moderator handoff', async () => {
			const chat = await createTestChatWithModerator('Auto Add Single Spawn Test');
			setGetSessionsCallback(() => [
				{
					id: 'session-client',
					name: 'Client',
					toolType: 'claude-code',
					cwd: '/tmp/project',
				},
			]);

			await routeModeratorResponse(
				chat.id,
				'@Client: Please create the requested file',
				mockProcessManager,
				mockAgentDetector
			);

			const participantSpawns = mockProcessManager.spawn.mock.calls.filter((call) =>
				call[0].sessionId?.includes(`group-chat-${chat.id}-participant-Client-`)
			);
			expect(participantSpawns).toHaveLength(1);
		});

		it('does not report auto-add races after the moderator has stopped', async () => {
			const chat = await createTestChatWithModerator('Auto Add Stopped Moderator Test');
			clearAllModeratorSessions();
			mockCaptureException.mockClear();
			setGetSessionsCallback(() => [
				{
					id: 'session-client',
					name: 'Client',
					toolType: 'claude-code',
					cwd: '/tmp/project',
				},
			]);

			await routeModeratorResponse(
				chat.id,
				'@Client: Please create the requested file',
				mockProcessManager,
				mockAgentDetector
			);

			expect(mockCaptureException).not.toHaveBeenCalled();
			expect((await loadGroupChat(chat.id))?.participants).toEqual([]);
		});
	});

	// ===========================================================================
	// Edge cases and integration scenarios
	// ===========================================================================
	describe('edge cases', () => {
		it('handles full message flow', async () => {
			const chat = await createTestChatWithModerator('Full Flow Test');
			await addParticipant(chat.id, 'Dev', 'claude-code', mockProcessManager);

			// User message
			await routeUserMessage(
				chat.id,
				'Please help me build a feature',
				mockProcessManager,
				mockAgentDetector
			);

			// Moderator response
			await routeModeratorResponse(chat.id, '@Dev: Build the feature', mockProcessManager);

			// Agent response
			await routeAgentResponse(chat.id, 'Dev', 'Feature built!', mockProcessManager);

			const messages = await readLog(chat.logPath);
			expect(messages.filter((m) => m.from === 'user')).toHaveLength(1);
			expect(messages.filter((m) => m.from === 'moderator')).toHaveLength(1);
			expect(messages.filter((m) => m.from === 'Dev')).toHaveLength(1);
		});

		it('handles special characters in messages', async () => {
			const chat = await createTestChatWithModerator('Special Char Test');
			await addParticipant(chat.id, 'Client', 'claude-code', mockProcessManager);

			await routeUserMessage(
				chat.id,
				'Message with pipes | and newlines\nand more',
				mockProcessManager,
				mockAgentDetector
			);

			const messages = await readLog(chat.logPath);
			const userMessage = messages.find((m) => m.from === 'user');
			expect(userMessage?.content).toBe('Message with pipes | and newlines\nand more');
		});

		it('handles concurrent routing', async () => {
			const chat = await createTestChatWithModerator('Concurrent Test');
			await addParticipant(chat.id, 'Agent1', 'claude-code', mockProcessManager);
			await addParticipant(chat.id, 'Agent2', 'claude-code', mockProcessManager);

			// Send multiple messages concurrently
			await Promise.all([
				routeAgentResponse(chat.id, 'Agent1', 'Response 1', mockProcessManager),
				routeAgentResponse(chat.id, 'Agent2', 'Response 2', mockProcessManager),
			]);

			const messages = await readLog(chat.logPath);
			expect(messages.filter((m) => m.from === 'Agent1' || m.from === 'Agent2')).toHaveLength(2);
		});
	});

	// ===========================================================================
	// Test 5.7: SSH remote execution for group chat participants
	// ===========================================================================
	describe('SSH remote participant support', () => {
		const sshRemoteConfig = {
			enabled: true,
			remoteId: 'remote-1',
			workingDirOverride: '/home/user/project',
		};

		const mockSshStore = {
			getSshRemotes: vi
				.fn()
				.mockReturnValue([
					{ id: 'remote-1', name: 'PedTome', host: 'pedtome.local', user: 'user' },
				]),
		};

		beforeEach(() => {
			// Configure the SSH wrapping mock to return transformed spawn config
			mockWrapSpawnWithSsh.mockResolvedValue({
				command: 'ssh',
				args: ['-t', 'user@pedtome.local', 'claude', '--print'],
				cwd: '/home/user/project',
				prompt: 'test prompt',
				customEnvVars: {},
				sshRemoteUsed: { name: 'PedTome' },
			});
		});

		afterEach(() => {
			// Clear the module-level callbacks after SSH tests
			setGetSessionsCallback(() => []);
			mockWrapSpawnWithSsh.mockReset();
		});

		it('user-mention auto-add stores SSH participant metadata without spawning yet', async () => {
			const chat = await createTestChatWithModerator('SSH User Mention Test');

			// Set up a session with SSH config that the router can discover
			const sshSession: GroupChatSessionInfo = {
				id: 'ses-ssh-1',
				name: 'RemoteAgent',
				toolType: 'claude-code',
				cwd: '/home/user/project',
				projectRoot: '/home/user/project',
				sshRemoteName: 'PedTome',
				sshRemoteConfig,
			};
			setGetSessionsCallback(() => [sshSession]);
			setSshStore(mockSshStore);

			// User mentions @RemoteAgent — this should auto-add with SSH config
			await routeUserMessage(
				chat.id,
				'@RemoteAgent: please help',
				mockProcessManager,
				mockAgentDetector
			);

			expect(mockWrapSpawnWithSsh).not.toHaveBeenCalled();
			const updatedChat = await loadGroupChat(chat.id);
			expect(updatedChat?.participants).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: 'RemoteAgent',
						sshRemoteName: 'PedTome',
					}),
				])
			);
		});

		it('moderator-mention participant spawn applies SSH wrapping', async () => {
			const chat = await createTestChatWithModerator('SSH Moderator Mention Test');

			// Set up session with SSH config
			const sshSession: GroupChatSessionInfo = {
				id: 'ses-ssh-2',
				name: 'SSHWorker',
				toolType: 'claude-code',
				cwd: '/home/user/project',
				projectRoot: '/home/user/project',
				sshRemoteName: 'PedTome',
				sshRemoteConfig,
			};
			setGetSessionsCallback(() => [sshSession]);
			setSshStore(mockSshStore);

			// Add the participant (this triggers SSH wrapping during spawn)
			await addParticipant(
				chat.id,
				'SSHWorker',
				'claude-code',
				mockProcessManager,
				'/home/user/project',
				mockAgentDetector,
				{},
				undefined,
				{ sshRemoteName: 'PedTome', sshRemoteConfig },
				mockSshStore
			);

			mockWrapSpawnWithSsh.mockClear();

			// Moderator mentions the SSH participant — batch spawn should use SSH wrapping
			await routeModeratorResponse(
				chat.id,
				'@SSHWorker: implement the feature',
				mockProcessManager,
				mockAgentDetector
			);

			expect(mockWrapSpawnWithSsh).toHaveBeenCalledWith(
				expect.objectContaining({
					command: expect.any(String),
					agentBinaryName: 'claude',
				}),
				sshRemoteConfig,
				mockSshStore
			);
		});

		it('does not apply SSH wrapping for non-SSH sessions', async () => {
			const chat = await createTestChatWithModerator('No SSH Test');

			// Session without SSH config
			const localSession: GroupChatSessionInfo = {
				id: 'ses-local-1',
				name: 'LocalAgent',
				toolType: 'claude-code',
				cwd: '/Users/dev/project',
				projectRoot: '/Users/dev/project',
			};
			setGetSessionsCallback(() => [localSession]);
			setSshStore(mockSshStore);

			await routeUserMessage(
				chat.id,
				'@LocalAgent: help please',
				mockProcessManager,
				mockAgentDetector
			);

			// SSH wrapper should NOT be called for local sessions
			expect(mockWrapSpawnWithSsh).not.toHaveBeenCalled();
		});
	});

	describe('participant cwd fallback chain', () => {
		it('uses session cwd when available (cwd-first)', async () => {
			const chat = await createTestChatWithModerator('CWD Fallback Test');
			const session: GroupChatSessionInfo = {
				id: 'ses-cwd-1',
				name: 'CwdAgent',
				toolType: 'claude-code',
				cwd: '/explicit/cwd',
				projectRoot: '/project/root',
			};
			setGetSessionsCallback(() => [session]);
			await addParticipant(chat.id, 'CwdAgent', 'claude-code', mockProcessManager);
			mockProcessManager.spawn.mockClear();

			await routeModeratorResponse(
				chat.id,
				'@CwdAgent: do the thing',
				mockProcessManager,
				mockAgentDetector
			);

			const spawnCall = mockProcessManager.spawn.mock.calls.find((call) =>
				call[0]?.prompt?.includes('do the thing')
			);
			expect(spawnCall).toBeDefined();
			expect(spawnCall![0].cwd).toBe('/explicit/cwd');
		});

		it('falls back to projectRoot when cwd is empty', async () => {
			const chat = await createTestChatWithModerator('ProjectRoot Fallback Test');
			const session: GroupChatSessionInfo = {
				id: 'ses-pr-1',
				name: 'PrAgent',
				toolType: 'claude-code',
				cwd: '',
				projectRoot: '/project/root',
			};
			setGetSessionsCallback(() => [session]);
			await addParticipant(chat.id, 'PrAgent', 'claude-code', mockProcessManager);
			mockProcessManager.spawn.mockClear();

			await routeModeratorResponse(
				chat.id,
				'@PrAgent: do the thing',
				mockProcessManager,
				mockAgentDetector
			);

			const spawnCall = mockProcessManager.spawn.mock.calls.find((call) =>
				call[0]?.prompt?.includes('do the thing')
			);
			expect(spawnCall).toBeDefined();
			expect(spawnCall![0].cwd).toBe('/project/root');
		});

		it('falls back to process.cwd() when both cwd and projectRoot are empty', async () => {
			const chat = await createTestChatWithModerator('ProcessCwd Fallback Test');
			const session: GroupChatSessionInfo = {
				id: 'ses-none-1',
				name: 'NoneAgent',
				toolType: 'claude-code',
				cwd: '',
				projectRoot: '',
			};
			setGetSessionsCallback(() => [session]);
			await addParticipant(chat.id, 'NoneAgent', 'claude-code', mockProcessManager);
			mockProcessManager.spawn.mockClear();

			await routeModeratorResponse(
				chat.id,
				'@NoneAgent: do the thing',
				mockProcessManager,
				mockAgentDetector
			);

			const spawnCall = mockProcessManager.spawn.mock.calls.find((call) =>
				call[0]?.prompt?.includes('do the thing')
			);
			expect(spawnCall).toBeDefined();
			expect(spawnCall![0].cwd).toBe(process.cwd());
		});
	});

	describe('participant timeout and timed-out state', () => {
		it('isParticipantTimedOut returns false for unknown session IDs', () => {
			expect(isParticipantTimedOut('nonexistent-session-123')).toBe(false);
		});

		it('clearTimedOutParticipant consumes the guard entry (round-trip)', () => {
			// We cannot insert into timedOutSessions directly (private),
			// but we can verify clear is a no-op for absent keys — the real
			// insert→consume cycle is tested in the fake-timer tests below.
			const sid = 'group-chat-test-participant-Agent-12345';
			expect(isParticipantTimedOut(sid)).toBe(false);
			clearTimedOutParticipant(sid);
			expect(isParticipantTimedOut(sid)).toBe(false);
		});

		it('routeModeratorResponse emits working state when spawning participant', async () => {
			const chat = await createTestChatWithModerator('timeout-working-test');
			await addParticipant(chat.id, 'WorkAgent', 'claude-code');

			groupChatEmitters.emitParticipantState = vi.fn();
			groupChatEmitters.emitMessage = vi.fn();

			await routeModeratorResponse(
				chat.id,
				'@WorkAgent check the timeout value',
				mockProcessManager,
				mockAgentDetector,
				false
			);

			expect(groupChatEmitters.emitParticipantState).toHaveBeenCalledWith(
				chat.id,
				'WorkAgent',
				'working'
			);
		});

		it('timeout fires → kill + guard-add + timed-out emit (fake timers)', async () => {
			vi.useFakeTimers();
			try {
				const chat = await createTestChatWithModerator('timer-kill-test');
				await addParticipant(chat.id, 'SlowAgent', 'claude-code');

				const emitSpy = vi.fn();
				groupChatEmitters.emitParticipantState = emitSpy;
				groupChatEmitters.emitMessage = vi.fn();

				await routeModeratorResponse(
					chat.id,
					'@SlowAgent do something',
					mockProcessManager,
					mockAgentDetector,
					false
				);

				// Capture the session ID that routeModeratorResponse generated
				const sessionId = getParticipantSessionId(chat.id, 'SlowAgent');
				expect(sessionId).toBeDefined();

				// Advance past the 30-minute timeout.
				// The ordering-race fix ensures session-resolve + guard-add + kill + emit
				// all execute synchronously before any await, so advanceTimersByTime works.
				vi.advanceTimersByTime(30 * 60 * 1000 + 100);

				// kill() was called with the correct session ID
				expect(mockProcessManager.kill).toHaveBeenCalledWith(sessionId);

				// Guard was set — isParticipantTimedOut returns true for the session
				expect(isParticipantTimedOut(sessionId!)).toBe(true);

				// 'timed-out' was emitted (not 'idle')
				const timedOutEmits = emitSpy.mock.calls.filter(
					(c: unknown[]) => c[1] === 'SlowAgent' && c[2] === 'timed-out'
				);
				expect(timedOutEmits).toHaveLength(1);

				// clearActiveParticipantSession was called — session is gone
				expect(getParticipantSessionId(chat.id, 'SlowAgent')).toBeUndefined();

				// Cleanup: consume the guard so it doesn't leak into other tests
				clearTimedOutParticipant(sessionId!);
			} finally {
				vi.useRealTimers();
			}
		});

		it('participant responds before timeout → no kill, no timed-out', async () => {
			vi.useFakeTimers();
			try {
				const chat = await createTestChatWithModerator('no-timeout-test');
				await addParticipant(chat.id, 'FastAgent', 'claude-code');

				const emitSpy = vi.fn();
				groupChatEmitters.emitParticipantState = emitSpy;
				groupChatEmitters.emitMessage = vi.fn();

				await routeModeratorResponse(
					chat.id,
					'@FastAgent do something quick',
					mockProcessManager,
					mockAgentDetector,
					false
				);

				const sessionId = getParticipantSessionId(chat.id, 'FastAgent');

				// Simulate the agent responding before timeout (routeAgentResponse logs
				// the response; markParticipantResponded clears the pending entry and
				// cancels the timeout — mirroring what the exit-listener does)
				await routeAgentResponse(chat.id, 'FastAgent', 'Done!', mockProcessManager);
				markParticipantResponded(chat.id, 'FastAgent');

				// Clear kill mock to isolate timeout behavior
				mockProcessManager.kill.mockClear();

				// Advance past the timeout — should be a no-op (already responded)
				vi.advanceTimersByTime(30 * 60 * 1000 + 100);

				expect(mockProcessManager.kill).not.toHaveBeenCalled();
				expect(isParticipantTimedOut(sessionId!)).toBe(false);

				const timedOutEmits = emitSpy.mock.calls.filter(
					(c: unknown[]) => c[1] === 'FastAgent' && c[2] === 'timed-out'
				);
				expect(timedOutEmits).toHaveLength(0);
			} finally {
				vi.useRealTimers();
			}
		});

		it('last participant timeout: mark-responded runs AFTER log write (multi-timeout-safe)', async () => {
			vi.useFakeTimers();
			try {
				const chat = await createTestChatWithModerator('synth-timeout-test');
				await addParticipant(chat.id, 'OnlyAgent', 'claude-code');

				groupChatEmitters.emitParticipantState = vi.fn();
				groupChatEmitters.emitMessage = vi.fn();
				groupChatEmitters.emitStateChange = vi.fn();

				await routeModeratorResponse(
					chat.id,
					'@OnlyAgent analyze everything',
					mockProcessManager,
					mockAgentDetector,
					false
				);

				const sessionId = getParticipantSessionId(chat.id, 'OnlyAgent');

				vi.advanceTimersByTime(30 * 60 * 1000 + 100);

				// Sync block runs immediately: kill + guard + timed-out emit
				expect(mockProcessManager.kill).toHaveBeenCalledWith(sessionId);
				expect(isParticipantTimedOut(sessionId!)).toBe(true);
				expect(groupChatEmitters.emitParticipantState).toHaveBeenCalledWith(
					chat.id,
					'OnlyAgent',
					'timed-out'
				);

				// DESIGN INVARIANT: markParticipantResponded is now AFTER the
				// async log writes (not synchronous). This means OnlyAgent is
				// still in the pending set at this point — the timeout handler's
				// async continuation hasn't run yet. This proves the multi-timeout
				// ordering fix: synthesis can't trigger until the log write completes.
				const stillPending = markParticipantResponded(chat.id, 'OnlyAgent');
				// stillPending = true means OnlyAgent WAS still in the pending set
				// (markParticipantResponded hadn't been called yet by the handler)
				expect(stillPending).toBe(true);

				// The exit-listener early-return (tested in exit-listener.test.ts)
				// guarantees no single-session race: timed-out sessions skip the
				// listener's mark-and-synthesize path entirely.

				clearTimedOutParticipant(sessionId!);
			} finally {
				vi.useRealTimers();
			}
		});

		it('consume-on-exit: guard insert→check→consume lifecycle proven end-to-end', async () => {
			vi.useFakeTimers();
			try {
				const chat = await createTestChatWithModerator('consume-test');
				await addParticipant(chat.id, 'ConsumeAgent', 'claude-code');

				const participantStates: Array<[string, string]> = [];
				groupChatEmitters.emitParticipantState = vi.fn(
					(_gid: string, name: string, state: string) => {
						participantStates.push([name, state]);
					}
				);
				groupChatEmitters.emitMessage = vi.fn();

				await routeModeratorResponse(
					chat.id,
					'@ConsumeAgent do work',
					mockProcessManager,
					mockAgentDetector,
					false
				);

				const sessionId = getParticipantSessionId(chat.id, 'ConsumeAgent')!;

				// Before timeout: guard is empty
				expect(isParticipantTimedOut(sessionId)).toBe(false);

				// Fire the timeout — sync block: guard-add + kill + emit 'timed-out'
				vi.advanceTimersByTime(30 * 60 * 1000 + 100);

				// INSERT proven: guard is now set with real sessionId
				expect(isParticipantTimedOut(sessionId)).toBe(true);

				// CHECK proven: calling isParticipantTimedOut returns true
				// (this is what the exit-listener calls at exit-listener.ts:282)
				expect(isParticipantTimedOut(sessionId)).toBe(true);

				// CONSUME proven: clearTimedOutParticipant removes the entry
				// (this is what the exit-listener calls at exit-listener.ts:286)
				clearTimedOutParticipant(sessionId);
				expect(isParticipantTimedOut(sessionId)).toBe(false);

				// No 'idle' was emitted for ConsumeAgent after 'timed-out'
				const timedOutIdx = participantStates.findIndex(
					([n, s]) => n === 'ConsumeAgent' && s === 'timed-out'
				);
				expect(timedOutIdx).toBeGreaterThanOrEqual(0);
				const afterTimeout = participantStates.slice(timedOutIdx + 1);
				const idleAfter = afterTimeout.filter(([n, s]) => n === 'ConsumeAgent' && s === 'idle');
				expect(idleAfter).toHaveLength(0);
			} finally {
				vi.useRealTimers();
			}
		});
	});

	describe('participant stall watchdog', () => {
		const STALL_MS = 4 * 60 * 1000;

		it('kills a participant that produces no stdout within the watchdog window', async () => {
			vi.useFakeTimers();
			try {
				const chat = await createTestChatWithModerator('stall-kill-test');
				await addParticipant(chat.id, 'SilentAgent', 'claude-code');

				const emitSpy = vi.fn();
				groupChatEmitters.emitParticipantState = emitSpy;
				groupChatEmitters.emitMessage = vi.fn();

				await routeModeratorResponse(
					chat.id,
					'@SilentAgent do something',
					mockProcessManager,
					mockAgentDetector,
					false
				);

				const sessionId = getParticipantSessionId(chat.id, 'SilentAgent');
				expect(sessionId).toBeDefined();

				// Advance past the stall watchdog (well short of the 30-minute timeout)
				vi.advanceTimersByTime(STALL_MS + 100);

				expect(mockProcessManager.kill).toHaveBeenCalledWith(sessionId);
				expect(isParticipantTimedOut(sessionId!)).toBe(true);
				const timedOutEmits = emitSpy.mock.calls.filter(
					(c: unknown[]) => c[1] === 'SilentAgent' && c[2] === 'timed-out'
				);
				expect(timedOutEmits).toHaveLength(1);

				clearTimedOutParticipant(sessionId!);
			} finally {
				vi.useRealTimers();
			}
		});

		it('stdout activity disarms the watchdog; the 30-minute timeout still applies', async () => {
			vi.useFakeTimers();
			try {
				const chat = await createTestChatWithModerator('stall-disarm-test');
				await addParticipant(chat.id, 'BusyAgent', 'claude-code');

				const emitSpy = vi.fn();
				groupChatEmitters.emitParticipantState = emitSpy;
				groupChatEmitters.emitMessage = vi.fn();

				await routeModeratorResponse(
					chat.id,
					'@BusyAgent do something long',
					mockProcessManager,
					mockAgentDetector,
					false
				);

				const sessionId = getParticipantSessionId(chat.id, 'BusyAgent')!;

				// First stdout chunk arrives - disarms the watchdog
				noteParticipantStdoutActivity(sessionId);
				mockProcessManager.kill.mockClear();

				vi.advanceTimersByTime(STALL_MS + 100);
				expect(mockProcessManager.kill).not.toHaveBeenCalled();
				expect(isParticipantTimedOut(sessionId)).toBe(false);

				// The full response timeout still protects against hangs after output
				vi.advanceTimersByTime(26 * 60 * 1000);
				expect(mockProcessManager.kill).toHaveBeenCalledWith(sessionId);
				expect(isParticipantTimedOut(sessionId)).toBe(true);

				clearTimedOutParticipant(sessionId);
			} finally {
				vi.useRealTimers();
			}
		});

		it('participant response clears the watchdog (no late kill)', async () => {
			vi.useFakeTimers();
			try {
				const chat = await createTestChatWithModerator('stall-responded-test');
				await addParticipant(chat.id, 'QuickAgent', 'claude-code');

				groupChatEmitters.emitParticipantState = vi.fn();
				groupChatEmitters.emitMessage = vi.fn();

				await routeModeratorResponse(
					chat.id,
					'@QuickAgent do something quick',
					mockProcessManager,
					mockAgentDetector,
					false
				);

				const sessionId = getParticipantSessionId(chat.id, 'QuickAgent')!;

				// Simulate the exit-listener marking the participant as responded
				markParticipantResponded(chat.id, 'QuickAgent');
				mockProcessManager.kill.mockClear();

				vi.advanceTimersByTime(STALL_MS + 100);
				expect(mockProcessManager.kill).not.toHaveBeenCalled();
				expect(isParticipantTimedOut(sessionId)).toBe(false);
			} finally {
				vi.useRealTimers();
			}
		});
	});

	describe('respawn cooldown after force-complete', () => {
		const STALL_MS = 4 * 60 * 1000;

		function participantSpawnCalls(name: string) {
			return (mockProcessManager.spawn as ReturnType<typeof vi.fn>).mock.calls.filter((c: any[]) =>
				String(c[0]?.sessionId ?? '').includes(`-participant-${name}-`)
			);
		}

		/** Spawn a participant via moderator delegation under fake timers and fire
		 *  the stall watchdog, then let the async force-complete tail settle. */
		async function spawnAndForceComplete(chatId: string, name: string) {
			vi.useFakeTimers();
			let sessionId: string | undefined;
			try {
				await routeModeratorResponse(
					chatId,
					`@${name} do something`,
					mockProcessManager,
					mockAgentDetector,
					false
				);
				sessionId = getParticipantSessionId(chatId, name);
				vi.advanceTimersByTime(STALL_MS + 100);
			} finally {
				vi.useRealTimers();
			}
			// Let the force-complete async tail (log write + mark-responded) settle
			await new Promise((r) => setTimeout(r, 50));
			if (sessionId) clearTimedOutParticipant(sessionId);
		}

		it('moderator failure report cannot immediately respawn a force-completed participant', async () => {
			const chat = await createTestChatWithModerator('cooldown-suppress-test');
			await addParticipant(chat.id, 'LoopAgent', 'claude-code');

			groupChatEmitters.emitParticipantState = vi.fn();
			const emitMessage = vi.fn();
			groupChatEmitters.emitMessage = emitMessage;

			await spawnAndForceComplete(chat.id, 'LoopAgent');
			expect(participantSpawnCalls('LoopAgent')).toHaveLength(1);

			// Moderator's failure report mentions the dead participant - must NOT respawn
			(mockProcessManager.spawn as ReturnType<typeof vi.fn>).mockClear();
			await routeModeratorResponse(
				chat.id,
				'@LoopAgent timed out with no response - the session link is not live.',
				mockProcessManager,
				mockAgentDetector,
				false
			);
			expect(participantSpawnCalls('LoopAgent')).toHaveLength(0);
			const infoMessages = emitMessage.mock.calls.filter((c: any[]) =>
				String(c[1]?.content ?? '').includes('was not re-engaged automatically')
			);
			expect(infoMessages).toHaveLength(1);

			// The cooldown is one-shot: the NEXT moderator response may delegate again
			(mockProcessManager.spawn as ReturnType<typeof vi.fn>).mockClear();
			await routeModeratorResponse(
				chat.id,
				'@LoopAgent please try again',
				mockProcessManager,
				mockAgentDetector,
				false
			);
			expect(participantSpawnCalls('LoopAgent')).toHaveLength(1);

			// Cleanup: clear pending state + timers from the respawn
			markParticipantResponded(chat.id, 'LoopAgent');
		});

		it('a new user message clears the respawn cooldown', async () => {
			const chat = await createTestChatWithModerator('cooldown-user-reset-test');
			await addParticipant(chat.id, 'RetryAgent', 'claude-code');

			groupChatEmitters.emitParticipantState = vi.fn();
			groupChatEmitters.emitMessage = vi.fn();

			await spawnAndForceComplete(chat.id, 'RetryAgent');

			// User explicitly re-engages - this clears the cooldown...
			await routeUserMessage(chat.id, 'retry @RetryAgent', mockProcessManager, mockAgentDetector);

			// ...so the moderator's next delegation spawns normally
			(mockProcessManager.spawn as ReturnType<typeof vi.fn>).mockClear();
			await routeModeratorResponse(
				chat.id,
				'@RetryAgent retrying now',
				mockProcessManager,
				mockAgentDetector,
				false
			);
			expect(participantSpawnCalls('RetryAgent')).toHaveLength(1);

			// Cleanup: clear pending state + timers from the respawn
			markParticipantResponded(chat.id, 'RetryAgent');
		});
	});
});
