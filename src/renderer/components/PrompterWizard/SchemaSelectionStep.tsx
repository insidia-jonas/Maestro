import { useEffect, useState } from 'react';
import { CheckSquare, Square, Loader2 } from 'lucide-react';
import type { Theme } from '../../types';
import { usePrompterStore } from '../../stores/prompterStore';
import { PROMPTER_DEFAULT_SCHEMAS, type PrompterSchema } from '../../../shared/prompter-types';

export function SchemaSelectionStep({ theme }: { theme: Theme }): JSX.Element {
	const createdProject = usePrompterStore((s) => s.createdProject);
	const selectedSchemas = usePrompterStore((s) => s.selectedSchemas);
	const toggleSchema = usePrompterStore((s) => s.toggleSchema);

	const [schemas, setSchemas] = useState<PrompterSchema[]>([]);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		window.maestro.prompter
			.listSchemas(createdProject?.rootPath)
			.then((list: PrompterSchema[]) => {
				if (cancelled) return;
				setSchemas(list);
				if (selectedSchemas.size === 0) {
					usePrompterStore.getState().setSelectedSchemas([...PROMPTER_DEFAULT_SCHEMAS]);
				}
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [createdProject?.rootPath]);

	const selectAll = (): void => {
		usePrompterStore.getState().setSelectedSchemas(schemas.map((s) => s.id));
	};

	const selectDefaults = (): void => {
		usePrompterStore.getState().setSelectedSchemas([...PROMPTER_DEFAULT_SCHEMAS]);
	};

	if (loading) {
		return (
			<div className="flex items-center gap-2 p-4" style={{ color: theme.colors.textDim }}>
				<Loader2 size={16} className="animate-spin" />
				<span className="text-sm">Lade Schemata...</span>
			</div>
		);
	}

	const effortColor = (effort: string): string => {
		if (effort === 'low') return theme.colors.success;
		if (effort === 'medium') return theme.colors.warning;
		return theme.colors.error;
	};

	return (
		<div className="flex flex-col gap-4 p-4 select-none">
			<div className="flex items-center justify-between gap-2">
				<div className="flex flex-col gap-1">
					<span className="text-base font-semibold" style={{ color: theme.colors.textMain }}>
						Test-Schemata
					</span>
					<span className="text-sm" style={{ color: theme.colors.textDim }}>
						Waehle die Schemata, gegen die jede Instruction getestet wird.
					</span>
				</div>
				<div className="flex gap-2">
					<button
						type="button"
						onClick={selectDefaults}
						className="text-xs rounded px-2 py-1"
						style={{
							color: theme.colors.textMain,
							border: `1px solid ${theme.colors.border}`,
							backgroundColor: theme.colors.bgSidebar,
						}}
					>
						Defaults
					</button>
					<button
						type="button"
						onClick={selectAll}
						className="text-xs rounded px-2 py-1"
						style={{
							color: theme.colors.accentText,
							border: `1px solid ${theme.colors.accentDim}`,
							backgroundColor: theme.colors.bgSidebar,
						}}
					>
						Alle
					</button>
				</div>
			</div>

			<div className="flex flex-col gap-2 overflow-y-auto" style={{ maxHeight: 380 }}>
				{schemas.map((schema) => {
					const checked = selectedSchemas.has(schema.id);
					const Icon = checked ? CheckSquare : Square;
					return (
						<button
							key={schema.id}
							type="button"
							onClick={() => toggleSchema(schema.id)}
							className="flex items-start gap-3 rounded-md p-3 text-left transition-colors"
							style={{
								backgroundColor: checked ? `${theme.colors.accent}11` : theme.colors.bgMain,
								border: `1px solid ${checked ? theme.colors.accent : theme.colors.border}`,
							}}
						>
							<Icon
								size={18}
								className="shrink-0 mt-0.5"
								style={{ color: checked ? theme.colors.accent : theme.colors.textDim }}
							/>
							<div className="flex flex-col gap-1 min-w-0">
								<div className="flex items-center gap-2">
									<span className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
										{schema.name}
									</span>
									<span
										className="text-xs rounded px-1.5 py-0.5"
										style={{
											color: effortColor(schema.estimatedEffort),
											backgroundColor: theme.colors.bgSidebar,
											border: `1px solid ${theme.colors.border}`,
										}}
									>
										{schema.estimatedEffort}
									</span>
									{schema.source && schema.source !== 'builtin' && (
										<span
											className="text-xs rounded px-1.5 py-0.5"
											style={{
												color: theme.colors.textDim,
												backgroundColor: theme.colors.bgSidebar,
											}}
										>
											{schema.source}
										</span>
									)}
								</div>
								<span className="text-xs" style={{ color: theme.colors.textDim }}>
									{schema.description}
								</span>
							</div>
						</button>
					);
				})}
			</div>

			{selectedSchemas.size === 0 && (
				<div
					className="flex items-center gap-2 rounded-md px-3 py-2 text-sm"
					style={{
						color: theme.colors.warning,
						border: `1px solid ${theme.colors.warning}`,
						backgroundColor: theme.colors.bgSidebar,
					}}
				>
					Mindestens 1 Schema muss ausgewaehlt sein.
				</div>
			)}
		</div>
	);
}
