/**
 * PrompterExitConfirmModal - "Wirklich schließen?" dialog shown when the user
 * tries to leave the Prompter wizard mid-flow. Analogous to
 * WizardExitConfirmModal: save & close, cancel, or discard & close.
 */

import { useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { Theme } from '../../types';
import { MODAL_PRIORITIES } from '../../constants/modalPriorities';
import { Modal } from '../ui/Modal';

interface PrompterExitConfirmModalProps {
	theme: Theme;
	isOpen: boolean;
	/** Save resume state, then close the wizard. */
	onConfirmExit: () => void;
	/** Close this dialog only, stay in the wizard. */
	onCancel: () => void;
	/** Discard the wizard state, then close. */
	onQuitWithoutSaving: () => void;
}

export function PrompterExitConfirmModal({
	theme,
	isOpen,
	onConfirmExit,
	onCancel,
	onQuitWithoutSaving,
}: PrompterExitConfirmModalProps): JSX.Element | null {
	const cancelButtonRef = useRef<HTMLButtonElement>(null);
	if (!isOpen) return null;

	return (
		<Modal
			theme={theme}
			title="Prompter schließen?"
			priority={MODAL_PRIORITIES.PROMPTER_EXIT_CONFIRM}
			onClose={onCancel}
			headerIcon={<AlertTriangle className="w-4 h-4" style={{ color: theme.colors.warning }} />}
			width={460}
			initialFocusRef={cancelButtonRef}
			footer={
				<div className="flex items-center justify-end gap-2">
					<button
						ref={cancelButtonRef}
						onClick={onCancel}
						className="px-3 py-1.5 rounded-md text-sm font-medium"
						style={{ color: theme.colors.textMain, border: `1px solid ${theme.colors.border}` }}
					>
						Im Wizard bleiben
					</button>
					<button
						onClick={onQuitWithoutSaving}
						className="px-3 py-1.5 rounded-md text-sm font-medium"
						style={{ color: theme.colors.error, border: `1px solid ${theme.colors.error}` }}
					>
						Verwerfen & schließen
					</button>
					<button
						onClick={onConfirmExit}
						className="px-3 py-1.5 rounded-md text-sm font-medium"
						style={{ backgroundColor: theme.colors.accent, color: theme.colors.accentForeground }}
					>
						Speichern & schließen
					</button>
				</div>
			}
		>
			<p className="leading-relaxed" style={{ color: theme.colors.textMain }}>
				Du hast den Wizard noch nicht abgeschlossen.
			</p>
			<p className="text-sm leading-relaxed mt-2" style={{ color: theme.colors.textDim }}>
				Speichern legt deinen Fortschritt ab, damit du später fortfahren kannst. Verwerfen löscht
				die aktuellen Wizard-Eingaben (bereits erstellte Projektordner bleiben auf der Festplatte).
			</p>
		</Modal>
	);
}
