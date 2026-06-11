import { CheckCircle, AlertTriangle, XCircle } from 'lucide-react';
import type { Theme } from '../../types';
import type { PrompterResultBand } from '../../../shared/prompter-types';

export function PrompterResultBadge({
	theme,
	band,
	size = 'md',
}: {
	theme: Theme;
	band: PrompterResultBand;
	size?: 'sm' | 'md';
}): JSX.Element {
	const config = {
		green: { color: theme.colors.success, Icon: CheckCircle, label: 'Green' },
		yellow: { color: theme.colors.warning, Icon: AlertTriangle, label: 'Yellow' },
		red: { color: theme.colors.error, Icon: XCircle, label: 'Red' },
	}[band];

	const { color, Icon, label } = config;
	const isSmall = size === 'sm';
	const textClass = isSmall ? 'text-[10px]' : 'text-xs';
	const iconClass = isSmall ? 'w-3 h-3' : 'w-3.5 h-3.5';

	return (
		<span
			className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium select-none ${textClass}`}
			style={{ backgroundColor: color + '1a', color }}
		>
			<Icon className={iconClass} style={{ color }} />
			{label}
		</span>
	);
}
