import { useCallback } from 'react';
import { useI18n } from './i18n.js';
import { RemoteOptionPicker, type PickerSpecialOption } from './RemoteOptionPicker.js';

interface FileReferenceOption {
  id: string;
  series_name: string;
  version_number: number;
  original_name: string;
  status: 'pending_upload' | 'verifying' | 'available' | 'failed';
  archived_at: string | null;
}

interface DatasetReferenceOption {
  id: string;
  name: string;
  dataset_type: 'tabular' | 'xy';
  status: 'pending' | 'processing' | 'ready' | 'failed';
  archived_at: string | null;
}

interface EngineeringReferencePickerProps {
  ariaLabel: string;
  base: string;
  className?: string;
  defaultValue?: string;
  disabled?: boolean;
  fieldType: 'file' | 'dataset';
  name?: string;
  specialOptions?: PickerSpecialOption[];
  value?: string;
  onChange?: (value: string) => void;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function EngineeringReferencePicker({
  base,
  fieldType,
  onChange,
  ...props
}: EngineeringReferencePickerProps) {
  const { t } = useI18n();
  const fileEndpoint = useCallback(
    (query: string, limit: number) => {
      const exact = uuidPattern.test(query);
      const parameters = new URLSearchParams({
        archiveState: exact ? 'all' : 'active',
        limit: String(limit),
        status: exact ? 'all' : 'available',
      });
      if (query) parameters.set('query', query);
      return `${base}/files?${parameters.toString()}`;
    },
    [base],
  );
  const datasetEndpoint = useCallback(
    (query: string, limit: number) => {
      const parameters = new URLSearchParams({
        includeArchived: uuidPattern.test(query) ? 'true' : 'false',
        limit: String(limit),
      });
      if (query) parameters.set('query', query);
      return `${base}/datasets?${parameters.toString()}`;
    },
    [base],
  );

  if (fieldType === 'file') {
    return (
      <RemoteOptionPicker<FileReferenceOption>
        {...props}
        endpoint={fileEndpoint}
        filterOption={(file) => file.status === 'available'}
        getLabel={(file) => `${file.series_name} · v${file.version_number} · ${file.original_name}`}
        initialOptions={[]}
        loadError={t('data.referenceSearchFailed')}
        noResults={t('data.noFileReferences')}
        onChange={(value) => onChange?.(value)}
        refineMessage={t('sidebar.refineProjectSearch')}
        renderMeta={(file) => (
          <span className="shrink-0 text-[9px] text-slate-500">
            {file.archived_at ? t('data.archived') : file.status}
          </span>
        )}
        resolveUnknown
      />
    );
  }

  return (
    <RemoteOptionPicker<DatasetReferenceOption>
      {...props}
      endpoint={datasetEndpoint}
      filterOption={(dataset) => dataset.status === 'ready'}
      getLabel={(dataset) => `${dataset.name} · ${dataset.dataset_type}`}
      initialOptions={[]}
      loadError={t('data.referenceSearchFailed')}
      noResults={t('data.noDatasetReferences')}
      onChange={(value) => onChange?.(value)}
      refineMessage={t('sidebar.refineProjectSearch')}
      renderMeta={(dataset) => (
        <span className="shrink-0 text-[9px] text-slate-500">
          {dataset.archived_at ? t('data.archived') : dataset.status}
        </span>
      )}
      resolveUnknown
    />
  );
}
