/**
 * @file ParkingPanel.tsx
 * @description Right-Bar "Parking" tab — the logical menu for the Agent Parking
 * feature. Lists every agent currently parked on a rate/usage limit (across all
 * projects, not just the active session) with its reason, penalty kind, a live
 * countdown to the next automatic retry, the known reset time, and per-row
 * actions (Retry now, Un-park). A "Un-park all" action clears them in bulk.
 *
 * Parking replaces the old blocking rate-limit modal: short penalties auto-retry
 * hourly, long (weekly/monthly) penalties retry once near their reset time. This
 * panel makes that state visible and steerable.
 */

import { useEffect, useState } from 'react';
import { Clock, RotateCw, X, ParkingSquare } from 'lucide-react';
import type { Session, Theme } from '../types';
import { useSessionStore } from '../stores/sessionStore';
import { useAgentStore } from '../stores/agentStore';
import { useGroupChatStore } from '../stores/groupChatStore';
import { getAgentDisplayName } from '../../shared/agentMetadata';

interface ParkingPanelProps {
	theme: Theme;
}

/** "in 47 min" / "in 2 h 5 min" / "now" from a future epoch ms. */
function formatCountdown(target: number, now: number): string {
	const ms = target - now;
	if (ms <= 0) return 'now';
	const totalMin = Math.round(ms / 60000);
	if (totalMin < 60) return `in ${totalMin} min`;
	const h = Math.floor(totalMin / 60);
	const m = totalMin % 60;
	if (h < 24) return m ? `in ${h} h ${m} min` : `in ${h} h`;
	const d = Math.floor(h / 24);
	const rh = h % 24;
	return rh ? `in ${d} d ${rh} h` : `in ${d} d`;
}

/** Local clock time "Tue 09:00" for a known reset timestamp. */
function formatResetClock(ts: number): string {
	const d = new Date(ts);
	const day = d.toLocaleDateString(undefined, { weekday: 'short' });
	const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	return `${day} ${time}`;
}

export function ParkingPanel({ theme }: ParkingPanelProps) {
	const sessions = useSessionStore((s) => s.sessions);
	const parked = sessions.filter((s): s is Session => !!s.rateLimitPark);

	const groupChats = useGroupChatStore((s) => s.groupChats);
	const groupChatParks = useGroupChatStore((s) => s.groupChatParks);
	const gcParked = [...groupChatParks.values()];
	const gcName = (id: string) => groupChats.find((c) => c.id === id)?.name ?? 'Group chat';

	const total = parked.length + gcParked.length;

	// Tick once a second so the countdowns stay live while the tab is open.
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (total === 0) return;
		const id = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(id);
	}, [total]);

	const retry = (id: string) => useAgentStore.getState().retryParkedRateLimit(id);
	const unpark = (id: string) => useAgentStore.getState().unparkRateLimit(id);
	const gcRetry = (id: string) => useGroupChatStore.getState().retryParkedGroupChat(id);
	const gcUnpark = (id: string) => useGroupChatStore.getState().unparkGroupChat(id);
	const unparkAll = () => {
		parked.forEach((s) => unpark(s.id));
		gcParked.forEach((p) => gcUnpark(p.groupChatId));
	};

	if (total === 0) {
		return (
			<div
				className="flex flex-col items-center justify-center h-full gap-2 text-center select-none"
				style={{ color: theme.colors.textDim }}
			>
				<ParkingSquare className="w-8 h-8 opacity-40" />
				<div className="text-sm">No agents parked</div>
				<div className="text-xs max-w-[240px]">
					Rate-limited agents park here and auto-retry on their cooldown instead of blocking with an
					error.
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-2 py-2 select-none">
			<div className="flex items-center justify-between px-1">
				<span className="text-xs font-bold" style={{ color: theme.colors.textDim }}>
					Parked ({total})
				</span>
				<button
					onClick={unparkAll}
					className="text-xs px-2 py-0.5 rounded transition-colors hover:opacity-80"
					style={{ color: theme.colors.textDim, borderWidth: 1, borderColor: theme.colors.border }}
				>
					Un-park all
				</button>
			</div>

			{gcParked.map((park) => {
				const isLong = park.kind === 'long';
				const badgeColor = isLong ? theme.colors.error : theme.colors.accent;
				return (
					<div
						key={park.groupChatId}
						className="rounded border p-2.5 flex flex-col gap-1.5"
						style={{ backgroundColor: theme.colors.bgMain, borderColor: theme.colors.border }}
					>
						<div className="flex items-center justify-between gap-2">
							<span
								className="text-sm font-medium truncate"
								style={{ color: theme.colors.textMain }}
								title={gcName(park.groupChatId)}
							>
								{gcName(park.groupChatId)}
							</span>
							<span
								className="text-[10px] px-1.5 py-0.5 rounded shrink-0 font-bold uppercase"
								style={{ backgroundColor: `${badgeColor}22`, color: badgeColor }}
							>
								Group chat
							</span>
						</div>
						<div className="text-xs truncate" style={{ color: theme.colors.textDim }}>
							{park.who} · {park.reason}
						</div>
						<div
							className="flex items-center gap-1.5 text-xs"
							style={{ color: theme.colors.textDim }}
						>
							<Clock className="w-3 h-3" />
							{park.retrying ? (
								<span style={{ color: theme.colors.accent }}>retrying…</span>
							) : park.retryMessage ? (
								<span>Next try {formatCountdown(park.retryAt, now)}</span>
							) : (
								<span>Manual retry only</span>
							)}
							{park.resetKnown && park.resetAt && (
								<span className="opacity-70">· resets {formatResetClock(park.resetAt)}</span>
							)}
							{park.attempts > 0 && <span className="opacity-70">· {park.attempts}×</span>}
						</div>
						<div className="flex items-center gap-1.5 pt-0.5">
							<button
								onClick={() => gcRetry(park.groupChatId)}
								disabled={park.retrying || !park.retryMessage}
								className="flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors disabled:opacity-40"
								style={{ backgroundColor: `${theme.colors.accent}22`, color: theme.colors.accent }}
							>
								<RotateCw className="w-3 h-3" />
								Retry now
							</button>
							<button
								onClick={() => gcUnpark(park.groupChatId)}
								className="flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors hover:bg-white/5"
								style={{ color: theme.colors.textDim }}
							>
								<X className="w-3 h-3" />
								Un-park
							</button>
						</div>
					</div>
				);
			})}

			{parked.map((s) => {
				const park = s.rateLimitPark!;
				const isLong = park.kind === 'long';
				const badgeColor = isLong ? theme.colors.error : theme.colors.accent;
				return (
					<div
						key={s.id}
						className="rounded border p-2.5 flex flex-col gap-1.5"
						style={{ backgroundColor: theme.colors.bgMain, borderColor: theme.colors.border }}
					>
						<div className="flex items-center justify-between gap-2">
							<span
								className="text-sm font-medium truncate"
								style={{ color: theme.colors.textMain }}
								title={s.name}
							>
								{s.name}
							</span>
							<span
								className="text-[10px] px-1.5 py-0.5 rounded shrink-0 font-bold uppercase"
								style={{ backgroundColor: `${badgeColor}22`, color: badgeColor }}
							>
								{isLong ? 'Weekly/Monthly' : 'Cooldown'}
							</span>
						</div>

						<div className="text-xs truncate" style={{ color: theme.colors.textDim }}>
							{getAgentDisplayName(s.toolType)} · {park.reason}
						</div>

						<div
							className="flex items-center gap-1.5 text-xs"
							style={{ color: theme.colors.textDim }}
						>
							<Clock className="w-3 h-3" />
							{park.retrying ? (
								<span style={{ color: theme.colors.accent }}>retrying…</span>
							) : park.prompt ? (
								<span>Next try {formatCountdown(park.retryAt, now)}</span>
							) : (
								<span>Manual retry only</span>
							)}
							{park.resetKnown && park.resetAt && (
								<span className="opacity-70">· resets {formatResetClock(park.resetAt)}</span>
							)}
							{park.attempts > 0 && <span className="opacity-70">· {park.attempts}×</span>}
						</div>

						<div className="flex items-center gap-1.5 pt-0.5">
							<button
								onClick={() => retry(s.id)}
								disabled={park.retrying}
								className="flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors disabled:opacity-40"
								style={{ backgroundColor: `${theme.colors.accent}22`, color: theme.colors.accent }}
							>
								<RotateCw className="w-3 h-3" />
								Retry now
							</button>
							<button
								onClick={() => unpark(s.id)}
								className="flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors hover:bg-white/5"
								style={{ color: theme.colors.textDim }}
							>
								<X className="w-3 h-3" />
								Un-park
							</button>
						</div>
					</div>
				);
			})}
		</div>
	);
}
