import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@engrove/ui';
import { api, ApiError } from './App.js';
import { FormFieldLabel } from './FormFieldLabel.js';
import { IconAction } from './IconAction.js';
import { useI18n } from './i18n.js';

type PermissionAction = 'visibility' | 'create' | 'update' | 'archive';
type PermissionMode =
  'everyone' | 'editors' | 'engineers' | 'administrators' | 'specific' | 'nobody';

interface PermissionSubjects {
  userIds: string[];
  groupIds: string[];
}

interface PermissionConfiguration {
  modes: Record<PermissionAction, PermissionMode>;
  subjects: Record<PermissionAction, PermissionSubjects>;
  subjectDirectory: {
    members: MemberOption[];
    groups: GroupOption[];
  };
  rowVersion: number;
}

interface MemberOption {
  id: string;
  displayName: string;
  email: string;
}

interface GroupOption {
  id: string;
  name: string;
}

interface MemberApiOption {
  userId: string;
  displayName: string;
  email: string;
}

const actions: PermissionAction[] = ['visibility', 'create', 'update', 'archive'];
const modes: PermissionMode[] = [
  'everyone',
  'editors',
  'engineers',
  'administrators',
  'specific',
  'nobody',
];
const inputClass =
  'mt-1 min-h-10 w-full rounded-lg border border-slate-700/80 bg-slate-950/75 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400 focus:ring-3 focus:ring-sky-400/15';

function copyConfiguration(configuration: PermissionConfiguration): PermissionConfiguration {
  return {
    ...configuration,
    modes: { ...configuration.modes },
    subjects: Object.fromEntries(
      actions.map((action) => [
        action,
        {
          userIds: [...configuration.subjects[action].userIds],
          groupIds: [...configuration.subjects[action].groupIds],
        },
      ]),
    ) as Record<PermissionAction, PermissionSubjects>,
    subjectDirectory: {
      members: [...configuration.subjectDirectory.members],
      groups: [...configuration.subjectDirectory.groups],
    },
  };
}

export function TablePermissionsPanel({
  base,
  tableId,
  tableName,
  onClose,
  onSaved,
}: {
  base: string;
  tableId: string;
  tableName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [configuration, setConfiguration] = useState<PermissionConfiguration>();
  const [draft, setDraft] = useState<PermissionConfiguration>();
  const [expandedAction, setExpandedAction] = useState<PermissionAction>('visibility');
  const [directoryKind, setDirectoryKind] = useState<'members' | 'groups'>('members');
  const [query, setQuery] = useState('');
  const [memberResults, setMemberResults] = useState<MemberOption[]>([]);
  const [groupResults, setGroupResults] = useState<GroupOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage('');
    setConflict(false);
    try {
      const loaded = await api<PermissionConfiguration>(
        `${base}/object-types/${tableId}/permissions`,
      );
      setConfiguration(loaded);
      setDraft(copyConfiguration(loaded));
      setMemberResults(loaded.subjectDirectory.members);
      setGroupResults(loaded.subjectDirectory.groups);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : t('data.tablePermissionsLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [base, tableId, t]);

  useEffect(() => void load(), [load]);

  const selectedMembers = useMemo(() => {
    if (!draft) return [];
    const directory = new Map(
      [...draft.subjectDirectory.members, ...memberResults].map((member) => [member.id, member]),
    );
    return draft.subjects[expandedAction].userIds.map(
      (id) => directory.get(id) ?? { id, displayName: t('data.unavailableMember'), email: '' },
    );
  }, [draft, expandedAction, memberResults, t]);
  const selectedGroups = useMemo(() => {
    if (!draft) return [];
    const directory = new Map(
      [...draft.subjectDirectory.groups, ...groupResults].map((group) => [group.id, group]),
    );
    return draft.subjects[expandedAction].groupIds.map(
      (id) => directory.get(id) ?? { id, name: t('data.unavailableGroup') },
    );
  }, [draft, expandedAction, groupResults, t]);
  const dirty = Boolean(
    configuration && draft && JSON.stringify(configuration) !== JSON.stringify(draft),
  );

  async function searchDirectory() {
    setSearching(true);
    setMessage('');
    try {
      const parameters = new URLSearchParams({ query: query.trim(), limit: '20', offset: '0' });
      if (directoryKind === 'members') {
        const response = await api<{ items: MemberApiOption[] }>(`/members?${parameters}`);
        setMemberResults(
          response.items.map((member) => ({
            id: member.userId,
            displayName: member.displayName,
            email: member.email,
          })),
        );
      } else {
        const response = await api<{ items: GroupOption[] }>(`/member-groups?${parameters}`);
        setGroupResults(response.items);
      }
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : t('data.tablePermissionDirectoryFailed'));
    } finally {
      setSearching(false);
    }
  }

  function toggleSubject(kind: 'userIds' | 'groupIds', id: string) {
    setDraft((current) => {
      if (!current) return current;
      const selected = current.subjects[expandedAction][kind];
      const next = selected.includes(id)
        ? selected.filter((candidate) => candidate !== id)
        : [...selected, id];
      return {
        ...current,
        subjects: {
          ...current.subjects,
          [expandedAction]: { ...current.subjects[expandedAction], [kind]: next },
        },
      };
    });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || !dirty) return;
    setSaving(true);
    setMessage('');
    setConflict(false);
    try {
      const updated = await api<PermissionConfiguration>(
        `${base}/object-types/${tableId}/permissions`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            modes: draft.modes,
            subjects: draft.subjects,
            rowVersion: draft.rowVersion,
          }),
        },
      );
      setConfiguration(updated);
      setDraft(copyConfiguration(updated));
      setMessage(t('data.tablePermissionsSaved'));
      onSaved();
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'TABLE_PERMISSION_VERSION_CONFLICT') {
        setConflict(true);
        setMessage(t('data.tablePermissionsConflict'));
      } else {
        setMessage(cause instanceof Error ? cause.message : t('data.tablePermissionsSaveFailed'));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      aria-labelledby="table-permissions-title"
      className="mt-3 rounded-xl border border-violet-500/30 bg-slate-900/75 p-4 shadow-xl shadow-slate-950/20"
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-100" id="table-permissions-title">
            {t('data.tablePermissions')}
          </h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {t('data.tablePermissionsHint', { table: tableName })}
          </p>
        </div>
        <IconAction icon="×" label={t('common.close')} onClick={onClose} tooltipAlign="end" />
      </header>
      {loading && <p className="mt-4 text-xs text-slate-500">{t('common.loading')}</p>}
      {!loading && draft && (
        <form className="mt-4" onSubmit={(event) => void save(event)}>
          <div className="grid gap-2 lg:grid-cols-2">
            {actions.map((action) => (
              <div
                className={`rounded-lg border p-3 ${expandedAction === action ? 'border-violet-400/50 bg-violet-400/5' : 'border-slate-800 bg-slate-950/35'}`}
                key={action}
              >
                <label className="block text-xs text-slate-300">
                  <FormFieldLabel required>
                    {t(`data.tablePermissionAction.${action}`)}
                  </FormFieldLabel>
                  <select
                    className={inputClass}
                    onChange={(event) => {
                      const mode = event.target.value as PermissionMode;
                      setDraft((current) =>
                        current
                          ? { ...current, modes: { ...current.modes, [action]: mode } }
                          : current,
                      );
                      if (mode === 'specific') setExpandedAction(action);
                    }}
                    value={draft.modes[action]}
                  >
                    {modes.map((mode) => (
                      <option key={mode} value={mode}>
                        {t(`data.tablePermissionMode.${mode}`)}
                      </option>
                    ))}
                  </select>
                </label>
                {draft.modes[action] === 'specific' && (
                  <button
                    className="mt-2 text-xs font-medium text-violet-300 hover:text-violet-200"
                    onClick={() => setExpandedAction(action)}
                    type="button"
                  >
                    {t('data.manageSpecificAccess', {
                      count:
                        draft.subjects[action].userIds.length +
                        draft.subjects[action].groupIds.length,
                    })}
                  </button>
                )}
              </div>
            ))}
          </div>

          {draft.modes[expandedAction] === 'specific' && (
            <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/45 p-3">
              <p className="text-xs font-semibold text-slate-300">
                {t('data.specificAccessFor', {
                  action: t(`data.tablePermissionAction.${expandedAction}`),
                })}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {selectedMembers.map((member) => (
                  <span
                    className="inline-flex items-center gap-1 rounded-full border border-sky-500/25 bg-sky-500/10 px-2 py-1 text-[10px] text-sky-200"
                    key={`member:${member.id}`}
                  >
                    {member.displayName}
                    <button
                      aria-label={t('data.removePermissionSubject', { name: member.displayName })}
                      className="text-sky-400 hover:text-white"
                      onClick={() => toggleSubject('userIds', member.id)}
                      title={t('data.removePermissionSubject', { name: member.displayName })}
                      type="button"
                    >
                      ×
                    </button>
                  </span>
                ))}
                {selectedGroups.map((group) => (
                  <span
                    className="inline-flex items-center gap-1 rounded-full border border-violet-500/25 bg-violet-500/10 px-2 py-1 text-[10px] text-violet-200"
                    key={`group:${group.id}`}
                  >
                    {group.name}
                    <button
                      aria-label={t('data.removePermissionSubject', { name: group.name })}
                      className="text-violet-400 hover:text-white"
                      onClick={() => toggleSubject('groupIds', group.id)}
                      title={t('data.removePermissionSubject', { name: group.name })}
                      type="button"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <select
                  aria-label={t('data.permissionSubjectType')}
                  className="min-h-9 rounded-lg border border-slate-700 bg-slate-900 px-2 text-xs text-slate-200"
                  onChange={(event) => setDirectoryKind(event.target.value as 'members' | 'groups')}
                  value={directoryKind}
                >
                  <option value="members">{t('data.members')}</option>
                  <option value="groups">{t('data.groups')}</option>
                </select>
                <input
                  aria-label={t('data.searchPermissionSubjects')}
                  className="min-h-9 min-w-48 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs text-slate-200 outline-none focus:border-violet-400"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('data.searchPermissionSubjects')}
                  type="search"
                  value={query}
                />
                <Button
                  disabled={searching}
                  onClick={() => void searchDirectory()}
                  type="button"
                  variant="quiet"
                >
                  {searching ? t('common.loading') : t('common.search')}
                </Button>
              </div>
              <div className="mt-2 grid max-h-48 gap-1 overflow-y-auto">
                {directoryKind === 'members'
                  ? memberResults.map((member) => (
                      <label
                        className="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                        key={member.id}
                      >
                        <input
                          checked={draft.subjects[expandedAction].userIds.includes(member.id)}
                          onChange={() => toggleSubject('userIds', member.id)}
                          type="checkbox"
                        />
                        <span>{member.displayName}</span>
                        <span className="ml-auto text-[10px] text-slate-600">{member.email}</span>
                      </label>
                    ))
                  : groupResults.map((group) => (
                      <label
                        className="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                        key={group.id}
                      >
                        <input
                          checked={draft.subjects[expandedAction].groupIds.includes(group.id)}
                          onChange={() => toggleSubject('groupIds', group.id)}
                          type="checkbox"
                        />
                        <span>{group.name}</span>
                      </label>
                    ))}
              </div>
            </div>
          )}

          {message && (
            <p
              className={`mt-3 text-xs ${conflict ? 'text-amber-300' : 'text-slate-300'}`}
              role={conflict ? 'alert' : 'status'}
            >
              {message}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button disabled={!dirty || saving} type="submit">
              {saving ? t('data.saving') : t('data.saveTablePermissions')}
            </Button>
            {conflict && (
              <Button onClick={() => void load()} type="button" variant="quiet">
                {t('data.reloadPermissions')}
              </Button>
            )}
            {dirty && <span className="text-[10px] text-amber-300">{t('data.unsaved')}</span>}
          </div>
        </form>
      )}
      {!loading && !draft && message && <p className="mt-4 text-xs text-rose-300">{message}</p>}
    </section>
  );
}
