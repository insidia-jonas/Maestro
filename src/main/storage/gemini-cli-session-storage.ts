/**
 * Gemini CLI Session Storage Implementation
 *
 * This module implements the AgentSessionStorage interface for Gemini CLI.
 * Gemini CLI stores sessions as JSONL files in ~/.gemini/tmp/<project>/chats/
 *
 * Directory structure:
 * - ~/.gemini/history/<project-name>/.project_root — Contains the absolute project path
 * - ~/.gemini/tmp/<project-name>/chats/session-<date>-<uuid>.jsonl — Session history
 *
 * Project name is the basename of the project directory (e.g., "maestro-dev").
 *
 * JSONL format:
 * - Line 1: {"sessionId":"...","projectHash":"...","startTime":"...","lastUpdated":"...","kind":"main"}
 * - User messages: {"id":"...","timestamp":"...","type":"user","content":[{"text":"..."}]}
 * - Gemini responses: {"id":"...","timestamp":"...","type":"gemini","content":"...","thoughts":[...],"tokens":{...},"model":"..."}
 * - Metadata updates: {"$set":{"summary":"...","lastUpdated":"...",...}}
 *
 * Verified against Gemini CLI v0.44.1 session files (2026-06-02)
 */

import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { logger } from '../utils/logger';
import { BaseSessionStorage, type SearchableMessage } from './base-session-storage';
import type {
	AgentSessionInfo,
	SessionMessagesResult,
	SessionReadOptions,
	SessionMessage,
} from '../agents';
import type { ToolType, SshRemoteConfig } from '../../shared/types';

const LOG_CONTEXT = '[GeminiCliSessionStorage]';

// ---------------------------------------------------------------------------
// Gemini session JSONL types
// ---------------------------------------------------------------------------

/** Header line — first line of every session file */
interface GeminiSessionHeader {
	sessionId: string;
	projectHash?: string;
	startTime: string;
	lastUpdated: string;
	kind?: string;
}

/** User message entry */
interface GeminiUserMessage {
	id: string;
	timestamp: string;
	type: 'user';
	content: Array<{ text: string }>;
}

/** Gemini (assistant) message entry */
interface GeminiAssistantMessage {
	id: string;
	timestamp: string;
	type: 'gemini';
	content: string;
	thoughts?: Array<{ subject?: string; description?: string; timestamp?: string }>;
	tokens?: {
		input?: number;
		output?: number;
		cached?: number;
		thoughts?: number;
		tool?: number;
		total?: number;
	};
	model?: string;
}

/** Metadata $set update */
interface GeminiSetUpdate {
	$set: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getGeminiBaseDir(): string {
	return path.join(os.homedir(), '.gemini');
}

/**
 * Resolve the project directory name used by Gemini CLI.
 * Gemini uses the basename of the project path as the directory name
 * in both ~/.gemini/history/ and ~/.gemini/tmp/.
 */
function resolveProjectName(projectPath: string): string {
	return path.basename(path.resolve(projectPath));
}

function isSessionHeader(obj: unknown): obj is GeminiSessionHeader {
	if (typeof obj !== 'object' || obj === null) return false;
	const o = obj as Record<string, unknown>;
	return typeof o.sessionId === 'string' && typeof o.startTime === 'string';
}

function isUserMessage(obj: unknown): obj is GeminiUserMessage {
	if (typeof obj !== 'object' || obj === null) return false;
	const o = obj as Record<string, unknown>;
	return o.type === 'user' && typeof o.id === 'string' && Array.isArray(o.content);
}

function isAssistantMessage(obj: unknown): obj is GeminiAssistantMessage {
	if (typeof obj !== 'object' || obj === null) return false;
	const o = obj as Record<string, unknown>;
	return o.type === 'gemini' && typeof o.id === 'string';
}

function isSetUpdate(obj: unknown): obj is GeminiSetUpdate {
	if (typeof obj !== 'object' || obj === null) return false;
	return '$set' in obj;
}

// ---------------------------------------------------------------------------
// Storage implementation
// ---------------------------------------------------------------------------

export class GeminiCliSessionStorage extends BaseSessionStorage {
	readonly agentId: ToolType = 'gemini-cli';

	/**
	 * List all Gemini CLI sessions for a project.
	 */
	async listSessions(
		projectPath: string,
		_sshConfig?: SshRemoteConfig
	): Promise<AgentSessionInfo[]> {
		const projectName = resolveProjectName(projectPath);
		const chatsDir = path.join(getGeminiBaseDir(), 'tmp', projectName, 'chats');

		let files: string[];
		try {
			files = await fs.readdir(chatsDir);
		} catch {
			return [];
		}

		const sessionFiles = files
			.filter((f) => f.startsWith('session-') && f.endsWith('.jsonl'))
			.sort()
			.reverse(); // Most recent first

		const sessions: AgentSessionInfo[] = [];

		for (const file of sessionFiles) {
			try {
				const filePath = path.join(chatsDir, file);
				const content = await fs.readFile(filePath, 'utf-8');
				const lines = content.split('\n').filter((l) => l.trim());
				const firstLine = lines[0];
				if (!firstLine) continue;

				const header = JSON.parse(firstLine);
				if (!isSessionHeader(header)) continue;

				// Extract summary and first user message from lines
				let summary = '';
				let firstMessage = '';
				let messageCount = 0;
				let totalInputTokens = 0;
				let totalOutputTokens = 0;
				let totalCacheReadTokens = 0;

				for (const line of lines) {
					try {
						const parsed = JSON.parse(line);
						if (isSetUpdate(parsed) && typeof parsed.$set.summary === 'string') {
							summary = parsed.$set.summary;
						}
						if (isUserMessage(parsed)) {
							messageCount++;
							const text = parsed.content
								.map((c) => c.text || '')
								.join('\n')
								.trim();
							if (!firstMessage && !text.startsWith('<session_context>')) {
								firstMessage = text;
							}
						}
						if (isAssistantMessage(parsed)) {
							messageCount++;
							if (parsed.tokens) {
								totalInputTokens += parsed.tokens.input || 0;
								totalOutputTokens += parsed.tokens.output || 0;
								totalCacheReadTokens += parsed.tokens.cached || 0;
							}
						}
					} catch {
						continue;
					}
				}

				// Strip the "Summary (max 80 chars): " prefix Gemini adds
				summary = summary.replace(/^Summary \(max \d+ chars\):\s*/i, '');

				const stat = await fs.stat(filePath);
				const startMs = new Date(header.startTime).getTime();
				const endMs = new Date(header.lastUpdated).getTime();

				sessions.push({
					sessionId: header.sessionId,
					projectPath,
					timestamp: header.startTime,
					modifiedAt: header.lastUpdated,
					firstMessage:
						summary || firstMessage || `Gemini session ${header.sessionId.substring(0, 8)}`,
					messageCount,
					sizeBytes: stat.size,
					inputTokens: totalInputTokens,
					outputTokens: totalOutputTokens,
					cacheReadTokens: totalCacheReadTokens,
					cacheCreationTokens: 0,
					durationSeconds: Math.max(0, Math.round((endMs - startMs) / 1000)),
				});
			} catch (err) {
				logger.debug(`Failed to parse Gemini session file ${file}: ${err}`, LOG_CONTEXT);
			}
		}

		return sessions;
	}

	/**
	 * Read messages from a Gemini CLI session.
	 */
	async readSessionMessages(
		projectPath: string,
		sessionId: string,
		options?: SessionReadOptions,
		_sshConfig?: SshRemoteConfig
	): Promise<SessionMessagesResult> {
		const filePath = await this.findSessionFile(projectPath, sessionId);
		if (!filePath) {
			return { messages: [], total: 0, hasMore: false };
		}

		let content: string;
		try {
			content = await fs.readFile(filePath, 'utf-8');
		} catch {
			return { messages: [], total: 0, hasMore: false };
		}

		const messages: SessionMessage[] = [];
		const lines = content.split('\n');

		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const parsed = JSON.parse(line);

				if (isUserMessage(parsed)) {
					const text = parsed.content
						.map((c) => c.text || '')
						.join('\n')
						.trim();

					// Skip the initial session_context system message
					if (text.startsWith('<session_context>')) continue;

					messages.push({
						type: 'user',
						role: 'user',
						content: text,
						timestamp: parsed.timestamp,
						uuid: parsed.id,
					});
				} else if (isAssistantMessage(parsed)) {
					messages.push({
						type: 'assistant',
						role: 'assistant',
						content: parsed.content || '',
						timestamp: parsed.timestamp,
						uuid: parsed.id,
					});
				}
			} catch {
				continue;
			}
		}

		// Apply pagination if requested
		return BaseSessionStorage.applyMessagePagination(messages, options);
	}

	/**
	 * Get the file path for a session.
	 */
	getSessionPath(
		projectPath: string,
		_sessionId: string,
		_sshConfig?: SshRemoteConfig
	): string | null {
		// Return the expected directory — exact file requires async lookup
		const projectName = resolveProjectName(projectPath);
		return path.join(getGeminiBaseDir(), 'tmp', projectName, 'chats');
	}

	/**
	 * Delete a user message and its corresponding assistant response.
	 * Not supported by Gemini CLI — its JSONL uses append-only $set updates.
	 */
	async deleteMessagePair(
		_projectPath: string,
		_sessionId: string,
		_userMessageUuid: string,
		_fallbackContent?: string,
		_sshConfig?: SshRemoteConfig
	): Promise<{ success: boolean; error?: string; linesRemoved?: number }> {
		return {
			success: false,
			error: 'Gemini CLI does not support message deletion (append-only JSONL format)',
		};
	}

	/**
	 * Get searchable messages for full-text search.
	 */
	protected async getSearchableMessages(
		sessionId: string,
		projectPath: string,
		_sshConfig?: SshRemoteConfig
	): Promise<SearchableMessage[]> {
		const result = await this.readSessionMessages(projectPath, sessionId);
		return result.messages.map((m) => ({
			role: m.role as 'user' | 'assistant',
			textContent: m.content || '',
		}));
	}

	// -----------------------------------------------------------------------
	// Private helpers
	// -----------------------------------------------------------------------

	/**
	 * Find the session JSONL file matching a session UUID.
	 * Scans the chats directory for a file whose header contains the session ID.
	 */
	private async findSessionFile(projectPath: string, sessionId: string): Promise<string | null> {
		const projectName = resolveProjectName(projectPath);
		const chatsDir = path.join(getGeminiBaseDir(), 'tmp', projectName, 'chats');

		let files: string[];
		try {
			files = await fs.readdir(chatsDir);
		} catch {
			return null;
		}

		// Fast path: check if the short UUID prefix is in the filename
		const shortId = sessionId.substring(0, 8);
		const directMatch = files.find((f) => f.includes(shortId) && f.endsWith('.jsonl'));
		if (directMatch) {
			return path.join(chatsDir, directMatch);
		}

		// Slow path: scan headers
		for (const file of files) {
			if (!file.endsWith('.jsonl')) continue;
			try {
				const filePath = path.join(chatsDir, file);
				const fileContent = await fs.readFile(filePath, 'utf-8');
				const firstLine = fileContent.split('\n')[0]?.trim();
				if (!firstLine) continue;
				const header = JSON.parse(firstLine);
				if (isSessionHeader(header) && header.sessionId === sessionId) {
					return filePath;
				}
			} catch {
				continue;
			}
		}

		return null;
	}
}
