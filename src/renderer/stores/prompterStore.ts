/**
 * prompterStore - Zustand store for the Prompter (Power & Robustness Lab) feature.
 *
 * Holds the 7-step wizard state machine, the active run + live event updates,
 * the compact log, and a serializable resume snapshot persisted to localStorage
 * so an unfinished wizard survives an app restart.
 *
 * Playbook reference: 05-PLAYBOOK-PROMPTER-PROMPT-POWER-LAB, Task E.
 */

import { create } from 'zustand';
import { getAgentDisplayName } from '../../shared/agentMetadata';
import {
	PROMPTER_WIZARD_STEPS,
	ALL_TRANSFORM_NAMES,
	type PrompterWizardStep,
	type PrompterProjectDraft,
	type ProjectPlan,
	type PrompterProject,
	type PrompterAgentSelection,
	type PrompterAgentConfig,
	type InstructionFile,
	type PrompterRun,
	type PrompterLogEvent,
	type PrompterRunUpdatedEvent,
	type PrompterTaskUpdatedEvent,
	type SerializableWizardState,
	type TestTarget,
	type RedTeamCrafterConfig,
	type CrafterAgent,
	type Campaign,
	type CampaignUpdatedEvent,
} from '../../shared/prompter-types';

const RESUME_KEY = 'prompter:wizard-resume';
const MAX_LOG_ENTRIES = 500;

export type PrompterLogFilter = 'all' | 'info' | 'warn' | 'error';

interface PrompterStoreState {
	// Wizard
	wizardOpen: boolean;
	wizardStep: PrompterWizardStep;
	projectDraft: PrompterProjectDraft | null;
	projectPlan: ProjectPlan | null;
	createdProject: PrompterProject | null;
	selectedAgents: PrompterAgentSelection[];
	agentConfigs: Map<string, PrompterAgentConfig>;
	selectedSchemas: Set<string>;
	selectedTransforms: Set<string>;
	availableInstructions: InstructionFile[];
	testTargets: TestTarget[];
	crafterConfig: RedTeamCrafterConfig | null;
	crafterAgents: CrafterAgent[];
	customDataOverrides: Record<string, string>;

	// Run
	activeRun: PrompterRun | null;
	runHistory: PrompterRun[];
	compactLog: PrompterLogEvent[];
	logFilter: PrompterLogFilter;
	/** When true the active run is shown in the center workspace (like group chat). */
	prompterFocused: boolean;

	// Campaign (autonomous adversarial test loops)
	activeCampaign: Campaign | null;
	campaignHistory: Campaign[];

	// Resume
	savedWizardState: SerializableWizardState | null;
}

interface PrompterStoreActions {
	// Wizard navigation
	openWizard: () => void;
	closeWizard: () => void;
	setWizardStep: (step: PrompterWizardStep) => void;
	goNext: () => void;
	goBack: () => void;

	// Project
	setProjectDraft: (draft: PrompterProjectDraft) => void;
	setProjectPlan: (plan: ProjectPlan | null) => void;
	setCreatedProject: (project: PrompterProject) => void;

	// Agents
	toggleAgent: (agent: PrompterAgentSelection) => void;
	setSelectedAgents: (agents: PrompterAgentSelection[]) => void;
	setAgentConfig: (agentId: string, config: PrompterAgentConfig) => void;

	// Schemas
	toggleSchema: (schemaId: string) => void;
	setSelectedSchemas: (schemaIds: string[]) => void;

	// Transforms
	toggleTransform: (transformId: string) => void;
	setSelectedTransforms: (transformIds: string[]) => void;
	toggleTransformCategory: (transforms: string[]) => void;

	// Test Targets
	setTestTargets: (targets: TestTarget[]) => void;
	toggleTestTarget: (target: TestTarget) => void;
	setPrimaryTarget: (agentId: string, modelId: string) => void;

	// Red-Team Crafter
	setCrafterConfig: (config: RedTeamCrafterConfig | null) => void;
	setCrafterAgents: (agents: CrafterAgent[]) => void;
	toggleCrafterAgent: (agent: CrafterAgent) => void;

	// Custom Data
	setCustomDataOverride: (key: string, value: string) => void;
	setCustomDataOverrides: (overrides: Record<string, string>) => void;

	// Instructions
	setAvailableInstructions: (instructions: InstructionFile[]) => void;

	// Run
	setActiveRun: (run: PrompterRun | null) => void;
	updateRunFromEvent: (event: PrompterRunUpdatedEvent) => void;
	updateTaskFromEvent: (event: PrompterTaskUpdatedEvent) => void;
	appendLog: (event: PrompterLogEvent) => void;
	setLogFilter: (filter: PrompterLogFilter) => void;
	clearActiveRun: () => void;
	loadRunHistory: (runs: PrompterRun[]) => void;
	/** Upsert a batch of runs into the history without clobbering existing ones. */
	mergeRunHistory: (runs: PrompterRun[]) => void;
	/** Show the active run in the center workspace. */
	focusPrompterRun: () => void;
	/** Leave the run view (return to agents / group chat). */
	blurPrompterRun: () => void;

	// Campaign
	setActiveCampaign: (campaign: Campaign | null) => void;
	updateCampaignFromEvent: (event: CampaignUpdatedEvent) => void;
	clearActiveCampaign: () => void;
	loadCampaignHistory: (campaigns: Campaign[]) => void;
	dismissCampaign: (campaignId: string) => void;

	// Resume
	saveStateForResume: () => void;
	clearResumeState: () => void;
	restoreFromSavedState: (state: SerializableWizardState) => void;
	loadResumeState: () => SerializableWizardState | null;

	// Cleanup
	resetWizard: () => void;
}

export type PrompterStore = PrompterStoreState & PrompterStoreActions;

const initialWizardState = (): PrompterStoreState => ({
	wizardOpen: false,
	wizardStep: 'project-folder',
	projectDraft: null,
	projectPlan: null,
	createdProject: null,
	selectedAgents: [],
	agentConfigs: new Map(),
	selectedSchemas: new Set(),
	selectedTransforms: new Set(ALL_TRANSFORM_NAMES),
	availableInstructions: [],
	testTargets: [],
	crafterConfig: null,
	crafterAgents: [],
	customDataOverrides: {},
	activeRun: null,
	runHistory: [],
	compactLog: [],
	logFilter: 'all',
	prompterFocused: false,
	activeCampaign: null,
	campaignHistory: [],
	savedWizardState: null,
});

function stepIndex(step: PrompterWizardStep): number {
	return PROMPTER_WIZARD_STEPS.indexOf(step);
}

function sortCampaignsNewestFirst(campaigns: Campaign[]): Campaign[] {
	return [...campaigns].sort((a, b) => {
		const bTime = b.createdAt || b.updatedAt || 0;
		const aTime = a.createdAt || a.updatedAt || 0;
		return bTime - aTime;
	});
}

function upsertCampaign(campaigns: Campaign[], campaign: Campaign): Campaign[] {
	const next = [campaign, ...campaigns.filter((c) => c.id !== campaign.id)];
	return sortCampaignsNewestFirst(next);
}

function upsertRun(runs: PrompterRun[], run: PrompterRun): PrompterRun[] {
	const next = [run, ...runs.filter((r) => r.id !== run.id)];
	return next.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export const usePrompterStore = create<PrompterStore>()((set, get) => ({
	...initialWizardState(),

	// ----------------------------------------------------------- wizard nav
	openWizard: () => set({ wizardOpen: true }),
	closeWizard: () => set({ wizardOpen: false }),
	setWizardStep: (wizardStep) => set({ wizardStep }),
	goNext: () => {
		const i = stepIndex(get().wizardStep);
		const next = PROMPTER_WIZARD_STEPS[Math.min(i + 1, PROMPTER_WIZARD_STEPS.length - 1)];
		set({ wizardStep: next });
	},
	goBack: () => {
		const i = stepIndex(get().wizardStep);
		const prev = PROMPTER_WIZARD_STEPS[Math.max(i - 1, 0)];
		set({ wizardStep: prev });
	},

	// ------------------------------------------------------------- project
	setProjectDraft: (projectDraft) => set({ projectDraft }),
	setProjectPlan: (projectPlan) => set({ projectPlan }),
	setCreatedProject: (createdProject) => set({ createdProject }),

	// -------------------------------------------------------------- agents
	toggleAgent: (agent) =>
		set((state) => {
			const exists = state.selectedAgents.some((a) => a.agentId === agent.agentId);
			const selectedAgents = exists
				? state.selectedAgents.filter((a) => a.agentId !== agent.agentId)
				: [...state.selectedAgents, agent];
			const agentConfigs = new Map(state.agentConfigs);
			if (exists) agentConfigs.delete(agent.agentId);
			return { selectedAgents, agentConfigs };
		}),
	setSelectedAgents: (selectedAgents) => set({ selectedAgents }),
	setAgentConfig: (agentId, config) =>
		set((state) => {
			const agentConfigs = new Map(state.agentConfigs);
			agentConfigs.set(agentId, config);
			return { agentConfigs };
		}),

	// ------------------------------------------------------------- schemas
	toggleSchema: (schemaId) =>
		set((state) => {
			const selectedSchemas = new Set(state.selectedSchemas);
			if (selectedSchemas.has(schemaId)) selectedSchemas.delete(schemaId);
			else selectedSchemas.add(schemaId);
			return { selectedSchemas };
		}),
	setSelectedSchemas: (schemaIds) => set({ selectedSchemas: new Set(schemaIds) }),

	// --------------------------------------------------------- transforms
	toggleTransform: (transformId) =>
		set((state) => {
			const selectedTransforms = new Set(state.selectedTransforms);
			if (selectedTransforms.has(transformId)) selectedTransforms.delete(transformId);
			else selectedTransforms.add(transformId);
			return { selectedTransforms };
		}),
	setSelectedTransforms: (transformIds) => set({ selectedTransforms: new Set(transformIds) }),
	toggleTransformCategory: (transforms) =>
		set((state) => {
			const selectedTransforms = new Set(state.selectedTransforms);
			const allSelected = transforms.every((t) => selectedTransforms.has(t));
			for (const t of transforms) {
				if (allSelected) selectedTransforms.delete(t);
				else selectedTransforms.add(t);
			}
			return { selectedTransforms };
		}),

	// --------------------------------------------------- test targets
	setTestTargets: (testTargets) => set({ testTargets }),
	toggleTestTarget: (target) =>
		set((state) => {
			const exists = state.testTargets.some(
				(t) => t.agentId === target.agentId && t.modelId === target.modelId
			);
			const testTargets = exists
				? state.testTargets.filter(
						(t) => !(t.agentId === target.agentId && t.modelId === target.modelId)
					)
				: [...state.testTargets, target];
			return { testTargets };
		}),
	setPrimaryTarget: (agentId, modelId) =>
		set((state) => ({
			testTargets: state.testTargets.map((t) => ({
				...t,
				isPrimary: t.agentId === agentId && t.modelId === modelId,
			})),
		})),

	// ------------------------------------------------- red-team crafter
	setCrafterConfig: (crafterConfig) => set({ crafterConfig }),
	setCrafterAgents: (crafterAgents) => set({ crafterAgents }),
	toggleCrafterAgent: (agent) =>
		set((state) => {
			const exists = state.crafterAgents.some(
				(c) => c.agentId === agent.agentId && c.modelId === agent.modelId
			);
			const crafterAgents = exists
				? state.crafterAgents.filter(
						(c) => !(c.agentId === agent.agentId && c.modelId === agent.modelId)
					)
				: [...state.crafterAgents, agent];
			return { crafterAgents };
		}),

	// ------------------------------------------------------ custom data
	setCustomDataOverride: (key, value) =>
		set((state) => ({
			customDataOverrides: { ...state.customDataOverrides, [key]: value },
		})),
	setCustomDataOverrides: (customDataOverrides) => set({ customDataOverrides }),

	// -------------------------------------------------------- instructions
	setAvailableInstructions: (availableInstructions) => set({ availableInstructions }),

	// ----------------------------------------------------------------- run
	setActiveRun: (activeRun) =>
		set((state) => ({
			activeRun,
			runHistory: activeRun ? upsertRun(state.runHistory, activeRun) : state.runHistory,
		})),
	updateRunFromEvent: (event) =>
		set((state) => {
			if (!state.activeRun || state.activeRun.id !== event.runId) return {};
			const activeRun = {
				...state.activeRun,
				status: event.status,
				phase: event.phase,
				summary: event.summary,
			};
			// Keep the Left Bar runs list live and accurate after completion.
			return { activeRun, runHistory: upsertRun(state.runHistory, activeRun) };
		}),
	updateTaskFromEvent: (event) =>
		set((state) => {
			if (!state.activeRun || state.activeRun.id !== event.runId) return {};
			const tasks = state.activeRun.tasks.map((t) => (t.id === event.task.id ? event.task : t));
			return { activeRun: { ...state.activeRun, tasks } };
		}),
	appendLog: (event) =>
		set((state) => {
			const compactLog = [...state.compactLog, event];
			if (compactLog.length > MAX_LOG_ENTRIES) {
				compactLog.splice(0, compactLog.length - MAX_LOG_ENTRIES);
			}
			return { compactLog };
		}),
	setLogFilter: (logFilter) => set({ logFilter }),
	clearActiveRun: () => set({ activeRun: null, compactLog: [], prompterFocused: false }),
	loadRunHistory: (runHistory) => set({ runHistory }),
	mergeRunHistory: (runs) =>
		set((state) => {
			let runHistory = state.runHistory;
			for (const run of runs) runHistory = upsertRun(runHistory, run);
			return { runHistory };
		}),
	focusPrompterRun: () => set({ prompterFocused: true }),
	blurPrompterRun: () => set({ prompterFocused: false }),

	// ---------------------------------------------------------- campaign
	setActiveCampaign: (activeCampaign) =>
		set((state) => ({
			activeCampaign,
			campaignHistory: activeCampaign
				? upsertCampaign(state.campaignHistory, activeCampaign)
				: state.campaignHistory,
		})),
	updateCampaignFromEvent: (event) =>
		set((state) => {
			// Prefer the full snapshot so the dashboard reflects live iterations,
			// findings, metrics and hardened instructions. Fall back to a scalar
			// status merge if an older emitter omits the snapshot.
			const existing =
				state.activeCampaign?.id === event.campaignId
					? state.activeCampaign
					: state.campaignHistory.find((c) => c.id === event.campaignId);
			const updated = event.campaign
				? event.campaign
				: existing
					? {
							...existing,
							status: event.status,
							updatedAt: Date.now(),
						}
					: null;
			if (!updated) return {};
			return {
				activeCampaign:
					state.activeCampaign?.id === event.campaignId ? updated : state.activeCampaign,
				campaignHistory: upsertCampaign(state.campaignHistory, updated),
			};
		}),
	clearActiveCampaign: () => set({ activeCampaign: null }),
	loadCampaignHistory: (campaignHistory) =>
		set((state) => {
			const sorted = sortCampaignsNewestFirst(campaignHistory);
			const activeCampaign =
				state.activeCampaign && sorted.some((c) => c.id === state.activeCampaign?.id)
					? (sorted.find((c) => c.id === state.activeCampaign?.id) ?? state.activeCampaign)
					: state.activeCampaign;
			return { campaignHistory: sorted, activeCampaign };
		}),
	dismissCampaign: (campaignId) =>
		set((state) => {
			const campaignHistory = state.campaignHistory.filter((c) => c.id !== campaignId);
			if (state.activeCampaign?.id !== campaignId) {
				return { campaignHistory };
			}
			return {
				campaignHistory,
				activeCampaign: campaignHistory[0] ?? null,
			};
		}),

	// -------------------------------------------------------------- resume
	saveStateForResume: () => {
		const s = get();
		// Nothing meaningful to resume before a project is drafted.
		if (!s.projectDraft && !s.createdProject) return;
		const snapshot: SerializableWizardState = {
			wizardStep: s.wizardStep,
			projectDraft: s.projectDraft,
			createdProject: s.createdProject,
			selectedAgentIds: s.selectedAgents.map((a) => a.agentId),
			agentConfigs: Array.from(s.agentConfigs.values()),
			selectedSchemaIds: Array.from(s.selectedSchemas),
			selectedTransformIds: Array.from(s.selectedTransforms),
			customDataOverrides:
				Object.keys(s.customDataOverrides).length > 0 ? s.customDataOverrides : undefined,
			testTargets: s.testTargets.length > 0 ? s.testTargets : undefined,
			crafterConfig: s.crafterConfig ?? undefined,
			crafterAgents: s.crafterAgents.length > 0 ? s.crafterAgents : undefined,
			savedAt: Date.now(),
		};
		try {
			localStorage.setItem(RESUME_KEY, JSON.stringify(snapshot));
		} catch {
			/* storage may be unavailable; resume is best-effort */
		}
		set({ savedWizardState: snapshot });
	},
	clearResumeState: () => {
		try {
			localStorage.removeItem(RESUME_KEY);
		} catch {
			/* ignore */
		}
		set({ savedWizardState: null });
	},
	restoreFromSavedState: (snapshot) =>
		set(() => {
			const agentConfigs = new Map<string, PrompterAgentConfig>();
			for (const config of snapshot.agentConfigs) agentConfigs.set(config.agentId, config);
			const selectedAgents: PrompterAgentSelection[] = snapshot.selectedAgentIds.map((agentId) => ({
				agentId,
				displayName: getAgentDisplayName(agentId),
				cliPath: '',
				status: 'detected',
			}));
			return {
				wizardOpen: true,
				wizardStep: snapshot.wizardStep,
				projectDraft: snapshot.projectDraft,
				createdProject: snapshot.createdProject,
				selectedAgents,
				agentConfigs,
				selectedSchemas: new Set(snapshot.selectedSchemaIds),
				selectedTransforms: new Set(
					snapshot.selectedTransformIds?.length
						? snapshot.selectedTransformIds
						: ALL_TRANSFORM_NAMES
				),
				testTargets: snapshot.testTargets ?? [],
				crafterConfig: snapshot.crafterConfig ?? null,
				crafterAgents: snapshot.crafterAgents ?? [],
				customDataOverrides: snapshot.customDataOverrides ?? {},
				savedWizardState: snapshot,
			};
		}),
	loadResumeState: () => {
		try {
			const raw = localStorage.getItem(RESUME_KEY);
			if (!raw) return null;
			const parsed = JSON.parse(raw) as SerializableWizardState;
			set({ savedWizardState: parsed });
			return parsed;
		} catch {
			return null;
		}
	},

	// ------------------------------------------------------------- cleanup
	resetWizard: () =>
		set((state) => ({
			...initialWizardState(),
			// keep run-side state and history across a wizard reset
			activeRun: state.activeRun,
			runHistory: state.runHistory,
			compactLog: state.compactLog,
			prompterFocused: state.prompterFocused,
			activeCampaign: state.activeCampaign,
			campaignHistory: state.campaignHistory,
		})),
}));

// ============================================================================
// Selectors
// ============================================================================

export const selectWizardOpen = (state: PrompterStore): boolean => state.wizardOpen;
export const selectWizardStep = (state: PrompterStore): PrompterWizardStep => state.wizardStep;
export const selectActiveRun = (state: PrompterStore): PrompterRun | null => state.activeRun;
export const selectRunHistory = (state: PrompterStore): PrompterRun[] => state.runHistory;
export const selectCreatedProject = (state: PrompterStore): PrompterProject | null =>
	state.createdProject;

export const selectActiveCampaign = (state: PrompterStore): Campaign | null => state.activeCampaign;

export const selectCampaignHistory = (state: PrompterStore): Campaign[] => state.campaignHistory;

export const selectIsFirstStep = (state: PrompterStore): boolean =>
	stepIndex(state.wizardStep) === 0;
export const selectIsLastStep = (state: PrompterStore): boolean =>
	stepIndex(state.wizardStep) === PROMPTER_WIZARD_STEPS.length - 1;

export const selectFilteredLog =
	() =>
	(state: PrompterStore): PrompterLogEvent[] =>
		state.logFilter === 'all'
			? state.compactLog
			: state.compactLog.filter((e) => e.level === state.logFilter);
