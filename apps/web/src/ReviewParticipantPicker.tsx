import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReviewParticipant } from './DataPageTypes.js';
import { IconAction } from './IconAction.js';
import { useI18n } from './i18n.js';
import { RemoteOptionPicker, type PickerSpecialOption } from './RemoteOptionPicker.js';

interface ReviewParticipantPickerProps {
  ariaLabel: string;
  base: string;
  className?: string;
  disabled?: boolean;
  excludedIds?: ReadonlySet<string>;
  name?: string;
  reviewerOnly?: boolean;
  specialOptions?: PickerSpecialOption[];
  value?: string;
  onChange?: ((value: string, participant?: ReviewParticipant) => void) | undefined;
}

export function ReviewParticipantPicker({
  base,
  excludedIds,
  reviewerOnly = false,
  ...props
}: ReviewParticipantPickerProps) {
  const { t } = useI18n();
  const endpoint = useCallback(
    (query: string, limit: number) => {
      const parameters = new URLSearchParams({
        limit: String(limit),
        reviewerOnly: String(reviewerOnly),
      });
      if (query) parameters.set('query', query);
      return `${base}/review-participants?${parameters.toString()}`;
    },
    [base, reviewerOnly],
  );
  const filterOption = useCallback(
    (participant: ReviewParticipant) => !excludedIds?.has(participant.id),
    [excludedIds],
  );
  return (
    <RemoteOptionPicker
      {...props}
      endpoint={endpoint}
      filterOption={filterOption}
      getLabel={(participant) => participant.displayName}
      initialOptions={[]}
      loadError={t('reviews.participantsLoadFailed')}
      noResults={t('reviews.noParticipantsFound')}
      refineMessage={t('reviews.refineParticipantSearch')}
      renderMeta={(participant) => (
        <span className="truncate text-[9px] text-slate-500">{participant.email}</span>
      )}
      resolveUnknown
    />
  );
}

export function ReviewMentionPicker({
  base,
  disabled = false,
  initialParticipants = [],
  onSelectionChange,
  userId,
}: {
  base: string;
  disabled?: boolean;
  initialParticipants?: Array<{ id: string; displayName: string }>;
  onSelectionChange?: (participants: Array<{ id: string; displayName: string }>) => void;
  userId: string;
}) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] =
    useState<Array<{ id: string; displayName: string }>>(initialParticipants);
  const excludedIds = useMemo(
    () => new Set([userId, ...selected.map((participant) => participant.id)]),
    [selected, userId],
  );

  useEffect(() => {
    const form = rootRef.current?.closest('form');
    if (!form) return;
    const reset = () => setSelected([]);
    form.addEventListener('reset', reset);
    return () => form.removeEventListener('reset', reset);
  }, []);

  useEffect(() => onSelectionChange?.(selected), [onSelectionChange, selected]);

  return (
    <div className="space-y-2" ref={rootRef}>
      {selected.map((participant) => (
        <input key={participant.id} name="mentionedUserIds" type="hidden" value={participant.id} />
      ))}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((participant) => (
            <span
              className="inline-flex min-h-7 items-center gap-1 rounded-full border border-sky-500/25 bg-sky-500/10 pl-2.5 pr-0.5 text-xs text-sky-200"
              key={participant.id}
            >
              @{participant.displayName}
              <IconAction
                className="size-6"
                disabled={disabled}
                icon="×"
                label={t('reviews.removeParticipant', { name: participant.displayName })}
                onClick={() =>
                  setSelected((current) =>
                    current.filter((candidate) => candidate.id !== participant.id),
                  )
                }
              />
            </span>
          ))}
        </div>
      )}
      <ReviewParticipantPicker
        ariaLabel={t('reviews.searchParticipants')}
        base={base}
        className="min-h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-sky-400"
        disabled={disabled}
        excludedIds={excludedIds}
        value=""
        onChange={(_, participant) => {
          if (!participant) return;
          setSelected((current) =>
            current.some((candidate) => candidate.id === participant.id)
              ? current
              : [...current, participant],
          );
        }}
      />
    </div>
  );
}
