/**
 * Tests for prompterStore — the 7-step wizard state machine, run-event
 * reducers, and localStorage-backed resume.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { usePrompterStore } from '../prompterStore';
import type {
	PrompterAgentSelection,
	PrompterRun,
	PrompterTask,
	PrompterRunUpdatedEvent,
	PrompterTaskUpdatedEvent,
} from '../../../shared/prompter-types';

const agent = (id: string): PrompterAgentSelection => ({
	agentId: id,
	displayName: id,
	cliPath: '/bin/' + id,
	status: 'detected',
});

function baseRun(): PrompterRun {
	const task: PrompterTask = {
		id: 'task-0',
		runId: 'run-1',
		agentId: 'claude-code',
		modelId: 'claude-fable-5',
		schemaId: 'baseline',
		instructionFile: 'eni.md',
		instructionHash: 'h',
		status: 'pending',
	};
	return {
		id: 'run-1',
		projectId: 'p1',
		projectRoot: '/tmp/lab',
		status: 'planned',
		phase: 'scaffold',
		agents: [],
		schemas: ['baseline'],
		tasks: [task],
		maxParallelAgents: 4,
		createdAt: 1,
		updatedAt: 1,
	};
}

describe('prompterStore wizard navigation', () => {
	beforeEach(() => {
		usePrompterStore.getState().resetWizard();
		usePrompterStore.setState({ wizardStep: 'project-folder' });
		localStorage.clear();
	});

	it('goNext / goBack walk the step list and clamp at the ends', () => {
		const s = usePrompterStore.getState();
		expect(usePrompterStore.getState().wizardStep).toBe('project-folder');
		s.goBack();
		expect(usePrompterStore.getState().wizardStep).toBe('project-folder'); // clamped
		s.goNext();
		expect(usePrompterStore.getState().wizardStep).toBe('create-structure');
		// walk to the end
		for (let i = 0; i < 10; i++) usePrompterStore.getState().goNext();
		expect(usePrompterStore.getState().wizardStep).toBe('review'); // clamped at last
	});
});

describe('prompterStore agents + schemas', () => {
	beforeEach(() => usePrompterStore.getState().resetWizard());

	it('toggleAgent adds/removes and drops its config', () => {
		const s = usePrompterStore.getState();
		s.toggleAgent(agent('claude-code'));
		expect(usePrompterStore.getState().selectedAgents).toHaveLength(1);
		s.setAgentConfig('claude-code', {
			agentId: 'claude-code',
			modelId: 'm',
			modelSource: 'manual',
			instructionFile: '*',
			providerConfigOverrides: {},
			generatedFiles: [],
		});
		expect(usePrompterStore.getState().agentConfigs.has('claude-code')).toBe(true);
		usePrompterStore.getState().toggleAgent(agent('claude-code'));
		expect(usePrompterStore.getState().selectedAgents).toHaveLength(0);
		expect(usePrompterStore.getState().agentConfigs.has('claude-code')).toBe(false);
	});

	it('toggleSchema flips membership in the set', () => {
		const s = usePrompterStore.getState();
		s.toggleSchema('baseline');
		expect(usePrompterStore.getState().selectedSchemas.has('baseline')).toBe(true);
		usePrompterStore.getState().toggleSchema('baseline');
		expect(usePrompterStore.getState().selectedSchemas.has('baseline')).toBe(false);
	});
});

describe('prompterStore run events', () => {
	beforeEach(() => {
		usePrompterStore.getState().resetWizard();
		usePrompterStore.getState().clearActiveRun();
		usePrompterStore.getState().setActiveRun(baseRun());
	});

	it('updateRunFromEvent patches status/phase/summary for the active run', () => {
		const event: PrompterRunUpdatedEvent = {
			runId: 'run-1',
			status: 'running',
			phase: 'schema-test',
			summary: {
				totalTasks: 1,
				completedTasks: 0,
				green: 0,
				yellow: 0,
				red: 0,
				failed: 0,
				skipped: 0,
				durationMs: 5,
			},
		};
		usePrompterStore.getState().updateRunFromEvent(event);
		expect(usePrompterStore.getState().activeRun?.status).toBe('running');
		expect(usePrompterStore.getState().activeRun?.phase).toBe('schema-test');
	});

	it('ignores events for a different run', () => {
		usePrompterStore.getState().updateRunFromEvent({
			runId: 'other',
			status: 'completed',
			phase: 'report',
			summary: {
				totalTasks: 0,
				completedTasks: 0,
				green: 0,
				yellow: 0,
				red: 0,
				failed: 0,
				skipped: 0,
				durationMs: 0,
			},
		});
		expect(usePrompterStore.getState().activeRun?.status).toBe('planned');
	});

	it('updateTaskFromEvent replaces the matching task', () => {
		const updated: PrompterTask = {
			...baseRun().tasks[0],
			status: 'completed',
			result: 'green',
		};
		const event: PrompterTaskUpdatedEvent = { runId: 'run-1', task: updated };
		usePrompterStore.getState().updateTaskFromEvent(event);
		expect(usePrompterStore.getState().activeRun?.tasks[0].status).toBe('completed');
		expect(usePrompterStore.getState().activeRun?.tasks[0].result).toBe('green');
	});

	it('appendLog and filter work together', () => {
		const s = usePrompterStore.getState();
		s.appendLog({ runId: 'run-1', level: 'info', message: 'a', timestamp: 1 });
		s.appendLog({ runId: 'run-1', level: 'warn', message: 'b', timestamp: 2 });
		expect(usePrompterStore.getState().compactLog).toHaveLength(2);
		usePrompterStore.getState().setLogFilter('warn');
		const filtered = usePrompterStore
			.getState()
			.compactLog.filter((e) => e.level === usePrompterStore.getState().logFilter);
		expect(filtered).toHaveLength(1);
	});
});

describe('prompterStore resume', () => {
	beforeEach(() => {
		usePrompterStore.getState().resetWizard();
		localStorage.clear();
	});

	it('saveStateForResume persists and restoreFromSavedState reloads it', () => {
		const s = usePrompterStore.getState();
		s.setProjectDraft({ targetDir: '/tmp', projectName: 'lab', dryRun: true });
		s.toggleAgent(agent('claude-code'));
		s.setWizardStep('schema-selection');
		s.toggleSchema('baseline');
		s.saveStateForResume();

		expect(localStorage.getItem('prompter:wizard-resume')).toBeTruthy();
		const snapshot = usePrompterStore.getState().savedWizardState;
		expect(snapshot?.selectedSchemaIds).toContain('baseline');
		expect(snapshot?.selectedAgentIds).toContain('claude-code');

		// wipe + restore
		usePrompterStore.getState().resetWizard();
		expect(usePrompterStore.getState().selectedAgents).toHaveLength(0);
		usePrompterStore.getState().restoreFromSavedState(snapshot!);
		expect(usePrompterStore.getState().wizardStep).toBe('schema-selection');
		expect(usePrompterStore.getState().selectedSchemas.has('baseline')).toBe(true);
		expect(usePrompterStore.getState().selectedAgents[0].agentId).toBe('claude-code');
	});

	it('clearResumeState removes the snapshot', () => {
		const s = usePrompterStore.getState();
		s.setProjectDraft({ targetDir: '/tmp', projectName: 'lab', dryRun: false });
		s.saveStateForResume();
		usePrompterStore.getState().clearResumeState();
		expect(localStorage.getItem('prompter:wizard-resume')).toBeNull();
		expect(usePrompterStore.getState().savedWizardState).toBeNull();
	});
});
