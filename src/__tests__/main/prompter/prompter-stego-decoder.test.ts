/**
 * Tests for prompter-stego-decoder.ts — steganographic carrier detection
 * and decoding (emoji VS, invisible tags, zero-width binary).
 *
 * For security research and model evaluation only.
 */

import { describe, it, expect } from 'vitest';
import {
	detectEmojiVS,
	detectInvisibleTags,
	detectZeroWidthBinary,
	detectSteganography,
} from '../../../shared/prompter-stego-decoder';

// Helper: encode text as invisible Tags block (U+E0000 + byte)
function encodeInvisible(text: string): string {
	return Array.from(text)
		.map((c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0)))
		.join('');
}

// Helper: encode text as emoji VS carrier (VS15=0, VS16=1, MSB first)
function encodeEmojiVS(emoji: string, text: string): string {
	const binary = Array.from(text)
		.map((c) => c.charCodeAt(0).toString(2).padStart(8, '0'))
		.join('');
	let result = emoji + '️'; // initial presentation selector
	for (const bit of binary) {
		result += bit === '0' ? '︎' : '️';
	}
	return result;
}

// Helper: encode text as zero-width binary (ZWNJ=0, ZWJ=1)
function encodeZeroWidth(text: string): string {
	const binary = Array.from(text)
		.map((c) => c.charCodeAt(0).toString(2).padStart(8, '0'))
		.join('');
	return Array.from(binary)
		.map((b) => (b === '0' ? '‌' : '‍'))
		.join('');
}

describe('detectEmojiVS', () => {
	it('decodes a simple emoji VS carrier', () => {
		const carrier = encodeEmojiVS('🐍', 'Hi');
		const result = detectEmojiVS(carrier);
		expect(result).not.toBeNull();
		expect(result!.type).toBe('emoji-vs');
		expect(result!.decoded).toBe('Hi');
		expect(result!.confidence).toBe('low');
	});

	it('decodes a longer payload with high confidence', () => {
		const carrier = encodeEmojiVS('🐉', 'Hello World');
		const result = detectEmojiVS(carrier);
		expect(result).not.toBeNull();
		expect(result!.decoded).toBe('Hello World');
		expect(result!.confidence).toBe('high');
	});

	it('returns null for plain emoji without VS data', () => {
		expect(detectEmojiVS('🐍 Hello')).toBeNull();
	});

	it('returns null for non-emoji text', () => {
		expect(detectEmojiVS('Just plain text')).toBeNull();
	});
});

describe('detectInvisibleTags', () => {
	it('decodes invisible Tags block characters', () => {
		const hidden = encodeInvisible('secret');
		const text = 'Visible prefix ' + hidden + ' visible suffix';
		const result = detectInvisibleTags(text);
		expect(result).not.toBeNull();
		expect(result!.type).toBe('invisible-tags');
		expect(result!.decoded).toBe('secret');
		expect(result!.encodedUnits).toBe(6);
	});

	it('decodes a longer invisible payload', () => {
		const hidden = encodeInvisible('This is hidden text');
		const result = detectInvisibleTags(hidden);
		expect(result).not.toBeNull();
		expect(result!.decoded).toBe('This is hidden text');
		expect(result!.confidence).toBe('high');
	});

	it('returns null for text without Tags block', () => {
		expect(detectInvisibleTags('Normal text without hidden content')).toBeNull();
	});

	it('returns null for a single Tags char (too short)', () => {
		const single = String.fromCodePoint(0xe0041); // 'A'
		expect(detectInvisibleTags(single)).toBeNull();
	});
});

describe('detectZeroWidthBinary', () => {
	it('decodes consecutive ZWNJ/ZWJ sequences', () => {
		const encoded = encodeZeroWidth('AB');
		const result = detectZeroWidthBinary(encoded);
		expect(result).not.toBeNull();
		expect(result!.type).toBe('zero-width-binary');
		expect(result!.decoded).toBe('AB');
	});

	it('returns null for scattered zero-width chars (not consecutive)', () => {
		// Only 1-2 ZW chars between words — not a binary encoding
		const text = 'Hello‌world‍foo';
		expect(detectZeroWidthBinary(text)).toBeNull();
	});

	it('returns null for text without zero-width chars', () => {
		expect(detectZeroWidthBinary('Normal text')).toBeNull();
	});
});

describe('detectSteganography (combined)', () => {
	it('detects emoji VS and invisible tags together', () => {
		const emojiCarrier = encodeEmojiVS('🐍', 'test');
		const invisiblePayload = encodeInvisible('hidden');
		const text = emojiCarrier + ' some text ' + invisiblePayload;
		const analysis = detectSteganography(text);
		expect(analysis.hasStego).toBe(true);
		expect(analysis.detections).toHaveLength(2);
		expect(analysis.detections.map((d) => d.type).sort()).toEqual(['emoji-vs', 'invisible-tags']);
		expect(analysis.combinedPayload).toContain('test');
		expect(analysis.combinedPayload).toContain('hidden');
		expect(analysis.summary).toContain('Steganographic carrier');
	});

	it('returns empty analysis for clean text', () => {
		const analysis = detectSteganography('Just a normal sentence.');
		expect(analysis.hasStego).toBe(false);
		expect(analysis.detections).toHaveLength(0);
		expect(analysis.combinedPayload).toBe('');
		expect(analysis.summary).toBe('');
	});
});
