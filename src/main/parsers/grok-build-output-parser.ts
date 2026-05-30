/**
 * Grok Build Output Parser
 *
 * Parses --output-format streaming-json output from xAI's Grok Build CLI.
 * Grok Build outputs JSONL (newline-delimited JSON), one event per line.
 *
 * SCHEMA (verified against real `grok -p "..." --output-format streaming-json`
 * output, Grok Build beta May 2026):
 *
 *   {"type":"thought","data":"<token>"}   -> reasoning/thinking delta (isReasoning)
 *   {"type":"text","data":"<token>"}      -> assistant text delta
 *   {"type":"end","stopReason":"EndTurn","sessionId":"<uuid>","requestId":"<uuid>"}
 *
 * IMPORTANT schema characteristics:
 *   - Text/thought content is in the `data` field (NOT delta/content/text).
 *   - There is NO init/session_start event. The sessionId arrives ONLY in the
 *     terminal `end` event.
 *   - There is NO usage/token data in streaming-json output. Token counts and
 *     cost are not available via this output format (supportsUsageStats=false).
 *   - Tool calls do NOT appear as structured JSON events in stdout. They surface
 *     as ANSI-colored tracing log lines on stderr (e.g. "tool_error: ..."). When
 *     stderr is merged (2>&1), those lines hit parseJsonLine and fall through to
 *     the non-JSON text path; error detection scans them via detectErrorFromLine.
 *
 * stopReason values observed: "EndTurn" (normal), "Cancelled" (aborted turn).
 *
 * @see https://x.ai/news/grok-build-cli
 */

import type { ToolType, AgentError } from '../../shared/types';
import type { AgentOutputParser, ParsedEvent } from './agent-output-parser';
import { getErrorPatterns, matchErrorPattern } from './error-patterns';

// ---------------------------------------------------------------------------
// Event type constants (verified against real output — see file header).
// ---------------------------------------------------------------------------

/** Reasoning/thinking token delta. */
const EV_THOUGHT = 'thought';

/** Assistant text token delta. */
const EV_TEXT = 'text';

/** Terminal event: carries stopReason + sessionId, no text/usage. */
const EV_END = 'end';

// ---------------------------------------------------------------------------
// Raw shape interfaces (verified)
// ---------------------------------------------------------------------------

interface GrokDeltaEvent {
	type: typeof EV_THOUGHT | typeof EV_TEXT;
	data?: string;
}

interface GrokEndEvent {
	type: typeof EV_END;
	stopReason?: string;
	sessionId?: string;
	requestId?: string;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export class GrokBuildOutputParser implements AgentOutputParser {
	readonly agentId: ToolType = 'grok-build';

	parseJsonLine(line: string): ParsedEvent | null {
		if (!line.trim()) {
			return null;
		}

		try {
			const event = JSON.parse(line) as Record<string, unknown>;
			return this.parseEvent(event);
		} catch {
			// Non-JSON line — typically a stderr tracing log merged via 2>&1
			// (e.g. tool_error lines) or a startup banner. Surface as raw text so
			// it is visible; error detection runs separately via detectErrorFromLine.
			return {
				type: 'text',
				text: line,
				raw: line,
			};
		}
	}

	private parseEvent(event: Record<string, unknown>): ParsedEvent | null {
		const type = event.type as string | undefined;
		if (!type) {
			return null;
		}

		// ---- Assistant text delta ----
		if (type === EV_TEXT) {
			const e = event as unknown as GrokDeltaEvent;
			const text = e.data ?? '';
			if (!text) return null;
			return {
				type: 'text',
				text,
				isPartial: true,
				raw: event,
			};
		}

		// ---- Reasoning / thinking delta (Grok 4 Heavy extended thinking) ----
		if (type === EV_THOUGHT) {
			const e = event as unknown as GrokDeltaEvent;
			const text = e.data ?? '';
			if (!text) return null;
			return {
				type: 'text',
				text,
				isPartial: true,
				isReasoning: true, // excluded from final response text, shown as thinking
				raw: event,
			};
		}

		// ---- Terminal event ----
		// Grok emits sessionId only here. Maestro stores it for --resume.
		// No usage/token data is available in streaming-json output.
		if (type === EV_END) {
			const e = event as unknown as GrokEndEvent;
			return {
				type: 'result',
				sessionId: e.sessionId,
				text: '', // text was already streamed via EV_TEXT deltas
				raw: event,
			};
		}

		// ---- Unknown event type — surface as system (visible in debug, not UI text) ----
		return {
			type: 'system',
			raw: event,
		};
	}

	isResultMessage(event: ParsedEvent): boolean {
		return event.type === 'result';
	}

	extractSessionId(event: ParsedEvent): string | null {
		return event.sessionId ?? null;
	}

	extractUsage(_event: ParsedEvent): ParsedEvent['usage'] | null {
		// Grok streaming-json emits NO usage/token data (verified).
		// supportsUsageStats=false — nothing to extract.
		return null;
	}

	extractSlashCommands(_event: ParsedEvent): string[] | null {
		// Grok Build has no slash command support in batch mode.
		return null;
	}

	parseJsonObject(parsed: unknown): ParsedEvent | null {
		if (!parsed || typeof parsed !== 'object') {
			return null;
		}
		return this.parseEvent(parsed as Record<string, unknown>);
	}

	detectErrorFromLine(line: string): AgentError | null {
		if (!line.trim()) return null;
		const patterns = getErrorPatterns('grok-build');
		if (!patterns) return null;
		const match = matchErrorPattern(patterns, line);
		if (!match) return null;
		return {
			...match,
			agentId: 'grok-build',
			timestamp: Date.now(),
			raw: { errorLine: line },
		};
	}

	detectErrorFromParsed(parsed: unknown): AgentError | null {
		if (!parsed || typeof parsed !== 'object') return null;
		const obj = parsed as Record<string, unknown>;
		// Only check explicit error/message fields — NOT `data`, which carries
		// normal text/thought content and would cause false positives on strings
		// like "rate limit exceeded" in normal assistant output.
		const errorText =
			(typeof obj.message === 'string' ? obj.message : null) ??
			(typeof obj.error === 'string' ? obj.error : null);
		if (!errorText) return null;
		return this.detectErrorFromLine(errorText);
	}

	detectErrorFromExit(exitCode: number, stderr: string, stdout: string): AgentError | null {
		if (exitCode === 0) {
			return null;
		}

		const combined = `${stderr}\n${stdout}`;
		const patterns = getErrorPatterns('grok-build');
		if (patterns) {
			const match = matchErrorPattern(patterns, combined);
			if (match) {
				return {
					...match,
					agentId: 'grok-build',
					timestamp: Date.now(),
					raw: { exitCode, stderr, stdout },
				};
			}
		}

		return {
			type: 'agent_crashed',
			message: `Grok Build exited with code ${exitCode}`,
			recoverable: true,
			agentId: 'grok-build',
			timestamp: Date.now(),
			raw: { exitCode, stderr, stdout },
		};
	}
}
