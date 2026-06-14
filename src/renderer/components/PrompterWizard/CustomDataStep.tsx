import { useEffect, useState, useCallback } from 'react';
import { Loader2, AlertTriangle, BookOpen, ChevronDown, Sparkles } from 'lucide-react';
import type { Theme } from '../../types';
import { usePrompterStore } from '../../stores/prompterStore';
import type { PrompterSchema } from '../../../shared/prompter-types';
import {
	TASK_PRESET_CATEGORIES,
	TASK_PRESETS,
	INTENSITY_LABELS,
	type TaskPresetCategory,
	type TaskPresetIntensity,
	type TaskPreset,
} from '../../../shared/prompter-task-presets';

interface PlaceholderInfo {
	key: string;
	defaultValue: string;
	usedBySchemas: string[];
}

function collectPlaceholders(
	schemas: PrompterSchema[],
	selectedIds: Set<string>
): PlaceholderInfo[] {
	const map = new Map<string, PlaceholderInfo>();
	for (const schema of schemas) {
		if (!selectedIds.has(schema.id)) continue;
		if (!schema.customDataDefaults) continue;
		for (const [key, defaultValue] of Object.entries(schema.customDataDefaults)) {
			const existing = map.get(key);
			if (existing) {
				existing.usedBySchemas.push(schema.name);
			} else {
				map.set(key, { key, defaultValue, usedBySchemas: [schema.name] });
			}
		}
	}
	return Array.from(map.values());
}

// ---------------------------------------------------------------------------
// Preset Browser (collapsible panel within the step)
// ---------------------------------------------------------------------------

function PresetBrowser({
	theme,
	onSelect,
}: {
	theme: Theme;
	onSelect: (text: string) => void;
}): JSX.Element {
	const [open, setOpen] = useState(false);
	const [selectedCategory, setSelectedCategory] = useState<TaskPresetCategory>('cybersecurity');
	const [selectedIntensity, setSelectedIntensity] = useState<TaskPresetIntensity>('standard');
	const [previewPreset, setPreviewPreset] = useState<TaskPreset | null>(null);

	const filteredPresets = TASK_PRESETS.filter((p) => p.category === selectedCategory);

	const handleApply = useCallback(
		(preset: TaskPreset) => {
			onSelect(preset.tasks[selectedIntensity]);
		},
		[onSelect, selectedIntensity]
	);

	if (!open) {
		return (
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors"
				style={{
					color: theme.colors.accent,
					border: `1px solid ${theme.colors.accent}40`,
					backgroundColor: `${theme.colors.accent}0a`,
				}}
			>
				<BookOpen size={13} />
				Task-Bibliothek
			</button>
		);
	}

	return (
		<div
			className="rounded-lg overflow-hidden"
			style={{
				border: `1px solid ${theme.colors.border}`,
				backgroundColor: theme.colors.bgSidebar,
			}}
		>
			{/* Header */}
			<div
				className="flex items-center justify-between px-3 py-2"
				style={{ borderBottom: `1px solid ${theme.colors.border}` }}
			>
				<div className="flex items-center gap-2">
					<BookOpen size={14} style={{ color: theme.colors.accent }} />
					<span className="text-xs font-semibold" style={{ color: theme.colors.textMain }}>
						Refusal-Evaluation Task Presets
					</span>
					<span
						className="text-[10px] px-1.5 py-0.5 rounded"
						style={{
							backgroundColor: `${theme.colors.warning ?? '#f59e0b'}1a`,
							color: theme.colors.warning ?? '#f59e0b',
						}}
					>
						Research Only
					</span>
				</div>
				<button
					type="button"
					onClick={() => setOpen(false)}
					className="text-xs px-2 py-0.5 rounded"
					style={{ color: theme.colors.textDim }}
				>
					Schliessen
				</button>
			</div>

			{/* Controls row */}
			<div
				className="flex flex-wrap items-center gap-2 px-3 py-2"
				style={{ borderBottom: `1px solid ${theme.colors.border}` }}
			>
				{/* Category tabs */}
				<div className="flex gap-1">
					{TASK_PRESET_CATEGORIES.map((cat) => {
						const active = selectedCategory === cat.key;
						return (
							<button
								type="button"
								key={cat.key}
								onClick={() => {
									setSelectedCategory(cat.key);
									setPreviewPreset(null);
								}}
								className="px-2 py-1 rounded text-[11px] font-medium transition-colors"
								style={{
									backgroundColor: active ? `${theme.colors.accent}1a` : 'transparent',
									color: active ? theme.colors.accent : theme.colors.textDim,
									border: active ? `1px solid ${theme.colors.accent}40` : `1px solid transparent`,
								}}
								title={cat.description}
							>
								{cat.label}
							</button>
						);
					})}
				</div>

				{/* Intensity selector */}
				<div className="flex items-center gap-1 ml-auto">
					<span className="text-[10px]" style={{ color: theme.colors.textDim }}>
						Stufe:
					</span>
					<div className="relative">
						<select
							value={selectedIntensity}
							onChange={(e) => setSelectedIntensity(e.target.value as TaskPresetIntensity)}
							className="appearance-none pl-2 pr-5 py-0.5 rounded text-[11px] cursor-pointer"
							style={{
								backgroundColor: theme.colors.bgMain,
								color: theme.colors.textMain,
								border: `1px solid ${theme.colors.border}`,
							}}
						>
							{(Object.entries(INTENSITY_LABELS) as [TaskPresetIntensity, string][]).map(
								([key, label]) => (
									<option key={key} value={key}>
										{label}
									</option>
								)
							)}
						</select>
						<ChevronDown
							size={10}
							className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none"
							style={{ color: theme.colors.textDim }}
						/>
					</div>
				</div>
			</div>

			{/* Preset grid */}
			<div className="grid grid-cols-2 gap-1.5 p-2 max-h-[200px] overflow-y-auto">
				{filteredPresets.map((preset) => {
					const isPreview = previewPreset?.id === preset.id;
					return (
						<button
							type="button"
							key={preset.id}
							onClick={() => setPreviewPreset(isPreview ? null : preset)}
							onDoubleClick={() => handleApply(preset)}
							className="text-left px-2.5 py-2 rounded-md text-xs transition-colors"
							style={{
								backgroundColor: isPreview ? `${theme.colors.accent}15` : theme.colors.bgMain,
								border: isPreview
									? `1px solid ${theme.colors.accent}40`
									: `1px solid ${theme.colors.border}`,
								color: theme.colors.textMain,
							}}
							title="Klick: Vorschau, Doppelklick: Uebernehmen"
						>
							<div className="font-medium text-[11px]">{preset.label}</div>
							<div
								className="text-[10px] mt-0.5 line-clamp-1"
								style={{ color: theme.colors.textDim }}
							>
								{preset.description}
							</div>
						</button>
					);
				})}
			</div>

			{/* Preview + apply */}
			{previewPreset && (
				<div className="px-3 py-2" style={{ borderTop: `1px solid ${theme.colors.border}` }}>
					<div className="flex items-center justify-between mb-1.5">
						<span className="text-[11px] font-medium" style={{ color: theme.colors.textMain }}>
							{previewPreset.label} ({INTENSITY_LABELS[selectedIntensity]})
						</span>
						<button
							type="button"
							onClick={() => handleApply(previewPreset)}
							className="px-2.5 py-1 rounded text-[11px] font-medium"
							style={{
								backgroundColor: theme.colors.accent,
								color: theme.colors.accentForeground,
							}}
						>
							In Task-Feld uebernehmen
						</button>
					</div>
					<div
						className="text-[11px] p-2 rounded whitespace-pre-wrap max-h-[80px] overflow-y-auto"
						style={{
							backgroundColor: theme.colors.bgMain,
							color: theme.colors.textDim,
							border: `1px solid ${theme.colors.border}`,
						}}
					>
						{previewPreset.tasks[selectedIntensity]}
					</div>
				</div>
			)}

			{/* Research disclaimer */}
			<div
				className="px-3 py-1.5 text-[9px]"
				style={{
					color: theme.colors.textDim,
					borderTop: `1px solid ${theme.colors.border}`,
					backgroundColor: `${theme.colors.bgMain}80`,
				}}
			>
				Nur fuer kontrollierte Robustheitstests. Green = Modellschwaeche, Red = Grenze haelt.
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Agent-generate button (placeholder for IPC integration)
// ---------------------------------------------------------------------------

function GenerateButton({ theme }: { theme: Theme }): JSX.Element {
	return (
		<button
			type="button"
			disabled
			className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium opacity-50 cursor-not-allowed"
			style={{
				color: theme.colors.textDim,
				border: `1px solid ${theme.colors.border}`,
			}}
			title="Agent-generierte Tasks (erfordert IPC-Endpunkt, kommt in naechster Iteration)"
		>
			<Sparkles size={13} />
			Agent generieren
		</button>
	);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CustomDataStep({ theme }: { theme: Theme }): JSX.Element {
	const createdProject = usePrompterStore((s) => s.createdProject);
	const selectedSchemas = usePrompterStore((s) => s.selectedSchemas);
	const customDataOverrides = usePrompterStore((s) => s.customDataOverrides);
	const setCustomDataOverride = usePrompterStore((s) => s.setCustomDataOverride);

	const [schemas, setSchemas] = useState<PrompterSchema[]>([]);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		window.maestro.prompter
			.listSchemas(createdProject?.rootPath)
			.then((list: PrompterSchema[]) => {
				if (!cancelled) setSchemas(list);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [createdProject?.rootPath]);

	const placeholders = collectPlaceholders(schemas, selectedSchemas);

	const handlePresetSelect = useCallback(
		(text: string) => {
			setCustomDataOverride('task', text);
		},
		[setCustomDataOverride]
	);

	if (loading) {
		return (
			<div className="flex items-center gap-2 p-4" style={{ color: theme.colors.textDim }}>
				<Loader2 size={16} className="animate-spin" />
				<span className="text-sm">Lade Schema-Platzhalter...</span>
			</div>
		);
	}

	if (placeholders.length === 0) {
		return (
			<div className="p-4" style={{ color: theme.colors.textDim }}>
				<p className="text-sm">
					Die ausgewaehlten Schemata haben keine Custom-Data-Platzhalter. Du kannst diesen Schritt
					ueberspringen.
				</p>
			</div>
		);
	}

	const taskPlaceholder = placeholders.find((p) => p.key === 'task');
	const hasUnfilledTask = taskPlaceholder && !customDataOverrides.task?.trim();

	return (
		<div className="flex flex-col gap-4 p-1">
			<p className="text-sm" style={{ color: theme.colors.textMain }}>
				Die ausgewaehlten Schemata verwenden <code>{'{{CUSTOM:*}}'}</code>-Platzhalter. Setze hier
				die Werte, die in den Prompt eingesetzt werden.
			</p>

			{hasUnfilledTask && (
				<div
					className="flex items-start gap-2 px-3 py-2 rounded-md text-xs"
					style={{
						backgroundColor: `${theme.colors.warning ?? '#f59e0b'}1a`,
						color: theme.colors.warning ?? '#f59e0b',
					}}
				>
					<AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
					<span>
						Platzhalter ohne eigenen Wert werden mit dem Schema-Default gesendet. Fuer einen echten
						Test sollte mindestens <strong>task</strong> gesetzt werden.
					</span>
				</div>
			)}

			{/* Task-Bibliothek + Generate buttons (only if task placeholder exists) */}
			{taskPlaceholder && (
				<div className="flex items-center gap-2">
					<PresetBrowser theme={theme} onSelect={handlePresetSelect} />
					<GenerateButton theme={theme} />
				</div>
			)}

			<div className="flex flex-col gap-3 max-h-[320px] overflow-y-auto pr-1">
				{placeholders.map((p) => (
					<div key={p.key} className="flex flex-col gap-1">
						<label
							className="text-xs font-medium flex items-center gap-2"
							style={{ color: theme.colors.textMain }}
						>
							<code
								className="px-1.5 py-0.5 rounded text-[11px]"
								style={{
									backgroundColor: `${theme.colors.accent}1a`,
									color: theme.colors.accent,
								}}
							>
								{`{{CUSTOM:${p.key}}}`}
							</code>
							<span style={{ color: theme.colors.textDim }}>
								({p.usedBySchemas.length} {p.usedBySchemas.length === 1 ? 'Schema' : 'Schemata'})
							</span>
						</label>
						<textarea
							rows={p.key === 'task' ? 3 : 4}
							className="w-full px-2.5 py-1.5 rounded-md text-sm resize-y"
							style={{
								backgroundColor: theme.colors.bgSidebar,
								color: theme.colors.textMain,
								border: `1px solid ${theme.colors.border}`,
							}}
							placeholder={p.defaultValue}
							value={customDataOverrides[p.key] ?? ''}
							onChange={(e) => setCustomDataOverride(p.key, e.target.value)}
						/>
						<span className="text-[10px]" style={{ color: theme.colors.textDim }}>
							Verwendet in: {p.usedBySchemas.join(', ')}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}
