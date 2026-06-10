/**
 * useGroupChatParking — Agent Parking scheduler for group chats.
 *
 * Mirrors useRateLimitParking but for the per-chat parks in groupChatStore.
 * Arms one timer per parked chat at its retryAt; on fire it re-sends the last
 * user turn to the moderator (retryParkedGroupChat), which re-drives the round.
 * Success un-parks via the global onStateChange listener; a renewed limit
 * re-parks with a fresh cooldown. Only parks that captured a retry message are
 * auto-retried; the rest wait for a manual retry from the Parking tab.
 *
 * Mount once (App.tsx).
 */

import { useEffect, useRef } from 'react';
import { useGroupChatStore } from '../../stores/groupChatStore';

export function useGroupChatParking(): void {
	const parks = useGroupChatStore((s) => s.groupChatParks);
	const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

	const armable = [...parks.values()]
		.filter((p) => !p.retrying && p.retryMessage)
		.map((p) => ({ id: p.groupChatId, retryAt: p.retryAt }));

	const signature = armable
		.map((p) => `${p.id}:${p.retryAt}`)
		.sort()
		.join('|');

	useEffect(() => {
		const timers = timersRef.current;
		const armableIds = new Set(armable.map((p) => p.id));

		for (const [id, t] of timers) {
			if (!armableIds.has(id)) {
				clearTimeout(t);
				timers.delete(id);
			}
		}

		for (const p of armable) {
			const existing = timers.get(p.id);
			if (existing) clearTimeout(existing);
			const delay = Math.max(0, p.retryAt - Date.now());
			const timer = setTimeout(() => {
				timers.delete(p.id);
				useGroupChatStore.getState().retryParkedGroupChat(p.id);
			}, delay);
			timers.set(p.id, timer);
		}
		// `signature` captures the only changes that should re-arm timers; `armable`
		// is recomputed every render and is intentionally not a dependency.
	}, [signature]);

	useEffect(() => {
		const timers = timersRef.current;
		return () => {
			for (const t of timers.values()) clearTimeout(t);
			timers.clear();
		};
	}, []);
}
