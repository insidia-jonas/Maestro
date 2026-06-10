/**
 * @file GroupChatParkBanner.tsx
 * @description Non-blocking cooldown banner shown inside a group chat when it is
 * parked on a rate/usage limit (Agent Parking). Replaces the old blocking error
 * for rate limits: shows who tripped the limit, a live countdown to the next
 * automatic retry, the known reset time, and Retry/Un-park actions. The same
 * park also appears in the global Parking tab.
 */

import { useEffect, useState } from 'react';
import { Clock, RotateCw, X } from 'lucide-react';
import type { Theme } from '../types';
import { useGroupChatStore } from '../stores/groupChatStore';

interface GroupChatParkBannerProps {
	theme: Theme;
	groupChatId: string;
}

function countdown(target: number, now: number): string {
	const ms = target - now;
	if (ms <= 0) return 'now';
	const min = Math.round(ms / 60000);
	if (min < 60) return `in ${min} min`;
	const h = Math.floor(min / 60);
	const m = min % 60;
	if (h < 24) return m ? `in ${h} h ${m} min` : `in ${h} h`;
	const d = Math.floor(h / 24);
	return `in ${d} d`;
}

export function GroupChatParkBanner({ theme, groupChatId }: GroupChatParkBannerProps) {
	const park = useGroupChatStore((s) => s.groupChatParks.get(groupChatId));
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		if (!park) return;
		const id = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(id);
	}, [park]);

	if (!park) return null;

	const isLong = park.kind === 'long';
	const accent = isLong ? theme.colors.error : theme.colors.accent;
	const retry = () => useGroupChatStore.getState().retryParkedGroupChat(groupChatId);
	const unpark = () => useGroupChatStore.getState().unparkGroupChat(groupChatId);

	return (
		<div
			className="flex items-center gap-2 px-3 py-2 text-xs select-none"
			style={{ backgroundColor: `${accent}12`, borderBottom: `1px solid ${accent}40` }}
		>
			<Clock className="w-3.5 h-3.5 shrink-0" style={{ color: accent }} />
			<span style={{ color: theme.colors.textMain }} className="font-medium">
				Parked — {park.who}
			</span>
			<span className="truncate" style={{ color: theme.colors.textDim }}>
				{park.reason}
				{park.retrying
					? ' · retrying…'
					: park.retryMessage
						? ` · auto-retry ${countdown(park.retryAt, now)}`
						: ' · manual retry only'}
				{park.attempts > 0 ? ` · ${park.attempts}×` : ''}
			</span>
			<div className="ml-auto flex items-center gap-1.5 shrink-0">
				<button
					onClick={retry}
					disabled={park.retrying || !park.retryMessage}
					className="flex items-center gap-1 px-2 py-0.5 rounded transition-colors disabled:opacity-40"
					style={{ backgroundColor: `${accent}22`, color: accent }}
				>
					<RotateCw className="w-3 h-3" />
					Retry now
				</button>
				<button
					onClick={unpark}
					className="flex items-center gap-1 px-2 py-0.5 rounded transition-colors hover:bg-white/5"
					style={{ color: theme.colors.textDim }}
					title="Un-park"
				>
					<X className="w-3 h-3" />
				</button>
			</div>
		</div>
	);
}
