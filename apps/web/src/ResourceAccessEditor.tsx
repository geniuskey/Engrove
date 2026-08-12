import { Button } from '@engrove/ui';
import { useEffect, useRef, useState } from 'react';
import { FormFieldLabel } from './FormFieldLabel.js';
import { useI18n } from './i18n.js';

interface AccessPolicy {
  visibility: 'organization' | 'workspace' | 'restricted';
  accessVersion: number;
  members: Array<{ id: string; displayName: string; email: string }>;
  groups: Array<{ id: string; name: string; color: string }>;
}

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;

const inputClass =
  'mt-1 min-h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-sky-400';

export function ResourceAccessEditor({
  endpoint,
  request,
  scope,
}: {
  endpoint: string;
  request: Request;
  scope: 'workspace' | 'project';
}) {
  const { t } = useI18n();
  const [policy, setPolicy] = useState<AccessPolicy>();
  const [members, setMembers] = useState<
    Array<{ userId: string; displayName: string; email: string }>
  >([]);
  const [groups, setGroups] = useState<Array<{ id: string; name: string; color: string }>>([]);
  const [visibility, setVisibility] = useState<'organization' | 'workspace' | 'restricted'>(
    scope === 'workspace' ? 'organization' : 'workspace',
  );
  const [userIds, setUserIds] = useState<string[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [directorySearch, setDirectorySearch] = useState('');
  const selectedUserIds = useRef(userIds);
  const selectedGroupIds = useRef(groupIds);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    selectedUserIds.current = userIds;
    selectedGroupIds.current = groupIds;
  }, [groupIds, userIds]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      request<AccessPolicy>(endpoint),
      request<{ items: Array<{ userId: string; displayName: string; email: string }> }>(
        '/members?limit=100&offset=0',
      ),
      request<{ items: Array<{ id: string; name: string; color: string }> }>(
        '/member-groups?limit=100&offset=0',
      ),
    ])
      .then(([nextPolicy, memberPage, groupPage]) => {
        if (!active) return;
        setPolicy(nextPolicy);
        setVisibility(nextPolicy.visibility);
        setUserIds(nextPolicy.members.map((member) => member.id));
        setGroupIds(nextPolicy.groups.map((group) => group.id));
        setMembers([
          ...nextPolicy.members.map((member) => ({ ...member, userId: member.id })),
          ...memberPage.items.filter(
            (member) => !nextPolicy.members.some((selected) => selected.id === member.userId),
          ),
        ]);
        setGroups([
          ...nextPolicy.groups,
          ...groupPage.items.filter(
            (group) => !nextPolicy.groups.some((selected) => selected.id === group.id),
          ),
        ]);
        setError('');
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : t('access.loadFailed'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [endpoint, request, t]);

  useEffect(() => {
    if (!policy) return;
    const timeout = window.setTimeout(() => {
      const query = directorySearch.trim();
      const suffix = query ? `&query=${encodeURIComponent(query)}` : '';
      void Promise.all([
        request<{ items: Array<{ userId: string; displayName: string; email: string }> }>(
          `/members?limit=100&offset=0${suffix}`,
        ),
        request<{ items: Array<{ id: string; name: string; color: string }> }>(
          `/member-groups?limit=100&offset=0${suffix}`,
        ),
      ])
        .then(([memberPage, groupPage]) => {
          setMembers((current) => [
            ...current.filter((member) => selectedUserIds.current.includes(member.userId)),
            ...memberPage.items.filter(
              (member) => !selectedUserIds.current.includes(member.userId),
            ),
          ]);
          setGroups((current) => [
            ...current.filter((group) => selectedGroupIds.current.includes(group.id)),
            ...groupPage.items.filter((group) => !selectedGroupIds.current.includes(group.id)),
          ]);
        })
        .catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [directorySearch, policy, request]);

  function toggle(values: string[], id: string, update: (next: string[]) => void) {
    update(values.includes(id) ? values.filter((value) => value !== id) : [...values, id]);
  }

  async function save() {
    if (!policy || saving) return;
    setSaving(true);
    setMessage('');
    try {
      const saved = await request<AccessPolicy>(endpoint, {
        method: 'PATCH',
        body: JSON.stringify({
          visibility,
          userIds,
          groupIds,
          accessVersion: policy.accessVersion,
        }),
      });
      setPolicy(saved);
      setVisibility(saved.visibility);
      setUserIds(saved.members.map((member) => member.id));
      setGroupIds(saved.groups.map((group) => group.id));
      setMessage(t('access.saved'));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('access.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  const inheritedVisibility = scope === 'workspace' ? 'organization' : 'workspace';
  return (
    <section aria-label={t('access.heading')} className="mt-6 border-t border-slate-800 pt-5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="grid size-8 shrink-0 place-items-center rounded-lg border border-slate-700 bg-slate-950/45 text-sm text-sky-300"
        >
          ◈
        </span>
        <div>
          <h2 className="text-sm font-semibold text-slate-200">{t('access.heading')}</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {scope === 'workspace' ? t('access.workspaceHint') : t('access.projectHint')}
          </p>
        </div>
      </div>
      {loading ? (
        <p className="mt-4 text-xs text-slate-500">{t('common.loading')}</p>
      ) : (
        <div className="mt-4 space-y-4">
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-xs font-medium text-slate-300">
              <FormFieldLabel required>{t('access.visibility')}</FormFieldLabel>
            </legend>
            <label className="flex cursor-pointer gap-3 rounded-lg border border-slate-800 bg-slate-950/30 p-3 text-sm text-slate-300">
              <input
                checked={visibility === inheritedVisibility}
                name={`${scope}-visibility`}
                onChange={() => setVisibility(inheritedVisibility)}
                type="radio"
              />
              <span>
                <strong className="block text-slate-200">
                  {scope === 'workspace' ? t('access.organization') : t('access.workspace')}
                </strong>
                <span className="mt-0.5 block text-xs text-slate-500">
                  {scope === 'workspace'
                    ? t('access.organizationHint')
                    : t('access.workspaceVisibilityHint')}
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer gap-3 rounded-lg border border-slate-800 bg-slate-950/30 p-3 text-sm text-slate-300">
              <input
                checked={visibility === 'restricted'}
                name={`${scope}-visibility`}
                onChange={() => setVisibility('restricted')}
                type="radio"
              />
              <span>
                <strong className="block text-slate-200">{t('access.restricted')}</strong>
                <span className="mt-0.5 block text-xs text-slate-500">
                  {t('access.restrictedHint')}
                </span>
              </span>
            </label>
          </fieldset>
          {visibility === 'restricted' && (
            <div>
              <input
                aria-label={t('access.searchSubjects')}
                className={inputClass}
                maxLength={200}
                onChange={(event) => setDirectorySearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.preventDefault();
                }}
                placeholder={t('access.searchSubjects')}
                type="search"
                value={directorySearch}
              />
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <fieldset className="rounded-lg border border-slate-800 p-3">
                  <legend className="px-1 text-xs font-medium text-slate-300">
                    {t('access.members')} · {t('common.optional')}
                  </legend>
                  <div className="max-h-48 space-y-1 overflow-y-auto">
                    {members.map((member) => (
                      <label
                        className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-slate-800/60"
                        key={member.userId}
                      >
                        <input
                          checked={userIds.includes(member.userId)}
                          onChange={() => toggle(userIds, member.userId, setUserIds)}
                          type="checkbox"
                        />
                        <span className="min-w-0 text-xs text-slate-300">
                          <strong className="block truncate font-medium">
                            {member.displayName}
                          </strong>
                          <span className="block truncate text-slate-500">{member.email}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <fieldset className="rounded-lg border border-slate-800 p-3">
                  <legend className="px-1 text-xs font-medium text-slate-300">
                    {t('access.groups')} · {t('common.optional')}
                  </legend>
                  <div className="max-h-48 space-y-1 overflow-y-auto">
                    {groups.map((group) => (
                      <label
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-800/60"
                        key={group.id}
                      >
                        <input
                          checked={groupIds.includes(group.id)}
                          onChange={() => toggle(groupIds, group.id, setGroupIds)}
                          type="checkbox"
                        />
                        <span className="text-xs text-slate-300">{group.name}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
            </div>
          )}
          {visibility === 'restricted' && userIds.length === 0 && groupIds.length === 0 && (
            <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
              {t('access.ownerOnlyWarning')}
            </p>
          )}
          <Button disabled={saving || !policy} onClick={() => void save()} type="button">
            {saving ? t('common.saving') : t('access.save')}
          </Button>
          {(error || message) && (
            <p
              aria-live="polite"
              className={`mt-2 text-sm ${error ? 'text-rose-300' : 'text-emerald-300'}`}
            >
              {error || message}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
