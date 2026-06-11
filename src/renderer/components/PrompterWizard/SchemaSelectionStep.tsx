import { useEffect, useState } from 'react';
import { Clock, ListChecks, Loader2 } from 'lucide-react';
import type { Theme } from '../../types';
import { usePrompterStore } from '../../stores/prompterStore';
import type { PrompterSchema } from '../../../shared/prompter-types';

function effortLabel(effort: PrompterSchema['estimatedEffort']): string {
	if (effort === 'low') return 'niedrig';
	if (effort === 'medium') return 'mittel';
	return 'hoch';
}

export function SchemaSelectionStep({ theme }: { theme: Theme }): JSX.Element {
	const createdProject = usePrompterStore((s) => s.createdProject);
	const selectedSchemas = usePrompterStore((s) => s.selectedSchemas);

	const [schemas, setSchemas] = useState<PrompterSchema[]>([]);
	const [loading, setLoading] = useState<boolean>(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setError(null);

		void (async () => {
			try {
				const list = await window.maestro.prompter.listSchemas(createdProject?.rootPath);
				if (cancelled) return;
				setSchemas(list);

				// Ensure every required schema is selected. Required ones are not deselectable.
				const current = usePrompterStore.getState().selectedSchemas;
				const missingRequired = list
					.filter((schema) => schema.required && !current.has(schema.id))
					.map((schema) => schema.id);
				if (missingRequired.length > 0) {
					const next = new Set(current);
					for (const id of missingRequired) next.add(id);
					usePrompterStore.getState().setSelectedSchemas(Array.from(next));
				}
			} catch (err) {
				if (cancelled) return;
				setError(err instanceof Error ? err.message : 'Schemata konnten nicht geladen werden.');
				setSchemas([]);
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [createdProject?.rootPath]);

	// Required first, then by name for stable ordering.
	const ordered = [...schemas].sort((a, b) => {
		if (a.required !== b.required) return a.required ? -1 : 1;
		return a.name.localeCompare(b.name);
	});

	const handleToggle = (schema: PrompterSchema): void => {
		if (schema.required) return;
		usePrompterStore.getState().toggleSchema(schema.id);
	};

	return (
		<div className="flex flex-col gap-4 select-none">
			<div className="flex items-center gap-2">
				<ListChecks size={20} style={{ color: theme.colors.accent }} />
				<h2 className="text-lg font-semibold" style={{ color: theme.colors.textMain }}>
					Testschemata auswaehlen
				</h2>
			</div>
			<p className="text-sm" style={{ color: theme.colors.textDim }}>
				Waehle die Schemata, gegen die geprueft werden soll. Pflicht-Schemata sind immer aktiv.
			</p>

			{loading && (
				<div className="flex items-center gap-2 text-sm" style={{ color: theme.colors.textDim }}>
					<Loader2 size={16} className="animate-spin" />
					<span>Schemata werden geladen...</span>
				</div>
			)}

			{!loading && error && (
				<div
					className="rounded-md p-3 text-sm select-text"
					style={{
						color: theme.colors.error,
						border: `1px solid ${theme.colors.error}`,
						backgroundColor: theme.colors.bgActivity,
					}}
				>
					{error}
				</div>
			)}

			{!loading && !error && ordered.length === 0 && (
				<div
					className="rounded-md p-4 text-sm"
					style={{
						color: theme.colors.textDim,
						border: `1px solid ${theme.colors.border}`,
						backgroundColor: theme.colors.bgActivity,
					}}
				>
					Keine Schemata gefunden.
				</div>
			)}

			{!loading && !error && ordered.length > 0 && (
				<div className="flex flex-col gap-2">
					{ordered.map((schema) => {
						const checked = selectedSchemas.has(schema.id);
						const isHigh = schema.estimatedEffort === 'high';
						return (
							<label
								key={schema.id}
								className={`flex items-start gap-3 rounded-md p-3 ${schema.required ? 'cursor-default' : 'cursor-pointer'}`}
								style={{
									border: `1px solid ${checked ? theme.colors.accent : theme.colors.border}`,
									backgroundColor: theme.colors.bgActivity,
									opacity: schema.required ? 0.95 : 1,
								}}
							>
								<input
									type="checkbox"
									className="mt-1 h-4 w-4 shrink-0"
									checked={checked}
									disabled={schema.required}
									onChange={() => handleToggle(schema)}
									style={{ accentColor: theme.colors.accent }}
								/>
								<div className="flex min-w-0 flex-1 flex-col gap-1">
									<div className="flex flex-wrap items-center gap-2">
										<span
											className="text-sm font-semibold"
											style={{ color: theme.colors.textMain }}
										>
											{schema.name}
										</span>
										{schema.required && (
											<span
												className="rounded-full px-2 py-0.5 text-xs font-medium"
												style={{
													color: theme.colors.accentForeground,
													backgroundColor: theme.colors.accent,
												}}
											>
												Pflicht
											</span>
										)}
									</div>
									<p
										className="truncate text-xs select-text"
										style={{ color: theme.colors.textDim }}
										title={schema.description}
									>
										{schema.description}
									</p>
									<div className="flex flex-wrap items-center gap-3 pt-0.5">
										<span
											className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs"
											style={{
												color: isHigh ? theme.colors.warning : theme.colors.textDim,
												border: `1px solid ${isHigh ? theme.colors.warning : theme.colors.border}`,
											}}
										>
											{isHigh && <Clock size={12} />}
											{effortLabel(schema.estimatedEffort)}
										</span>
										<span className="text-xs" style={{ color: theme.colors.textDim }}>
											{schema.artefacts.length} Artefakte
										</span>
									</div>
								</div>
							</label>
						);
					})}
				</div>
			)}
		</div>
	);
}
