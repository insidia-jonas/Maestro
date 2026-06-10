/**
 * useRateLimitParking — the Agent Parking scheduler (renderer-side).
 *
 * Watches every session with a `rateLimitPark` and arms one timer per parked
 * agent that fires at its `retryAt`. On fire it calls `retryParkedRateLimit`,
 * which re-sends the parked prompt. The outcome flows through the normal
 * listeners: real output un-parks (success), a renewed limit re-parks with a
 * fresh cooldown (failure). Short penalties retry hourly; long penalties were
 * scheduled near their reset time.
 *
 * Lives in the renderer because the park state and the send path both live
 * here. Mount once (App.tsx). Timers `unref` is not needed in the renderer.
 */

import { useEffect, useRef } from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { useAgentStore } from '../../stores/agentStore';

export function useRateLimitParking(): void {
	const sessions = useSessionStore((s) => s.sessions);
	const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

	// Only sessions that are parked, not already retrying, and have a prompt to
	// re-send can be auto-retried. Prompt-less parks wait for a manual retry.
	const armable = sessions
		.filter((s) => s.rateLimitPark && !s.rateLimitPark.retrying && s.rateLimitPark.prompt)
		.map((s) => ({ id: s.id, retryAt: s.rateLimitPark!.retryAt }));

	// Re-arm only when the parked set or any retryAt changes.
	const signature = armable
		.map((p) => `${p.id}:${p.retryAt}`)
		.sort()
		.join('|');

	useEffect(() => {
		const timers = timersRef.current;
		const armableIds = new Set(armable.map((p) => p.id));

		// Drop timers for sessions that are no longer armable (un-parked, retrying).
		for (const [id, t] of timers) {
			if (!armableIds.has(id)) {
				clearTimeout(t);
				timers.delete(id);
			}
		}

		// Arm / re-arm a timer per armable parked session.
		for (const p of armable) {
			const existing = timers.get(p.id);
			if (existing) clearTimeout(existing);
			const delay = Math.max(0, p.retryAt - Date.now());
			const timer = setTimeout(() => {
				timers.delete(p.id);
				useAgentStore.getState().retryParkedRateLimit(p.id);
			}, delay);
			timers.set(p.id, timer);
		}
		// `armable` is intentionally omitted: it is recomputed every render, but
		// `signature` captures the only changes that should re-arm timers (the
		// parked set or any retryAt). Re-running on every render would thrash.
	}, [signature]);

	// Clear all timers on unmount.
	useEffect(() => {
		const timers = timersRef.current;
		return () => {
			for (const t of timers.values()) clearTimeout(t);
			timers.clear();
		};
	}, []);
}
