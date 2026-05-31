/**
 * Unit tests for GrokBuildOutputParser
 *
 * Tests are written against the VERIFIED Grok Build streaming-json schema
 * (real `grok -p "..." --output-format streaming-json` output, beta May 2026):
 *   {"type":"thought","data":"<token>"}
 *   {"type":"text","data":"<token>"}
 *   {"type":"end","stopReason":"EndTurn","sessionId":"<uuid>","requestId":"<uuid>"}
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GrokBuildOutputParser } from '../../../main/parsers/grok-build-output-parser';
import type { ParsedEvent } from '../../../main/parsers/agent-output-parser';

describe('GrokBuildOutputParser', () => {
	let parser: GrokBuildOutputParser;

	beforeEach(() => {
		parser = new GrokBuildOutputParser();
	});

	// ---- agentId ----

	it('identifies as grok-build', () => {
		expect(parser.agentId).toBe('grok-build');
	});

	// ---- parseJsonLine: empty / invalid ----

	it('returns null for empty line', () => {
		expect(parser.parseJsonLine('')).toBeNull();
		expect(parser.parseJsonLine('   ')).toBeNull();
	});

	it('returns raw text event for non-JSON line (stderr trace merged via 2>&1)', () => {
		const event = parser.parseJsonLine('Grok Build starting...');
		expect(event).not.toBeNull();
		expect(event?.type).toBe('text');
		expect(event?.text).toBe('Grok Build starting...');
	});

	it('returns null for JSON without type field', () => {
		const event = parser.parseJsonLine('{"data": "orphan", "foo": "bar"}');
		expect(event).toBeNull();
	});

	// ---- Text delta (type: "text", field: "data") ----

	it('parses text delta event', () => {
		const line = JSON.stringify({ type: 'text', data: 'Hello' });
		const event = parser.parseJsonLine(line);
		expect(event?.type).toBe('text');
		expect(event?.text).toBe('Hello');
		// Text deltas are NOT isPartial — they are the final answer, not thinking.
		// This routes them through emitDataBuffered for real-time markdown streaming.
		expect(event?.isPartial).toBeFalsy();
		expect(event?.isReasoning).toBeFalsy();
	});

	it('accumulates multiple text deltas (each parsed independently)', () => {
		const tokens = ['Hey', ' there', '!'];
		const texts = tokens.map((t) => {
			const ev = parser.parseJsonLine(JSON.stringify({ type: 'text', data: t }));
			return ev?.text;
		});
		expect(texts).toEqual(['Hey', ' there', '!']);
	});

	it('returns null for text event with empty data', () => {
		const line = JSON.stringify({ type: 'text', data: '' });
		expect(parser.parseJsonLine(line)).toBeNull();
	});

	it('returns null for text event with missing data field', () => {
		const line = JSON.stringify({ type: 'text' });
		expect(parser.parseJsonLine(line)).toBeNull();
	});

	// ---- Thought / reasoning delta (type: "thought", field: "data") ----

	it('parses thought delta as reasoning text', () => {
		const line = JSON.stringify({ type: 'thought', data: 'The user said hello.' });
		const event = parser.parseJsonLine(line);
		expect(event?.type).toBe('text');
		expect(event?.text).toBe('The user said hello.');
		expect(event?.isPartial).toBe(true);
		expect(event?.isReasoning).toBe(true);
	});

	it('returns null for thought event with empty data', () => {
		const line = JSON.stringify({ type: 'thought', data: '' });
		expect(parser.parseJsonLine(line)).toBeNull();
	});

	// ---- Terminal end event (type: "end", sessionId camelCase) ----

	it('parses end event as result and extracts sessionId', () => {
		const line = JSON.stringify({
			type: 'end',
			stopReason: 'EndTurn',
			sessionId: '019e7344-988f-7e20-abb0-d3d2d598151a',
			requestId: 'b72270ab-a640-44ce-a4a9-7970df260363',
		});
		const event = parser.parseJsonLine(line);
		expect(event?.type).toBe('result');
		expect(event?.sessionId).toBe('019e7344-988f-7e20-abb0-d3d2d598151a');
		expect(event?.text).toBe(''); // text was streamed via deltas, not in end event
	});

	it('parses end event with Cancelled stopReason', () => {
		const line = JSON.stringify({
			type: 'end',
			stopReason: 'Cancelled',
			sessionId: '019e7344-d5b5-7633-afa9-8efac1dddbb8',
			requestId: 'b589c9ce-469a-4686-8929-3bddad260e95',
		});
		const event = parser.parseJsonLine(line);
		expect(event?.type).toBe('result');
		expect(event?.sessionId).toBe('019e7344-d5b5-7633-afa9-8efac1dddbb8');
	});

	it('handles end event without sessionId gracefully', () => {
		const line = JSON.stringify({ type: 'end', stopReason: 'EndTurn' });
		const event = parser.parseJsonLine(line);
		expect(event?.type).toBe('result');
		expect(event?.sessionId).toBeUndefined();
	});

	// ---- Unknown event type ----

	it('returns system event for unknown event type', () => {
		const line = JSON.stringify({ type: 'some_future_event', data: 'xyz' });
		const event = parser.parseJsonLine(line);
		expect(event?.type).toBe('system');
	});

	// ---- isResultMessage ----

	it('identifies result (end) events correctly', () => {
		const resultEvent: ParsedEvent = { type: 'result', text: '' };
		const textEvent: ParsedEvent = { type: 'text', text: 'partial' };
		expect(parser.isResultMessage(resultEvent)).toBe(true);
		expect(parser.isResultMessage(textEvent)).toBe(false);
	});

	// ---- extractSessionId ----

	it('extracts session ID from result event', () => {
		const event: ParsedEvent = {
			type: 'result',
			sessionId: '019e7344-988f-7e20-abb0-d3d2d598151a',
		};
		expect(parser.extractSessionId(event)).toBe('019e7344-988f-7e20-abb0-d3d2d598151a');
	});

	it('returns null when no session ID', () => {
		const event: ParsedEvent = { type: 'text', text: 'hello' };
		expect(parser.extractSessionId(event)).toBeNull();
	});

	// ---- Error detection (stderr trace lines, non-JSON) ----

	it('detects auth expired error', () => {
		const error = parser.detectErrorFromLine('Error: authentication failed for user');
		expect(error?.type).toBe('auth_expired');
		expect(error?.recoverable).toBe(true);
		expect(error?.agentId).toBe('grok-build');
	});

	it('detects invalid API key error', () => {
		const error = parser.detectErrorFromLine('Error: invalid api key provided');
		expect(error?.type).toBe('auth_expired');
	});

	it('detects rate limit error', () => {
		const error = parser.detectErrorFromLine('rate limit exceeded, please wait');
		expect(error?.type).toBe('rate_limited');
		expect(error?.recoverable).toBe(true);
	});

	it('detects token exhaustion', () => {
		const error = parser.detectErrorFromLine('context length exceeded for this model');
		expect(error?.type).toBe('token_exhaustion');
		expect(error?.recoverable).toBe(false);
	});

	it('detects network error', () => {
		const error = parser.detectErrorFromLine('ECONNREFUSED connecting to x.ai');
		expect(error?.type).toBe('network_error');
	});

	it('detects sandbox permission denied', () => {
		const error = parser.detectErrorFromLine('sandbox blocked network access');
		expect(error?.type).toBe('permission_denied');
	});

	it('returns null for benign output', () => {
		expect(parser.detectErrorFromLine('Successfully read 3 files.')).toBeNull();
		expect(parser.detectErrorFromLine('Writing output...')).toBeNull();
	});

	// ---- detectErrorFromParsed (F4 fix: no false positives on data field) ----

	it('detects error from parsed object via message field', () => {
		const error = parser.detectErrorFromParsed({ message: 'rate limit exceeded' });
		expect(error?.type).toBe('rate_limited');
	});

	it('detects error from parsed object via error field', () => {
		const error = parser.detectErrorFromParsed({ error: 'authentication failed' });
		expect(error?.type).toBe('auth_expired');
	});

	it('does NOT false-positive on normal text event data field', () => {
		// A text event with data="rate limit exceeded" must NOT trigger error detection
		expect(parser.detectErrorFromParsed({ type: 'text', data: 'rate limit exceeded' })).toBeNull();
	});

	it('does NOT false-positive on normal thought event data field', () => {
		expect(
			parser.detectErrorFromParsed({ type: 'thought', data: 'context length exceeded' })
		).toBeNull();
	});

	it('returns null for parsed object with no error/message fields', () => {
		expect(parser.detectErrorFromParsed({ type: 'text', data: 'hello' })).toBeNull();
	});

	// ---- extractUsage ----

	it('returns null for usage extraction (no usage in streaming-json)', () => {
		const event = parser.parseJsonLine(
			JSON.stringify({ type: 'end', stopReason: 'EndTurn', sessionId: 'sess-1' })
		);
		expect(parser.extractUsage(event!)).toBeNull();
	});

	// ---- extractSlashCommands ----

	it('returns null for slash commands (not supported)', () => {
		const event = parser.parseJsonLine(JSON.stringify({ type: 'text', data: 'hi' }));
		expect(parser.extractSlashCommands(event!)).toBeNull();
	});

	// ---- parseJsonObject ----

	it('parses pre-parsed JSON object (text event)', () => {
		const event = parser.parseJsonObject({ type: 'text', data: 'Hello' });
		expect(event?.type).toBe('text');
		expect(event?.text).toBe('Hello');
		expect(event?.isPartial).toBeFalsy();
	});

	it('parses pre-parsed JSON object (end event)', () => {
		const event = parser.parseJsonObject({
			type: 'end',
			stopReason: 'EndTurn',
			sessionId: 'sess-abc',
		});
		expect(event?.type).toBe('result');
		expect(event?.sessionId).toBe('sess-abc');
	});

	it('returns null for non-object input to parseJsonObject', () => {
		expect(parser.parseJsonObject(null)).toBeNull();
		expect(parser.parseJsonObject('string')).toBeNull();
		expect(parser.parseJsonObject(42)).toBeNull();
	});

	// ---- detectErrorFromExit ----

	it('returns null for exit code 0', () => {
		expect(parser.detectErrorFromExit(0, '', '')).toBeNull();
	});

	it('detects error from non-zero exit with matching stderr', () => {
		const error = parser.detectErrorFromExit(1, 'authentication failed', '');
		expect(error?.type).toBe('auth_expired');
		expect(error?.agentId).toBe('grok-build');
	});

	it('returns agent_crashed for non-zero exit without pattern match', () => {
		const error = parser.detectErrorFromExit(137, 'Killed', '');
		expect(error?.type).toBe('agent_crashed');
		expect(error?.recoverable).toBe(true);
	});

	// ---- raw field preservation ----

	it('preserves raw field for debugging', () => {
		const raw = { type: 'text', data: 'hi' };
		const event = parser.parseJsonLine(JSON.stringify(raw));
		expect(event?.raw).toEqual(raw);
	});

	// ---- Integration: realistic event stream ----

	it('parses a realistic hello-world event sequence', () => {
		const stream = [
			{ type: 'thought', data: 'The user' },
			{ type: 'thought', data: ' said hello.' },
			{ type: 'text', data: 'Hey' },
			{ type: 'text', data: ' there.' },
			{ type: 'end', stopReason: 'EndTurn', sessionId: 'sess-xyz', requestId: 'req-1' },
		];
		const events = stream.map((e) => parser.parseJsonLine(JSON.stringify(e)));

		// 2 reasoning + 2 text + 1 result
		const reasoning = events.filter((e) => e?.isReasoning);
		const text = events.filter((e) => e?.type === 'text' && !e?.isReasoning);
		const result = events.filter((e) => e?.type === 'result');

		expect(reasoning).toHaveLength(2);
		expect(text).toHaveLength(2);
		expect(result).toHaveLength(1);
		expect(result[0]?.sessionId).toBe('sess-xyz');

		// Final answer text (excluding reasoning) accumulates to "Hey there."
		const answer = text.map((e) => e?.text).join('');
		expect(answer).toBe('Hey there.');
	});
});
