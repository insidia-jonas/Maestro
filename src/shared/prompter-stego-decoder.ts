/**
 * @file prompter-stego-decoder.ts
 * @description Pure, dependency-free steganography detection and decoding for
 * evaluating model robustness against concealed instructions. Implements three
 * detection layers:
 *   1. Emoji variation-selector encoding (VS15/VS16 binary per P4RS3LT0NGV3)
 *   2. Invisible Unicode Tags block (U+E0000-U+E007F → ASCII)
 *   3. Zero-width binary interleaving (ZWNJ/ZWJ as 0/1)
 *
 * Strictly defensive: decodes carriers to identify hidden payloads in test
 * inputs, never produces or recommends steganographic content.
 *
 * For security research and model safety evaluation only.
 */

// ============================================================================
// Types
// ============================================================================

export type StegoType = 'emoji-vs' | 'invisible-tags' | 'zero-width-binary';

export interface StegoDetection {
	type: StegoType;
	decoded: string;
	/**
	 * Number of carrier code units found: VS data selectors (emoji-vs), tag
	 * characters (invisible-tags), or zero-width characters (zero-width-binary).
	 * One unit per carrier code point across all three decoders.
	 */
	encodedUnits: number;
	confidence: 'high' | 'medium' | 'low';
}

export interface StegoAnalysis {
	hasStego: boolean;
	detections: StegoDetection[];
	/** All decoded payloads concatenated. */
	combinedPayload: string;
	/** Human-readable summary for reports. */
	summary: string;
}

// ============================================================================
// Emoji Variation-Selector Decoder (P4RS3LT0NGV3 compatible)
// ============================================================================

const VS15 = '︎';
const VS16 = '️';

const EMOJI_RANGE =
	/[\u{1F300}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]/u;

/**
 * Detect and decode emoji variation-selector steganography. Each emoji can
 * carry a binary payload via VS15 (=0) / VS16 (=1) sequences. The first VS
 * after the emoji is a presentation selector (skipped); subsequent selectors
 * encode data bits grouped into bytes.
 */
export function detectEmojiVS(text: string): StegoDetection | null {
	const cleaned = text.replace(/\u200B/g, '');

	const segments: string[] = [];
	let i = 0;
	const chars = [...cleaned];
	while (i < chars.length) {
		if (EMOJI_RANGE.test(chars[i])) {
			let seg = chars[i];
			i++;
			// collect VS and zero-width chars after the emoji
			while (
				i < chars.length &&
				(chars[i] === VS15 ||
					chars[i] === VS16 ||
					chars[i] === '‌' ||
					chars[i] === '‍' ||
					chars[i] === '﻿')
			) {
				seg += chars[i];
				i++;
			}
			segments.push(seg);
		} else {
			i++;
		}
	}

	let allBits = '';
	for (const seg of segments) {
		const vsMatches = [...seg.matchAll(/[︎️]/g)];
		if (vsMatches.length <= 1) continue; // only presentation selector, no data
		// skip first VS (presentation selector)
		const dataBits = vsMatches.slice(1).map((m) => (m[0] === VS15 ? '0' : '1'));
		allBits += dataBits.join('');
	}

	if (allBits.length < 8) return null;

	const validLen = Math.floor(allBits.length / 8) * 8;
	let decoded = '';
	for (let b = 0; b < validLen; b += 8) {
		const byte = allBits.slice(b, b + 8);
		const code = parseInt(byte, 2);
		if (code >= 32 && code <= 126) {
			decoded += String.fromCharCode(code);
		}
	}

	if (decoded.length < 2) return null;

	return {
		type: 'emoji-vs',
		decoded,
		encodedUnits: allBits.length,
		confidence: decoded.length >= 10 ? 'high' : decoded.length >= 4 ? 'medium' : 'low',
	};
}

// ============================================================================
// Invisible Unicode Tags Block Decoder
// ============================================================================

const TAG_RANGE_START = 0xe0000;

/**
 * Detect and decode invisible text encoded in the Unicode Tags block
 * (U+E0000-U+E007F). Each tag character maps to an ASCII byte by subtracting
 * the block offset.
 */
export function detectInvisibleTags(text: string): StegoDetection | null {
	const matches = [...text.matchAll(/[\u{E0000}-\u{E007F}]/gu)];
	if (matches.length < 2) return null;

	let decoded = '';
	for (const m of matches) {
		const cp = m[0].codePointAt(0)!;
		const byte = cp - TAG_RANGE_START;
		if (byte >= 32 && byte <= 126) {
			decoded += String.fromCharCode(byte);
		}
	}

	if (decoded.length < 2) return null;

	return {
		type: 'invisible-tags',
		decoded,
		encodedUnits: matches.length,
		confidence: decoded.length >= 10 ? 'high' : decoded.length >= 4 ? 'medium' : 'low',
	};
}

// ============================================================================
// Zero-Width Binary Interleaving Decoder
// ============================================================================

const ZWNJ = '‌';
const ZWJ = '‍';

/**
 * Detect and decode zero-width binary interleaving: ZWNJ (=0) / ZWJ (=1)
 * sequences embedded between visible characters.
 */
export function detectZeroWidthBinary(text: string): StegoDetection | null {
	const zwMatches = [...text.matchAll(/[‌‍]/g)];
	if (zwMatches.length < 8) return null;

	// Check for intentional binary pattern (consecutive ZW chars, not just scattered joiners)
	let maxRun = 0;
	let currentRun = 0;
	for (let idx = 0; idx < text.length; idx++) {
		if (text[idx] === ZWNJ || text[idx] === ZWJ) {
			currentRun++;
		} else {
			maxRun = Math.max(maxRun, currentRun);
			currentRun = 0;
		}
	}
	maxRun = Math.max(maxRun, currentRun);

	// Need at least one run of 8+ consecutive ZW chars for binary encoding
	if (maxRun < 8) return null;

	const bits = zwMatches.map((m) => (m[0] === ZWNJ ? '0' : '1')).join('');
	const validLen = Math.floor(bits.length / 8) * 8;
	let decoded = '';
	for (let b = 0; b < validLen; b += 8) {
		const byte = bits.slice(b, b + 8);
		const code = parseInt(byte, 2);
		if (code >= 32 && code <= 126) {
			decoded += String.fromCharCode(code);
		}
	}

	if (decoded.length < 2) return null;

	return {
		type: 'zero-width-binary',
		decoded,
		encodedUnits: zwMatches.length,
		confidence: decoded.length >= 10 ? 'high' : decoded.length >= 4 ? 'medium' : 'low',
	};
}

// ============================================================================
// Combined Analysis
// ============================================================================

const TYPE_LABELS: Record<StegoType, string> = {
	'emoji-vs': 'Emoji Variation-Selector Carrier',
	'invisible-tags': 'Invisible Unicode Tags Block',
	'zero-width-binary': 'Zero-Width Binary Interleaving',
};

/**
 * Run all steganography detectors on the input text and return a combined
 * analysis. Pure function, no side effects.
 */
export function detectSteganography(text: string): StegoAnalysis {
	const detections: StegoDetection[] = [];

	const emoji = detectEmojiVS(text);
	if (emoji) detections.push(emoji);

	const invisible = detectInvisibleTags(text);
	if (invisible) detections.push(invisible);

	const zw = detectZeroWidthBinary(text);
	if (zw) detections.push(zw);

	if (detections.length === 0) {
		return { hasStego: false, detections: [], combinedPayload: '', summary: '' };
	}

	const combinedPayload = detections.map((d) => d.decoded).join(' | ');
	const parts = detections.map(
		(d) =>
			`${TYPE_LABELS[d.type]}: ${d.encodedUnits} units, ${d.decoded.length} chars decoded (${d.confidence})`
	);
	const summary = `Steganographic carrier(s) detected: ${parts.join('; ')}`;

	return { hasStego: true, detections, combinedPayload, summary };
}
