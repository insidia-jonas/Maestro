/**
 * PrompterWizardModal - orchestrator for the 7-step Prompter (Power & Robustness Lab)
 * wizard. Visibility is driven by the modal store id 'prompter' (the parent
 * mounts this only when open). Owns step navigation, per-step advance
 * validation, the exit-confirm flow, and the terminal "Run starten" action
 * (createRun + startRun + setActiveRun). Each step component is presentational
 * and reads/writes the prompterStore directly.
 *
 * Playbook reference: section 6 (wizard flow), Task F, Task J.
 */

import { useState, useCallback, useEffect } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { Theme } from '../../types';
import { MODAL_PRIORITIES } from '../../constants/modalPriorities';
import { Modal } from '../ui/Modal';
import { useModalStore } from '../../stores/modalStore';
import { usePrompterStore, selectIsFirstStep, selectIsLastStep } from '../../stores/prompterStore';
import { PROMPTER_WIZARD_STEPS, type PrompterRunConfig } from '../../../shared/prompter-types';
import { rememberPrompterProjectRoot } from '../../hooks/prompter/usePrompterListeners';
import { PrompterWizardStepper } from './PrompterWizardStepper';
import { PrompterExitConfirmModal } from './PrompterExitConfirmModal';
import { ProjectFolderStep } from './ProjectFolderStep';
import { CreateStructureStep } from './CreateStructureStep';
import { AgentSelectionStep } from './AgentSelectionStep';
import { ModelConfigStep } from './ModelConfigStep';
import { InstructionStep } from './InstructionStep';
import { SchemaSelectionStep } from './SchemaSelectionStep';
import { ReviewStep } from './ReviewStep';

interface PrompterWizardModalProps {
	theme: Theme;
}

export function PrompterWizardModal({ theme }: PrompterWizardModalProps): JSX.Element {
	const wizardStep = usePrompterStore((s) => s.wizardStep);
	const isFirstStep = usePrompterStore(selectIsFirstStep);
	const isLastStep = usePrompterStore(selectIsLastStep);

	const goNext = usePrompterStore((s) => s.goNext);
	const goBack = usePrompterStore((s) => s.goBack);
	const resetWizard = usePrompterStore((s) => s.resetWizard);
	const saveStateForResume = usePrompterStore((s) => s.saveStateForResume);
	const clearResumeState = usePrompterStore((s) => s.clearResumeState);
	const setActiveRun = usePrompterStore((s) => s.setActiveRun);

	// Advance-gate inputs from the store.
	const projectDraft = usePrompterStore((s) => s.projectDraft);
	const createdProject = usePrompterStore((s) => s.createdProject);
	const selectedAgents = usePrompterStore((s) => s.selectedAgents);
	const agentConfigs = usePrompterStore((s) => s.agentConfigs);
	const availableInstructions = usePrompterStore((s) => s.availableInstructions);
	const selectedSchemas = usePrompterStore((s) => s.selectedSchemas);
	const selectedTransforms = usePrompterStore((s) => s.selectedTransforms);

	const [showExitConfirm, setShowExitConfirm] = useState(false);
	const [maxParallelAgents, setMaxParallelAgents] = useState(4);
	const [starting, setStarting] = useState(false);

	// On open, restore a saved (unfinished) wizard snapshot if one exists.
	useEffect(() => {
		const snapshot =
			usePrompterStore.getState().savedWizardState ?? usePrompterStore.getState().loadResumeState();
		if (snapshot) usePrompterStore.getState().restoreFromSavedState(snapshot);
	}, []);

	const close = useCallback(() => {
		useModalStore.getState().closeModal('prompter');
		usePrompterStore.getState().closeWizard();
	}, []);

	const canAdvance = useCallback((): boolean => {
		switch (wizardStep) {
			case 'project-folder':
				return Boolean(projectDraft?.targetDir && projectDraft?.projectName.trim());
			case 'create-structure':
				return createdProject !== null;
			case 'agent-selection':
				return selectedAgents.length >= 1;
			case 'model-config':
				return (
					selectedAgents.length >= 1 &&
					selectedAgents.every((a) => Boolean(agentConfigs.get(a.agentId)?.modelId?.trim()))
				);
			case 'instructions':
				return availableInstructions.length >= 1;
			case 'schema-selection':
				return selectedSchemas.size >= 1;
			case 'review':
				return true;
			default:
				return false;
		}
	}, [
		wizardStep,
		projectDraft,
		createdProject,
		selectedAgents,
		agentConfigs,
		availableInstructions,
		selectedSchemas,
	]);

	const handleCloseRequest = useCallback(() => {
		// Past the first step the user has meaningful state worth confirming.
		if (PROMPTER_WIZARD_STEPS.indexOf(wizardStep) > 0) {
			setShowExitConfirm(true);
		} else {
			close();
		}
	}, [wizardStep, close]);

	const handleConfirmExit = useCallback(() => {
		saveStateForResume();
		setShowExitConfirm(false);
		close();
	}, [saveStateForResume, close]);

	const handleQuitWithoutSaving = useCallback(() => {
		clearResumeState();
		resetWizard();
		setShowExitConfirm(false);
		close();
	}, [clearResumeState, resetWizard, close]);

	const handleStart = useCallback(async () => {
		if (!createdProject || starting) return;
		setStarting(true);
		try {
			const transforms = Array.from(selectedTransforms);
			const config: PrompterRunConfig = {
				projectId: createdProject.id,
				projectRoot: createdProject.rootPath,
				agents: Array.from(agentConfigs.values()),
				schemas: Array.from(selectedSchemas),
				maxParallelAgents,
				includeVariations: transforms.length > 0,
				selectedTransforms: transforms,
			};
			const run = await window.maestro.prompter.createRun(config);
			await window.maestro.prompter.startRun(run.id);
			rememberPrompterProjectRoot(createdProject.rootPath);
			setActiveRun(run);
			clearResumeState();
			resetWizard();
			// Open the run in the center workspace (resetWizard clears the focus).
			usePrompterStore.getState().focusPrompterRun();
			close();
		} finally {
			setStarting(false);
		}
	}, [
		createdProject,
		starting,
		agentConfigs,
		selectedSchemas,
		selectedTransforms,
		maxParallelAgents,
		setActiveRun,
		clearResumeState,
		resetWizard,
		close,
	]);

	const advanceEnabled = canAdvance();

	return (
		<>
			<Modal
				theme={theme}
				title="Prompter - Power & Robustness Lab"
				priority={MODAL_PRIORITIES.PROMPTER}
				onClose={handleCloseRequest}
				headerIcon={<ShieldCheck className="w-4 h-4" style={{ color: theme.colors.accent }} />}
				width={760}
				layerOptions={{ enabled: !showExitConfirm }}
				footer={
					<div className="flex items-center justify-between w-full">
						<button
							onClick={goBack}
							disabled={isFirstStep}
							className="px-3 py-1.5 rounded-md text-sm font-medium disabled:opacity-40"
							style={{ color: theme.colors.textMain, border: `1px solid ${theme.colors.border}` }}
						>
							Zurück
						</button>
						{isLastStep ? (
							<button
								onClick={handleStart}
								disabled={!advanceEnabled || starting}
								className="px-4 py-1.5 rounded-md text-sm font-semibold disabled:opacity-40"
								style={{
									backgroundColor: theme.colors.accent,
									color: theme.colors.accentForeground,
								}}
							>
								{starting ? 'Starte...' : 'Run starten'}
							</button>
						) : (
							<button
								onClick={goNext}
								disabled={!advanceEnabled}
								className="px-4 py-1.5 rounded-md text-sm font-semibold disabled:opacity-40"
								style={{
									backgroundColor: theme.colors.accent,
									color: theme.colors.accentForeground,
								}}
							>
								Weiter
							</button>
						)}
					</div>
				}
			>
				<div className="flex flex-col gap-4">
					<PrompterWizardStepper theme={theme} currentStep={wizardStep} />
					<div className="min-h-[280px]">
						{wizardStep === 'project-folder' && <ProjectFolderStep theme={theme} />}
						{wizardStep === 'create-structure' && <CreateStructureStep theme={theme} />}
						{wizardStep === 'agent-selection' && <AgentSelectionStep theme={theme} />}
						{wizardStep === 'model-config' && <ModelConfigStep theme={theme} />}
						{wizardStep === 'instructions' && <InstructionStep theme={theme} />}
						{wizardStep === 'schema-selection' && <SchemaSelectionStep theme={theme} />}
						{wizardStep === 'review' && (
							<ReviewStep
								theme={theme}
								maxParallelAgents={maxParallelAgents}
								onMaxParallelChange={setMaxParallelAgents}
							/>
						)}
					</div>
				</div>
			</Modal>

			<PrompterExitConfirmModal
				theme={theme}
				isOpen={showExitConfirm}
				onConfirmExit={handleConfirmExit}
				onCancel={() => setShowExitConfirm(false)}
				onQuitWithoutSaving={handleQuitWithoutSaving}
			/>
		</>
	);
}

export default PrompterWizardModal;
