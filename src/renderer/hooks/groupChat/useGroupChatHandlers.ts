/**
 * useGroupChatHandlers — extracted from App.tsx (Phase 2B)
 *
 * Owns all group chat lifecycle callbacks, IPC event listeners,
 * execution queue processing, error recovery, and refs.
 * Reads from Zustand stores directly — no parameters needed.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { GroupChatMessagesHandle } from '../../components/GroupChatMessages';
import type { GroupChatRightTab } from '../../components/GroupChatRightPanel';
import type { RecoveryAction } from '../../components/AgentErrorModal';
import type { QueuedItem, ModeratorConfig } from '../../types';
import { moderatorPromptFilename } from '../../utils/generateModeratorPrompt';
import { useGroupChatStore } from '../../stores/groupChatStore';
import { useModalStore } from '../../stores/modalStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useBatchStore } from '../../stores/batchStore';
import { useUIStore } from '../../stores/uiStore';
import { useAgentErrorRecovery } from '../agent/useAgentErrorRecovery';
import type { ToolType } from '../../../shared/types';
import { notifyToast } from '../../stores/notificationStore';
import { generateId } from '../../utils/ids';
import { aiTabFocusFields } from '../../utils/tabHelpers';
import { getAutoRunSessionsForGroupChat } from '../../utils/groupChatAutoRunRegistry';
import { logger } from '../../utils/logger';

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface GroupChatHandlersReturn {
	// Refs
	groupChatInputRef: React.RefObject<HTMLTextAreaElement>;
	groupChatMessagesRef: React.RefObject<GroupChatMessagesHandle>;

	// Error recovery
	handleClearGroupChatError: () => void;
	groupChatRecoveryActions: RecoveryAction[];

	// CRUD
	handleOpenGroupChat: (id: string) => Promise<void>;
	handleCloseGroupChat: () => void;
	handleCreateGroupChat: (
		name: string,
		moderatorAgentId: string,
		moderatorConfig?: {
			customPath?: string;
			customArgs?: string;
			customEnvVars?: Record<string, string>;
			customModel?: string;
			enableMaestroP?: boolean;
			maestroPMode?: 'interactive' | 'dynamic';
			maestroPPath?: string;
		}
	) => Promise<void>;
	handleDeleteGroupChat: (id: string) => Promise<void>;
	handleArchiveGroupChat: (id: string, archived: boolean) => Promise<void>;
	handleRenameGroupChat: (id: string, newName: string) => Promise<void>;
	handleUpdateGroupChat: (
		id: string,
		name: string,
		moderatorAgentId: string,
		moderatorConfig?: {
			customPath?: string;
			customArgs?: string;
			customEnvVars?: Record<string, string>;
			enableMaestroP?: boolean;
			maestroPMode?: 'interactive' | 'dynamic';
			maestroPPath?: string;
		}
	) => Promise<void>;
	deleteGroupChatWithConfirmation: (id: string) => void;
	handleDeleteAllArchivedGroupChats: () => void;

	/**
	 * Create a group chat via the wizard: writes the generated moderator prompt
	 * file to ~/.maestro/prompts/, wires it into the moderator config, creates
	 * the chat, and docks the selected existing sessions as participants.
	 */
	handleCreateGroupChatWithWizard: (input: {
		name: string;
		moderatorAgentId: string;
		moderatorConfig?: ModeratorConfig;
		promptContent: string;
		participants: { name: string; agentId: string; cwd?: string }[];
	}) => Promise<void>;

	// Navigation
	handleProcessMonitorNavigateToGroupChat: (groupChatId: string) => void;
	handleOpenModeratorSession: (moderatorSessionId: string) => void;
	handleJumpToGroupChatMessage: (timestamp: number) => void;

	// Right panel
	handleGroupChatRightTabChange: (tab: GroupChatRightTab) => void;

	// Stop All
	handleStopAll: () => Promise<void>;

	// Messages & queue
	handleSendGroupChatMessage: (
		content: string,
		images?: string[],
		readOnly?: boolean
	) => Promise<void>;
	handleGroupChatDraftChange: (draft: string) => void;
	handleRemoveGroupChatQueueItem: (itemId: string) => void;
	handleReorderGroupChatQueueItems: (fromIndex: number, toIndex: number) => void;

	// Modal openers
	handleNewGroupChat: () => void;
	handleEditGroupChat: (id: string) => void;
	handleOpenRenameGroupChatModal: (id: string) => void;
	handleOpenDeleteGroupChatModal: (id: string) => void;
	handleOpenWakeUpCallModal: (id: string) => void;

	// Modal closers (for AppGroupChatModals component)
	handleCloseNewGroupChatModal: () => void;
	handleCloseDeleteGroupChatModal: () => void;
	handleConfirmDeleteGroupChat: () => void;
	handleCloseRenameGroupChatModal: () => void;
	handleRenameGroupChatFromModal: (newName: string) => void;
	handleCloseEditGroupChatModal: () => void;
	handleCloseGroupChatInfo: () => void;
	handleCloseWakeUpCallModal: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resets group chat UI to idle state. Shared by handleCloseGroupChat and handleOpenModeratorSession. */
function resetGroupChatUI(): void {
	const {
		setActiveGroupChatId,
		setGroupChatMessages,
		setGroupChatState,
		setParticipantStates,
		setGroupChatError,
	} = useGroupChatStore.getState();
	setActiveGroupChatId(null);
	setGroupChatMessages([]);
	setGroupChatState('idle');
	setParticipantStates(new Map());
	setGroupChatError(null);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useGroupChatHandlers(): GroupChatHandlersReturn {
	// --- Refs ---
	const groupChatInputRef = useRef<HTMLTextAreaElement>(null);
	const groupChatMessagesRef = useRef<GroupChatMessagesHandle>(null);

	// --- Reactive reads (for effects only) ---
	const activeGroupChatId = useGroupChatStore((s) => s.activeGroupChatId);
	const groupChatState = useGroupChatStore((s) => s.groupChatState);
	const groupChatStates = useGroupChatStore((s) => s.groupChatStates);
	const groupChatExecutionQueue = useGroupChatStore((s) => s.groupChatExecutionQueue);
	const groupChatError = useGroupChatStore((s) => s.groupChatError);

	// =======================================================================
	// Error recovery
	// =======================================================================

	const handleClearGroupChatError = useCallback(() => {
		useGroupChatStore.getState().clearGroupChatError();
		setTimeout(() => groupChatInputRef.current?.focus(), 0);
	}, []);

	const groupChats = useGroupChatStore((s) => s.groupChats);
	const moderatorAgentId = (groupChats.find((c) => c.id === activeGroupChatId)?.moderatorAgentId ??
		'claude-code') as ToolType;

	const { recoveryActions: groupChatRecoveryActions } = useAgentErrorRecovery({
		error: groupChatError?.error,
		agentId: moderatorAgentId,
		sessionId: groupChatError?.groupChatId || '',
		onRetry: handleClearGroupChatError,
		onClearError: handleClearGroupChatError,
	});

	// =======================================================================
	// IPC Event Listeners — Global (session-agnostic, registered once)
	// =======================================================================

	useEffect(() => {
		const {
			setGroupChatState,
			setGroupChatStates,
			setGroupChats,
			setAllGroupChatParticipantStates,
			setParticipantStates,
			appendParticipantLiveOutput,
			clearParticipantLiveOutput,
		} = useGroupChatStore.getState();

		const unsubState = window.maestro.groupChat.onStateChange((id, state) => {
			// Track state for ALL group chats (for sidebar indicator when not active)
			setGroupChatStates((prev) => {
				const next = new Map(prev);
				next.set(id, state);
				return next;
			});
			// Also update the active group chat's state for immediate UI
			if (id === useGroupChatStore.getState().activeGroupChatId) {
				setGroupChatState(state);
			}
			// Agent Parking success: a retrying parked chat that reaches idle without a
			// fresh rate-limit (which would have re-parked + cleared `retrying`) means
			// the round completed — un-park it.
			if (state === 'idle') {
				const park = useGroupChatStore.getState().groupChatParks.get(id);
				if (park?.retrying) {
					useGroupChatStore.getState().unparkGroupChat(id);
				}
			}
		});

		const unsubParticipants = window.maestro.groupChat.onParticipantsChanged((id, participants) => {
			setGroupChats((prev) =>
				prev.map((chat) => (chat.id === id ? { ...chat, participants } : chat))
			);
		});

		const unsubParticipantState = window.maestro.groupChat.onParticipantState?.(
			(id, participantName, state) => {
				// Track participant state for ALL group chats (for sidebar indicator)
				setAllGroupChatParticipantStates((prev) => {
					const next = new Map(prev);
					const chatStates = next.get(id) || new Map();
					const updatedChatStates = new Map(chatStates);
					updatedChatStates.set(participantName, state);
					next.set(id, updatedChatStates);
					return next;
				});
				// Also update the active group chat's participant states for immediate UI
				if (id === useGroupChatStore.getState().activeGroupChatId) {
					setParticipantStates((prev) => {
						const next = new Map(prev);
						next.set(participantName, state);
						return next;
					});
				}
				// Clear live output when participant becomes idle or timed out
				if (state === 'idle' || state === 'timed-out') {
					clearParticipantLiveOutput(`${id}:${participantName}`);
				}
			}
		);

		const unsubLiveOutput = window.maestro.groupChat.onParticipantLiveOutput?.(
			(id, participantName, chunk) => {
				if (id === useGroupChatStore.getState().activeGroupChatId) {
					appendParticipantLiveOutput(`${id}:${participantName}`, chunk);
				}
			}
		);

		const unsubModeratorSessionId = window.maestro.groupChat.onModeratorSessionIdChanged?.(
			(id, agentSessionId) => {
				setGroupChats((prev) =>
					prev.map((chat) =>
						chat.id === id ? { ...chat, moderatorAgentSessionId: agentSessionId } : chat
					)
				);
			}
		);

		// Force-complete the batch run for an autorun participant.
		// Fired by the main process on both normal completion (reportAutoRunComplete) and
		// on the participant timeout, so the AUTO badge and progress bar always clear.
		const unsubBatchComplete = window.maestro.groupChat.onAutoRunBatchComplete?.(
			(groupChatId, participantName) => {
				// Prefer group-chat-scoped autorun registry to avoid name collisions across chats.
				// Only complete the specific participant's session, not all sessions for the chat.
				const autoRunSessionIds = getAutoRunSessionsForGroupChat(groupChatId);
				if (autoRunSessionIds.length > 0) {
					const sessions = useSessionStore.getState().sessions;
					const matchingSessionId = autoRunSessionIds.find((sid) =>
						sessions.some((s) => s.id === sid && s.name === participantName)
					);
					if (matchingSessionId) {
						useBatchStore.getState().dispatchBatch({
							type: 'COMPLETE_BATCH',
							sessionId: matchingSessionId,
						});
						return;
					}
				}
				// Fallback: resolve by participant name if registry entry was already consumed
				const session = useSessionStore.getState().sessions.find((s) => s.name === participantName);
				if (!session) return;
				useBatchStore.getState().dispatchBatch({
					type: 'COMPLETE_BATCH',
					sessionId: session.id,
				});
			}
		);

		return () => {
			unsubState();
			unsubParticipants();
			unsubParticipantState?.();
			unsubLiveOutput?.();
			unsubModeratorSessionId?.();
			unsubBatchComplete?.();
		};
	}, []); // Mount once — global listeners read activeGroupChatId from store at call time

	// =======================================================================
	// IPC Event Listeners — Active chat (re-registered on chat switch)
	// =======================================================================

	useEffect(() => {
		if (!activeGroupChatId) return;

		const { setGroupChatMessages, setModeratorUsage } = useGroupChatStore.getState();

		const unsubMessage = window.maestro.groupChat.onMessage((id, message) => {
			if (id === activeGroupChatId) {
				setGroupChatMessages((prev) => [...prev, message]);
			}
		});

		const unsubModeratorUsage = window.maestro.groupChat.onModeratorUsage?.((id, usage) => {
			if (id === activeGroupChatId) {
				// When contextUsage is -1, tokens were accumulated from multi-tool turns.
				// Preserve previous context/token values; only update cost.
				if (usage.contextUsage < 0) {
					setModeratorUsage((prev) =>
						prev
							? { ...prev, totalCost: usage.totalCost }
							: { contextUsage: 0, totalCost: usage.totalCost, tokenCount: 0 }
					);
				} else {
					setModeratorUsage(usage);
				}
			}
		});

		return () => {
			unsubMessage();
			unsubModeratorUsage?.();
		};
	}, [activeGroupChatId]);

	// =======================================================================
	// Execution queue processor
	// =======================================================================

	useEffect(() => {
		if (groupChatExecutionQueue.length === 0) return;

		const {
			setGroupChatExecutionQueue,
			setGroupChatState: setGCState,
			setGroupChatStates: setGCStates,
			setGroupChatMessages: setGCMessages,
		} = useGroupChatStore.getState();

		// A queued message runs in the chat it was typed into (item.tabId), and
		// only once THAT chat is idle — never the currently-active chat. This
		// keeps each group chat's queue ordered and prevents a prompt queued for
		// chat A from firing against chat B after the user switches chats.
		// The per-chat state map is kept current for every chat (active or not)
		// by the global onStateChange listener, so a background chat going idle
		// re-triggers this effect and flushes its own next item.
		const chatIsIdle = (chatId: string): boolean =>
			chatId === activeGroupChatId
				? groupChatState === 'idle'
				: (groupChatStates.get(chatId) ?? 'idle') === 'idle';

		const idx = groupChatExecutionQueue.findIndex((item) => !!item.tabId && chatIsIdle(item.tabId));
		if (idx === -1) return; // every queued item's target chat is still busy

		const nextItem = groupChatExecutionQueue[idx];
		const targetChatId = nextItem.tabId as string;
		setGroupChatExecutionQueue(groupChatExecutionQueue.filter((_, i) => i !== idx));

		setGCStates((prev) => {
			const next = new Map(prev);
			next.set(targetChatId, 'moderator-thinking');
			return next;
		});
		if (targetChatId === activeGroupChatId) setGCState('moderator-thinking');

		// Remember this turn so Agent Parking can re-send it on a rate-limit retry.
		useGroupChatStore.getState().recordModeratorMessage(targetChatId, nextItem.text || '');

		window.maestro.groupChat
			.sendToModerator(targetChatId, nextItem.text || '', nextItem.images, nextItem.readOnlyMode)
			.catch((err: unknown) => {
				const msg = err instanceof Error ? err.message : String(err);
				// Reset the TARGET chat to idle so the user can retry
				setGCStates((prev) => {
					const next = new Map(prev);
					next.set(targetChatId, 'idle');
					return next;
				});
				if (targetChatId === activeGroupChatId) {
					setGCState('idle');
					// Only surface the error banner when the user is looking at that chat
					setGCMessages((prev) => [
						...prev,
						{
							timestamp: new Date().toISOString(),
							from: 'system',
							content: `⚠️ Moderator is not available. Try sending your message again. (${msg})`,
						},
					]);
				}
			});
	}, [groupChatState, groupChatStates, groupChatExecutionQueue, activeGroupChatId]);

	// =======================================================================
	// Navigate to group chat from ProcessMonitor
	// =======================================================================

	const handleProcessMonitorNavigateToGroupChat = useCallback((groupChatId: string) => {
		const {
			setActiveGroupChatId,
			setGroupChatState,
			setParticipantStates,
			groupChatStates,
			allGroupChatParticipantStates,
		} = useGroupChatStore.getState();
		const { closeModal } = useModalStore.getState();
		setActiveGroupChatId(groupChatId);
		setGroupChatState(groupChatStates.get(groupChatId) ?? 'idle');
		setParticipantStates(allGroupChatParticipantStates.get(groupChatId) ?? new Map());
		closeModal('processMonitor');
	}, []);

	// =======================================================================
	// Core group chat handlers
	// =======================================================================

	const handleOpenGroupChat = useCallback(async (id: string) => {
		const {
			setActiveGroupChatId,
			setGroupChatMessages,
			setGroupChatState,
			setGroupChatRightTab,
			setGroupChats,
			setParticipantStates,
			groupChatStates,
			allGroupChatParticipantStates,
		} = useGroupChatStore.getState();
		const { setActiveFocus } = useUIStore.getState();

		const chat = await window.maestro.groupChat.load(id);
		if (chat) {
			setActiveGroupChatId(id);
			const messages = await window.maestro.groupChat.getMessages(id);
			setGroupChatMessages(messages);

			// Restore the state for this specific chat from the per-chat state map
			setGroupChatState(groupChatStates.get(id) ?? 'idle');

			// Restore participant states for this chat
			setParticipantStates(allGroupChatParticipantStates.get(id) ?? new Map());

			// Load saved right tab preference for this group chat
			const savedTab = await window.maestro.settings.get(`groupChatRightTab:${id}`);
			if (savedTab === 'participants' || savedTab === 'history') {
				setGroupChatRightTab(savedTab);
			} else {
				setGroupChatRightTab('participants'); // Default
			}

			// Start moderator if not running
			// Fixes MAESTRO-B2: handle case where group chat was deleted between operations
			try {
				const moderatorSessionId = await window.maestro.groupChat.startModerator(id);
				if (moderatorSessionId) {
					setGroupChats((prev) =>
						prev.map((c) => (c.id === id ? { ...c, moderatorSessionId } : c))
					);
				}
			} catch (error) {
				logger.warn(`Failed to start moderator for group chat ${id}:`, undefined, error);
			}

			// Focus the input after the component renders
			setTimeout(() => {
				setActiveFocus('main');
				groupChatInputRef.current?.focus();
			}, 100);
		}
	}, []);

	const handleCloseGroupChat = useCallback(() => {
		resetGroupChatUI();
	}, []);

	const handleGroupChatRightTabChange = useCallback((tab: GroupChatRightTab) => {
		const { setGroupChatRightTab, activeGroupChatId } = useGroupChatStore.getState();
		setGroupChatRightTab(tab);
		if (activeGroupChatId) {
			window.maestro.settings.set(`groupChatRightTab:${activeGroupChatId}`, tab);
		}
	}, []);

	const handleJumpToGroupChatMessage = useCallback((timestamp: number) => {
		groupChatMessagesRef.current?.scrollToMessage(timestamp);
	}, []);

	const handleOpenModeratorSession = useCallback((moderatorSessionId: string) => {
		const sessions = useSessionStore.getState().sessions;
		const session = sessions.find((s) =>
			s.aiTabs?.some((tab) => tab.agentSessionId === moderatorSessionId)
		);

		if (session) {
			resetGroupChatUI();

			// Set the session as active
			const { setActiveSessionId, setSessions } = useSessionStore.getState();
			setActiveSessionId(session.id);

			// Find and activate the tab with this agent session ID
			const tab = session.aiTabs?.find((t) => t.agentSessionId === moderatorSessionId);
			if (tab) {
				setSessions((prev) =>
					prev.map((s) => (s.id === session.id ? { ...s, ...aiTabFocusFields(tab.id) } : s))
				);
			}
		}
	}, []);

	const handleCreateGroupChat = useCallback(
		async (
			name: string,
			moderatorAgentId: string,
			moderatorConfig?: {
				customPath?: string;
				customArgs?: string;
				customEnvVars?: Record<string, string>;
				customModel?: string;
				enableMaestroP?: boolean;
				maestroPMode?: 'interactive' | 'dynamic';
				maestroPPath?: string;
			}
		) => {
			const { setGroupChats } = useGroupChatStore.getState();
			const { closeModal } = useModalStore.getState();
			try {
				const chat = await window.maestro.groupChat.create(name, moderatorAgentId, moderatorConfig);
				setGroupChats((prev) => [chat, ...prev]);
				closeModal('newGroupChat');
				handleOpenGroupChat(chat.id);
			} catch (err) {
				closeModal('newGroupChat');
				const message = err instanceof Error ? err.message : '';
				const isValidationError = message.includes('Invalid moderator agent ID');
				notifyToast({
					type: 'error',
					title: 'Group Chat',
					message: isValidationError
						? message.replace(/^Error invoking remote method '[^']+': /, '')
						: 'Failed to create group chat',
				});
				if (!isValidationError) {
					throw err; // Unexpected — let Sentry capture via unhandledrejection
				}
			}
		},
		[handleOpenGroupChat]
	);

	const handleCreateGroupChatWithWizard = useCallback(
		async (input: {
			name: string;
			moderatorAgentId: string;
			moderatorConfig?: ModeratorConfig;
			promptContent: string;
			participants: { name: string; agentId: string; cwd?: string }[];
		}) => {
			const { setGroupChats } = useGroupChatStore.getState();
			const { closeModal } = useModalStore.getState();
			try {
				// 1. Write the generated moderator prompt file to ~/.maestro/prompts/.
				const home = await window.maestro.fs.homeDir();
				const promptPath = `${home}/.maestro/prompts/${moderatorPromptFilename(input.name)}`;
				await window.maestro.fs.writeFile(promptPath, input.promptContent);

				// 2. Wire the prompt file into the moderator config (preserve existing args).
				const cfg: ModeratorConfig = { ...(input.moderatorConfig ?? {}) };
				const spf = `--system-prompt-file ${promptPath}`;
				cfg.customArgs = cfg.customArgs?.trim() ? `${cfg.customArgs.trim()} ${spf}` : spf;

				// 3. Create the group chat.
				const chat = await window.maestro.groupChat.create(input.name, input.moderatorAgentId, cfg);

				// 4. Dock the selected existing sessions as participants. Each
				// participant matches its session by name, so model/args/SSH/cwd
				// come straight from that session's own config.
				for (const p of input.participants) {
					try {
						await window.maestro.groupChat.addParticipant(chat.id, p.name, p.agentId, p.cwd);
					} catch (err) {
						logger.error('[GroupChatWizard] addParticipant failed', undefined, {
							participant: p.name,
							error: err instanceof Error ? err.message : String(err),
						});
					}
				}

				// 5. Reload (participants changed) and surface the new chat.
				const fresh = (await window.maestro.groupChat.load(chat.id)) ?? chat;
				setGroupChats((prev) => [fresh, ...prev.filter((c) => c.id !== fresh.id)]);
				closeModal('groupChatWizard');
				handleOpenGroupChat(chat.id);
				notifyToast({
					color: 'green',
					title: 'Group Chat',
					message: `"${input.name}" created with ${input.participants.length} docked agent(s)`,
				});
			} catch (err) {
				closeModal('groupChatWizard');
				notifyToast({
					color: 'red',
					title: 'Group Chat',
					message: 'Wizard failed to create the group chat',
				});
				throw err;
			}
		},
		[handleOpenGroupChat]
	);

	const handleDeleteGroupChat = useCallback(
		async (id: string) => {
			const { activeGroupChatId, setGroupChats } = useGroupChatStore.getState();
			const { closeModal } = useModalStore.getState();
			await window.maestro.groupChat.delete(id);
			setGroupChats((prev) => prev.filter((c) => c.id !== id));
			if (activeGroupChatId === id) {
				handleCloseGroupChat();
			}
			closeModal('deleteGroupChat');
		},
		[handleCloseGroupChat]
	);

	const handleArchiveGroupChat = useCallback(
		async (id: string, archived: boolean) => {
			const { activeGroupChatId, setGroupChats } = useGroupChatStore.getState();
			const updated = await window.maestro.groupChat.archive(id, archived);
			setGroupChats((prev) => prev.map((c) => (c.id === id ? updated : c)));
			if (archived && activeGroupChatId === id) {
				handleCloseGroupChat();
			}
		},
		[handleCloseGroupChat]
	);

	const handleRenameGroupChat = useCallback(async (id: string, newName: string) => {
		const { setGroupChats } = useGroupChatStore.getState();
		const { closeModal } = useModalStore.getState();
		await window.maestro.groupChat.rename(id, newName);
		setGroupChats((prev) => prev.map((c) => (c.id === id ? { ...c, name: newName } : c)));
		closeModal('renameGroupChat');
	}, []);

	const handleUpdateGroupChat = useCallback(
		async (
			id: string,
			name: string,
			moderatorAgentId: string,
			moderatorConfig?: {
				customPath?: string;
				customArgs?: string;
				customEnvVars?: Record<string, string>;
				enableMaestroP?: boolean;
				maestroPMode?: 'interactive' | 'dynamic';
				maestroPPath?: string;
			}
		) => {
			const { setGroupChats } = useGroupChatStore.getState();
			const { closeModal } = useModalStore.getState();
			const updated = await window.maestro.groupChat.update(id, {
				name,
				moderatorAgentId,
				moderatorConfig,
			});
			setGroupChats((prev) => prev.map((c) => (c.id === id ? updated : c)));
			closeModal('editGroupChat');
		},
		[]
	);

	// =======================================================================
	// Delete all archived group chats
	// =======================================================================

	const handleDeleteAllArchivedGroupChats = useCallback(() => {
		const { groupChats } = useGroupChatStore.getState();
		const archivedChats = groupChats.filter((c) => c.archived);
		if (archivedChats.length === 0) return;

		useModalStore.getState().openModal('confirm', {
			message: `Are you sure you want to delete all ${archivedChats.length} archived group chat${archivedChats.length !== 1 ? 's' : ''}? This action cannot be undone.`,
			onConfirm: async () => {
				const { activeGroupChatId, setGroupChats } = useGroupChatStore.getState();
				const archivedIds = new Set(archivedChats.map((c) => c.id));
				// Delete all archived chats
				await Promise.all(archivedChats.map((c) => window.maestro.groupChat.delete(c.id)));
				setGroupChats((prev) => prev.filter((c) => !archivedIds.has(c.id)));
				if (activeGroupChatId && archivedIds.has(activeGroupChatId)) {
					handleCloseGroupChat();
				}
			},
		});
	}, [handleCloseGroupChat]);

	// =======================================================================
	// Delete with confirmation (keyboard shortcut / CMD+K)
	// =======================================================================

	const deleteGroupChatWithConfirmation = useCallback(
		(id: string) => {
			const { groupChats, activeGroupChatId } = useGroupChatStore.getState();
			const chat = groupChats.find((c) => c.id === id);
			if (!chat) return;

			useModalStore.getState().openModal('confirm', {
				message: `Are you sure you want to delete the group chat "${chat.name}"? This action cannot be undone.`,
				onConfirm: async () => {
					const { setGroupChats } = useGroupChatStore.getState();
					await window.maestro.groupChat.delete(id);
					setGroupChats((prev) => prev.filter((c) => c.id !== id));
					if (activeGroupChatId === id) {
						handleCloseGroupChat();
					}
				},
			});
		},
		[handleCloseGroupChat]
	);

	// =======================================================================
	// Message & queue handlers
	// =======================================================================

	const handleSendGroupChatMessage = useCallback(
		async (content: string, images?: string[], readOnly?: boolean) => {
			const {
				activeGroupChatId,
				groupChatState,
				groupChats,
				setGroupChatExecutionQueue,
				setGroupChatState,
				setGroupChatStates,
			} = useGroupChatStore.getState();
			if (!activeGroupChatId) return;

			// If group chat is busy, queue the message instead of sending immediately
			if (groupChatState !== 'idle') {
				const queuedItem: QueuedItem = {
					id: generateId(),
					timestamp: Date.now(),
					tabId: activeGroupChatId,
					type: 'message',
					text: content,
					images: images ? [...images] : undefined,
					tabName: groupChats.find((c) => c.id === activeGroupChatId)?.name || 'Group Chat',
					readOnlyMode: readOnly,
				};
				setGroupChatExecutionQueue((prev) => [...prev, queuedItem]);
				return;
			}

			setGroupChatState('moderator-thinking');
			setGroupChatStates((prev) => {
				const next = new Map(prev);
				next.set(activeGroupChatId, 'moderator-thinking');
				return next;
			});
			// Remember this turn so Agent Parking can re-send it on a rate-limit retry.
			useGroupChatStore.getState().recordModeratorMessage(activeGroupChatId, content);
			try {
				await window.maestro.groupChat.sendToModerator(
					activeGroupChatId,
					content,
					images,
					readOnly
				);
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				// Reset to idle so user can retry
				setGroupChatState('idle');
				setGroupChatStates((prev) => {
					const next = new Map(prev);
					next.set(activeGroupChatId, 'idle');
					return next;
				});
				useGroupChatStore.getState().setGroupChatMessages((prev) => [
					...prev,
					{
						timestamp: new Date().toISOString(),
						from: 'system',
						content: `⚠️ Moderator is not available. Try sending your message again. (${msg})`,
					},
				]);
			}
		},
		[]
	);

	const handleStopAll = useCallback(async () => {
		const { activeGroupChatId } = useGroupChatStore.getState();
		if (!activeGroupChatId) return;
		try {
			// Cancel any in-flight autorun batch runs for this group chat.
			// These run in the agent's own Maestro session (not group-chat-prefixed),
			// so the main process's clearAllParticipantSessions won't reach them.
			const autoRunSessionIds = getAutoRunSessionsForGroupChat(activeGroupChatId);
			for (const sessionId of autoRunSessionIds) {
				useBatchStore.getState().dispatchBatch({
					type: 'COMPLETE_BATCH',
					sessionId,
				});
			}
			await window.maestro.groupChat.stopAll(activeGroupChatId);
		} catch (error) {
			logger.error('[GroupChat] Failed to stop all:', undefined, error);
			notifyToast({
				type: 'error',
				title: 'Stop Failed',
				message: 'Failed to stop all group chat conversations. Please try again.',
			});
		}
	}, []);

	const handleGroupChatDraftChange = useCallback((draft: string) => {
		const { activeGroupChatId, setGroupChats } = useGroupChatStore.getState();
		if (!activeGroupChatId) return;
		setGroupChats((prev) =>
			prev.map((c) => (c.id === activeGroupChatId ? { ...c, draftMessage: draft } : c))
		);
	}, []);

	const handleRemoveGroupChatQueueItem = useCallback((itemId: string) => {
		useGroupChatStore
			.getState()
			.setGroupChatExecutionQueue((prev) => prev.filter((item) => item.id !== itemId));
	}, []);

	const handleReorderGroupChatQueueItems = useCallback((fromIndex: number, toIndex: number) => {
		useGroupChatStore.getState().setGroupChatExecutionQueue((prev) => {
			const queue = [...prev];
			const [removed] = queue.splice(fromIndex, 1);
			queue.splice(toIndex, 0, removed);
			return queue;
		});
	}, []);

	// =======================================================================
	// Modal openers
	// =======================================================================

	const handleNewGroupChat = useCallback(() => {
		useModalStore.getState().openModal('newGroupChat');
	}, []);

	const handleEditGroupChat = useCallback((id: string) => {
		useModalStore.getState().openModal('editGroupChat', { groupChatId: id });
	}, []);

	const handleOpenRenameGroupChatModal = useCallback((id: string) => {
		useModalStore.getState().openModal('renameGroupChat', { groupChatId: id });
	}, []);

	const handleOpenDeleteGroupChatModal = useCallback((id: string) => {
		useModalStore.getState().openModal('deleteGroupChat', { groupChatId: id });
	}, []);

	const handleOpenWakeUpCallModal = useCallback((id: string) => {
		useModalStore.getState().openModal('wakeUpCall', { groupChatId: id });
	}, []);

	// =======================================================================
	// Modal closers (stable callbacks for AppGroupChatModals component)
	// =======================================================================

	const handleCloseNewGroupChatModal = useCallback(() => {
		useModalStore.getState().closeModal('newGroupChat');
	}, []);

	const handleCloseDeleteGroupChatModal = useCallback(() => {
		useModalStore.getState().closeModal('deleteGroupChat');
	}, []);

	const handleConfirmDeleteGroupChat = useCallback(() => {
		const modalData = useModalStore.getState().modals.get('deleteGroupChat');
		const groupChatId = (modalData?.data as { groupChatId?: string })?.groupChatId;
		if (groupChatId) {
			handleDeleteGroupChat(groupChatId);
		}
	}, [handleDeleteGroupChat]);

	const handleCloseRenameGroupChatModal = useCallback(() => {
		useModalStore.getState().closeModal('renameGroupChat');
	}, []);

	const handleRenameGroupChatFromModal = useCallback(
		(newName: string) => {
			const modalData = useModalStore.getState().modals.get('renameGroupChat');
			const groupChatId = (modalData?.data as { groupChatId?: string })?.groupChatId;
			if (groupChatId) {
				handleRenameGroupChat(groupChatId, newName);
			}
		},
		[handleRenameGroupChat]
	);

	const handleCloseEditGroupChatModal = useCallback(() => {
		useModalStore.getState().closeModal('editGroupChat');
	}, []);

	const handleCloseGroupChatInfo = useCallback(() => {
		useModalStore.getState().closeModal('groupChatInfo');
	}, []);

	const handleCloseWakeUpCallModal = useCallback(() => {
		useModalStore.getState().closeModal('wakeUpCall');
	}, []);

	// =======================================================================
	// Return
	// =======================================================================

	return {
		// Refs
		groupChatInputRef,
		groupChatMessagesRef,

		// Error recovery
		handleClearGroupChatError,
		groupChatRecoveryActions,

		// CRUD
		handleOpenGroupChat,
		handleCloseGroupChat,
		handleCreateGroupChat,
		handleCreateGroupChatWithWizard,
		handleDeleteGroupChat,
		handleArchiveGroupChat,
		handleRenameGroupChat,
		handleUpdateGroupChat,
		deleteGroupChatWithConfirmation,
		handleDeleteAllArchivedGroupChats,

		// Navigation
		handleProcessMonitorNavigateToGroupChat,
		handleOpenModeratorSession,
		handleJumpToGroupChatMessage,

		// Right panel
		handleGroupChatRightTabChange,

		// Stop All
		handleStopAll,

		// Messages & queue
		handleSendGroupChatMessage,
		handleGroupChatDraftChange,
		handleRemoveGroupChatQueueItem,
		handleReorderGroupChatQueueItems,

		// Modal openers
		handleNewGroupChat,
		handleEditGroupChat,
		handleOpenRenameGroupChatModal,
		handleOpenDeleteGroupChatModal,
		handleOpenWakeUpCallModal,

		// Modal closers
		handleCloseNewGroupChatModal,
		handleCloseDeleteGroupChatModal,
		handleConfirmDeleteGroupChat,
		handleCloseRenameGroupChatModal,
		handleRenameGroupChatFromModal,
		handleCloseEditGroupChatModal,
		handleCloseGroupChatInfo,
		handleCloseWakeUpCallModal,
	};
}
