/**
 * usePrompterListeners - app-level wiring for the Prompter (Power & Robustness Lab):
 * subscribes to the main-process run/task/log events and routes them into the
 * prompterStore, and on startup recovers interrupted runs from known project
 * folders (no auto-resume: a recovered run is shown paused so the user decides).
 *
 * Mount once near the App root.
 *
 * Playbook reference: section 13 (crash recovery), Task J (events in the store).
 */

import { useEffect } from 'react';
import { usePrompterStore } from '../../stores/prompterStore';
import type { PrompterRun } from '../../../shared/prompter-types';

const ROOTS_KEY = 'prompter:project-roots';

/** Record a project root so interrupted runs in it can be recovered on restart. */
export function rememberPrompterProjectRoot(root: string): void {
	try {
		const raw = localStorage.getItem(ROOTS_KEY);
		const roots: string[] = raw ? (JSON.parse(raw) as string[]) : [];
		if (!roots.includes(root)) {
			roots.push(root);
			localStorage.setItem(ROOTS_KEY, JSON.stringify(roots));
		}
	} catch {
		/* localStorage may be unavailable; recovery is best-effort */
	}
}

function getKnownProjectRoots(): string[] {
	try {
		const raw = localStorage.getItem(ROOTS_KEY);
		return raw ? (JSON.parse(raw) as string[]) : [];
	} catch {
		return [];
	}
}

export function usePrompterListeners(): void {
	// Route main-process events into the store.
	useEffect(() => {
		const unsubRun = window.maestro.prompter.onRunUpdated((payload) => {
			usePrompterStore.getState().updateRunFromEvent(payload);
		});
		const unsubTask = window.maestro.prompter.onTaskUpdated((payload) => {
			usePrompterStore.getState().updateTaskFromEvent(payload);
		});
		const unsubLog = window.maestro.prompter.onLog((payload) => {
			usePrompterStore.getState().appendLog(payload);
		});
		const unsubCampaign = window.maestro.prompter.onCampaignUpdated((payload) => {
			usePrompterStore.getState().updateCampaignFromEvent(payload);
		});
		return () => {
			unsubRun();
			unsubTask();
			unsubLog();
			unsubCampaign();
		};
	}, []);

	// Surface existing in-memory campaigns on startup so the Left Bar list can
	// show multiple visible campaigns, newest first.
	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const campaigns = await window.maestro.prompter.listCampaigns();
				if (cancelled || campaigns.length === 0) return;
				usePrompterStore.getState().loadCampaignHistory(campaigns);
				if (!usePrompterStore.getState().activeCampaign) {
					usePrompterStore.getState().setActiveCampaign(campaigns[0]);
				}
			} catch {
				/* campaign restore is best-effort */
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	// Load the full run history from known project folders so the Left Bar can
	// list past Tests, not just the active one.
	useEffect(() => {
		const roots = getKnownProjectRoots();
		if (roots.length === 0) return;
		let cancelled = false;
		void (async () => {
			const all: PrompterRun[] = [];
			for (const root of roots) {
				try {
					const runs = await window.maestro.prompter.listRuns(root);
					all.push(...runs);
				} catch {
					/* a missing or unreadable project folder is non-fatal */
				}
			}
			if (!cancelled && all.length > 0) {
				usePrompterStore.getState().mergeRunHistory(all);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	// Recover interrupted runs from known project folders on startup.
	useEffect(() => {
		const roots = getKnownProjectRoots();
		if (roots.length === 0) return;
		let cancelled = false;
		void (async () => {
			try {
				const interrupted = await window.maestro.prompter.recoverRuns(roots);
				if (cancelled || interrupted.length === 0) return;
				usePrompterStore.getState().mergeRunHistory(interrupted);
				// Surface the most recent interrupted run if nothing is active.
				if (!usePrompterStore.getState().activeRun) {
					usePrompterStore.getState().setActiveRun(interrupted[0]);
				}
			} catch {
				/* recovery is best-effort */
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);
}
