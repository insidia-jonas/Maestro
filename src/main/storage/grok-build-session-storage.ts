/**
 * Grok Build Session Storage Implementation
 *
 * This module implements the AgentSessionStorage interface for Grok Build.
 * Grok Build stores sessions in directory-named folders in ~/.grok/sessions/
 *
 * Directory structure:
 * - ~/.grok/sessions/<encoded-project-path>/<session-id>/
 * - summary.json — Session metadata (summary, created_at, updated_at)
 * - chat_history.jsonl — Full conversation history
 *
 * Encoded project path is URL-encoded (e.g., /home/rto/maestro-dev -> %2Fhome%2Frto%2Fmaestro-dev)
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

const LOG_CONTEXT = '[GrokBuildSessionStorage]';

// ---------------------------------------------------------------------------
// Grok session types
// ---------------------------------------------------------------------------

interface GrokSummaryJson {
	info: {
		id: string;
		cwd: string;
	};
	session_summary: string;
	created_at: string;
	updated_at: string;
	num_messages: number;
	num_chat_messages: number;
	current_model_id: string;
	agent_name?: string;
}

interface GrokChatEntry {
	type: 'user' | 'assistant' | 'reasoning' | 'system' | 'thought' | 'tool_call' | 'tool_result';
	content?: string | any[];
	text?: string;
	data?: string;
	timestamp?: string;
	id?: string;
	tool_calls?: any[];
	summary?: any[];
}

// ---------------------------------------------------------------------------
// Storage implementation
// ---------------------------------------------------------------------------

export class GrokBuildSessionStorage extends BaseSessionStorage {
	readonly agentId: ToolType = 'grok-build';

	private getGrokSessionsDir(): string {
		return path.join(os.homedir(), '.grok', 'sessions');
	}

	private getProjectDir(projectPath: string): string {
		const encodedPath = encodeURIComponent(path.resolve(projectPath));
		return path.join(this.getGrokSessionsDir(), encodedPath);
	}

	async listSessions(
		projectPath: string,
		_sshConfig?: SshRemoteConfig
	): Promise<AgentSessionInfo[]> {
		const projectDir = this.getProjectDir(projectPath);

		let sessionDirs: string[];
		try {
			const entries = await fs.readdir(projectDir, { withFileTypes: true });
			sessionDirs = entries
				.filter((e) => e.isDirectory() && e.name !== 'prompt_history.jsonl')
				.map((e) => e.name);
		} catch {
			return [];
		}

		const sessions: AgentSessionInfo[] = [];

		for (const sessionId of sessionDirs) {
			try {
				const sessionPath = path.join(projectDir, sessionId);
				const summaryPath = path.join(sessionPath, 'summary.json');
				const summaryContent = await fs.readFile(summaryPath, 'utf-8');
				const summary: GrokSummaryJson = JSON.parse(summaryContent);

				const stat = await fs.stat(summaryPath);

				sessions.push({
					sessionId: summary.info.id,
					projectPath,
					timestamp: summary.created_at,
					modifiedAt: summary.updated_at,
					firstMessage: summary.session_summary || `Grok session ${sessionId.substring(0, 8)}`,
					messageCount: summary.num_chat_messages || 0,
					sizeBytes: stat.size,
					inputTokens: 0, // Grok doesn't provide tokens in summary
					outputTokens: 0,
					cacheReadTokens: 0,
					cacheCreationTokens: 0,
					durationSeconds: 0, // TBD: calculate from timestamps
				});
			} catch (err) {
				logger.debug(`Failed to parse Grok session metadata for ${sessionId}: ${err}`, LOG_CONTEXT);
			}
		}

		// Sort by updated_at (newest first)
		return sessions.sort(
			(a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()
		);
	}

	async readSessionMessages(
		projectPath: string,
		sessionId: string,
		options?: SessionReadOptions,
		_sshConfig?: SshRemoteConfig
	): Promise<SessionMessagesResult> {
		const projectDir = this.getProjectDir(projectPath);
		const historyPath = path.join(projectDir, sessionId, 'chat_history.jsonl');

		let content: string;
		try {
			content = await fs.readFile(historyPath, 'utf-8');
		} catch {
			return { messages: [], total: 0, hasMore: false };
		}

		const lines = content.split('\n').filter((l) => l.trim());
		const messages: SessionMessage[] = [];

		for (const line of lines) {
			try {
				const entry: GrokChatEntry = JSON.parse(line);

				if (entry.type === 'user') {
					let textContent = '';
					if (typeof entry.content === 'string') {
						textContent = entry.content;
					} else if (Array.isArray(entry.content)) {
						textContent = entry.content
							.filter((c) => c.type === 'text')
							.map((c) => c.text || '')
							.join('\n');
					}

					// Skip context context if needed, but Grok's user query is usually at the end of the content
					// For now we just take the whole thing.
					messages.push({
						type: 'user',
						role: 'user',
						content: textContent,
						timestamp: entry.timestamp || new Date().toISOString(),
						uuid: entry.id || sessionId + '-' + messages.length,
					});
				} else if (entry.type === 'assistant') {
					messages.push({
						type: 'assistant',
						role: 'assistant',
						content: (entry.content as string) || entry.text || '',
						timestamp: entry.timestamp || new Date().toISOString(),
						uuid: entry.id || sessionId + '-' + messages.length,
						toolUse: entry.tool_calls,
					});
				} else if (entry.type === 'reasoning') {
					// Reasoning in Grok is often a separate message.
					// We can append it to the last assistant message or show it as its own.
					// Maestro typically prefers reasoning inside the assistant message.
					const lastMsg = messages[messages.length - 1];
					// const reasoningText = entry.summary
					//	? entry.summary.map((s) => s.text).join('\n')
					//	: '';

					if (lastMsg && lastMsg.role === 'assistant') {
						// For now, we don't have a standard "reasoning" field in SessionMessage
						// so we just skip it or log it.
					}
				}
			} catch {
				continue;
			}
		}

		return BaseSessionStorage.applyMessagePagination(messages, options);
	}

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

	getSessionPath(
		projectPath: string,
		sessionId: string,
		_sshConfig?: SshRemoteConfig
	): string | null {
		const projectDir = this.getProjectDir(projectPath);
		return path.join(projectDir, sessionId);
	}

	async deleteMessagePair(
		_projectPath: string,
		_sessionId: string,
		_userMessageUuid: string,
		_fallbackContent?: string,
		_sshConfig?: SshRemoteConfig
	): Promise<{ success: boolean; error?: string; linesRemoved?: number }> {
		return {
			success: false,
			error: 'Grok Build does not support message deletion (complex directory structure)',
		};
	}
}
