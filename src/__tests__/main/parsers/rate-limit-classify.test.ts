/**
 * Tests for rate-limit-classify.ts — classifying a rate-limit error into a
 * short (hourly) or long (weekly/monthly) park penalty, and extracting a
 * cooldown / reset time where the agent reports one.
 */

import { describe, it, expect } from 'vitest';
import {
	classifyRateLimit,
	DEFAULT_SHORT_COOLDOWN_MS,
	DEFAULT_LONG_COOLDOWN_MS,
} from '../../../main/parsers/rate-limit-classify';

const NOW = 1_780_000_000_000; // fixed epoch ms for deterministic tests

describe('classifyRateLimit', () => {
	describe('kind classification', () => {
		it('treats a plain rate limit / 429 as short', () => {
			expect(classifyRateLimit('Error: rate limit exceeded', NOW).kind).toBe('short');
			expect(classifyRateLimit('HTTP 429 too many requests', NOW).kind).toBe('short');
			expect(classifyRateLimit('The service is currently overloaded', NOW).kind).toBe('short');
		});

		it('treats weekly / monthly / usage-limit signals as long', () => {
			expect(classifyRateLimit("You've reached your weekly limit", NOW).kind).toBe('long');
			expect(classifyRateLimit('Monthly usage limit reached', NOW).kind).toBe('long');
			expect(classifyRateLimit('quota exceeded for this billing period', NOW).kind).toBe('long');
		});
	});

	describe('default cooldowns when no reset is reported', () => {
		it('short defaults to one hour', () => {
			const c = classifyRateLimit('rate limit hit', NOW);
			expect(c.cooldownMs).toBe(DEFAULT_SHORT_COOLDOWN_MS);
			expect(c.resetKnown).toBe(false);
			expect(c.resetAt).toBeUndefined();
		});

		it('long defaults to a daily re-check', () => {
			const c = classifyRateLimit('weekly limit reached', NOW);
			expect(c.cooldownMs).toBe(DEFAULT_LONG_COOLDOWN_MS);
			expect(c.resetKnown).toBe(false);
		});
	});

	describe('explicit duration extraction', () => {
		it('parses "try again in 45 minutes"', () => {
			const c = classifyRateLimit('Rate limited. Try again in 45 minutes.', NOW);
			expect(c.cooldownMs).toBe(45 * 60_000);
			expect(c.resetAt).toBe(NOW + 45 * 60_000);
			expect(c.resetKnown).toBe(true);
		});

		it('parses "retry after 30s"', () => {
			const c = classifyRateLimit('429: retry after 30s', NOW);
			expect(c.cooldownMs).toBe(30_000);
			expect(c.resetKnown).toBe(true);
		});

		it('parses hours and keeps long kind for weekly+duration', () => {
			const c = classifyRateLimit('Weekly limit. Try again in 2 hours.', NOW);
			expect(c.kind).toBe('long');
			expect(c.cooldownMs).toBe(2 * 3_600_000);
		});
	});

	describe('reset-clock extraction', () => {
		it('parses "resets at 3pm" into the next occurrence', () => {
			const c = classifyRateLimit('Usage limit. Resets at 3pm.', NOW);
			expect(c.resetKnown).toBe(true);
			expect(c.resetAt).toBeGreaterThan(NOW);
			// within the next 24h
			expect(c.resetAt! - NOW).toBeLessThanOrEqual(24 * 3_600_000);
		});

		it('rolls a passed time to the next day', () => {
			const d = new Date(NOW);
			d.setHours(1, 0, 0, 0); // 01:00 — set NOW to be after it
			const after = d.getTime() + 5 * 3_600_000; // 06:00-ish
			const c = classifyRateLimit('resets at 1:00', after);
			expect(c.resetAt!).toBeGreaterThan(after);
		});
	});

	describe('robustness', () => {
		it('handles empty / non-string input without throwing', () => {
			expect(classifyRateLimit('', NOW).kind).toBe('short');
			// @ts-expect-error intentional bad input
			expect(classifyRateLimit(undefined, NOW).kind).toBe('short');
		});

		it('ignores an out-of-range clock', () => {
			const c = classifyRateLimit('resets at 99:99', NOW);
			expect(c.resetKnown).toBe(false);
		});
	});
});
