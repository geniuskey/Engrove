import { useCallback, useMemo } from 'react';
import type { ProjectReference } from './DataPageTypes.js';
import { useI18n } from './i18n.js';
import { RemoteOptionPicker, type PickerSpecialOption } from './RemoteOptionPicker.js';

interface ProjectReferencePickerProps {
  ariaLabel: string;
  className?: string;
  defaultValue?: string | undefined;
  disabled?: boolean;
  name?: string;
  projects: ProjectReference[];
  specialOptions?: PickerSpecialOption[];
  value?: string;
  workspaceId: string;
  onChange?: ((value: string, project?: ProjectReference) => void) | undefined;
  onProjectResolved?: ((project: ProjectReference) => void) | undefined;
}

export function ProjectReferencePicker({
  projects,
  value,
  defaultValue,
  workspaceId,
  onProjectResolved,
  ...props
}: ProjectReferencePickerProps) {
  const { t } = useI18n();
  const selectedValue = value ?? defaultValue ?? '';
  const initialOptions = useMemo(
    () => projects.filter((project) => !project.archivedAt || project.id === selectedValue),
    [projects, selectedValue],
  );
  const endpoint = useCallback(
    (query: string, limit: number) => {
      const parameters = new URLSearchParams({ limit: String(limit) });
      if (query) parameters.set('query', query);
      return `/workspaces/${workspaceId}/project-options?${parameters.toString()}`;
    },
    [workspaceId],
  );
  return (
    <RemoteOptionPicker
      {...props}
      defaultValue={defaultValue}
      endpoint={endpoint}
      getLabel={(project) => project.name}
      initialOptions={initialOptions}
      loadError={t('data.projectSearchFailed')}
      noResults={t('sidebar.noProjectsFound')}
      onOptionResolved={onProjectResolved}
      refineMessage={t('sidebar.refineProjectSearch')}
      renderMeta={(project) =>
        project.archivedAt ? (
          <span className="shrink-0 text-[9px] text-amber-300">{t('common.archived')}</span>
        ) : null
      }
      value={value}
    />
  );
}
