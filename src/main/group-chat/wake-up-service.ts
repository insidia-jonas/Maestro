/**
 * @file wake-up-service.ts
 * @description Wake-up call sequencer for Group Chat.
 *
 * Sends a series of timed messages through the moderator at configured intervals.
 * Uses setTimeout chains (not setInterval) for sequential delivery with
 * AbortController for clean cancellation. State is ephemeral (not persisted);
 * the WakeUpConfig is persisted to metadata.json via group-chat-storage.
 */

import type { WakeUpConfig, WakeUpState, WakeUpProgress } from '../../shared/group-chat-types';
import { normalizeMentionName } from '../../shared/group-chat-types';
import { loadGroupChat, updateGroupChat } from './group-chat-storage';
import { isModeratorActive, spawnModerator, type IProcessManager } from './group-chat-moderator';
import { routeUserMessage } from './group-chat-router';
import { setWakeUpPromptOverrides, clearWakeUpPromptOverrides } from './wake-up-prompt-overrides';
import { groupChatEmitters } from '../ipc/handlers/groupChat';
import { logger } from '../utils/logger';
import type { AgentDetector } from '../agents';

const LOG_CONTEXT = '[WakeUp]';

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface ActiveSequence {
	state: WakeUpState;
	config: WakeUpConfig;
	abortController: AbortController;
	timerId?: ReturnType<typeof setTimeout>;
	processManager: IProcessManager | null;
	agentDetector: AgentDetector | null;
	/** Remaining ms until the next fire, saved on pause for resume */
	remainingMs?: number;
	/** True while the async dispatch (ensureModeratorAndSend) is in flight.
	 *  Prevents pause/resume from corrupting state mid-delivery. */
	dispatchInFlight: boolean;
}

/** In-memory map of running wake-up sequences (groupChatId → sequence). */
const activeSequences = new Map<string, ActiveSequence>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start a wake-up call sequence for a group chat.
 *
 * 1. Persists the config to metadata.json.
 * 2. Sends the initial prompt (or system-prompt reference) immediately.
 * 3. Schedules each message at `config.intervalMs` intervals.
 */
export async function startWakeUp(
	groupChatId: string,
	config: WakeUpConfig,
	processManager: IProcessManager | null,
	agentDetector: AgentDetector | null
): Promise<void> {
	// Stop any existing sequence for this chat
	if (activeSequences.has(groupChatId)) {
		stopWakeUp(groupChatId);
	}

	// Fix 2: Strip stale pause fields before persisting a fresh start
	const cleanConfig = stripPauseFields(config);

	// Persist the config so it survives app restarts (user can re-trigger)
	await updateGroupChat(groupChatId, { wakeUpConfig: cleanConfig });

	const totalSteps = cleanConfig.messages.length;
	const ac = new AbortController();

	const seq: ActiveSequence = {
		state: {
			phase: 'running',
			currentStep: 0,
			totalSteps,
			startedAt: Date.now(),
		},
		config: cleanConfig,
		abortController: ac,
		processManager,
		agentDetector,
		dispatchInFlight: false,
	};
	activeSequences.set(groupChatId, seq);

	// Register per-agent and moderator prompt overrides for the router.
	// Active for the lifetime of the sequence (cleared on stop/finish).
	setWakeUpPromptOverrides(
		groupChatId,
		cleanConfig.moderatorPrompt,
		cleanConfig.messages
			.filter((m) => !!m.agentPrompt?.trim())
			.map((m) => ({ participantName: m.targetParticipant, prompt: m.agentPrompt! }))
	);

	logger.info(
		`Starting wake-up sequence for ${groupChatId}: ${totalSteps} messages, interval ${cleanConfig.intervalMs}ms`,
		LOG_CONTEXT
	);

	// Send initial prompt immediately (preamble — not counted as a step)
	const initialMsg = buildInitialMessage(cleanConfig);
	if (initialMsg) {
		try {
			await ensureModeratorAndSend(groupChatId, initialMsg, processManager, agentDetector);
		} catch (err) {
			logger.error(`Wake-up initial prompt failed: ${err}`, LOG_CONTEXT);
		}
	}

	// Emit initial progress so the renderer can show the sequence is running
	emitProgress(groupChatId, seq, undefined, undefined);

	// Schedule the first real message after intervalMs
	scheduleNext(groupChatId);
}

/**
 * Stop a running wake-up sequence. Cleans up timers and emits a final
 * 'stopped' progress event.
 */
export function stopWakeUp(groupChatId: string): void {
	const seq = activeSequences.get(groupChatId);
	if (!seq) return;

	seq.abortController.abort();
	if (seq.timerId) clearTimeout(seq.timerId);

	seq.state.phase = 'stopped';
	seq.state.nextFireAt = undefined;
	emitProgress(groupChatId, seq, undefined, undefined);

	activeSequences.delete(groupChatId);
	clearWakeUpPromptOverrides(groupChatId);

	// Fix 2: Fire-and-forget cleanup of persisted pause state
	clearPersistedPauseState(groupChatId);

	logger.info(`Stopped wake-up sequence for ${groupChatId}`, LOG_CONTEXT);
}

/**
 * Get the current ephemeral state of a wake-up sequence (or null if none).
 */
export function getWakeUpState(groupChatId: string): WakeUpState | null {
	const seq = activeSequences.get(groupChatId);
	return seq ? { ...seq.state } : null;
}

/**
 * Stop all active wake-up sequences. Called during app shutdown.
 */
export function stopAllWakeUps(): void {
	for (const id of activeSequences.keys()) {
		stopWakeUp(id);
	}
}

/**
 * Pause a running wake-up sequence.
 *
 * Clears the pending timer, captures remainingMs = nextFireAt − now,
 * sets phase to 'paused', and persists pause state to metadata.json.
 *
 * Race-condition guard: if the timer callback has already been dequeued
 * from the event loop (fired in the same tick), the callback checks
 * `phase !== 'running'` and bails out — so we never double-fire.
 */
export async function pauseWakeUp(groupChatId: string): Promise<void> {
	const seq = activeSequences.get(groupChatId);
	if (!seq || seq.state.phase !== 'running') return;

	// Clear the pending timer (no-op if already fired — race guard in callback)
	if (seq.timerId) clearTimeout(seq.timerId);

	// Fix 1: If a dispatch is currently in flight (ensureModeratorAndSend is
	// awaiting), that step will complete but we must NOT re-schedule after it.
	// Treat the pause as "pause before the NEXT step": advance currentStep
	// by 1 and set remainingMs to the full interval (not 0).
	if (seq.dispatchInFlight) {
		seq.state.currentStep = Math.min(seq.state.currentStep + 1, seq.config.messages.length);
		seq.remainingMs = seq.config.intervalMs;
	} else {
		const now = Date.now();
		seq.remainingMs = seq.state.nextFireAt
			? Math.max(0, seq.state.nextFireAt - now)
			: seq.config.intervalMs;
	}

	const remaining = seq.remainingMs!;

	// Update ephemeral state
	seq.state.phase = 'paused';
	seq.state.nextFireAt = undefined;
	seq.state.remainingMs = remaining;

	// Persist pause state to metadata.json
	const chat = await loadGroupChat(groupChatId);
	if (chat?.wakeUpConfig) {
		await updateGroupChat(groupChatId, {
			wakeUpConfig: {
				...chat.wakeUpConfig,
				pausedAtStep: seq.state.currentStep,
				pausedRemainingMs: remaining,
			},
		});
	}

	emitProgress(groupChatId, seq, undefined, undefined);
	logger.info(
		`Paused wake-up sequence for ${groupChatId} ` +
			`(step ${seq.state.currentStep}/${seq.state.totalSteps}, remaining ${remaining}ms)`,
		LOG_CONTEXT
	);
}

/**
 * Resume a paused wake-up sequence.
 *
 * Restores the timer using the saved remainingMs (or falls back to
 * intervalMs), sets phase back to 'running', and clears persisted
 * pause state from metadata.json.
 */
export async function resumeWakeUp(groupChatId: string): Promise<void> {
	const seq = activeSequences.get(groupChatId);
	if (!seq || seq.state.phase !== 'paused') return;

	// Fix 1: No-op if a dispatch is still in flight (shouldn't happen in
	// normal flow, but guards against rapid pause→resume while awaiting)
	if (seq.dispatchInFlight) return;

	const remaining = seq.remainingMs ?? seq.config.intervalMs;

	// Update ephemeral state
	seq.state.phase = 'running';
	seq.state.nextFireAt = Date.now() + remaining;
	seq.state.remainingMs = undefined;
	seq.remainingMs = undefined;

	// Clear persisted pause state from metadata.json
	const chat = await loadGroupChat(groupChatId);
	if (chat?.wakeUpConfig) {
		const cleaned = { ...chat.wakeUpConfig };
		delete cleaned.pausedAtStep;
		delete cleaned.pausedRemainingMs;
		await updateGroupChat(groupChatId, { wakeUpConfig: cleaned });
	}

	emitProgress(groupChatId, seq, undefined, undefined);

	// Resume the timer chain with the remaining delay
	scheduleNext(groupChatId, remaining);

	logger.info(
		`Resumed wake-up sequence for ${groupChatId} (firing in ${remaining}ms)`,
		LOG_CONTEXT
	);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Schedule the next message in the sequence using setTimeout.
 * Calls itself recursively until all messages have been sent.
 *
 * @param delayOverride — Custom delay for the first post-resume fire.
 *   When omitted, uses `config.intervalMs`.
 */
function scheduleNext(groupChatId: string, delayOverride?: number): void {
	const seq = activeSequences.get(groupChatId);
	if (!seq || seq.state.phase !== 'running') return;

	const step = seq.state.currentStep;
	if (step >= seq.config.messages.length) {
		// All messages sent
		seq.state.phase = 'finished';
		seq.state.nextFireAt = undefined;
		emitProgress(groupChatId, seq, undefined, undefined);
		activeSequences.delete(groupChatId);
		clearWakeUpPromptOverrides(groupChatId);
		logger.info(`Wake-up sequence completed for ${groupChatId}`, LOG_CONTEXT);
		return;
	}

	const delay = delayOverride ?? seq.config.intervalMs;
	const fireAt = Date.now() + delay;
	seq.state.nextFireAt = fireAt;

	seq.timerId = setTimeout(async () => {
		// Pre-dispatch guard: abort or pause may have landed after the timer
		// fired but before this callback executes (same-tick event-loop race).
		if (seq.abortController.signal.aborted || seq.state.phase !== 'running') return;

		// Fix 1: Clear timer metadata on entry — the timer has fired, these
		// values are stale. Prevents pauseWakeUp from computing remainingMs
		// against an already-elapsed nextFireAt.
		seq.timerId = undefined;
		seq.state.nextFireAt = undefined;

		const msg = seq.config.messages[step];
		const mention = `@${normalizeMentionName(msg.targetParticipant)}`;
		let content: string;

		if (msg.generate) {
			content =
				`[Wake-up call ${step + 1}/${seq.config.messages.length}] ` +
				`Generate and send a contextually relevant wake-up message to ${mention}. ` +
				`Consider the conversation history and current task state.`;
		} else {
			content = `${mention} ${msg.content}`;
		}

		// Fix 1: Mark dispatch as in-flight so pause/stop can detect it
		seq.dispatchInFlight = true;
		try {
			await ensureModeratorAndSend(groupChatId, content, seq.processManager, seq.agentDetector);
			logger.info(
				`Wake-up step ${step + 1}/${seq.config.messages.length} sent to ${msg.targetParticipant}`,
				LOG_CONTEXT
			);
		} catch (err) {
			logger.error(`Wake-up step ${step + 1} failed: ${err}`, LOG_CONTEXT);
		}
		seq.dispatchInFlight = false;

		// Fix 1: Post-await guard — pause or stop may have arrived while
		// ensureModeratorAndSend was awaiting. If so, bail out silently.
		// pauseWakeUp already advanced currentStep for us in that case.
		if (seq.abortController.signal.aborted || seq.state.phase !== 'running') return;

		// Advance state
		seq.state.currentStep = step + 1;
		emitProgress(groupChatId, seq, msg.generate ? content : msg.content, msg.targetParticipant);

		// Schedule the next step (always uses full intervalMs from here)
		scheduleNext(groupChatId);
	}, delay);
}

/**
 * Fix 2: Strip stale pause fields from a config before persisting.
 */
function stripPauseFields(config: WakeUpConfig): WakeUpConfig {
	const cleaned = { ...config };
	delete cleaned.pausedAtStep;
	delete cleaned.pausedRemainingMs;
	return cleaned;
}

/**
 * Fix 2: Fire-and-forget cleanup of persisted pause state after stop.
 */
function clearPersistedPauseState(groupChatId: string): void {
	loadGroupChat(groupChatId)
		.then((chat) => {
			if (
				chat?.wakeUpConfig &&
				(chat.wakeUpConfig.pausedAtStep !== undefined ||
					chat.wakeUpConfig.pausedRemainingMs !== undefined)
			) {
				return updateGroupChat(groupChatId, {
					wakeUpConfig: stripPauseFields(chat.wakeUpConfig),
				});
			}
		})
		.catch(() => {
			// Best-effort — chat may have been deleted
		});
}

/**
 * Build the initial message sent before the timed sequence begins.
 */
function buildInitialMessage(config: WakeUpConfig): string {
	if (config.useSystemPrompt) {
		return (
			'[Wake-up call] Starting a wake-up sequence. ' +
			'Please refer to the system prompt for context and current objectives, ' +
			'then proceed with the following delegations.'
		);
	}
	return config.initialPrompt ?? '';
}

/**
 * Ensure the moderator is running and send a message through routeUserMessage.
 */
async function ensureModeratorAndSend(
	groupChatId: string,
	message: string,
	pm: IProcessManager | null,
	ad: AgentDetector | null
): Promise<void> {
	if (!pm) return;

	// Auto-restart moderator if it exited between turns
	if (!isModeratorActive(groupChatId)) {
		const chat = await loadGroupChat(groupChatId);
		if (!chat) throw new Error(`Group chat not found: ${groupChatId}`);
		await spawnModerator(chat, pm);
	}

	await routeUserMessage(groupChatId, message, pm, ad ?? undefined);
}

/**
 * Emit a WakeUpProgress event to the renderer.
 */
function emitProgress(
	groupChatId: string,
	seq: ActiveSequence,
	messageSent: string | undefined,
	targetAgent: string | undefined
): void {
	const progress: WakeUpProgress = {
		step: seq.state.currentStep,
		totalSteps: seq.state.totalSteps,
		phase: seq.state.phase,
		messageSent,
		targetAgent,
	};
	groupChatEmitters.emitWakeUpProgress?.(groupChatId, progress);
}
