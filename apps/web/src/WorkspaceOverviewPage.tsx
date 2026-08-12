import { Button } from '@engrove/ui';
import type { Action } from '@engrove/permissions';
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { User } from './App.js';
import { FormFieldLabel } from './FormFieldLabel.js';
import { IconAction } from './IconAction.js';
import { useI18n } from './i18n.js';

interface WorkspaceSummary {
  id: string;
  publicId?: string;
  name: string;
  description?: string;
}

interface ProjectSummary {
  id: string;
  publicId?: string;
  name: string;
  key: string;
  status: 'active' | 'on_hold' | 'completed';
  archivedAt: string | null;
  openTaskCount: number;
  blockedTaskCount: number;
  overdueDateCount: number;
  nextDate: Omit<ProjectDate, 'project'> | null;
}

interface ProjectDate {
  id: string;
  title: string;
  status: 'planned' | 'active' | 'at_risk' | 'completed';
  targetDate: string;
  project: Pick<ProjectSummary, 'id' | 'publicId' | 'name'>;
}

interface WorkspaceOverviewResponse {
  workspace: WorkspaceSummary;
  summary: {
    activeProjects: number;
    openTasks: number;
    blockedTasks: number;
    overdueDates: number;
    nextUpcomingDate: ProjectDate | null;
  };
  projects: ProjectSummary[];
  projectPageInfo: {
    limit: number;
    offset: number;
    total: number;
    hasNext: boolean;
  };
  dates: ProjectDate[];
}

export function WorkspaceOverviewPage({
  canAccess,
  request,
  user,
}: {
  canAccess: (user: User, action: Action) => boolean;
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
  user: User;
}) {
  const { formatDate, formatNumber, t } = useI18n();
  const workspaceId = useParams().workspaceId!;
  const [workspace, setWorkspace] = useState<WorkspaceSummary>();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [dates, setDates] = useState<ProjectDate[]>([]);
  const [summary, setSummary] = useState<WorkspaceOverviewResponse['summary']>({
    activeProjects: 0,
    openTasks: 0,
    blockedTasks: 0,
    overdueDates: 0,
    nextUpcomingDate: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [projectPageError, setProjectPageError] = useState('');
  const [projectPageInfo, setProjectPageInfo] = useState({
    limit: 20,
    offset: 0,
    total: 0,
    hasNext: false,
  });
  const [projectSearch, setProjectSearch] = useState('');
  const [projectQuery, setProjectQuery] = useState('');
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsLoadingMore, setProjectsLoadingMore] = useState(false);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');
  const loadedWorkspaceId = useRef('');
  const overviewRequestId = useRef(0);

  const load = useCallback(
    async (projectOffset = 0, append = false, query = projectQuery) => {
      const requestId = ++overviewRequestId.current;
      const refreshingLoadedWorkspace = !append && loadedWorkspaceId.current === workspaceId;
      if (append) setProjectsLoadingMore(true);
      else {
        setProjectsLoadingMore(false);
        if (refreshingLoadedWorkspace) setProjectsLoading(true);
        else setLoading(true);
      }
      if (append) setProjectPageError('');
      else setError('');
      if (loadedWorkspaceId.current !== workspaceId) {
        setWorkspace(undefined);
        setProjects([]);
        setDates([]);
      }
      try {
        const result = await request<WorkspaceOverviewResponse>(
          `/workspaces/${workspaceId}/overview?today=${localDate()}&dateLimit=6&projectQuery=${encodeURIComponent(query)}&projectLimit=20&projectOffset=${projectOffset}`,
        );
        if (requestId !== overviewRequestId.current) return;
        setWorkspace(result.workspace);
        setProjects((current) =>
          append
            ? [
                ...current,
                ...result.projects.filter(
                  (project) => !current.some((loaded) => loaded.id === project.id),
                ),
              ]
            : result.projects,
        );
        setProjectPageInfo(result.projectPageInfo);
        setProjectPageError('');
        setDates(result.dates);
        setSummary(result.summary);
        loadedWorkspaceId.current = workspaceId;
      } catch (cause) {
        if (requestId !== overviewRequestId.current) return;
        if (append || refreshingLoadedWorkspace) {
          setProjectPageError(
            cause instanceof Error
              ? cause.message
              : t(
                  append
                    ? 'workspaceOverview.loadMoreError'
                    : 'workspaceOverview.projectSearchError',
                ),
          );
          return;
        }
        setWorkspace(undefined);
        setProjects([]);
        setDates([]);
        setSummary({
          activeProjects: 0,
          openTasks: 0,
          blockedTasks: 0,
          overdueDates: 0,
          nextUpcomingDate: null,
        });
        setProjectPageInfo({ limit: 20, offset: 0, total: 0, hasNext: false });
        setError(cause instanceof Error ? cause.message : t('workspaceOverview.loadError'));
      } finally {
        if (requestId === overviewRequestId.current) {
          if (append) setProjectsLoadingMore(false);
          else if (refreshingLoadedWorkspace) setProjectsLoading(false);
          else setLoading(false);
        }
      }
    },
    [projectQuery, request, t, workspaceId],
  );

  useEffect(() => void load(0, false), [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => setProjectQuery(projectSearch.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [projectSearch]);

  async function submitProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setCreating(true);
    setFormError('');
    try {
      await request(`/workspaces/${workspaceId}/projects`, {
        method: 'POST',
        body: JSON.stringify({
          name: data.get('name'),
          key: data.get('key'),
          description: data.get('description'),
          visibility: data.get('visibility'),
        }),
      });
      form.reset();
      setShowCreateProject(false);
      setProjectSearch('');
      setProjectQuery('');
      await load(0, false, '');
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : t('projects.creationFailed'));
    } finally {
      setCreating(false);
    }
  }

  const activeProjects = useMemo(
    () => projects.filter((project) => !project.archivedAt),
    [projects],
  );
  const upcomingDates = dates;
  const archivedProjects = projects.filter((project) => project.archivedAt);
  const workspaceBase = `/workspaces/${workspaceId}`;

  return (
    <>
      <section className="rounded-2xl border border-slate-800 bg-slate-900/55 p-5 sm:p-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-sky-400">
          {t('workspaceOverview.eyebrow')}
        </p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {workspace?.name ?? t('workspaceOverview.heading')}
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-500">
              {workspace?.description || t('workspaceOverview.description')}
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="quiet">
              <Link to={`${workspaceBase}/data`}>{t('data.library')}</Link>
            </Button>
          </div>
        </div>
      </section>

      {showCreateProject && (
        <form
          aria-label={t('projects.create')}
          className="mt-4 rounded-2xl border border-sky-500/25 bg-slate-900/55 p-5"
          onSubmit={(event) => void submitProject(event)}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{t('projects.create')}</h2>
              <p className="mt-1 text-xs text-slate-500">{t('projects.description')}</p>
            </div>
            <Button
              disabled={creating}
              onClick={() => {
                setShowCreateProject(false);
                setFormError('');
              }}
              type="button"
              variant="quiet"
            >
              {t('common.cancel')}
            </Button>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="text-xs font-medium text-slate-400">
              <FormFieldLabel required>{t('projects.name')}</FormFieldLabel>
              <input
                autoFocus
                className={projectInputClass}
                name="name"
                placeholder="Force characterization"
                required
              />
            </label>
            <label className="text-xs font-medium text-slate-400">
              <FormFieldLabel required>{t('projects.key')}</FormFieldLabel>
              <input className={projectInputClass} name="key" placeholder="FORCE" required />
            </label>
            <label className="text-xs font-medium text-slate-400 sm:col-span-2">
              <FormFieldLabel>{t('projects.descriptionLabel')}</FormFieldLabel>
              <textarea
                className={`${projectInputClass} min-h-20 resize-y py-2`}
                name="description"
                placeholder={t('projects.descriptionPlaceholder')}
              />
            </label>
            <label className="text-xs font-medium text-slate-400 sm:col-span-2">
              <FormFieldLabel required>{t('access.visibility')}</FormFieldLabel>
              <select
                className={projectInputClass}
                defaultValue="workspace"
                name="visibility"
                required
              >
                <option value="workspace">{t('access.workspace')}</option>
                <option value="restricted">{t('access.restricted')}</option>
              </select>
              <span className="mt-1 block text-[11px] font-normal text-slate-500">
                {t('access.createRestrictedHint')}
              </span>
            </label>
          </div>
          {formError && (
            <p aria-live="polite" className="mt-3 text-sm text-rose-300">
              {formError}
            </p>
          )}
          <div className="mt-4 flex justify-end">
            <Button disabled={creating} type="submit">
              {creating ? t('common.working') : t('projects.create')}
            </Button>
          </div>
        </form>
      )}

      {error && (
        <section className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 p-5 text-center">
          <p aria-live="polite" className="text-sm text-rose-200">
            {error}
          </p>
          <Button
            className="mt-3"
            onClick={() => void load(0, false)}
            type="button"
            variant="quiet"
          >
            {t('common.retry')}
          </Button>
        </section>
      )}

      {!error && (
        <section
          aria-label={t('workspaceOverview.summary')}
          aria-busy={loading}
          className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        >
          {[
            [
              t('workspaceOverview.activeProjects'),
              formatNumber(summary.activeProjects),
              'bg-sky-400',
            ],
            [t('workspaceOverview.openTasks'), formatNumber(summary.openTasks), 'bg-amber-400'],
            [
              t('workspaceOverview.blockedTasks'),
              formatNumber(summary.blockedTasks),
              'bg-rose-400',
            ],
            [
              t('workspaceOverview.overdueDates'),
              formatNumber(summary.overdueDates),
              'bg-violet-400',
            ],
          ].map(([label, value, accent]) => (
            <article
              className="relative overflow-hidden rounded-xl border border-slate-800 bg-slate-900/45 px-4 py-3"
              key={label}
            >
              <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${accent}`} />
              <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                {label}
              </p>
              <p className="mt-1 text-2xl font-semibold text-slate-100">{loading ? '—' : value}</p>
            </article>
          ))}
        </section>
      )}

      {!error && (
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <section
            aria-busy={projectsLoading || projectsLoadingMore}
            aria-labelledby="workspace-projects-heading"
            className="rounded-2xl border border-slate-800 bg-slate-900/45 p-5"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold" id="workspace-projects-heading">
                {t('workspaceOverview.projects')}
              </h2>
              {canAccess(user, 'project.create') && !showCreateProject && (
                <Button onClick={() => setShowCreateProject(true)} type="button">
                  <span aria-hidden="true" className="mr-1 text-base leading-none">
                    +
                  </span>
                  {t('projects.create')}
                </Button>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="relative min-w-48 flex-1">
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-2.5 text-slate-600"
                >
                  ⌕
                </span>
                <span className="sr-only">{t('workspaceOverview.searchProjects')}</span>
                <input
                  aria-label={t('workspaceOverview.searchProjects')}
                  className="min-h-9 w-full rounded-lg border border-slate-800 bg-slate-950 py-1.5 pl-8 pr-9 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-sky-400"
                  maxLength={200}
                  onChange={(event) => setProjectSearch(event.target.value)}
                  placeholder={t('workspaceOverview.searchProjectsPlaceholder')}
                  type="search"
                  value={projectSearch}
                />
                {projectSearch && (
                  <span className="absolute right-1 top-1">
                    <IconAction
                      icon="×"
                      label={t('workspaceOverview.clearProjectSearch')}
                      onClick={() => setProjectSearch('')}
                      tooltipAlign="end"
                    />
                  </span>
                )}
              </label>
              <span className="text-[10px] text-slate-500">
                {loading || projectsLoading
                  ? t('common.loading')
                  : t('workspaceOverview.projectResults', {
                      shown: formatNumber(projects.length),
                      total: formatNumber(projectPageInfo.total),
                    })}
              </span>
            </div>
            <div className="mt-3 divide-y divide-slate-800">
              {activeProjects.map((project) => {
                const projectId = project.publicId ?? project.id;
                return (
                  <Link
                    className="flex flex-col gap-2 py-3 hover:text-sky-200 sm:flex-row sm:items-center"
                    key={project.id}
                    to={`${workspaceBase}/projects/${projectId}`}
                  >
                    <span className="min-w-0 sm:flex-1">
                      <strong className="block truncate text-sm text-slate-200">
                        {project.name}
                      </strong>
                    </span>
                    <span className="text-xs text-slate-500">
                      {t('workspaceOverview.taskCount', {
                        count: formatNumber(project.openTaskCount),
                      })}
                      {project.blockedTaskCount
                        ? ` · ${t('workspaceOverview.blockedCount', { count: formatNumber(project.blockedTaskCount) })}`
                        : ''}
                    </span>
                    <span className="text-xs text-slate-500">
                      {project.nextDate
                        ? formatDate(`${project.nextDate.targetDate}T00:00:00`, {
                            month: 'short',
                            day: 'numeric',
                          })
                        : t('workspaceOverview.noUpcomingDate')}
                    </span>
                  </Link>
                );
              })}
              {!loading &&
                activeProjects.length === 0 &&
                (!projectQuery || projects.length === 0) && (
                  <p className="py-8 text-center text-sm text-slate-500">
                    {projectQuery
                      ? t('workspaceOverview.noProjectMatches')
                      : t('workspaceOverview.noProjects')}
                  </p>
                )}
            </div>
            {!loading && archivedProjects.length > 0 && (
              <details className="mt-3 border-t border-slate-800 pt-3">
                <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-300">
                  {t('workspaceOverview.archivedProjects', {
                    count: formatNumber(archivedProjects.length),
                  })}
                </summary>
                <div className="mt-2 divide-y divide-slate-800/70">
                  {archivedProjects.map((project) => (
                    <Link
                      className="flex items-center justify-between gap-3 py-2 text-sm text-slate-500 hover:text-sky-200"
                      key={project.id}
                      to={`${workspaceBase}/projects/${project.publicId ?? project.id}/settings`}
                    >
                      <span className="truncate">{project.name}</span>
                      <span className="text-[10px] text-amber-300">{t('projects.archived')}</span>
                    </Link>
                  ))}
                </div>
              </details>
            )}
            {!loading && projectPageInfo.hasNext && (
              <div className="mt-3 border-t border-slate-800 pt-3 text-center">
                <Button
                  disabled={projectsLoadingMore}
                  onClick={() => void load(projects.length, true)}
                  type="button"
                  variant="quiet"
                >
                  {projectsLoadingMore
                    ? t('common.loading')
                    : t('workspaceOverview.loadMoreProjects', {
                        shown: formatNumber(projects.length),
                        total: formatNumber(projectPageInfo.total),
                      })}
                </Button>
              </div>
            )}
            {projectPageError && (
              <p aria-live="polite" className="mt-2 text-center text-xs text-rose-300">
                {projectPageError}
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900/45 p-5">
            <h2 className="text-lg font-semibold">{t('workspaceOverview.upcomingDates')}</h2>
            {summary.nextUpcomingDate && (
              <p className="mt-1 text-xs text-slate-500">
                {t('workspaceOverview.nextDate', { title: summary.nextUpcomingDate.title })}
              </p>
            )}
            <div className="mt-3 divide-y divide-slate-800">
              {upcomingDates.map((date) => (
                <Link
                  className="flex items-center justify-between gap-3 py-3"
                  key={date.id}
                  to={`${workspaceBase}/projects/${date.project.publicId ?? date.project.id}/milestones`}
                >
                  <span className="min-w-0">
                    <strong className="block truncate text-sm text-slate-200">{date.title}</strong>
                    <span className="block truncate text-[10px] text-slate-600">
                      {date.project.name}
                    </span>
                  </span>
                  <time
                    className={
                      date.targetDate < localDate()
                        ? 'text-xs text-rose-300'
                        : 'text-xs text-slate-400'
                    }
                    dateTime={date.targetDate}
                  >
                    {formatDate(`${date.targetDate}T00:00:00`, {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </time>
                </Link>
              ))}
              {!loading && upcomingDates.length === 0 && (
                <p className="py-8 text-center text-sm text-slate-500">
                  {t('workspaceOverview.noDates')}
                </p>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

const projectInputClass =
  'mt-1 min-h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-sky-400';

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
