/**
 * groupChatStore - Zustand store for group chat state management
 *
 * Replaces GroupChatContext. All group chat states (chats list, messages,
 * moderator state, participant states, execution queue, etc.) live here.
 * Components subscribe to individual slices via selectors to avoid
 * unnecessary re-renders.
 *
 * Refs (groupChatInputRef, groupChatMessagesRef) stay outside the store
 * since they are React-specific and don't trigger re-renders.
 *
 * Can be used outside React via useGroupChatStore.getState().
 */

import { create } from 'zustand';
import type { GroupChat, GroupChatMessage, GroupChatState, AgentError } from '../types';
import type { QueuedItem } from '../types';

// ============================================================================
// Types
// ============================================================================

/** Right panel tab within the group chat view */
export type GroupChatRightTab = 'participants' | 'history';

/** Group chat error state — tracks which chat has an error and from which participant */
export interface GroupChatErrorState {
	groupChatId: string;
	error: AgentError;
	participantName?: string;
}

/**
 * Agent Parking for a group chat: when the moderator or a participant hits a
 * rate/usage limit, the whole chat is parked (cooldown badge + Parking tab)
 * instead of erroring. On cooldown the last user turn is re-sent to the
 * moderator, which re-drives the round. Keyed per group chat.
 */
export interface GroupChatPark {
	groupChatId: string;
	/** Who tripped the limit — "Moderator" or a participant name. */
	who: string;
	kind: 'short' | 'long';
	parkedAt: number;
	retryAt: number;
	resetAt?: number;
	resetKnown: boolean;
	reason: string;
	attempts: number;
	/** True while an auto-retry turn is in flight. */
	retrying?: boolean;
	/** The last user message to re-send to the moderator on retry. */
	retryMessage?: string;
}

export interface GroupChatStoreState {
	// Entity data
	groupChats: GroupChat[];
	activeGroupChatId: string | null;

	// Active chat state
	groupChatMessages: GroupChatMessage[];
	groupChatState: GroupChatState;
	participantStates: Map<string, 'idle' | 'working' | 'timed-out'>;
	moderatorUsage: { contextUsage: number; totalCost: number; tokenCount: number } | null;

	// All-chats tracking (for sidebar busy indicators when chat is not active)
	groupChatStates: Map<string, GroupChatState>;
	allGroupChatParticipantStates: Map<string, Map<string, 'idle' | 'working' | 'timed-out'>>;

	// Execution
	groupChatExecutionQueue: QueuedItem[];
	groupChatReadOnlyMode: boolean;

	// UI
	groupChatRightTab: GroupChatRightTab;
	groupChatParticipantColors: Record<string, string>;
	groupChatStagedImages: string[];

	// Live output peek
	participantLiveOutput: Map<string, string>;

	// Error
	groupChatError: GroupChatErrorState | null;

	// Agent Parking (rate-limit cooldown), keyed per group chat
	groupChatParks: Map<string, GroupChatPark>;
	/** Last user message sent to each chat's moderator (re-sent on park retry). */
	lastModeratorMessage: Map<string, string>;
}

export interface GroupChatStoreActions {
	// Entity setters
	setGroupChats: (v: GroupChat[] | ((prev: GroupChat[]) => GroupChat[])) => void;
	setActiveGroupChatId: (v: string | null | ((prev: string | null) => string | null)) => void;

	// Active chat setters
	setGroupChatMessages: (
		v: GroupChatMessage[] | ((prev: GroupChatMessage[]) => GroupChatMessage[])
	) => void;
	setGroupChatState: (v: GroupChatState | ((prev: GroupChatState) => GroupChatState)) => void;
	setParticipantStates: (
		v:
			| Map<string, 'idle' | 'working' | 'timed-out'>
			| ((
					prev: Map<string, 'idle' | 'working' | 'timed-out'>
			  ) => Map<string, 'idle' | 'working' | 'timed-out'>)
	) => void;
	setModeratorUsage: (
		v:
			| { contextUsage: number; totalCost: number; tokenCount: number }
			| null
			| ((
					prev: { contextUsage: number; totalCost: number; tokenCount: number } | null
			  ) => { contextUsage: number; totalCost: number; tokenCount: number } | null)
	) => void;

	// All-chats tracking
	setGroupChatStates: (
		v:
			| Map<string, GroupChatState>
			| ((prev: Map<string, GroupChatState>) => Map<string, GroupChatState>)
	) => void;
	setAllGroupChatParticipantStates: (
		v:
			| Map<string, Map<string, 'idle' | 'working' | 'timed-out'>>
			| ((
					prev: Map<string, Map<string, 'idle' | 'working' | 'timed-out'>>
			  ) => Map<string, Map<string, 'idle' | 'working' | 'timed-out'>>)
	) => void;

	// Execution
	setGroupChatExecutionQueue: (v: QueuedItem[] | ((prev: QueuedItem[]) => QueuedItem[])) => void;
	setGroupChatReadOnlyMode: (v: boolean | ((prev: boolean) => boolean)) => void;

	// UI
	setGroupChatRightTab: (
		v: GroupChatRightTab | ((prev: GroupChatRightTab) => GroupChatRightTab)
	) => void;
	setGroupChatParticipantColors: (
		v: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)
	) => void;
	setGroupChatStagedImages: (v: string[] | ((prev: string[]) => string[])) => void;

	// Live output peek
	appendParticipantLiveOutput: (participantName: string, chunk: string) => void;
	clearParticipantLiveOutput: (participantName?: string) => void;

	// Error
	setGroupChatError: (
		v:
			| GroupChatErrorState
			| null
			| ((prev: GroupChatErrorState | null) => GroupChatErrorState | null)
	) => void;

	// Agent Parking
	/** Park a group chat on a rate limit (captures the last user turn for retry). */
	parkGroupChat: (
		groupChatId: string,
		who: string,
		park: {
			kind: 'short' | 'long';
			cooldownMs: number;
			resetAt?: number;
			resetKnown: boolean;
			reason: string;
		}
	) => void;
	/** Clear a chat's park (manual un-park or success). */
	unparkGroupChat: (groupChatId: string) => void;
	/** Re-send the parked chat's last user turn to the moderator. */
	retryParkedGroupChat: (groupChatId: string) => void;
	/** Record the last user message sent to a chat's moderator (for park retry). */
	recordModeratorMessage: (groupChatId: string, message: string) => void;

	// Convenience methods
	/** Clear the current error. Focus side-effect (ref.focus) must be handled by caller. */
	clearGroupChatError: () => void;
	/** Reset active chat state (close chat). Clears activeGroupChatId, messages, state, participants, error. */
	resetGroupChatState: () => void;
}

export type GroupChatStore = GroupChatStoreState & GroupChatStoreActions;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Resolve a value-or-updater argument, matching React's setState signature.
 */
function resolve<T>(valOrFn: T | ((prev: T) => T), prev: T): T {
	return typeof valOrFn === 'function' ? (valOrFn as (prev: T) => T)(prev) : valOrFn;
}

// ============================================================================
// Store
// ============================================================================

export const useGroupChatStore = create<GroupChatStore>()((set) => ({
	// --- State ---
	groupChats: [],
	activeGroupChatId: null,
	groupChatMessages: [],
	groupChatState: 'idle' as GroupChatState,
	participantStates: new Map(),
	moderatorUsage: null,
	groupChatStates: new Map(),
	allGroupChatParticipantStates: new Map(),
	groupChatExecutionQueue: [],
	groupChatReadOnlyMode: false,
	groupChatRightTab: 'participants' as GroupChatRightTab,
	groupChatParticipantColors: {},
	groupChatStagedImages: [],
	participantLiveOutput: new Map(),
	groupChatError: null,
	groupChatParks: new Map(),
	lastModeratorMessage: new Map(),

	// --- Actions ---
	setGroupChats: (v) => set((s) => ({ groupChats: resolve(v, s.groupChats) })),
	setActiveGroupChatId: (v) => set((s) => ({ activeGroupChatId: resolve(v, s.activeGroupChatId) })),
	setGroupChatMessages: (v) => set((s) => ({ groupChatMessages: resolve(v, s.groupChatMessages) })),
	setGroupChatState: (v) => set((s) => ({ groupChatState: resolve(v, s.groupChatState) })),
	setParticipantStates: (v) => set((s) => ({ participantStates: resolve(v, s.participantStates) })),
	setModeratorUsage: (v) => set((s) => ({ moderatorUsage: resolve(v, s.moderatorUsage) })),
	setGroupChatStates: (v) => set((s) => ({ groupChatStates: resolve(v, s.groupChatStates) })),
	setAllGroupChatParticipantStates: (v) =>
		set((s) => ({
			allGroupChatParticipantStates: resolve(v, s.allGroupChatParticipantStates),
		})),
	setGroupChatExecutionQueue: (v) =>
		set((s) => ({ groupChatExecutionQueue: resolve(v, s.groupChatExecutionQueue) })),
	setGroupChatReadOnlyMode: (v) =>
		set((s) => ({ groupChatReadOnlyMode: resolve(v, s.groupChatReadOnlyMode) })),
	setGroupChatRightTab: (v) => set((s) => ({ groupChatRightTab: resolve(v, s.groupChatRightTab) })),
	setGroupChatParticipantColors: (v) =>
		set((s) => ({ groupChatParticipantColors: resolve(v, s.groupChatParticipantColors) })),
	setGroupChatStagedImages: (v) =>
		set((s) => ({ groupChatStagedImages: resolve(v, s.groupChatStagedImages) })),
	setGroupChatError: (v) => set((s) => ({ groupChatError: resolve(v, s.groupChatError) })),

	appendParticipantLiveOutput: (participantName, chunk) =>
		set((s) => {
			const next = new Map(s.participantLiveOutput);
			const existing = next.get(participantName) || '';
			// Cap at ~50KB per participant to prevent unbounded growth
			const combined = existing + chunk;
			next.set(participantName, combined.length > 50000 ? combined.slice(-50000) : combined);
			return { participantLiveOutput: next };
		}),

	clearParticipantLiveOutput: (participantName) =>
		set((s) => {
			if (participantName) {
				const next = new Map(s.participantLiveOutput);
				next.delete(participantName);
				return { participantLiveOutput: next };
			}
			return { participantLiveOutput: new Map() };
		}),

	parkGroupChat: (groupChatId, who, p) =>
		set((s) => {
			const now = Date.now();
			const prev = s.groupChatParks.get(groupChatId);
			const next = new Map(s.groupChatParks);
			next.set(groupChatId, {
				groupChatId,
				who,
				kind: p.kind,
				parkedAt: now,
				retryAt: now + Math.max(0, p.cooldownMs),
				resetAt: p.resetAt,
				resetKnown: p.resetKnown,
				reason: p.reason,
				// Preserve attempts + the captured user turn across re-parks.
				attempts: prev ? prev.attempts + 1 : 0,
				retrying: false,
				retryMessage: prev?.retryMessage ?? s.lastModeratorMessage.get(groupChatId),
			});
			return { groupChatParks: next };
		}),

	unparkGroupChat: (groupChatId) =>
		set((s) => {
			if (!s.groupChatParks.has(groupChatId)) return s;
			const next = new Map(s.groupChatParks);
			next.delete(groupChatId);
			return { groupChatParks: next };
		}),

	retryParkedGroupChat: (groupChatId) => {
		const s = useGroupChatStore.getState();
		const park = s.groupChatParks.get(groupChatId);
		if (!park || !park.retryMessage) return;
		// Mark retrying and re-drive the round by re-sending the last user turn.
		set((st) => {
			const next = new Map(st.groupChatParks);
			const cur = next.get(groupChatId);
			if (cur) next.set(groupChatId, { ...cur, retrying: true });
			const states = new Map(st.groupChatStates);
			states.set(groupChatId, 'moderator-thinking');
			return {
				groupChatParks: next,
				groupChatStates: states,
				...(st.activeGroupChatId === groupChatId
					? { groupChatState: 'moderator-thinking' as GroupChatState }
					: {}),
			};
		});
		window.maestro.groupChat.sendToModerator(groupChatId, park.retryMessage).catch(() => {
			// A failed re-send surfaces as a fresh agent-error → re-park.
		});
	},

	recordModeratorMessage: (groupChatId, message) =>
		set((s) => {
			const next = new Map(s.lastModeratorMessage);
			next.set(groupChatId, message);
			return { lastModeratorMessage: next };
		}),

	clearGroupChatError: () => set({ groupChatError: null }),

	resetGroupChatState: () =>
		set({
			activeGroupChatId: null,
			groupChatMessages: [],
			groupChatState: 'idle' as GroupChatState,
			participantStates: new Map(),
			participantLiveOutput: new Map(),
			groupChatError: null,
		}),
}));
