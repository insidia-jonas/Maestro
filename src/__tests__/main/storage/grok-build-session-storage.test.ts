import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GrokBuildSessionStorage } from '../../../main/storage/grok-build-session-storage';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

// Mock logger
vi.mock('../../../main/utils/logger', () => ({
	logger: {
		info: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

// Mock fs/promises
vi.mock('fs/promises', () => ({
	default: {
		readdir: vi.fn(),
		readFile: vi.fn(),
		stat: vi.fn(),
	},
}));

describe('GrokBuildSessionStorage', () => {
	let storage: GrokBuildSessionStorage;
	const projectPath = '/home/rto/maestro-dev';

	beforeEach(() => {
		vi.clearAllMocks();
		storage = new GrokBuildSessionStorage();
	});

	describe('listSessions', () => {
		it('should list sessions from grok sessions directory', async () => {
			const sessionId = '019e8efc-5d61-7711-b906-89427269bab4';
			const summary = {
				info: { id: sessionId, cwd: projectPath },
				session_summary: 'Test Session',
				created_at: '2026-06-03T19:36:04Z',
				updated_at: '2026-06-04T14:53:49Z',
				num_chat_messages: 5,
			};

			vi.mocked(fs.readdir).mockResolvedValue([
				{ name: sessionId, isDirectory: () => true } as any,
			]);
			vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(summary));
			vi.mocked(fs.stat).mockResolvedValue({ size: 1234 } as any);

			const sessions = await storage.listSessions(projectPath);

			expect(sessions).toHaveLength(1);
			expect(sessions[0].sessionId).toBe(sessionId);
			expect(sessions[0].firstMessage).toBe('Test Session');
			expect(sessions[0].messageCount).toBe(5);
		});

		it('should return empty array if directory does not exist', async () => {
			vi.mocked(fs.readdir).mockRejectedValue(new Error('Not found'));

			const sessions = await storage.listSessions(projectPath);
			expect(sessions).toEqual([]);
		});
	});

	describe('readSessionMessages', () => {
		it('should read messages from chat_history.jsonl', async () => {
			const sessionId = 'session-123';
			const history = [
				JSON.stringify({ type: 'user', content: 'hello', timestamp: '2026-06-03T19:36:04Z' }),
				JSON.stringify({
					type: 'assistant',
					content: 'hi there',
					timestamp: '2026-06-03T19:36:05Z',
				}),
			].join('\n');

			vi.mocked(fs.readFile).mockResolvedValue(history);

			const result = await storage.readSessionMessages(projectPath, sessionId);

			expect(result.messages).toHaveLength(2);
			expect(result.messages[0].role).toBe('user');
			expect(result.messages[0].content).toBe('hello');
			expect(result.messages[1].role).toBe('assistant');
			expect(result.messages[1].content).toBe('hi there');
		});

		it('should handle complex user content', async () => {
			const sessionId = 'session-123';
			const history = JSON.stringify({
				type: 'user',
				content: [{ type: 'text', text: 'complex hello' }],
				timestamp: '2026-06-03T19:36:04Z',
			});

			vi.mocked(fs.readFile).mockResolvedValue(history);

			const result = await storage.readSessionMessages(projectPath, sessionId);

			expect(result.messages).toHaveLength(1);
			expect(result.messages[0].content).toBe('complex hello');
		});
	});
});
