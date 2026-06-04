/**
 * Output parsing utilities for group chat.
 * Extracts text content from agent JSON/JSONL output formats.
 */

import { getOutputParser } from '../parsers';
import { logger } from '../utils/logger';

/**
 * Generic text extraction fallback for unknown agent types.
 * Tries common patterns for JSON output.
 */
export function extractTextGeneric(rawOutput: string): string {
	const lines = rawOutput.split('\n');

	// Check if this looks like JSONL output — find first line that starts with '{'
	// Skip non-JSON noise lines (e.g. Gemini CLI truecolor/ripgrep warnings)
	const firstJsonLineIndex = lines.findIndex((line) => line.trim().startsWith('{'));
	if (firstJsonLineIndex === -1) {
		return rawOutput;
	}

	const textParts: string[] = [];

	for (let i = firstJsonLineIndex; i < lines.length; i++) {
		const line = lines[i];
		if (!line.trim()) continue;

		try {
			const msg = JSON.parse(line);

			// Try common patterns
			if (msg.result) return msg.result;
			if (msg.text) textParts.push(msg.text);
			if (msg.part?.text) textParts.push(msg.part.text);
			if (msg.message?.content) {
				const content = msg.message.content;
				if (typeof content === 'string') {
					textParts.push(content);
				}
			}
		} catch {
			// Not valid JSON - include raw text if it looks like content
			if (!line.startsWith('{') && !line.includes('session_id') && !line.includes('sessionID')) {
				textParts.push(line);
			}
		}
	}

	// Join parts. Note: extractTextGeneric doesn't have access to isPartial flags,
	// but for generic JSON patterns we typically expect full lines or paragraphs.
	// We use newline as a safe default for non-streaming generic fallbacks.
	return textParts.join('\n');
}

/**
 * Extract text content from agent JSON output format.
 * Uses the registered output parser for the given agent type.
 * Different agents have different output formats:
 * - Claude: { type: 'result', result: '...' } and { type: 'assistant', message: { content: ... } }
 * - OpenCode: { type: 'text', part: { text: '...' } } and { type: 'step_finish', part: { reason: 'stop' } }
 *
 * @param rawOutput - The raw JSONL output from the agent
 * @param agentType - The agent type (e.g., 'claude-code', 'opencode')
 * @returns Extracted text content
 */
export function extractTextFromAgentOutput(rawOutput: string, agentType: string): string {
	const parser = getOutputParser(agentType);

	// If no parser found, try a generic extraction
	if (!parser) {
		logger.warn(
			`No parser found for agent type '${agentType}', using generic extraction`,
			'[GroupChat]'
		);
		return extractTextGeneric(rawOutput);
	}

	const lines = rawOutput.split('\n');

	// Check if this looks like JSONL output — find first line that starts with '{'
	// Some agents (e.g. Gemini CLI) emit non-JSON warnings before JSONL begins;
	// skip those noise lines instead of treating the entire output as plaintext.
	const firstJsonLineIndex = lines.findIndex((line) => line.trim().startsWith('{'));
	if (firstJsonLineIndex === -1) {
		logger.debug(
			`[GroupChat] Input is not JSONL, returning as plain text (len=${rawOutput.length})`,
			'[GroupChat]'
		);
		return rawOutput;
	}

	const textParts: string[] = [];
	let resultText: string | null = null;
	let hasPartialEvents = false;
	let _resultMessageCount = 0;
	let _textMessageCount = 0;

	for (let i = firstJsonLineIndex; i < lines.length; i++) {
		const line = lines[i];
		if (!line.trim()) continue;

		const event = parser.parseJsonLine(line);
		if (!event) continue;

		// Extract text based on event type
		if (event.type === 'result' && event.text) {
			// Result message is the authoritative final response - save it
			resultText = event.text;
			_resultMessageCount++;
		}

		if (event.type === 'text' && event.text) {
			textParts.push(event.text);
			if (event.isPartial) {
				hasPartialEvents = true;
			}
			_textMessageCount++;
		}
	}

	// Prefer result message if available (it contains the complete formatted response)
	if (resultText) {
		return resultText;
	}

	// Fallback: if no result message, concatenate streaming text parts.
	// If the agent emits partial parts (deltas), join with empty string to reconstruct the message;
	// otherwise join with newlines for distinct message events.
	return textParts.join(hasPartialEvents ? '' : '\n');
}

/**
 * Extract text content from stream-json output (JSONL).
 * Uses the agent-specific parser when the agent type is known.
 */
export function extractTextFromStreamJson(rawOutput: string, agentType?: string): string {
	if (agentType) {
		return extractTextFromAgentOutput(rawOutput, agentType);
	}

	return extractTextGeneric(rawOutput);
}
