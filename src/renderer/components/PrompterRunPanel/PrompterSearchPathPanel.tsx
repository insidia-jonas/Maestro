/**
 * PrompterSearchPathPanel - visualizes the adversarial test search path:
 * which techniques were tried, which succeeded/failed, and the exploration
 * tree of the current run or campaign.
 *
 * For security research and model evaluation purposes only.
 */

import { useState, useMemo } from 'react';
import { GitBranch, ChevronDown, ChevronRight, Check, X, Minus } from 'lucide-react';
import type { Theme } from '../../types';
import type { PrompterRun, PrompterResultBand } from '../../../shared/prompter-types';

interface PathNode {
	label: string;
	total: number;
	green: number;
	yellow: number;
	red: number;
	avgScore: number;
	children: PathNode[];
}

function buildSearchTree(run: PrompterRun): PathNode[] {
	const bySchema = new Map<string, PathNode>();

	for (const t of run.tasks) {
		if (t.status !== 'completed' && t.status !== 'failed') continue;

		const schemaId = t.schemaId;
		if (!bySchema.has(schemaId)) {
			bySchema.set(schemaId, {
				label: schemaId,
				total: 0,
				green: 0,
				yellow: 0,
				red: 0,
				avgScore: 0,
				children: [],
			});
		}
		const schemaNode = bySchema.get(schemaId)!;

		const isVariation = t.instructionFile.includes('tv-');
		const technique = isVariation
			? (t.instructionFile.match(/tv-[^/]+-([a-z0-9-]+)\.md$/)?.[1] ?? 'variant')
			: 'baseline';

		let techChild = schemaNode.children.find((c) => c.label === technique);
		if (!techChild) {
			techChild = {
				label: technique,
				total: 0,
				green: 0,
				yellow: 0,
				red: 0,
				avgScore: 0,
				children: [],
			};
			schemaNode.children.push(techChild);
		}

		schemaNode.total++;
		techChild.total++;

		const band: PrompterResultBand | null = t.result ?? null;
		if (band === 'green') {
			schemaNode.green++;
			techChild.green++;
		} else if (band === 'yellow') {
			schemaNode.yellow++;
			techChild.yellow++;
		} else {
			schemaNode.red++;
			techChild.red++;
		}

		if (t.complianceScore != null) {
			techChild.avgScore =
				(techChild.avgScore * (techChild.total - 1) + t.complianceScore) / techChild.total;
			schemaNode.avgScore =
				(schemaNode.avgScore * (schemaNode.total - 1) + t.complianceScore) / schemaNode.total;
		}
	}

	for (const node of bySchema.values()) {
		node.children.sort((a, b) => b.avgScore - a.avgScore);
	}

	return [...bySchema.values()].sort((a, b) => b.avgScore - a.avgScore);
}

function NodeRow({
	node,
	theme,
	depth,
}: {
	node: PathNode;
	theme: Theme;
	depth: number;
}): JSX.Element {
	const [expanded, setExpanded] = useState(depth === 0);

	const scoreColor =
		node.avgScore >= 0.7
			? theme.colors.warning
			: node.avgScore >= 0.3
				? theme.colors.accent
				: theme.colors.success;

	return (
		<>
			<div
				className="flex items-center gap-1.5 px-2 py-1 text-xs cursor-pointer"
				style={{ paddingLeft: `${8 + depth * 16}px` }}
				onClick={() => setExpanded((e) => !e)}
			>
				{node.children.length > 0 ? (
					expanded ? (
						<ChevronDown size={11} style={{ color: theme.colors.textDim }} />
					) : (
						<ChevronRight size={11} style={{ color: theme.colors.textDim }} />
					)
				) : (
					<Minus size={11} style={{ color: theme.colors.textDim }} />
				)}
				<span className="font-medium" style={{ color: theme.colors.textMain }}>
					{node.label}
				</span>
				<span className="text-[10px]" style={{ color: theme.colors.textDim }}>
					{node.total}
				</span>
				<span className="flex items-center gap-0.5 text-[10px]">
					<Check size={9} style={{ color: theme.colors.success }} />
					<span style={{ color: theme.colors.success }}>{node.green}</span>
				</span>
				<span className="flex items-center gap-0.5 text-[10px]">
					<Minus size={9} style={{ color: theme.colors.warning }} />
					<span style={{ color: theme.colors.warning }}>{node.yellow}</span>
				</span>
				<span className="flex items-center gap-0.5 text-[10px]">
					<X size={9} style={{ color: theme.colors.error }} />
					<span style={{ color: theme.colors.error }}>{node.red}</span>
				</span>
				{node.avgScore > 0 && (
					<span className="ml-auto text-[10px] font-mono" style={{ color: scoreColor }}>
						{Math.round(node.avgScore * 100)}%
					</span>
				)}
			</div>
			{expanded &&
				node.children.map((child) => (
					<NodeRow key={child.label} node={child} theme={theme} depth={depth + 1} />
				))}
		</>
	);
}

export function PrompterSearchPathPanel({
	theme,
	run,
}: {
	theme: Theme;
	run: PrompterRun;
}): JSX.Element | null {
	const [open, setOpen] = useState(false);
	const tree = useMemo(() => buildSearchTree(run), [run]);

	const completedTasks = run.tasks.filter(
		(t) => t.status === 'completed' || t.status === 'failed'
	).length;

	if (completedTasks === 0) return null;

	return (
		<div className="select-none" style={{ borderTop: `1px solid ${theme.colors.border}` }}>
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				className="flex w-full items-center gap-2 px-3 py-2 text-left"
			>
				{open ? (
					<ChevronDown size={14} style={{ color: theme.colors.textDim }} />
				) : (
					<ChevronRight size={14} style={{ color: theme.colors.textDim }} />
				)}
				<GitBranch size={14} style={{ color: theme.colors.accent }} />
				<span className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
					Such-Pfad Visualisierung
				</span>
				<span className="text-xs" style={{ color: theme.colors.textDim }}>
					{tree.length} Schemas · {completedTasks} Tasks
				</span>
			</button>

			{open && (
				<div className="pb-2 select-text">
					<p className="px-3 mb-2 text-[10px]" style={{ color: theme.colors.textDim }}>
						Baumansicht der getesteten Pfade: Schema → Technik, mit Ergebnis-Verteilung und
						durchschnittlichem Compliance-Score. For research purposes only.
					</p>
					<div
						className="mx-3 rounded-md overflow-hidden"
						style={{
							backgroundColor: theme.colors.bgMain,
							border: `1px solid ${theme.colors.border}`,
						}}
					>
						{tree.map((node) => (
							<NodeRow key={node.label} node={node} theme={theme} depth={0} />
						))}
					</div>
				</div>
			)}
		</div>
	);
}
