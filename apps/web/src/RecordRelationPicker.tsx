import { useCallback, useEffect, useRef, useState } from 'react';
import type { FieldDefinition, RecordReference } from './DataPageTypes.js';
import { IconAction } from './IconAction.js';
import { useI18n } from './i18n.js';
import { RemoteOptionPicker } from './RemoteOptionPicker.js';

function uniqueReferences(references: RecordReference[]): RecordReference[] {
  const seen = new Set<string>();
  return references.filter(
    (reference) => !seen.has(reference.id) && Boolean(seen.add(reference.id)),
  );
}

export function RelationValue({
  ids,
  references = [],
}: {
  ids: string[];
  references?: RecordReference[] | undefined;
}) {
  const { t } = useI18n();
  if (!ids.length) return <span className="text-slate-500">—</span>;
  const byId = new Map(references.map((reference) => [reference.id, reference]));
  return (
    <span className="flex min-w-0 flex-wrap gap-1">
      {ids.map((id) => {
        const reference = byId.get(id);
        return (
          <span
            className="inline-flex max-w-48 items-center gap-1 rounded-md border border-sky-400/20 bg-sky-400/10 px-1.5 py-0.5 text-[11px] text-sky-200"
            key={id}
            title={reference?.displayName ?? id}
          >
            <span className="truncate">{reference?.displayName ?? id}</span>
            {reference?.archivedAt && (
              <span className="shrink-0 text-[9px] text-amber-300">{t('common.archived')}</span>
            )}
          </span>
        );
      })}
    </span>
  );
}

export function RecordRelationPicker({
  base,
  className = '',
  compact = false,
  disabled = false,
  field,
  initialIds = [],
  initialReferences = [],
  name,
  onChange,
}: {
  base: string;
  className?: string;
  compact?: boolean;
  disabled?: boolean;
  field: FieldDefinition;
  initialIds?: string[];
  initialReferences?: RecordReference[] | undefined;
  name?: string;
  onChange?: (ids: string[], references: RecordReference[]) => void;
}) {
  const { t } = useI18n();
  const initialSignature = initialIds.join(',');
  const [selectedIds, setSelectedIds] = useState(initialIds);
  const [references, setReferences] = useState(() => uniqueReferences(initialReferences));
  const rootRef = useRef<HTMLDivElement>(null);
  const targetObjectTypeId = field.config.targetObjectTypeId ?? '';
  const multiple = field.config.multiple !== false;

  useEffect(() => {
    setSelectedIds(initialIds);
    setReferences(uniqueReferences(initialReferences));
  }, [initialSignature]);

  useEffect(() => {
    if (!name) return;
    const form = rootRef.current?.closest('form');
    if (!form) return;
    const reset = () => {
      setSelectedIds(initialIds);
      setReferences(uniqueReferences(initialReferences));
    };
    form.addEventListener('reset', reset);
    return () => form.removeEventListener('reset', reset);
  }, [initialSignature, name]);

  const endpoint = useCallback(
    (query: string, limit: number) => {
      const parameters = new URLSearchParams({ query, limit: String(limit) });
      return `${base}/object-types/${targetObjectTypeId}/record-references?${parameters.toString()}`;
    },
    [base, targetObjectTypeId],
  );
  function publish(nextIds: string[], nextReferences: RecordReference[]) {
    setSelectedIds(nextIds);
    setReferences(uniqueReferences(nextReferences));
    onChange?.(nextIds, uniqueReferences(nextReferences));
  }

  function remove(id: string) {
    publish(
      selectedIds.filter((candidate) => candidate !== id),
      references.filter((reference) => reference.id !== id),
    );
  }

  return (
    <div className={`${compact ? '' : 'mt-1.5'} grid gap-1.5`} ref={rootRef}>
      {name && selectedIds.map((id) => <input key={id} name={name} type="hidden" value={id} />)}
      {selectedIds.length > 0 && (
        <div className="flex min-w-0 flex-wrap gap-1">
          {selectedIds.map((id) => {
            const reference = references.find((candidate) => candidate.id === id);
            return (
              <span
                className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border border-sky-400/20 bg-sky-400/10 pl-2 text-xs text-sky-200"
                key={id}
              >
                <span className="max-w-52 truncate" title={reference?.displayName ?? id}>
                  {reference?.displayName ?? id}
                </span>
                {reference?.archivedAt && (
                  <span className="text-[9px] text-amber-300">{t('common.archived')}</span>
                )}
                {!disabled && (
                  <IconAction
                    className="size-7 border-0 bg-transparent"
                    icon="×"
                    label={t('data.removeRelation', { name: reference?.displayName ?? id })}
                    onClick={() => remove(id)}
                  />
                )}
              </span>
            );
          })}
        </div>
      )}
      {!disabled && targetObjectTypeId && (
        <RemoteOptionPicker<RecordReference>
          ariaLabel={t('data.searchRelation')}
          className={className}
          disabled={disabled}
          endpoint={endpoint}
          filterOption={(option) => !selectedIds.includes(option.id) && !option.archivedAt}
          getLabel={(option) => option.displayName}
          initialOptions={references.filter((reference) => !reference.archivedAt)}
          loadError={t('data.relationSearchFailed')}
          noResults={t('data.noRelationMatches')}
          refineMessage={t('data.refineRelationSearch')}
          value=""
          onChange={(_, option) => {
            if (!option) return;
            const nextIds = multiple ? [...selectedIds, option.id] : [option.id];
            const nextReferences = multiple ? [...references, option] : [option];
            publish(nextIds, nextReferences);
          }}
        />
      )}
      {!targetObjectTypeId && (
        <p className="text-xs text-rose-300">{t('data.relationTargetMissing')}</p>
      )}
    </div>
  );
}
