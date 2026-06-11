/**
 * prompterStore - Zustand store for the Prompter (Prompt Safety Lab) feature.
 *
 * Holds the 7-step wizard state machine, the active run + live event updates,
 * the compact log, and a serializable resume snapshot persisted to localStorage
 * so an unfinished wizard survives an app restart.
 *
 * Playbook reference: 05-PLAYBOOK-PROMPTER-PROMPT-SAFETY-LAB, Task E.
 */

import { create } from 'zustand';
import { getAgentDisplayName } from '../../shared/agentMetadata';
import {
	PROMPTER_WIZARD_STEPS,
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
	availableInstructions: InstructionFile[];

	// Run
	activeRun: PrompterRun | null;
	runHistory: PrompterRun[];
	compactLog: PrompterLogEvent[];
	logFilter: PrompterLogFilter;

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
	availableInstructions: [],
	activeRun: null,
	runHistory: [],
	compactLog: [],
	logFilter: 'all',
	savedWizardState: null,
});

function stepIndex(step: PrompterWizardStep): number {
	return PROMPTER_WIZARD_STEPS.indexOf(step);
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

	// -------------------------------------------------------- instructions
	setAvailableInstructions: (availableInstructions) => set({ availableInstructions }),

	// ----------------------------------------------------------------- run
	setActiveRun: (activeRun) => set({ activeRun }),
	updateRunFromEvent: (event) =>
		set((state) => {
			if (!state.activeRun || state.activeRun.id !== event.runId) return {};
			return {
				activeRun: {
					...state.activeRun,
					status: event.status,
					phase: event.phase,
					summary: event.summary,
				},
			};
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
	clearActiveRun: () => set({ activeRun: null, compactLog: [] }),
	loadRunHistory: (runHistory) => set({ runHistory }),

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
		})),
}));

// ============================================================================
// Selectors
// ============================================================================

export const selectWizardOpen = (state: PrompterStore): boolean => state.wizardOpen;
export const selectWizardStep = (state: PrompterStore): PrompterWizardStep => state.wizardStep;
export const selectActiveRun = (state: PrompterStore): PrompterRun | null => state.activeRun;
export const selectCreatedProject = (state: PrompterStore): PrompterProject | null =>
	state.createdProject;

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
