/**
 * Component tests for CustomDataStep and its PresetBrowser subcomponent.
 *
 * Tests the Custom Data wizard step including:
 * - Loading state while schemas are fetched
 * - Empty state when no placeholders exist
 * - Textarea rendering for task placeholder
 * - Preset browser open/close
 * - Category tab switching
 * - Preset preview and apply
 * - Double-click apply
 * - Manual input
 * - GenerateButton disabled state
 * - Research disclaimer visibility
 *
 * SAFETY NOTE: No preset content is used in test names or snapshots.
 *
 * For security research and model safety evaluation only.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CustomDataStep } from '../../../../renderer/components/PrompterWizard/CustomDataStep';
import { mockTheme } from '../../../helpers/mockTheme';
import { TASK_PRESETS, TASK_PRESET_CATEGORIES } from '../../../../shared/prompter-task-presets';

// ---------------------------------------------------------------------------
// Store mock
// ---------------------------------------------------------------------------

const mockSetCustomDataOverride = vi.fn();
let mockStoreState: Record<string, unknown> = {};

vi.mock('../../../../renderer/stores/prompterStore', () => ({
	usePrompterStore: (selector: (s: Record<string, unknown>) => unknown) => selector(mockStoreState),
}));

// ---------------------------------------------------------------------------
// IPC mock (window.maestro.prompter)
// ---------------------------------------------------------------------------

const mockListSchemas = vi.fn();

if (!window.maestro) {
	(window as unknown as Record<string, unknown>).maestro = {};
}
if (!(window.maestro as Record<string, unknown>).prompter) {
	(window.maestro as Record<string, unknown>).prompter = {};
}
(window.maestro.prompter as Record<string, unknown>).listSchemas = mockListSchemas;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const schemaWithTask = {
	id: 'test-schema-1',
	name: 'Test Schema',
	customDataDefaults: { task: 'default task value' },
};

beforeEach(() => {
	vi.clearAllMocks();

	mockStoreState = {
		createdProject: { rootPath: '/test/project' },
		selectedSchemas: new Set(['test-schema-1']),
		customDataOverrides: {},
		setCustomDataOverride: mockSetCustomDataOverride,
	};

	mockListSchemas.mockResolvedValue([schemaWithTask]);
});

// ---------------------------------------------------------------------------
// Loading and empty states
// ---------------------------------------------------------------------------

describe('CustomDataStep loading state', () => {
	it('shows loading indicator while schemas are being fetched', () => {
		mockListSchemas.mockReturnValue(new Promise(() => {}));
		render(<CustomDataStep theme={mockTheme} />);
		expect(screen.getByText('Lade Schema-Platzhalter...')).toBeTruthy();
	});
});

describe('CustomDataStep empty state', () => {
	it('shows skip message when no placeholders exist', async () => {
		mockListSchemas.mockResolvedValue([
			{ id: 'test-schema-1', name: 'Test', customDataDefaults: undefined },
		]);
		render(<CustomDataStep theme={mockTheme} />);
		await waitFor(() => {
			expect(screen.getByText(/ueberspringen/i)).toBeTruthy();
		});
	});
});

// ---------------------------------------------------------------------------
// Task placeholder and textarea
// ---------------------------------------------------------------------------

describe('CustomDataStep with task placeholder', () => {
	it('renders textarea for task placeholder', async () => {
		render(<CustomDataStep theme={mockTheme} />);
		await waitFor(() => {
			expect(screen.getByPlaceholderText('default task value')).toBeTruthy();
		});
	});

	it('shows task-bibliothek button when task placeholder exists', async () => {
		render(<CustomDataStep theme={mockTheme} />);
		await waitFor(() => {
			expect(screen.getByText('Task-Bibliothek')).toBeTruthy();
		});
	});

	it('shows warning when task is unfilled', async () => {
		render(<CustomDataStep theme={mockTheme} />);
		await waitFor(() => {
			expect(screen.getByText(/mindestens/i)).toBeTruthy();
		});
	});

	it('manual input calls setCustomDataOverride', async () => {
		render(<CustomDataStep theme={mockTheme} />);
		await waitFor(() => {
			expect(screen.getByPlaceholderText('default task value')).toBeTruthy();
		});
		const textarea = screen.getByPlaceholderText('default task value');
		fireEvent.change(textarea, { target: { value: 'manual test input' } });
		expect(mockSetCustomDataOverride).toHaveBeenCalledWith('task', 'manual test input');
	});
});

// ---------------------------------------------------------------------------
// Preset browser
// ---------------------------------------------------------------------------

describe('PresetBrowser', () => {
	async function openBrowser() {
		render(<CustomDataStep theme={mockTheme} />);
		await waitFor(() => {
			expect(screen.getByText('Task-Bibliothek')).toBeTruthy();
		});
		fireEvent.click(screen.getByText('Task-Bibliothek'));
	}

	it('opens preset browser on click', async () => {
		await openBrowser();
		expect(screen.getByText('Refusal-Evaluation Task Presets')).toBeTruthy();
	});

	it('shows research-only badge', async () => {
		await openBrowser();
		expect(screen.getByText('Research Only')).toBeTruthy();
	});

	it('shows research disclaimer footer', async () => {
		await openBrowser();
		expect(screen.getByText(/Nur fuer kontrollierte Robustheitstests/)).toBeTruthy();
	});

	it('shows category tabs for all categories', async () => {
		await openBrowser();
		for (const cat of TASK_PRESET_CATEGORIES) {
			expect(screen.getByText(cat.label)).toBeTruthy();
		}
	});

	it('filters presets when switching category', async () => {
		await openBrowser();
		const cyberPresets = TASK_PRESETS.filter((p) => p.category === 'cybersecurity');
		for (const preset of cyberPresets) {
			expect(screen.getByText(preset.label)).toBeTruthy();
		}

		fireEvent.click(screen.getByText('Alltagsgefahren'));
		const dangerPresets = TASK_PRESETS.filter((p) => p.category === 'everyday-danger');
		for (const preset of dangerPresets) {
			expect(screen.getByText(preset.label)).toBeTruthy();
		}
	});

	it('shows preview on preset click', async () => {
		await openBrowser();
		const firstPreset = TASK_PRESETS.filter((p) => p.category === 'cybersecurity')[0];
		fireEvent.click(screen.getByText(firstPreset.label));
		expect(screen.getByText('In Task-Feld uebernehmen')).toBeTruthy();
	});

	it('applies preset via apply button', async () => {
		await openBrowser();
		const firstPreset = TASK_PRESETS.filter((p) => p.category === 'cybersecurity')[0];
		fireEvent.click(screen.getByText(firstPreset.label));
		fireEvent.click(screen.getByText('In Task-Feld uebernehmen'));
		expect(mockSetCustomDataOverride).toHaveBeenCalledWith('task', firstPreset.tasks.standard);
	});

	it('applies preset via double-click', async () => {
		await openBrowser();
		const firstPreset = TASK_PRESETS.filter((p) => p.category === 'cybersecurity')[0];
		fireEvent.doubleClick(screen.getByText(firstPreset.label));
		expect(mockSetCustomDataOverride).toHaveBeenCalledWith('task', firstPreset.tasks.standard);
	});

	it('closes browser on close button', async () => {
		await openBrowser();
		fireEvent.click(screen.getByText('Schliessen'));
		expect(screen.queryByText('Refusal-Evaluation Task Presets')).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// GenerateButton
// ---------------------------------------------------------------------------

describe('GenerateButton', () => {
	it('is disabled', async () => {
		render(<CustomDataStep theme={mockTheme} />);
		await waitFor(() => {
			expect(screen.getByText('Agent generieren')).toBeTruthy();
		});
		const btn = screen.getByText('Agent generieren').closest('button');
		expect(btn?.disabled).toBe(true);
	});
});
