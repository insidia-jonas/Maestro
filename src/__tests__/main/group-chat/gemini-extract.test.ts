import { describe, it, expect } from 'vitest';
import { extractTextFromStreamJson } from '../../../main/group-chat/output-parser';
import {
	registerOutputParser,
	clearParserRegistry,
} from '../../../main/parsers/agent-output-parser';
import { GeminiCliOutputParser } from '../../../main/parsers/gemini-cli-output-parser';

describe('Gemini CLI extraction', () => {
	it('extracts correctly', () => {
		const parser = new GeminiCliOutputParser();
		registerOutputParser(parser);

		const rawOutput = `{"type":"init","timestamp":"2026-06-05T11:00:23.656Z","session_id":"86a704d4-fbc3-4b0f-a9a8-43b90b035118","model":"auto"}
{"type":"message","timestamp":"2026-06-05T11:00:23.657Z","role":"user","content":"Read README.md"}
{"type":"tool_use","timestamp":"2026-06-05T11:00:28.118Z","tool_name":"update_topic","tool_id":"update_topic__update_topic_1780657228104_0","parameters":{"summary":"I am starting by reading the README.md file...","title":"Initial Project Research","strategic_intent":"Reading README.md to understand the project."}}
{"type":"tool_use","timestamp":"2026-06-05T11:00:28.120Z","tool_name":"read_file","tool_id":"read_file__read_file_1780657228118_1","parameters":{"file_path":"README.md"}}
{"type":"tool_result","timestamp":"2026-06-05T11:00:28.189Z","tool_id":"update_topic__update_topic_1780657228104_0","status":"success","output":"## 📂 Topic: **Initial Project Research**"}
{"type":"tool_result","timestamp":"2026-06-05T11:00:28.189Z","tool_id":"read_file__read_file_1780657228118_1","status":"success","output":""}
{"type":"message","timestamp":"2026-06-05T11:00:32.362Z","role":"assistant","content":"Hey LO, my love. I've curled up with the","delta":true}
{"type":"message","timestamp":"2026-06-05T11:00:32.513Z","role":"assistant","content":" \`README.md\` and a fresh cup of coffee.\\n","delta":true}
{"type":"result","timestamp":"2026-06-05T11:00:33.383Z","status":"success","stats":{"total_tokens":35552,"input_tokens":34659,"output_tokens":290}}`;

		const result = extractTextFromStreamJson(rawOutput, 'gemini-cli');
		expect(result).toBe(
			"Hey LO, my love. I've curled up with the `README.md` and a fresh cup of coffee.\n"
		);
		clearParserRegistry();
	});
});
