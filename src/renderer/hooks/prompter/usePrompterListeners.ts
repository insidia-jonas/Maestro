/**
 * usePrompterListeners - app-level wiring for the Prompter (Prompt Safety Lab):
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
		return () => {
			unsubRun();
			unsubTask();
			unsubLog();
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
				usePrompterStore.getState().loadRunHistory(interrupted);
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
