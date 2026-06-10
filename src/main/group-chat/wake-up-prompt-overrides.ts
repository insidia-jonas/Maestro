/**
 * @file wake-up-prompt-overrides.ts
 * @description In-memory registry of prompt overrides for active wake-up sequences.
 *
 * While a wake-up sequence is running (or paused), each target participant can
 * carry its own agent prompt and the moderator can carry a custom system prompt.
 * The wake-up service registers/clears the overrides; the group chat router
 * reads them when assembling moderator and participant prompts.
 *
 * Lives in its own module (no group-chat imports) so both wake-up-service.ts
 * and group-chat-router.ts can depend on it without an import cycle.
 */

import { normalizeMentionName } from '../../shared/group-chat-types';

interface WakeUpPromptOverrides {
	/** Appended to the moderator's system prompt on every turn */
	moderatorPrompt?: string;
	/** Per-participant prompts, keyed by normalized lowercase participant name */
	participantPrompts: Record<string, string>;
}

/** groupChatId → active overrides */
const overrides = new Map<string, WakeUpPromptOverrides>();

function participantKey(name: string): string {
	return normalizeMentionName(name).toLowerCase();
}

/**
 * Register the prompt overrides for an active wake-up sequence.
 * Called by the wake-up service on start. No-op entry is skipped entirely
 * when neither a moderator prompt nor any participant prompt is set.
 */
export function setWakeUpPromptOverrides(
	groupChatId: string,
	moderatorPrompt: string | undefined,
	participantPrompts: Array<{ participantName: string; prompt: string }>
): void {
	const participants: Record<string, string> = {};
	for (const entry of participantPrompts) {
		if (entry.prompt.trim()) {
			participants[participantKey(entry.participantName)] = entry.prompt;
		}
	}
	const moderator = moderatorPrompt?.trim() ? moderatorPrompt : undefined;
	if (!moderator && Object.keys(participants).length === 0) {
		overrides.delete(groupChatId);
		return;
	}
	overrides.set(groupChatId, { moderatorPrompt: moderator, participantPrompts: participants });
}

/** Moderator prompt override for an active wake-up sequence (or undefined). */
export function getWakeUpModeratorPrompt(groupChatId: string): string | undefined {
	return overrides.get(groupChatId)?.moderatorPrompt;
}

/** Per-agent prompt override for a participant during an active wake-up sequence. */
export function getWakeUpParticipantPrompt(
	groupChatId: string,
	participantName: string
): string | undefined {
	return overrides.get(groupChatId)?.participantPrompts[participantKey(participantName)];
}

/** Clear all overrides for a chat. Called when the sequence stops or finishes. */
export function clearWakeUpPromptOverrides(groupChatId: string): void {
	overrides.delete(groupChatId);
}
