/**
 * @file rate-limit-classify.ts
 * @description Classify a detected rate-limit error into a "short" (hourly /
 * rolling-window) or "long" (weekly / monthly / quota) penalty, and extract a
 * cooldown duration or reset time where the agent provides one.
 *
 * This is additive on top of `matchErrorPattern()`: that function decides an
 * error is `rate_limited`; this one decides how to PARK it. Kept separate so
 * the hot streaming matcher stays untouched and this only runs once per actual
 * rate-limit hit.
 *
 * Powers the Agent Parking feature: short penalties auto-retry hourly, long
 * penalties retry once near their reset time (see RateLimitParkingScheduler).
 */

/** How severe a rate-limit penalty is, which drives the retry cadence. */
export type RateLimitKind = 'short' | 'long';

export interface RateLimitClassification {
	kind: RateLimitKind;
	/** Milliseconds until the next automatic retry should fire (from `now`). */
	cooldownMs: number;
	/** Absolute epoch ms when the limit is known to reset, if the agent said so. */
	resetAt?: number;
	/** Whether a reset time / duration was actually parsed (vs. defaulted). */
	resetKnown: boolean;
}

/** Default cooldown for a short penalty when the agent gives no reset hint: 1h. */
export const DEFAULT_SHORT_COOLDOWN_MS = 60 * 60 * 1000;
/** Default cooldown for a long penalty when no reset is known: re-check daily. */
export const DEFAULT_LONG_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// Signals that escalate a rate-limit to a long (weekly/monthly/plan) penalty.
const LONG_SIGNAL =
	/\b(week|weekly|month|monthly|per[-\s]?day|daily limit|usage limit|quota\s*exceeded|plan limit|monthly limit|spending limit)\b/i;

// "try again in 45 minutes", "retry after 30s", "wait 2 hours"
const DURATION_RE =
	/\b(?:try again in|retry after|retry in|wait(?:\s+for)?|available in|back in)\s+(\d+)\s*(second|sec|s|minute|min|m|hour|hr|h|day|d)s?\b/i;

// "resets at 3:00pm", "resets at 15:30", "limit resets at 3pm"
const RESET_AT_CLOCK_RE = /\bresets?\s+(?:at|in)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;

const UNIT_MS: Record<string, number> = {
	s: 1000,
	sec: 1000,
	second: 1000,
	m: 60_000,
	min: 60_000,
	minute: 60_000,
	h: 3_600_000,
	hr: 3_600_000,
	hour: 3_600_000,
	d: 86_400_000,
	day: 86_400_000,
};

/** Parse a relative "in N units" duration into ms, or null. */
function parseDurationMs(line: string): number | null {
	const m = line.match(DURATION_RE);
	if (!m) return null;
	const n = parseInt(m[1], 10);
	const unit = m[2].toLowerCase();
	const base = UNIT_MS[unit];
	if (!base || !Number.isFinite(n)) return null;
	return n * base;
}

/**
 * Parse a clock-time "resets at HH[:MM] [am|pm]" into the next epoch ms it
 * occurs at, relative to `now`. Returns null if not present/parseable.
 */
function parseResetClock(line: string, now: number): number | null {
	const m = line.match(RESET_AT_CLOCK_RE);
	if (!m) return null;
	let hour = parseInt(m[1], 10);
	const minute = m[2] ? parseInt(m[2], 10) : 0;
	const ampm = m[3]?.toLowerCase();
	if (Number.isNaN(hour) || hour > 23 || minute > 59) return null;
	if (ampm === 'pm' && hour < 12) hour += 12;
	if (ampm === 'am' && hour === 12) hour = 0;
	const d = new Date(now);
	d.setHours(hour, minute, 0, 0);
	let ts = d.getTime();
	// If that time already passed today, it must mean the next occurrence.
	if (ts <= now) ts += 86_400_000;
	return ts;
}

/**
 * Classify a rate-limit error line into a park penalty.
 *
 * @param line   The raw error line(s) that tripped the rate_limited matcher.
 * @param now    Current epoch ms (injectable for tests).
 */
export function classifyRateLimit(line: string, now: number): RateLimitClassification {
	const text = typeof line === 'string' ? line : '';
	const isLong = LONG_SIGNAL.test(text);

	// Prefer an explicit reset/duration the agent gave us.
	const durationMs = parseDurationMs(text);
	const resetClock = parseResetClock(text, now);

	if (durationMs != null) {
		const resetAt = now + durationMs;
		return {
			kind: isLong ? 'long' : 'short',
			cooldownMs: durationMs,
			resetAt,
			resetKnown: true,
		};
	}
	if (resetClock != null) {
		return {
			kind: isLong ? 'long' : 'short',
			cooldownMs: Math.max(0, resetClock - now),
			resetAt: resetClock,
			resetKnown: true,
		};
	}

	// No hint parsed: fall back to kind-appropriate defaults.
	return {
		kind: isLong ? 'long' : 'short',
		cooldownMs: isLong ? DEFAULT_LONG_COOLDOWN_MS : DEFAULT_SHORT_COOLDOWN_MS,
		resetKnown: false,
	};
}
