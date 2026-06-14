/**
 * PrompterHardenedNotice - displays a notice when hardened instruction files
 * have been generated from green adversarial findings, or offers a manual
 * trigger when qualifying greens exist but no hardened file was produced.
 *
 * For security research and model evaluation purposes only.
 */

import { useState } from 'react';
import { ShieldCheck, FileText, RefreshCw } from 'lucide-react';
import type { Theme } from '../../types';
import type { PrompterRun } from '../../../shared/prompter-types';

const ADVERSARIAL_SCHEMA_IDS = new Set([
	'adversarial-compliance-test',
	'homoglyph-bypass-effectiveness',
	'semantic-self-reference-tester',
	'taxonomy-embedding-momentum',
	'bidi-zero-width-evasion',
	'multi-technique-synergy-finder',
	'injection-reliability-verifier',
	'adversarial-intelligence-discoverer',
	'model-vulnerability-profiler',
	'edge-case-injection-finder',
	'emoji-steganography',
	'invisible-text-steganography',
	'steganographic-carrier-tester',
]);

function hasQualifyingGreens(run: PrompterRun): boolean {
	return run.tasks.some(
		(t) =>
			t.status === 'completed' && t.result === 'green' && ADVERSARIAL_SCHEMA_IDS.has(t.schemaId)
	);
}

interface Props {
	theme: Theme;
	run: PrompterRun;
}

export function PrompterHardenedNotice({ theme, run }: Props): JSX.Element | null {
	const [generating, setGenerating] = useState(false);
	const [error, setError] = useState<string | null>(null);

	if (run.status !== 'completed') return null;

	const hasHardened = run.hardenedInstructions && run.hardenedInstructions.length > 0;
	const hasGreens = hasQualifyingGreens(run);

	if (!hasHardened && !hasGreens) return null;

	const handleGenerate = async (): Promise<void> => {
		setError(null);
		setGenerating(true);
		try {
			const result = await window.maestro.prompter.generateHardenedInstruction(run.id);
			if (!result) {
				setError('Keine qualifizierenden Greens oder Base Instruction nicht gefunden');
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setGenerating(false);
		}
	};

	return (
		<div className="select-none" style={{ borderTop: `1px solid ${theme.colors.border}` }}>
			<div className="px-3 py-2">
				{hasHardened ? (
					<div
						className="rounded-md p-2 text-xs"
						style={{
							backgroundColor: `${theme.colors.success}10`,
							border: `1px solid ${theme.colors.success}44`,
						}}
					>
						<div className="flex items-center gap-2 mb-1">
							<ShieldCheck size={14} style={{ color: theme.colors.success }} />
							<span className="font-medium" style={{ color: theme.colors.success }}>
								Gehaertete Instruction generiert
							</span>
						</div>
						<p className="mb-1 text-[10px]" style={{ color: theme.colors.textDim }}>
							Defensive Haertung basierend auf Green Findings. For security research and model
							evaluation only.
						</p>
						{run.hardenedInstructions!.map((h, i) => (
							<div
								key={i}
								className="flex items-center gap-2 rounded px-2 py-1 mt-1"
								style={{ backgroundColor: `${theme.colors.success}08` }}
							>
								<FileText size={11} style={{ color: theme.colors.success }} />
								<span className="font-mono text-[10px]" style={{ color: theme.colors.textMain }}>
									{h.path.split('/').pop()}
								</span>
								<span className="text-[10px]" style={{ color: theme.colors.textDim }}>
									Base: {h.basedOn}
								</span>
								<span className="text-[10px]" style={{ color: theme.colors.textDim }}>
									· {h.findingsAddressed.length} Techniken adressiert
								</span>
							</div>
						))}
						<p className="mt-1 text-[10px]" style={{ color: theme.colors.textDim }}>
							Tipp: Kopiere die gehaertete Instruction in 1-generic-instructions/ und teste erneut
							um die Verbesserung zu verifizieren.
						</p>
					</div>
				) : hasGreens ? (
					<div
						className="rounded-md p-2 text-xs"
						style={{
							backgroundColor: `${theme.colors.warning}10`,
							border: `1px solid ${theme.colors.warning}44`,
						}}
					>
						<div className="flex items-center gap-2 mb-1">
							<ShieldCheck size={14} style={{ color: theme.colors.warning }} />
							<span className="font-medium" style={{ color: theme.colors.warning }}>
								Green Findings erkannt
							</span>
						</div>
						<p className="mb-1 text-[10px]" style={{ color: theme.colors.textDim }}>
							Adversarielle Schemata haben Modell-Schwachstellen identifiziert. Eine gehaertete
							System Instruction kann automatisch generiert werden.
						</p>
						{error && (
							<p className="mb-1 text-[10px]" style={{ color: theme.colors.error }}>
								{error}
							</p>
						)}
						<button
							type="button"
							onClick={handleGenerate}
							disabled={generating}
							className="flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium"
							style={{
								color: generating ? theme.colors.textDim : theme.colors.bgMain,
								backgroundColor: generating ? theme.colors.border : theme.colors.success,
								opacity: generating ? 0.7 : 1,
							}}
						>
							<RefreshCw size={11} className={generating ? 'animate-spin' : ''} />
							{generating ? 'Wird generiert...' : 'Gehaertete Instruction generieren'}
						</button>
					</div>
				) : null}
			</div>
		</div>
	);
}
