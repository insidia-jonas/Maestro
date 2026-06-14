/**
 * @file prompter.ts (preload)
 * @description contextBridge factory for the Prompter (Prompt Power & Robustness Lab) API.
 * invoke() methods mirror the IPC handlers in src/main/ipc/handlers/prompter.ts;
 * onXxx() subscriptions return an unsubscribe function.
 *
 * Playbook reference: section 8 (Task D).
 */

import { ipcRenderer } from 'electron';
import type {
	ProjectPlan,
	PrompterProject,
	InstructionFile,
	PrompterSchema,
	PrompterModelOption,
	PrompterRun,
	PrompterRunConfig,
	PrompterRunUpdatedEvent,
	PrompterTaskUpdatedEvent,
	PrompterLogEvent,
	InstructionExportFormat,
	InstructionExportResult,
	TestTarget,
	Campaign,
	CampaignConfig,
	CampaignUpdatedEvent,
	ResearchExportFormat,
	ResearchExportResult,
} from '../../shared/prompter-types';

export function createPrompterApi() {
	return {
		// Project setup
		planProject: (targetDir: string, projectName: string): Promise<ProjectPlan> =>
			ipcRenderer.invoke('prompter:planProject', targetDir, projectName),
		createProject: (targetDir: string, projectName: string): Promise<PrompterProject> =>
			ipcRenderer.invoke('prompter:createProject', targetDir, projectName),
		deleteProject: (projectRoot: string): Promise<void> =>
			ipcRenderer.invoke('prompter:deleteProject', projectRoot),
		openProjectFolder: (projectRoot: string): Promise<void> =>
			ipcRenderer.invoke('prompter:openProjectFolder', projectRoot),
		selectFile: (): Promise<string | null> => ipcRenderer.invoke('prompter:selectFile'),
		updateProjectTargets: (projectRoot: string, targets: TestTarget[]): Promise<void> =>
			ipcRenderer.invoke('prompter:updateProjectTargets', projectRoot, targets),

		// Instructions
		listInstructions: (projectRoot: string): Promise<InstructionFile[]> =>
			ipcRenderer.invoke('prompter:listInstructions', projectRoot),
		importInstruction: (projectRoot: string, sourcePath: string): Promise<InstructionFile> =>
			ipcRenderer.invoke('prompter:importInstruction', projectRoot, sourcePath),

		// Schemas
		listSchemas: (projectRoot?: string): Promise<PrompterSchema[]> =>
			ipcRenderer.invoke('prompter:listSchemas', projectRoot),

		// Models
		getAgentModelOptions: (
			agentId: string,
			forceRefresh?: boolean
		): Promise<PrompterModelOption[]> =>
			ipcRenderer.invoke('prompter:getAgentModelOptions', agentId, forceRefresh),

		// Runs
		createRun: (runConfig: PrompterRunConfig): Promise<PrompterRun> =>
			ipcRenderer.invoke('prompter:createRun', runConfig),
		startRun: (runId: string): Promise<void> => ipcRenderer.invoke('prompter:startRun', runId),
		pauseRun: (runId: string): Promise<void> => ipcRenderer.invoke('prompter:pauseRun', runId),
		resumeRun: (runId: string): Promise<void> => ipcRenderer.invoke('prompter:resumeRun', runId),
		stopRun: (runId: string): Promise<void> => ipcRenderer.invoke('prompter:stopRun', runId),
		getRun: (runId: string): Promise<PrompterRun | null> =>
			ipcRenderer.invoke('prompter:getRun', runId),
		listRuns: (projectRoot: string): Promise<PrompterRun[]> =>
			ipcRenderer.invoke('prompter:listRuns', projectRoot),
		deleteRun: (runId: string): Promise<void> => ipcRenderer.invoke('prompter:deleteRun', runId),
		recoverRuns: (projectRoots: string[]): Promise<PrompterRun[]> =>
			ipcRenderer.invoke('prompter:recoverRuns', projectRoots),

		// Reports
		exportReport: (runId: string, format: 'md' | 'json'): Promise<string> =>
			ipcRenderer.invoke('prompter:exportReport', runId, format),
		exportDefenderReport: (runId: string): Promise<string> =>
			ipcRenderer.invoke('prompter:exportDefenderReport', runId),

		// Instruction export
		exportInstruction: (
			projectRoot: string,
			instructionPath: string,
			targetDir: string,
			format: InstructionExportFormat
		): Promise<InstructionExportResult> =>
			ipcRenderer.invoke(
				'prompter:exportInstruction',
				projectRoot,
				instructionPath,
				targetDir,
				format
			),
		selectExportFolder: (): Promise<string | null> =>
			ipcRenderer.invoke('prompter:selectExportFolder'),

		// Campaigns (autonomous adversarial test loops)
		createCampaign: (config: CampaignConfig): Promise<Campaign> =>
			ipcRenderer.invoke('prompter:createCampaign', config),
		startCampaign: (campaignId: string): Promise<void> =>
			ipcRenderer.invoke('prompter:startCampaign', campaignId),
		pauseCampaign: (campaignId: string): Promise<void> =>
			ipcRenderer.invoke('prompter:pauseCampaign', campaignId),
		resumeCampaign: (campaignId: string): Promise<void> =>
			ipcRenderer.invoke('prompter:resumeCampaign', campaignId),
		stopCampaign: (campaignId: string): Promise<void> =>
			ipcRenderer.invoke('prompter:stopCampaign', campaignId),
		getCampaign: (campaignId: string): Promise<Campaign | null> =>
			ipcRenderer.invoke('prompter:getCampaign', campaignId),
		listCampaigns: (): Promise<Campaign[]> => ipcRenderer.invoke('prompter:listCampaigns'),

		// Hardened instruction generation
		generateHardenedInstruction: (
			runId: string
		): Promise<{ path: string; basedOn: string; findingsAddressed: string[] } | null> =>
			ipcRenderer.invoke('prompter:generateHardenedInstruction', runId),

		// Research export
		exportResearchData: (
			runId: string,
			targetDir: string,
			format: ResearchExportFormat
		): Promise<ResearchExportResult> =>
			ipcRenderer.invoke('prompter:exportResearchData', runId, targetDir, format),
		exportCampaignData: (
			campaignId: string,
			targetDir: string,
			format: ResearchExportFormat
		): Promise<ResearchExportResult> =>
			ipcRenderer.invoke('prompter:exportCampaignData', campaignId, targetDir, format),

		// Events
		onRunUpdated: (callback: (payload: PrompterRunUpdatedEvent) => void): (() => void) => {
			const handler = (_: unknown, payload: PrompterRunUpdatedEvent) => callback(payload);
			ipcRenderer.on('prompter:runUpdated', handler);
			return () => ipcRenderer.removeListener('prompter:runUpdated', handler);
		},
		onTaskUpdated: (callback: (payload: PrompterTaskUpdatedEvent) => void): (() => void) => {
			const handler = (_: unknown, payload: PrompterTaskUpdatedEvent) => callback(payload);
			ipcRenderer.on('prompter:taskUpdated', handler);
			return () => ipcRenderer.removeListener('prompter:taskUpdated', handler);
		},
		onLog: (callback: (payload: PrompterLogEvent) => void): (() => void) => {
			const handler = (_: unknown, payload: PrompterLogEvent) => callback(payload);
			ipcRenderer.on('prompter:log', handler);
			return () => ipcRenderer.removeListener('prompter:log', handler);
		},
		onCampaignUpdated: (callback: (payload: CampaignUpdatedEvent) => void): (() => void) => {
			const handler = (_: unknown, payload: CampaignUpdatedEvent) => callback(payload);
			ipcRenderer.on('prompter:campaignUpdated', handler);
			return () => ipcRenderer.removeListener('prompter:campaignUpdated', handler);
		},
	};
}

export type PrompterApi = ReturnType<typeof createPrompterApi>;
