import { useEffect, useState } from 'react';
import { api, inputClass } from './App.js';
import type { FieldDefinition, FieldType } from './DataPageTypes.js';
import { useI18n } from './i18n.js';

export const fieldTypeMeta: Record<
  FieldType,
  {
    label: string;
    description: string;
    icon: string;
    group: 'Basic' | 'Choice' | 'Linked' | 'Engineering' | 'Structured' | 'Calculated';
  }
> = {
  text: {
    label: 'Text',
    description: 'Short names, codes, and labels',
    icon: 'Aa',
    group: 'Basic',
  },
  long_text: {
    label: 'Long text',
    description: 'Notes and multi-line descriptions',
    icon: '¶',
    group: 'Basic',
  },
  integer: { label: 'Integer', description: 'Whole numbers', icon: '#', group: 'Basic' },
  decimal: { label: 'Decimal', description: 'Numbers with precision', icon: '.0', group: 'Basic' },
  boolean: { label: 'Checkbox', description: 'Yes or no values', icon: '✓', group: 'Basic' },
  date: { label: 'Date', description: 'Calendar dates', icon: '◷', group: 'Basic' },
  datetime: { label: 'Date & time', description: 'Timestamped events', icon: '◴', group: 'Basic' },
  single_select: {
    label: 'Single select',
    description: 'One option from a controlled list',
    icon: '▾',
    group: 'Choice',
  },
  multi_select: {
    label: 'Multi select',
    description: 'Multiple controlled labels',
    icon: '≡',
    group: 'Choice',
  },
  user: { label: 'User', description: 'Organization member reference', icon: '@', group: 'Linked' },
  relation: {
    label: 'Relation',
    description: 'Records from another table',
    icon: '↗',
    group: 'Linked',
  },
  file: { label: 'File', description: 'Uploaded file reference', icon: '⌑', group: 'Linked' },
  dataset: {
    label: 'Dataset',
    description: 'Processed dataset reference',
    icon: '▦',
    group: 'Linked',
  },
  quantity: {
    label: 'Quantity',
    description: 'A value with compatible units',
    icon: 'u',
    group: 'Engineering',
  },
  measurement: {
    label: 'Measurement',
    description: 'Traceable measured result',
    icon: 'μ',
    group: 'Engineering',
  },
  range: {
    label: 'Range',
    description: 'Lower and upper engineering bounds',
    icon: '↔',
    group: 'Engineering',
  },
  spectral_data: {
    label: 'Spectral data',
    description: 'X-axis values with one or more signal series',
    icon: '∿',
    group: 'Structured',
  },
  tabular_data: {
    label: 'Data table',
    description: 'Excel-like columns and rows stored as structured data',
    icon: '▦',
    group: 'Structured',
  },
  formula: {
    label: 'Formula',
    description: 'Calculate a value from fields in this row',
    icon: 'ƒx',
    group: 'Calculated',
  },
  lookup: {
    label: 'Lookup',
    description: 'Bring a value from related records',
    icon: '↙',
    group: 'Calculated',
  },
  rollup: {
    label: 'Rollup',
    description: 'Aggregate values across related records',
    icon: 'Σ',
    group: 'Calculated',
  },
};

export const fieldTypes = Object.keys(fieldTypeMeta) as FieldType[];
export const fieldLabelClass = 'text-xs font-medium text-slate-300';
export const wideFieldLabelClass = `${fieldLabelClass} sm:col-span-2`;
export const checkboxLabelClass = 'flex cursor-pointer items-center gap-2';
export const fieldHintClass = 'mt-1 block text-[10px] font-normal text-slate-600';
export const compactMenuItemClass = 'rounded px-2 py-1.5 text-left hover:bg-slate-800';
export const emptyPanelClass = 'mt-8 rounded-2xl border border-slate-800 bg-slate-900/60 p-6';
export const checkboxClass = 'accent-sky-500';
export const skeletonLineClass = 'h-10 animate-pulse rounded bg-slate-900';

export function schemaFieldKey(name: string): string {
  return name
    .normalize('NFKD')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function fieldSupportsUnique(type: FieldType): boolean {
  return [
    'text',
    'long_text',
    'integer',
    'decimal',
    'date',
    'datetime',
    'single_select',
    'user',
    'quantity',
  ].includes(type);
}

function selectOptionsFromText(value: string): Array<{ key: string; label: string }> {
  return value
    .split(/\n|,/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const separator = line.indexOf(':');
      const explicitKey = separator > 0 ? line.slice(0, separator).trim() : '';
      const label = separator > 0 ? line.slice(separator + 1).trim() : line;
      return { key: schemaFieldKey(explicitKey || label) || `option-${index + 1}`, label };
    });
}

export function schemaFieldConfig(type: FieldType, data: FormData): Record<string, unknown> {
  if (type === 'single_select' || type === 'multi_select') {
    return { options: selectOptionsFromText(String(data.get('options') ?? '')) };
  }
  if (type === 'relation') {
    return {
      targetObjectTypeId: data.get('targetObjectTypeId'),
      multiple: data.get('multiple') === 'on',
    };
  }
  if (['quantity', 'measurement', 'range'].includes(type)) {
    return {
      dimension: data.get('dimension'),
      canonicalUnit: data.get('canonicalUnit'),
      allowedUnits: String(data.get('allowedUnits') ?? '')
        .split(',')
        .map((unit) => unit.trim())
        .filter(Boolean),
      displayPrecision: Number(data.get('displayPrecision') ?? 3),
    };
  }
  if (type === 'spectral_data') {
    return {
      xLabel: String(data.get('xLabel') ?? '').trim(),
      xUnit: String(data.get('xUnit') ?? '').trim(),
      yLabel: String(data.get('yLabel') ?? '').trim(),
      yUnit: String(data.get('yUnit') ?? '').trim(),
    };
  }
  if (type === 'tabular_data') {
    return { firstRowHeader: data.get('firstRowHeader') === 'on' };
  }
  if (type === 'formula') {
    return { expression: String(data.get('expression') ?? '').trim() };
  }
  if (type === 'lookup' || type === 'rollup') {
    return {
      relationFieldId: String(data.get('relationFieldId') ?? ''),
      targetFieldId: String(data.get('targetFieldId') ?? ''),
      ...(type === 'rollup' ? { aggregation: String(data.get('aggregation') ?? 'count') } : {}),
    };
  }
  return {};
}

export const calculatedFieldTypeSet = new Set<FieldType>(['formula', 'lookup', 'rollup']);

export function CalculatedFieldSettings({
  type,
  fields,
  base,
  defaults,
}: {
  type: 'formula' | 'lookup' | 'rollup';
  fields: FieldDefinition[];
  base: string;
  defaults?: FieldDefinition['config'];
}) {
  const { t } = useI18n();
  const relationFields = fields.filter((field) => field.fieldType === 'relation');
  const [relationFieldId, setRelationFieldId] = useState(
    defaults?.relationFieldId ?? relationFields[0]?.id ?? '',
  );
  const [targetFields, setTargetFields] = useState<FieldDefinition[]>([]);
  const [aggregation, setAggregation] = useState(defaults?.aggregation ?? 'count');
  useEffect(() => {
    const relation = relationFields.find((field) => field.id === relationFieldId);
    const targetId = relation?.config.targetObjectTypeId;
    if (!targetId) {
      setTargetFields([]);
      return;
    }
    let active = true;
    void api<{ items: FieldDefinition[] }>(`${base}/object-types/${targetId}/fields`).then(
      (result) => {
        if (active)
          setTargetFields(
            result.items.filter((field) => !calculatedFieldTypeSet.has(field.fieldType)),
          );
      },
      () => {
        if (active) setTargetFields([]);
      },
    );
    return () => {
      active = false;
    };
  }, [base, relationFieldId]);
  if (type === 'formula')
    return (
      <label className={wideFieldLabelClass}>
        {t('data.formulaExpression')}
        <textarea
          aria-label={t('data.formulaExpression')}
          className={`${inputClass} mt-1.5 min-h-24 resize-y font-mono`}
          defaultValue={defaults?.expression}
          maxLength={2000}
          name="expression"
          placeholder={'ROUND({quantity} * {unit-price}, 2)'}
          required
        />
        <span className={fieldHintClass}>{t('data.formulaHelp')}</span>
      </label>
    );
  const targetOptions = targetFields.filter(
    (field) =>
      type === 'lookup' ||
      aggregation === 'count' ||
      ['integer', 'decimal', 'quantity'].includes(field.fieldType),
  );
  return (
    <>
      <label className={fieldLabelClass}>
        {t('data.relationField')}
        <select
          className={`${inputClass} mt-1.5`}
          name="relationFieldId"
          required
          value={relationFieldId}
          onChange={(event) => setRelationFieldId(event.target.value)}
        >
          <option value="">{t('data.selectRelation')}</option>
          {relationFields.map((field) => (
            <option key={field.id} value={field.id}>
              {field.name}
            </option>
          ))}
        </select>
      </label>
      {type === 'rollup' && (
        <label className={fieldLabelClass}>
          {t('data.aggregation')}
          <select
            className={`${inputClass} mt-1.5`}
            name="aggregation"
            value={aggregation}
            onChange={(event) =>
              setAggregation(event.target.value as 'count' | 'sum' | 'average' | 'min' | 'max')
            }
          >
            <option value="count">{t('data.count')}</option>
            <option value="sum">{t('data.sum')}</option>
            <option value="average">{t('data.average')}</option>
            <option value="min">{t('data.minimum')}</option>
            <option value="max">{t('data.maximum')}</option>
          </select>
        </label>
      )}
      <label className={type === 'lookup' ? wideFieldLabelClass : fieldLabelClass}>
        {t('data.targetField')}
        <select
          className={`${inputClass} mt-1.5`}
          defaultValue={defaults?.targetFieldId ?? 'displayName'}
          name="targetFieldId"
          required
        >
          {(type === 'lookup' || aggregation === 'count') && (
            <option value="displayName">{t('data.displayName')}</option>
          )}
          {targetOptions.map((field) => (
            <option key={field.id} value={field.id}>
              {field.name}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
