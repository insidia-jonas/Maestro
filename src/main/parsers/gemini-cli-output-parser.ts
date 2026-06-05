/**
 * Gemini CLI Output Parser
 *
 * Parses JSON output from Gemini CLI (`gemini -p "..." --output-format stream-json`).
 *
 * Gemini CLI outputs JSONL with the following format:
 *
 * 1. Init event:
 *    {"type":"init","timestamp":"...","session_id":"...","model":"auto"}
 *
 * 2. User message echo:
 *    {"type":"message","timestamp":"...","role":"user","content":"..."}
 *
 * 3. Assistant message (streaming delta):
 *    {"type":"message","timestamp":"...","role":"assistant","content":"...","delta":true}
 *
 * 4. Result event:
 *    {"type":"result","timestamp":"...","status":"success","stats":{
 *      "total_tokens":...,"input_tokens":...,"output_tokens":...,"cached":...,
 *      "input":...,"duration_ms":...,"tool_calls":...,
 *      "models":{"model-name":{"total_tokens":...,"input_tokens":...,"output_tokens":...}}
 *    }}
 *
 * Verified against Gemini CLI v0.44.1 (2026-06-02)
 */

import type { ToolType, AgentError } from '../../shared/types';
import type { AgentOutputParser, ParsedEvent } from './agent-output-parser';
import { getErrorPatterns, matchErrorPattern } from './error-patterns';

/**
 * Raw event structure from Gemini CLI stream-json output
 */
interface GeminiStreamEvent {
	type: 'init' | 'message' | 'result' | 'tool_use' | 'tool_result' | 'tool_error';
	timestamp?: string;
	// Init fields
	session_id?: string;
	model?: string;
	// Message fields
	role?: 'user' | 'assistant';
	content?: string;
	delta?: boolean;
	// Result fields
	status?: string;
	stats?: {
		total_tokens?: number;
		input_tokens?: number;
		output_tokens?: number;
		cached?: number;
		input?: number;
		duration_ms?: number;
		tool_calls?: number;
		models?: Record<
			string,
			{
				total_tokens?: number;
				input_tokens?: number;
				output_tokens?: number;
				cached?: number;
				input?: number;
			}
		>;
	};
}

/**
 * Type guard for Gemini stream events
 */
function isGeminiStreamEvent(data: unknown): data is GeminiStreamEvent {
	if (typeof data !== 'object' || data === null) return false;
	const obj = data as Record<string, unknown>;
	return (
		typeof obj.type === 'string' &&
		['init', 'message', 'result', 'tool_use', 'tool_result', 'tool_error'].includes(obj.type)
	);
}

/**
 * Gemini CLI Output Parser Implementation
 *
 * Transforms Gemini CLI's stream-json format into normalized ParsedEvents.
 */
export class GeminiCliOutputParser implements AgentOutputParser {
	readonly agentId: ToolType = 'gemini-cli';

	/**
	 * Parse a single JSON line from Gemini CLI output.
	 * Delegates to parseJsonObject after JSON.parse.
	 */
	parseJsonLine(line: string): ParsedEvent | null {
		if (!line.trim()) return null;

		// Suppress YOLO mode warnings and other non-JSON noise from Gemini CLI
		if (line.includes('YOLO mode is enabled')) {
			return { type: 'system', raw: line };
		}

		// Intercept Gaxios/retry error dumps which can be massive and contain the full prompt
		if (
			line.includes('Attempt') &&
			line.includes('failed with status') &&
			(line.includes('429') || line.includes('503'))
		) {
			// Emit a system error instead of just text, which will trigger the error handler and allow Maestro to kill the hanging retry loop.
			return {
				type: 'system',
				raw: {
					errorLine: line,
					forceError: true,
					message: 'Gemini API rate limit hit. Process hanging in retry loop.',
				},
			};
		}

		if (line.includes('_GaxiosError') || line.includes('rateLimitExceeded')) {
			return { type: 'system', raw: line };
		}

		try {
			const parsed: unknown = JSON.parse(line);
			return (
				this.parseJsonObject(parsed) ?? {
					type: 'system' as const,
					raw: parsed,
				}
			);
		} catch {
			const trimmed = line.trim();
			if (trimmed) {
				// Suppress lines that look like part of a Node.js error dump
				if (
					trimmed.startsWith('at ') ||
					trimmed.startsWith('config: {') ||
					trimmed.startsWith('url: ') ||
					trimmed.startsWith('method: ')
				) {
					return { type: 'system', raw: line };
				}

				// Non-JSON line — treat as text but mark partial
				return { type: 'text', text: line, isPartial: true, raw: line };
			}
			return null;
		}
	}

	/**
	 * Parse a pre-parsed JSON object into a normalized event.
	 */
	parseJsonObject(parsed: unknown): ParsedEvent | null {
		if (!parsed || typeof parsed !== 'object') return null;
		if (!isGeminiStreamEvent(parsed)) return null;

		const data = parsed;

		switch (data.type) {
			case 'init':
				return {
					type: 'init',
					sessionId: data.session_id,
					raw: data,
				};

			case 'message':
				return this.parseMessageEvent(data);

			case 'result':
				return this.parseResultEvent(data);

			case 'tool_use': {
				const toolName = (data as any).tool_name || 'unknown_tool';
				return {
					type: 'text', // Emitting as text so Group Chat users can see progress
					text: `\n*[Gemini is using tool: ${toolName}]*\n`,
					isPartial: true,
					toolName: toolName,
					toolState: (data as any).parameters,
					toolCallId: (data as any).tool_id,
					sessionId: data.session_id,
					raw: data,
				};
			}
			case 'tool_result':
			case 'tool_error':
				// We don't need to display the result body as text, but it's part of the tool lifecycle
				return { type: 'system', raw: data };

			default:
				return { type: 'system', raw: data };
		}
	}

	/**
	 * Parse message events (user echo and assistant deltas)
	 */
	private parseMessageEvent(data: GeminiStreamEvent): ParsedEvent | null {
		if (data.role === 'assistant' && data.content) {
			return {
				type: 'text',
				text: data.content,
				isPartial: true,
				raw: data,
			};
		}

		if (data.role === 'user') {
			// User message echo — system info, not displayed
			return { type: 'system', raw: data };
		}

		return null;
	}

	/**
	 * Parse result event (end of response with usage stats)
	 */
	private parseResultEvent(data: GeminiStreamEvent): ParsedEvent {
		return {
			type: 'result',
			text: '',
			sessionId: data.session_id,
			usage: this.extractUsageFromStats(data.stats),
			raw: data,
		};
	}

	/**
	 * Extract normalized usage stats from Gemini's stats object
	 */
	private extractUsageFromStats(
		stats: GeminiStreamEvent['stats']
	): ParsedEvent['usage'] | undefined {
		if (!stats) return undefined;

		return {
			inputTokens: stats.input_tokens || 0,
			outputTokens: stats.output_tokens || 0,
			cacheReadTokens: stats.cached || 0,
		};
	}

	/**
	 * Check if an event is a final result message
	 */
	isResultMessage(event: ParsedEvent): boolean {
		if (event.type === 'result') return true;
		const raw = event.raw as GeminiStreamEvent | undefined;
		return raw?.type === 'result';
	}

	/**
	 * Extract session ID from an event
	 */
	extractSessionId(event: ParsedEvent): string | null {
		if (event.sessionId) return event.sessionId;
		const raw = event.raw as GeminiStreamEvent | undefined;
		return raw?.session_id || null;
	}

	/**
	 * Extract usage statistics from an event
	 */
	extractUsage(event: ParsedEvent): ParsedEvent['usage'] | null {
		return event.usage || null;
	}

	/**
	 * Extract slash commands from an event.
	 * Gemini CLI does not use slash commands.
	 */
	extractSlashCommands(_event: ParsedEvent): string[] | null {
		return null;
	}

	/**
	 * Detect an error from a line of agent output.
	 */
	detectErrorFromLine(line: string): AgentError | null {
		if (!line.trim()) return null;

		try {
			const error = this.detectErrorFromParsed(JSON.parse(line));
			if (error) {
				error.raw = { ...(error.raw as Record<string, unknown>), errorLine: line };
			}
			return error;
		} catch {
			// Not JSON — check raw text against error patterns
			const patterns = getErrorPatterns(this.agentId);
			const match = matchErrorPattern(patterns, line);
			if (match) {
				return {
					type: match.type,
					message: match.message,
					recoverable: match.recoverable,
					agentId: this.agentId,
					timestamp: Date.now(),
					raw: { errorLine: line },
				};
			}
			return null;
		}
	}

	/**
	 * Detect an error from a pre-parsed JSON object.
	 */
	detectErrorFromParsed(parsed: unknown): AgentError | null {
		if (!parsed || typeof parsed !== 'object') return null;

		const obj = parsed as GeminiStreamEvent;

		// Gemini signals errors in result events with status !== 'success'
		if (obj.type === 'result' && obj.status && obj.status !== 'success') {
			const errorText = `Gemini CLI finished with status: ${obj.status}`;
			const patterns = getErrorPatterns(this.agentId);
			const match = matchErrorPattern(patterns, errorText);

			if (match) {
				return {
					type: match.type,
					message: match.message,
					recoverable: match.recoverable,
					agentId: this.agentId,
					timestamp: Date.now(),
					parsedJson: parsed,
				};
			}

			return {
				type: 'unknown',
				message: errorText,
				recoverable: true,
				agentId: this.agentId,
				timestamp: Date.now(),
				parsedJson: parsed,
			};
		}

		return null;
	}

	/**
	 * Detect an error from process exit information
	 */
	detectErrorFromExit(exitCode: number, stderr: string, stdout: string): AgentError | null {
		if (exitCode === 0) return null;

		const combined = `${stderr}\n${stdout}`;
		const patterns = getErrorPatterns(this.agentId);
		const match = matchErrorPattern(patterns, combined);

		if (match) {
			return {
				type: match.type,
				message: match.message,
				recoverable: match.recoverable,
				agentId: this.agentId,
				timestamp: Date.now(),
				raw: { exitCode, stderr, stdout },
			};
		}

		const stderrPreview = stderr?.trim()
			? `: ${stderr.trim().split('\n')[0].substring(0, 200)}`
			: '';
		return {
			type: 'agent_crashed',
			message: `Gemini CLI exited with code ${exitCode}${stderrPreview}`,
			recoverable: true,
			agentId: this.agentId,
			timestamp: Date.now(),
			raw: { exitCode, stderr, stdout },
		};
	}
}
