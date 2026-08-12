import { useCallback } from 'react';
import { useI18n } from './i18n.js';
import { RemoteOptionPicker, type PickerSpecialOption } from './RemoteOptionPicker.js';

export interface AssigneeOption {
  id: string;
  displayName: string;
  email: string;
}

interface AssigneePickerProps {
  ariaLabel: string;
  base: string;
  className?: string;
  defaultValue?: string;
  disabled?: boolean;
  initialOptions: AssigneeOption[];
  name?: string;
  specialOptions?: PickerSpecialOption[];
  value?: string;
  onChange?: ((value: string, assignee?: AssigneeOption) => void) | undefined;
  onAssigneeResolved?: ((assignee: AssigneeOption) => void) | undefined;
}

export function AssigneePicker({ base, onAssigneeResolved, ...props }: AssigneePickerProps) {
  const { t } = useI18n();
  const endpoint = useCallback(
    (query: string, limit: number) => {
      const parameters = new URLSearchParams({ limit: String(limit) });
      if (query) parameters.set('query', query);
      return `${base}/task-assignees?${parameters.toString()}`;
    },
    [base],
  );
  return (
    <RemoteOptionPicker
      {...props}
      endpoint={endpoint}
      getLabel={(assignee) => assignee.displayName}
      loadError={t('tasks.assigneesLoadError')}
      noResults={t('tasks.noAssigneesFound')}
      onOptionResolved={onAssigneeResolved}
      refineMessage={t('sidebar.refineProjectSearch')}
      renderMeta={(assignee) => (
        <span className="truncate text-[9px] text-slate-500">{assignee.email}</span>
      )}
      resolveUnknown
    />
  );
}
