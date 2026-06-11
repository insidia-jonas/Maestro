import type { Theme } from '../../types';
import type { PrompterTask } from '../../../shared/prompter-types';
import { PrompterTaskRow } from './PrompterTaskRow';

export function PrompterTaskList({
	theme,
	tasks,
}: {
	theme: Theme;
	tasks: PrompterTask[];
}): JSX.Element {
	if (tasks.length === 0) {
		return (
			<div className="py-6 text-center text-xs select-none" style={{ color: theme.colors.textDim }}>
				Keine Tasks
			</div>
		);
	}

	return (
		<div className="flex flex-col">
			{tasks.map((t) => (
				<PrompterTaskRow key={t.id} theme={theme} task={t} />
			))}
		</div>
	);
}
