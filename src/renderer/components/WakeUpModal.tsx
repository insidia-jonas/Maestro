/**
 * @file WakeUpModal.tsx
 * @description Wake-up call configuration and progress modal for Group Chats.
 *
 * Two views:
 * 1. Config view — interval selection, initial prompt / system-prompt toggle,
 *    1–5 message rows (content + target participant + generate toggle).
 * 2. Progress view — shows current step, phase (running/paused/stopped/finished),
 *    and Pause/Resume + Stop buttons.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { AlarmClock, Plus, Trash2, Play, Pause, Square, Wand2 } from 'lucide-react';
import { Modal } from './ui/Modal';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';
import { useGroupChatStore } from '../stores/groupChatStore';
import type { Theme, GroupChat, WakeUpConfig, WakeUpMessage, WakeUpProgress } from '../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INTERVAL_PRESETS = [
	{ label: '30 s', ms: 30_000 },
	{ label: '1 min', ms: 60_000 },
	{ label: '2 min', ms: 120_000 },
	{ label: '5 min', ms: 300_000 },
	{ label: '10 min', ms: 600_000 },
	{ label: '15 min', ms: 900_000 },
] as const;

const MAX_MESSAGES = 5;

function defaultMessage(): WakeUpMessage {
	return { content: '', targetParticipant: '', generate: false };
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface WakeUpModalProps {
	theme: Theme;
	isOpen: boolean;
	groupChat: GroupChat;
	onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WakeUpModal({ theme, isOpen, groupChat, onClose }: WakeUpModalProps) {
	// ── Config state ───────────────────────────────────────────────────────
	const [intervalMs, setIntervalMs] = useState(60_000);
	const [useSystemPrompt, setUseSystemPrompt] = useState(true);
	const [initialPrompt, setInitialPrompt] = useState('');
	const [messages, setMessages] = useState<WakeUpMessage[]>([defaultMessage()]);

	// ── Progress state ─────────────────────────────────────────────────────
	const [isRunning, setIsRunning] = useState(false);
	const [progress, setProgress] = useState<WakeUpProgress | null>(null);
	const cleanupRef = useRef<(() => void) | null>(null);

	// Hydrate from saved config when the modal opens
	useEffect(() => {
		if (!isOpen) return;
		const cfg = groupChat.wakeUpConfig;
		if (cfg) {
			setIntervalMs(cfg.intervalMs);
			setUseSystemPrompt(cfg.useSystemPrompt);
			setInitialPrompt(cfg.initialPrompt ?? '');
			setMessages(cfg.messages.length > 0 ? cfg.messages : [defaultMessage()]);
		}
		// Check if a sequence is already running
		window.maestro.groupChat.getWakeUpState(groupChat.id).then((state) => {
			if (state && (state.phase === 'running' || state.phase === 'paused')) {
				setIsRunning(true);
				setProgress({
					step: state.currentStep,
					totalSteps: state.totalSteps,
					phase: state.phase,
				});
			}
		});
	}, [isOpen, groupChat.id, groupChat.wakeUpConfig]);

	// Subscribe to progress events
	useEffect(() => {
		if (!isOpen) return;
		const unsub = window.maestro.groupChat.onWakeUpProgress((chatId, prog) => {
			if (chatId !== groupChat.id) return;
			setProgress(prog);
			if (prog.phase === 'finished' || prog.phase === 'stopped') {
				setIsRunning(false);
			}
		});
		cleanupRef.current = unsub;
		return () => {
			unsub();
			cleanupRef.current = null;
		};
	}, [isOpen, groupChat.id]);

	// ── Participant list for dropdowns ──────────────────────────────────────
	const participants = groupChat.participants ?? [];
	const participantNames = participants.map((p) => p.name);

	// ── Message management ─────────────────────────────────────────────────
	const updateMessage = useCallback((index: number, patch: Partial<WakeUpMessage>) => {
		setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));
	}, []);

	const addMessage = useCallback(() => {
		setMessages((prev) => (prev.length < MAX_MESSAGES ? [...prev, defaultMessage()] : prev));
	}, []);

	const removeMessage = useCallback((index: number) => {
		setMessages((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
	}, []);

	// ── Actions ────────────────────────────────────────────────────────────
	const canStart =
		messages.length > 0 &&
		messages.every((m) => m.targetParticipant && (m.generate || m.content.trim()));

	const handleStart = useCallback(async () => {
		const config: WakeUpConfig = {
			useSystemPrompt,
			initialPrompt: useSystemPrompt ? undefined : initialPrompt,
			messages,
			intervalMs,
		};
		await window.maestro.groupChat.startWakeUp(groupChat.id, config);
		// Update the local store so Close/Reopen hydrates from fresh config
		useGroupChatStore
			.getState()
			.setGroupChats((prev) =>
				prev.map((c) => (c.id === groupChat.id ? { ...c, wakeUpConfig: config } : c))
			);
		setIsRunning(true);
	}, [groupChat.id, useSystemPrompt, initialPrompt, messages, intervalMs]);

	const handleStop = useCallback(async () => {
		await window.maestro.groupChat.stopWakeUp(groupChat.id);
		setIsRunning(false);
		setProgress(null);
	}, [groupChat.id]);

	const handlePause = useCallback(async () => {
		await window.maestro.groupChat.pauseWakeUp(groupChat.id);
	}, [groupChat.id]);

	const handleResume = useCallback(async () => {
		await window.maestro.groupChat.resumeWakeUp(groupChat.id);
	}, [groupChat.id]);

	// ── Styles ─────────────────────────────────────────────────────────────
	const inputStyle: React.CSSProperties = {
		backgroundColor: theme.colors.bgMain,
		color: theme.colors.textMain,
		borderColor: theme.colors.border,
	};

	const labelColor = theme.colors.textDim;

	// ── Render ─────────────────────────────────────────────────────────────
	return (
		<Modal
			theme={theme}
			title="Wake up call"
			headerIcon={<AlarmClock className="w-4 h-4" />}
			priority={MODAL_PRIORITIES.WAKE_UP_CALL}
			onClose={onClose}
			width={520}
			maxHeight="85vh"
			footer={
				isRunning ? (
					<div className="flex items-center gap-2 w-full">
						{progress?.phase === 'paused' ? (
							<button
								onClick={handleResume}
								className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors"
								style={{
									backgroundColor: theme.colors.accent,
									color: '#fff',
								}}
							>
								<Play className="w-3.5 h-3.5" />
								Resume
							</button>
						) : (
							<button
								onClick={handlePause}
								className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors"
								style={{
									backgroundColor: `${theme.colors.accent}30`,
									color: theme.colors.accent,
								}}
							>
								<Pause className="w-3.5 h-3.5" />
								Pause
							</button>
						)}
						<button
							onClick={handleStop}
							className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors"
							style={{
								backgroundColor: `${theme.colors.error}20`,
								color: theme.colors.error,
							}}
						>
							<Square className="w-3.5 h-3.5" />
							Stop
						</button>
					</div>
				) : (
					<button
						onClick={handleStart}
						disabled={!canStart}
						className="flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-medium transition-colors disabled:opacity-40"
						style={{
							backgroundColor: canStart ? theme.colors.accent : theme.colors.border,
							color: canStart ? '#fff' : theme.colors.textDim,
						}}
					>
						<Play className="w-3.5 h-3.5" />
						Start Wake-up
					</button>
				)
			}
		>
			<div className="flex flex-col gap-4 select-none">
				{/* ── Progress banner ─────────────────────────────────────── */}
				{isRunning && progress && (
					<div
						className="rounded-md p-3 text-xs flex flex-col gap-1"
						style={{
							backgroundColor: `${theme.colors.accent}15`,
							borderLeft: `3px solid ${theme.colors.accent}`,
						}}
					>
						<div className="flex items-center justify-between">
							<span className="font-medium" style={{ color: theme.colors.textMain }}>
								{progress.phase === 'paused' ? 'Paused' : 'Running'}
								{' — '}
								Step {progress.step}/{progress.totalSteps}
							</span>
							{progress.phase === 'running' && (
								<span
									className="inline-block w-2 h-2 rounded-full animate-pulse"
									style={{ backgroundColor: theme.colors.accent }}
								/>
							)}
						</div>
						{progress.targetAgent && (
							<span style={{ color: theme.colors.textDim }}>
								Last sent to: {progress.targetAgent}
							</span>
						)}
					</div>
				)}

				{/* ── Interval selector ───────────────────────────────────── */}
				<div>
					<label className="block text-xs mb-1.5 font-medium" style={{ color: labelColor }}>
						Interval between messages
					</label>
					<div className="flex flex-wrap gap-1.5">
						{INTERVAL_PRESETS.map((preset) => (
							<button
								key={preset.ms}
								onClick={() => setIntervalMs(preset.ms)}
								disabled={isRunning}
								className="px-2.5 py-1 rounded text-xs transition-colors"
								style={{
									backgroundColor:
										intervalMs === preset.ms ? theme.colors.accent : theme.colors.bgMain,
									color: intervalMs === preset.ms ? '#fff' : theme.colors.textMain,
									borderWidth: 1,
									borderColor: intervalMs === preset.ms ? theme.colors.accent : theme.colors.border,
								}}
							>
								{preset.label}
							</button>
						))}
					</div>
				</div>

				{/* ── System prompt toggle ─────────────────────────────────── */}
				<div>
					<label className="flex items-center gap-2 text-xs cursor-pointer">
						<input
							type="checkbox"
							checked={useSystemPrompt}
							onChange={(e) => setUseSystemPrompt(e.target.checked)}
							disabled={isRunning}
							className="rounded"
						/>
						<span style={{ color: theme.colors.textMain }}>
							Use system prompt as initial context
						</span>
					</label>
				</div>

				{/* ── Initial prompt (shown when system prompt unchecked) ──── */}
				{!useSystemPrompt && (
					<div>
						<label className="block text-xs mb-1.5 font-medium" style={{ color: labelColor }}>
							Initial prompt
						</label>
						<textarea
							value={initialPrompt}
							onChange={(e) => setInitialPrompt(e.target.value)}
							disabled={isRunning}
							rows={3}
							className="w-full rounded border px-2.5 py-1.5 text-xs resize-none select-text"
							style={inputStyle}
							placeholder="Sent before the timed messages as context..."
						/>
					</div>
				)}

				{/* ── Message rows ─────────────────────────────────────────── */}
				<div>
					<div className="flex items-center justify-between mb-1.5">
						<label className="text-xs font-medium" style={{ color: labelColor }}>
							Messages ({messages.length}/{MAX_MESSAGES})
						</label>
						{messages.length < MAX_MESSAGES && !isRunning && (
							<button
								onClick={addMessage}
								className="flex items-center gap-1 text-xs transition-colors hover:opacity-80"
								style={{ color: theme.colors.accent }}
							>
								<Plus className="w-3 h-3" />
								Add
							</button>
						)}
					</div>

					<div className="flex flex-col gap-2">
						{messages.map((msg, idx) => (
							<div
								key={idx}
								className="rounded border p-2.5 flex flex-col gap-2"
								style={{
									backgroundColor: theme.colors.bgMain,
									borderColor: theme.colors.border,
								}}
							>
								{/* Row 1: Target + Generate + Delete */}
								<div className="flex items-center gap-2">
									<select
										value={msg.targetParticipant}
										onChange={(e) => updateMessage(idx, { targetParticipant: e.target.value })}
										disabled={isRunning}
										className="flex-1 rounded border px-2 py-1 text-xs"
										style={inputStyle}
									>
										<option value="">Select agent...</option>
										{participantNames.map((name) => (
											<option key={name} value={name}>
												{name}
											</option>
										))}
									</select>

									<label
										className="flex items-center gap-1 text-xs shrink-0 cursor-pointer"
										title="Let the moderator generate this message"
									>
										<input
											type="checkbox"
											checked={msg.generate}
											onChange={(e) => updateMessage(idx, { generate: e.target.checked })}
											disabled={isRunning}
											className="rounded"
										/>
										<Wand2 className="w-3 h-3" style={{ color: theme.colors.textDim }} />
									</label>

									{messages.length > 1 && !isRunning && (
										<button
											onClick={() => removeMessage(idx)}
											className="p-0.5 rounded hover:bg-white/5 transition-colors"
											title="Remove message"
										>
											<Trash2 className="w-3 h-3" style={{ color: theme.colors.error }} />
										</button>
									)}
								</div>

								{/* Row 2: Content (hidden when generate is on) */}
								{!msg.generate && (
									<textarea
										value={msg.content}
										onChange={(e) => updateMessage(idx, { content: e.target.value })}
										disabled={isRunning}
										rows={2}
										className="w-full rounded border px-2 py-1 text-xs resize-none select-text"
										style={inputStyle}
										placeholder={`Message for ${msg.targetParticipant || 'agent'}...`}
									/>
								)}
							</div>
						))}
					</div>
				</div>
			</div>
		</Modal>
	);
}
