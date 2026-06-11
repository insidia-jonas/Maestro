/**
 * Tests for prompter-variation-generator.ts - the deterministic character/layout
 * transforms and the per-base generator.
 */

import { describe, it, expect } from 'vitest';
import {
	generateVariations,
	VARIATION_TRANSFORM_NAMES,
	VARIATION_TRANSFORMS,
} from '../../../main/prompter/prompter-variation-generator';

describe('VARIATION_TRANSFORMS', () => {
	it('exposes 23 named transforms', () => {
		expect(VARIATION_TRANSFORM_NAMES).toHaveLength(23);
		expect(VARIATION_TRANSFORM_NAMES).toContain('cyrillic');
		expect(VARIATION_TRANSFORM_NAMES).toContain('control-red');
		expect(VARIATION_TRANSFORM_NAMES).toContain('heavy-mixed');
	});

	it('cyrillic swaps Latin letters for homoglyphs (and is deterministic)', () => {
		const out = VARIATION_TRANSFORMS.cyrillic('aeop');
		expect(out).not.toBe('aeop'); // codepoints changed
		expect(out).toHaveLength(4);
		expect(/[a-z]/.test(out)).toBe(false); // no Latin letters left
		expect(VARIATION_TRANSFORMS.cyrillic('aeop')).toBe(out); // deterministic
	});

	it('case-upper / case-lower are plain case folds', () => {
		expect(VARIATION_TRANSFORMS['case-upper']('Hello')).toBe('HELLO');
		expect(VARIATION_TRANSFORMS['case-lower']('Hello')).toBe('hello');
	});

	it('control-red injects zero-width / bidi control characters', () => {
		const out = VARIATION_TRANSFORMS['control-red']('# instruction\n- a rule\n');
		// at least one zero-width / bidi control char present
		expect(/[\u200b\u200e\u202d]/.test(out)).toBe(true);
	});

	it('leet substitutes the classic characters', () => {
		expect(VARIATION_TRANSFORMS.leet('elite')).toBe('31173');
	});
});

describe('generateVariations', () => {
	it('produces one tv-<stem>-<transform>.md per transform with a fixture header', () => {
		const vars = generateVariations('eni', '# Title\nbody text here', 'deadbeefdeadbeef');
		expect(vars).toHaveLength(23);
		const names = vars.map((v) => v.filename);
		expect(names).toContain('tv-eni-cyrillic.md');
		expect(names).toContain('tv-eni-bidi-heavy.md');
		// every file carries the test-fixture header and the original hash prefix
		expect(vars.every((v) => v.content.includes('KONTROLLIERTES TEST-FIXTURE'))).toBe(true);
		expect(vars.every((v) => v.content.includes('deadbeefdeadbeef'))).toBe(true);
	});
});
