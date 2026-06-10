/**
 * @file GroupChatWizard.tsx
 * @description Stepped wizard for creating a group chat that docks existing
 * agents and generates the moderator prompt file. Three steps:
 *   1. Name + moderator agent/model
 *   2. Pick existing sessions to dock as participants (grouped by working dir)
 *   3. Project description + live preview of the generated moderator prompt
 *
 * On finish it calls `onComplete`, which writes the prompt to
 * ~/.maestro/prompts/moderator-<slug>.md, wires it into the moderator config,
 * creates the chat, and docks the selected sessions. Docked participants match
 * their session by name, so their model/args/SSH/cwd come from that session —
 * exactly matching how the existing groups are configured.
 */

import { useMemo, useState } from 'react';
import { Users, ArrowLeft, ArrowRight, Wand2, Check } from 'lucide-react';
import type { ModeratorConfig, Theme } from '../types';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';
import { Modal, FormInput } from './ui';
import { useSessionStore } from '../stores/sessionStore';
import { useAvailableAgents } from '../hooks/agent/useAvailableAgents';
import { isBetaAgent, getAgentDisplayName } from '../../shared/agentMetadata';
import { generateModeratorPrompt, moderatorPromptFilename } from '../utils/generateModeratorPrompt';

interface GroupChatWizardProps {
	theme: Theme;
	onClose: () => void;
	onComplete: (input: {
		name: string;
		moderatorAgentId: string;
		moderatorConfig?: ModeratorConfig;
		promptContent: string;
		participants: { name: string; agentId: string; cwd?: string }[];
	}) => Promise<void>;
}

export function GroupChatWizard({ theme, onClose, onComplete }: GroupChatWizardProps) {
	const sessions = useSessionStore((s) => s.sessions);
	const { agents } = useAvailableAgents(null, sessions);

	const [step, setStep] = useState<1 | 2 | 3>(1);
	const [name, setName] = useState('');
	const [moderatorAgentId, setModeratorAgentId] = useState('claude-code');
	const [moderatorModel, setModeratorModel] = useState('');
	const [description, setDescription] = useState('');
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [submitting, setSubmitting] = useState(false);

	// Dockable sessions: everything except terminals. Grouped by working dir so
	// a project's agents cluster together.
	const dockable = useMemo(() => sessions.filter((s) => s.toolType !== 'terminal'), [sessions]);
	const groups = useMemo(() => {
		const byCwd = new Map<string, typeof dockable>();
		for (const s of dockable) {
			const key = s.cwd || '(no working dir)';
			const list = byCwd.get(key) ?? [];
			list.push(s);
			byCwd.set(key, list);
		}
		return [...byCwd.entries()].sort((a, b) => a[0].localeCompare(b[0]));
	}, [dockable]);

	const availableAgents = agents.filter((a) => a.available);

	const participants = useMemo(
		() =>
			dockable
				.filter((s) => selected.has(s.id))
				.map((s) => ({ name: s.name, agentId: s.toolType, cwd: s.cwd })),
		[dockable, selected]
	);

	const promptContent = useMemo(
		() =>
			generateModeratorPrompt({
				groupName: name || 'Neue Gruppe',
				moderatorModel: moderatorModel || undefined,
				participants,
				description,
			}),
		[name, moderatorModel, participants, description]
	);

	const toggle = (id: string) =>
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	const toggleGroup = (list: typeof dockable) =>
		setSelected((prev) => {
			const next = new Set(prev);
			const allSelected = list.every((s) => next.has(s.id));
			for (const s of list) {
				if (allSelected) next.delete(s.id);
				else next.add(s.id);
			}
			return next;
		});

	const canNext = step === 1 ? name.trim() && moderatorAgentId : true;

	const handleFinish = async () => {
		if (submitting) return;
		setSubmitting(true);
		try {
			await onComplete({
				name: name.trim(),
				moderatorAgentId,
				moderatorConfig: moderatorModel.trim() ? { customModel: moderatorModel.trim() } : undefined,
				promptContent,
				participants,
			});
		} finally {
			setSubmitting(false);
		}
	};

	const inputStyle: React.CSSProperties = {
		backgroundColor: theme.colors.bgMain,
		color: theme.colors.textMain,
		borderColor: theme.colors.border,
	};

	const footer = (
		<div className="flex items-center justify-between w-full">
			<span className="text-xs" style={{ color: theme.colors.textDim }}>
				Step {step} of 3
			</span>
			<div className="flex items-center gap-2">
				{step > 1 && (
					<button
						onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)}
						className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs transition-colors hover:bg-white/5"
						style={{ color: theme.colors.textDim }}
					>
						<ArrowLeft className="w-3.5 h-3.5" />
						Back
					</button>
				)}
				{step < 3 ? (
					<button
						onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3)}
						disabled={!canNext}
						className="flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-medium transition-colors disabled:opacity-40"
						style={{ backgroundColor: theme.colors.accent, color: '#fff' }}
					>
						Next
						<ArrowRight className="w-3.5 h-3.5" />
					</button>
				) : (
					<button
						onClick={handleFinish}
						disabled={submitting || !name.trim()}
						className="flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-medium transition-colors disabled:opacity-40"
						style={{ backgroundColor: theme.colors.accent, color: '#fff' }}
					>
						<Check className="w-3.5 h-3.5" />
						{submitting ? 'Creating…' : `Create with ${participants.length} agent(s)`}
					</button>
				)}
			</div>
		</div>
	);

	return (
		<Modal
			theme={theme}
			title="Group Chat Wizard"
			headerIcon={<Wand2 className="w-4 h-4" />}
			priority={MODAL_PRIORITIES.NEW_GROUP_CHAT}
			onClose={onClose}
			width={560}
			maxHeight="85vh"
			footer={footer}
		>
			{/* Step 1 — Name + moderator */}
			{step === 1 && (
				<div className="flex flex-col gap-4">
					<FormInput
						theme={theme}
						label="Group name"
						value={name}
						onChange={setName}
						placeholder="e.g. INSIDIA OSINT — Build"
						autoFocus
					/>
					<div>
						<label
							className="block text-xs mb-1.5 font-medium"
							style={{ color: theme.colors.textDim }}
						>
							Moderator agent
						</label>
						<select
							value={moderatorAgentId}
							onChange={(e) => setModeratorAgentId(e.target.value)}
							className="w-full px-3 py-2 rounded-lg border outline-none text-sm"
							style={inputStyle}
						>
							{availableAgents.map((a) => (
								<option key={a.id} value={a.id}>
									{a.name}
									{isBetaAgent(a.id) ? ' (Beta)' : ''}
								</option>
							))}
						</select>
					</div>
					<FormInput
						theme={theme}
						label="Moderator model (optional)"
						value={moderatorModel}
						onChange={setModeratorModel}
						placeholder='e.g. "opus", "fable", "claude-opus-4-8"'
					/>
				</div>
			)}

			{/* Step 2 — Dock existing agents */}
			{step === 2 && (
				<div className="flex flex-col gap-3">
					<div className="flex items-center gap-2 text-xs" style={{ color: theme.colors.textDim }}>
						<Users className="w-3.5 h-3.5" />
						Select the existing agents to dock. Their model, args and SSH config come from each
						session.
					</div>
					{dockable.length === 0 ? (
						<div className="text-sm py-4 text-center" style={{ color: theme.colors.textDim }}>
							No existing agents to dock. Create some sessions first.
						</div>
					) : (
						groups.map(([cwd, list]) => {
							const allSelected = list.every((s) => selected.has(s.id));
							return (
								<div
									key={cwd}
									className="rounded border"
									style={{ borderColor: theme.colors.border }}
								>
									<button
										onClick={() => toggleGroup(list)}
										className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs font-medium hover:bg-white/5 transition-colors"
										style={{ color: theme.colors.textDim }}
									>
										<span className="truncate" title={cwd}>
											{cwd}
										</span>
										<span style={{ color: theme.colors.accent }}>
											{allSelected ? 'Deselect all' : 'Select all'}
										</span>
									</button>
									<div className="flex flex-col">
										{list.map((s) => (
											<label
												key={s.id}
												className="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer hover:bg-white/5 transition-colors border-t"
												style={{ borderColor: theme.colors.border }}
											>
												<input
													type="checkbox"
													checked={selected.has(s.id)}
													onChange={() => toggle(s.id)}
													className="rounded"
												/>
												<span
													className="text-sm font-medium truncate"
													style={{ color: theme.colors.textMain }}
												>
													{s.name}
												</span>
												<span
													className="text-[10px] ml-auto shrink-0"
													style={{ color: theme.colors.textDim }}
												>
													{getAgentDisplayName(s.toolType)}
												</span>
											</label>
										))}
									</div>
								</div>
							);
						})
					)}
					<div className="text-xs" style={{ color: theme.colors.textDim }}>
						{selected.size} agent(s) selected
					</div>
				</div>
			)}

			{/* Step 3 — Description + generated moderator prompt preview */}
			{step === 3 && (
				<div className="flex flex-col gap-3">
					<div>
						<label
							className="block text-xs mb-1.5 font-medium"
							style={{ color: theme.colors.textDim }}
						>
							Project description / tech stack (optional)
						</label>
						<textarea
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							rows={3}
							className="w-full rounded border px-2.5 py-1.5 text-xs resize-none select-text"
							style={inputStyle}
							placeholder="Short description of the project — goes into the moderator prompt context."
						/>
					</div>
					<div>
						<div
							className="flex items-center justify-between text-xs mb-1.5 font-medium"
							style={{ color: theme.colors.textDim }}
						>
							<span>Generated moderator prompt</span>
							<span className="opacity-70">
								→ ~/.maestro/prompts/{moderatorPromptFilename(name || 'group')}
							</span>
						</div>
						<pre
							className="rounded border px-2.5 py-2 text-[11px] overflow-auto select-text whitespace-pre-wrap"
							style={{ ...inputStyle, maxHeight: '32vh' }}
						>
							{promptContent}
						</pre>
					</div>
				</div>
			)}
		</Modal>
	);
}
