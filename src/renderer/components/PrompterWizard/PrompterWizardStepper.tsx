/**
 * PrompterWizardStepper - horizontal step indicator for the 7-step Prompter
 * wizard. Mirrors the existing wizard's compact breadcrumb style.
 */

import type { Theme } from '../../types';
import { PROMPTER_WIZARD_STEPS, type PrompterWizardStep } from '../../../shared/prompter-types';

const STEP_LABELS: Record<PrompterWizardStep, string> = {
	'project-folder': 'Ordner',
	'create-structure': 'Struktur',
	'agent-selection': 'Agents',
	'model-config': 'Modelle',
	instructions: 'Instructions',
	'schema-selection': 'Schemata',
	review: 'Review',
};

interface PrompterWizardStepperProps {
	theme: Theme;
	currentStep: PrompterWizardStep;
}

export function PrompterWizardStepper({
	theme,
	currentStep,
}: PrompterWizardStepperProps): JSX.Element {
	const currentIndex = PROMPTER_WIZARD_STEPS.indexOf(currentStep);
	return (
		<div className="flex items-center gap-1 flex-wrap select-none">
			{PROMPTER_WIZARD_STEPS.map((step, index) => {
				const active = index === currentIndex;
				const done = index < currentIndex;
				const color = active
					? theme.colors.accent
					: done
						? theme.colors.textMain
						: theme.colors.textDim;
				return (
					<div key={step} className="flex items-center gap-1">
						<div
							className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium"
							style={{
								color,
								backgroundColor: active ? `${theme.colors.accent}1a` : 'transparent',
							}}
						>
							<span
								className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px]"
								style={{
									backgroundColor: active || done ? color : 'transparent',
									color: active || done ? theme.colors.bgMain : color,
									border: active || done ? 'none' : `1px solid ${color}`,
								}}
							>
								{index + 1}
							</span>
							{STEP_LABELS[step]}
						</div>
						{index < PROMPTER_WIZARD_STEPS.length - 1 && (
							<span style={{ color: theme.colors.textDim }}>›</span>
						)}
					</div>
				);
			})}
		</div>
	);
}
