/**
 * Tests for prompterStore - the 7-step wizard state machine, run-event
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
	Campaign,
	CampaignUpdatedEvent,
} from '../../../shared/prompter-types';

function baseCampaign(overrides: Partial<Campaign> = {}): Campaign {
	return {
		id: 'camp-1',
		config: {} as Campaign['config'],
		status: 'planned',
		iterations: [],
		findings: [],
		metrics: {
			totalIterations: 0,
			totalRuns: 0,
			totalTasks: 0,
			overallSuccessRate: 0,
			bestTechnique: '',
			bestSuccessRate: 0,
			weakestBoundary: '',
			strongestBoundary: '',
		},
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	};
}

function campaignEvent(overrides: Partial<CampaignUpdatedEvent> = {}): CampaignUpdatedEvent {
	return {
		campaignId: 'camp-1',
		status: 'running',
		currentIteration: 0,
		totalIterations: 5,
		findings: 0,
		overallComplianceRate: 0,
		campaign: baseCampaign({ status: 'running' }),
		...overrides,
	};
}

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
		schemaId: 'adversarial-compliance-test',
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
		schemas: ['adversarial-compliance-test'],
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
		s.toggleSchema('adversarial-compliance-test');
		expect(usePrompterStore.getState().selectedSchemas.has('adversarial-compliance-test')).toBe(
			true
		);
		usePrompterStore.getState().toggleSchema('adversarial-compliance-test');
		expect(usePrompterStore.getState().selectedSchemas.has('adversarial-compliance-test')).toBe(
			false
		);
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
				totalTokens: 0,
				avgResponseLength: 0,
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
				totalTokens: 0,
				avgResponseLength: 0,
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
		s.toggleSchema('adversarial-compliance-test');
		s.saveStateForResume();

		expect(localStorage.getItem('prompter:wizard-resume')).toBeTruthy();
		const snapshot = usePrompterStore.getState().savedWizardState;
		expect(snapshot?.selectedSchemaIds).toContain('adversarial-compliance-test');
		expect(snapshot?.selectedAgentIds).toContain('claude-code');

		// wipe + restore
		usePrompterStore.getState().resetWizard();
		expect(usePrompterStore.getState().selectedAgents).toHaveLength(0);
		usePrompterStore.getState().restoreFromSavedState(snapshot!);
		expect(usePrompterStore.getState().wizardStep).toBe('schema-selection');
		expect(usePrompterStore.getState().selectedSchemas.has('adversarial-compliance-test')).toBe(
			true
		);
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

describe('prompterStore campaign event reducer', () => {
	beforeEach(() => {
		usePrompterStore.setState({ activeCampaign: null, campaignHistory: [] });
	});

	it('adds each new campaign as its own newest-first sidebar entry', () => {
		const first = baseCampaign({
			id: 'camp-1',
			createdAt: 100,
			config: { name: 'First' } as Campaign['config'],
		});
		const second = baseCampaign({
			id: 'camp-2',
			createdAt: 200,
			config: { name: 'Second' } as Campaign['config'],
		});

		usePrompterStore.getState().setActiveCampaign(first);
		usePrompterStore.getState().setActiveCampaign(second);

		const state = usePrompterStore.getState();
		expect(state.activeCampaign?.id).toBe('camp-2');
		expect(state.campaignHistory.map((c) => c.id)).toEqual(['camp-2', 'camp-1']);
	});

	it('applies the full campaign snapshot so progress fields reach the dashboard', () => {
		usePrompterStore.getState().setActiveCampaign(baseCampaign());
		const snapshot = baseCampaign({
			status: 'running',
			iterations: [{ iterationNumber: 1 } as unknown as Campaign['iterations'][number]],
			findings: [{ technique: 'authority-frame' } as unknown as Campaign['findings'][number]],
			metrics: { ...baseCampaign().metrics, overallSuccessRate: 0.42 },
			updatedAt: 123,
		});
		usePrompterStore.getState().updateCampaignFromEvent(campaignEvent({ campaign: snapshot }));

		const active = usePrompterStore.getState().activeCampaign;
		expect(active?.iterations).toHaveLength(1);
		expect(active?.findings).toHaveLength(1);
		expect(active?.metrics.overallSuccessRate).toBe(0.42);
		expect(active?.status).toBe('running');
		expect(usePrompterStore.getState().campaignHistory[0].status).toBe('running');
	});

	it('keeps focus when an event arrives for a different visible campaign', () => {
		usePrompterStore.getState().setActiveCampaign(baseCampaign({ id: 'camp-1' }));
		usePrompterStore
			.getState()
			.setActiveCampaign(baseCampaign({ id: 'other', status: 'running', createdAt: 200 }));
		usePrompterStore.getState().setActiveCampaign(baseCampaign({ id: 'camp-1', createdAt: 100 }));
		usePrompterStore.getState().updateCampaignFromEvent(
			campaignEvent({
				campaignId: 'other',
				status: 'completed',
				campaign: baseCampaign({ id: 'other', status: 'completed', createdAt: 200 }),
			})
		);
		expect(usePrompterStore.getState().activeCampaign?.status).toBe('planned');
		expect(usePrompterStore.getState().campaignHistory.find((c) => c.id === 'other')?.status).toBe(
			'completed'
		);
	});

	it('dismisses a campaign without deleting the remaining entries', () => {
		usePrompterStore.getState().setActiveCampaign(baseCampaign({ id: 'camp-1', createdAt: 100 }));
		usePrompterStore.getState().setActiveCampaign(baseCampaign({ id: 'camp-2', createdAt: 200 }));

		usePrompterStore.getState().dismissCampaign('camp-2');

		const state = usePrompterStore.getState();
		expect(state.campaignHistory.map((c) => c.id)).toEqual(['camp-1']);
		expect(state.activeCampaign?.id).toBe('camp-1');
	});
});
