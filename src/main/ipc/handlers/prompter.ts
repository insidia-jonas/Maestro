/**
 * @file prompter.ts (IPC handlers)
 * @description IPC surface for the Prompter (Prompt Safety Lab) feature. Wires
 * the main-process services (project service, schema registry, model discovery,
 * config writer, evaluator, report writer, run manager) to renderer-facing
 * channels and forwards run/task/log events to the renderer.
 *
 * Agent spawning goes through the shared spawnAgent() (src/cli/services/
 * agent-spawner), loaded lazily via dynamic import so the cli chain stays out of
 * the main hot path. Prompter never accesses ProcessManager directly, so
 * getProcessManager is intentionally NOT a dependency here (stop is handled via
 * AbortController + timeout inside the run manager).
 *
 * Playbook reference: section 8 (Task C), section 10.
 */

import { ipcMain, shell, type BrowserWindow } from 'electron';
import type Store from 'electron-store';
import { withIpcErrorLogging, type CreateHandlerOptions } from '../../utils/ipcHandler';
import type { MaestroSettings } from './persistence';
import type { AgentDetector } from '../../agents';
import type { ToolType } from '../../../shared/types';
import { PrompterProjectService } from '../../prompter/prompter-project-service';
import { PrompterModelDiscovery } from '../../prompter/prompter-model-discovery';
import { PrompterAgentConfigWriter } from '../../prompter/prompter-agent-config-writer';
import { PrompterReportWriter } from '../../prompter/prompter-report-writer';
import {
	PrompterRunManager,
	type PrompterSpawnFn,
	type PrompterEventSink,
} from '../../prompter/prompter-run-manager';
import type { PrompterRunConfig, PrompterModelOption } from '../../../shared/prompter-types';

const LOG_CONTEXT = '[Prompter]';

const handlerOpts = (
	operation: string,
	context = LOG_CONTEXT
): Pick<CreateHandlerOptions, 'context' | 'operation'> => ({ context, operation });

export interface PrompterHandlerDependencies {
	getMainWindow: () => BrowserWindow | null;
	getAgentDetector: () => AgentDetector | null;
	settingsStore: Store<MaestroSettings>;
}

/** Adapter: dynamic-import the cli spawnAgent and map to the run manager's shape. */
const spawnViaCli: PrompterSpawnFn = async (toolType, cwd, prompt, sessionId, options) => {
	const { spawnAgent } = await import('../../../cli/services/agent-spawner');
	const result = await spawnAgent(toolType as ToolType, cwd, prompt, sessionId, {
		customModel: options.customModel,
		customArgs: options.customArgs,
		appendSystemPrompt: options.appendSystemPrompt,
	});
	return {
		success: result.success,
		response: result.response,
		agentSessionId: result.agentSessionId,
		usageStats: result.usageStats as Record<string, unknown> | undefined,
		error: result.error,
	};
};

export function registerPrompterHandlers(deps: PrompterHandlerDependencies): void {
	const { getMainWindow, getAgentDetector } = deps;

	const projectService = new PrompterProjectService();
	const modelDiscovery = new PrompterModelDiscovery({ getAgentDetector });
	const configWriter = new PrompterAgentConfigWriter();
	const reportWriter = new PrompterReportWriter();

	const emit: PrompterEventSink = (event) => {
		const win = getMainWindow();
		if (!win || win.isDestroyed()) return;
		const channel =
			event.type === 'run'
				? 'prompter:runUpdated'
				: event.type === 'task'
					? 'prompter:taskUpdated'
					: 'prompter:log';
		win.webContents.send(channel, event.payload);
	};

	const runManager = new PrompterRunManager({
		projectService,
		configWriter,
		reportWriter,
		spawn: spawnViaCli,
		emit,
	});

	// ----------------------------------------------------------- project setup

	ipcMain.handle(
		'prompter:planProject',
		withIpcErrorLogging(
			handlerOpts('planProject'),
			async (targetDir: string, projectName: string) =>
				projectService.planProject(targetDir, projectName)
		)
	);

	ipcMain.handle(
		'prompter:createProject',
		withIpcErrorLogging(
			handlerOpts('createProject'),
			async (targetDir: string, projectName: string) =>
				projectService.createProject(targetDir, projectName)
		)
	);

	ipcMain.handle(
		'prompter:deleteProject',
		withIpcErrorLogging(handlerOpts('deleteProject'), async (projectRoot: string) => {
			await projectService.deleteProject(projectRoot);
		})
	);

	ipcMain.handle(
		'prompter:openProjectFolder',
		withIpcErrorLogging(handlerOpts('openProjectFolder'), async (projectRoot: string) => {
			await shell.openPath(projectRoot);
		})
	);

	// ------------------------------------------------------------- instructions

	ipcMain.handle(
		'prompter:listInstructions',
		withIpcErrorLogging(handlerOpts('listInstructions'), async (projectRoot: string) =>
			projectService.scanInstructions(projectRoot)
		)
	);

	ipcMain.handle(
		'prompter:importInstruction',
		withIpcErrorLogging(
			handlerOpts('importInstruction'),
			async (projectRoot: string, sourcePath: string) =>
				projectService.importInstruction(projectRoot, sourcePath)
		)
	);

	// ------------------------------------------------------------------ schemas

	ipcMain.handle(
		'prompter:listSchemas',
		withIpcErrorLogging(handlerOpts('listSchemas'), async (projectRoot?: string) => {
			const registry = projectService.getSchemaRegistry(projectRoot);
			return registry.listSchemaDescriptors();
		})
	);

	// ------------------------------------------------------------------- models

	ipcMain.handle(
		'prompter:getAgentModelOptions',
		withIpcErrorLogging(
			handlerOpts('getAgentModelOptions'),
			async (agentId: string, forceRefresh?: boolean): Promise<PrompterModelOption[]> =>
				modelDiscovery.getModelOptions(agentId, forceRefresh ?? false)
		)
	);

	// --------------------------------------------------------------------- runs

	ipcMain.handle(
		'prompter:createRun',
		withIpcErrorLogging(handlerOpts('createRun'), async (runConfig: PrompterRunConfig) =>
			runManager.createRun(runConfig)
		)
	);

	ipcMain.handle(
		'prompter:startRun',
		withIpcErrorLogging(handlerOpts('startRun'), async (runId: string) => {
			// Fire-and-forget: a run can take minutes. Progress is reported via
			// 'prompter:runUpdated' / 'prompter:taskUpdated' events.
			void runManager.startRun(runId).catch((error) => {
				const win = getMainWindow();
				if (win && !win.isDestroyed()) {
					win.webContents.send('prompter:log', {
						runId,
						level: 'error',
						message: `Run fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`,
						timestamp: Date.now(),
					});
				}
			});
		})
	);

	ipcMain.handle(
		'prompter:pauseRun',
		withIpcErrorLogging(handlerOpts('pauseRun'), async (runId: string) => {
			await runManager.pauseRun(runId);
		})
	);

	ipcMain.handle(
		'prompter:resumeRun',
		withIpcErrorLogging(handlerOpts('resumeRun'), async (runId: string) => {
			await runManager.resumeRun(runId);
		})
	);

	ipcMain.handle(
		'prompter:stopRun',
		withIpcErrorLogging(handlerOpts('stopRun'), async (runId: string) => {
			await runManager.stopRun(runId);
		})
	);

	ipcMain.handle(
		'prompter:getRun',
		withIpcErrorLogging(handlerOpts('getRun'), async (runId: string) => runManager.getRun(runId))
	);

	ipcMain.handle(
		'prompter:listRuns',
		withIpcErrorLogging(handlerOpts('listRuns'), async (projectRoot: string) =>
			runManager.listRuns(projectRoot)
		)
	);

	ipcMain.handle(
		'prompter:deleteRun',
		withIpcErrorLogging(handlerOpts('deleteRun'), async (runId: string) => {
			await runManager.deleteRun(runId);
		})
	);

	ipcMain.handle(
		'prompter:recoverRuns',
		withIpcErrorLogging(handlerOpts('recoverRuns'), async (projectRoots: string[]) =>
			runManager.recoverInterruptedRuns(projectRoots)
		)
	);

	// ------------------------------------------------------------------ reports

	ipcMain.handle(
		'prompter:exportReport',
		withIpcErrorLogging(
			handlerOpts('exportReport'),
			async (runId: string, format: 'md' | 'json'): Promise<string> => {
				const run = runManager.getRun(runId);
				if (!run) throw new Error(`Run nicht gefunden: ${runId}`);
				if (format === 'json') return JSON.stringify(run, null, 2);
				return reportWriter.writeRunReport(run.projectRoot, run);
			}
		)
	);
}
