import type { Action } from '@engrove/permissions';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import type { User } from './App.js';
import { useI18n } from './i18n.js';

interface WorkspaceSummary {
  id: string;
  publicId?: string;
  name: string;
}

interface ProjectSummary {
  id: string;
  publicId?: string;
  name: string;
  archivedAt: string | null;
}

type Theme = 'light' | 'dark';
type RequestApi = <T>(path: string, init?: RequestInit) => Promise<T>;

export const ServiceSidebarPortalContext = createContext<HTMLElement | null>(null);

export function useServiceSidebarPortal(): HTMLElement | null {
  return useContext(ServiceSidebarPortalContext);
}

export function ServiceShell({
  user,
  theme,
  request,
  can,
  onSignedOut,
  onToggleTheme,
  children,
}: PropsWithChildren<{
  user: User;
  theme: Theme;
  request: RequestApi;
  can: (user: User, action: Action) => boolean;
  onSignedOut: () => void;
  onToggleTheme: () => void;
}>) {
  const { locale, setLocale, t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const workspaceId = location.pathname.match(/^\/workspaces\/([^/]+)/)?.[1];
  const projectId = location.pathname.match(/^\/workspaces\/[^/]+\/projects\/([^/]+)/)?.[1];
  const workspaceBase = workspaceId ? `/workspaces/${workspaceId}` : undefined;
  const projectBase = workspaceBase && projectId ? `${workspaceBase}/projects/${projectId}` : null;
  const inWorkspaceData = Boolean(
    workspaceBase && location.pathname.startsWith(`${workspaceBase}/data`),
  );
  const inProjects = Boolean(
    workspaceBase && location.pathname.startsWith(`${workspaceBase}/projects`),
  );
  const dataWorkspace = /^\/workspaces\/[^/]+\/(?:data|projects\/[^/]+\/data)(?:\/|$)/.test(
    location.pathname,
  );
  const [expanded, setExpanded] = useState(
    () => window.localStorage.getItem('engrove-service-sidebar') !== 'collapsed',
  );
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');

  const loadWorkspaces = useCallback(async () => {
    const result = await request<{ items: WorkspaceSummary[] }>('/workspaces');
    setWorkspaces(result.items);
  }, [request]);
  useEffect(() => void loadWorkspaces(), [loadWorkspaces]);
  useEffect(() => {
    if (!workspaceId) {
      setProjects([]);
      return;
    }
    void request<{ items: ProjectSummary[] }>(`/workspaces/${workspaceId}/projects`).then(
      (result) => setProjects(result.items),
      () => setProjects([]),
    );
  }, [request, workspaceId]);
  useEffect(() => {
    window.localStorage.setItem('engrove-service-sidebar', expanded ? 'expanded' : 'collapsed');
  }, [expanded]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen((current) => !current);
      }
      if (event.key === 'Escape') setCommandOpen(false);
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);

  const workspace = workspaces.find(
    (item) => (item.publicId ?? item.id) === workspaceId || item.id === workspaceId,
  );
  useEffect(() => {
    if (!workspaceId || !workspace?.publicId || workspaceId === workspace.publicId) return;
    navigate(
      {
        pathname: location.pathname.replace(
          `/workspaces/${workspaceId}`,
          `/workspaces/${workspace.publicId}`,
        ),
        search: location.search,
        hash: location.hash,
      },
      { replace: true },
    );
  }, [location.hash, location.pathname, location.search, navigate, workspace, workspaceId]);
  const project = projects.find(
    (item) => (item.publicId ?? item.id) === projectId || item.id === projectId,
  );
  useEffect(() => {
    if (!projectId || !project?.publicId || projectId === project.publicId) return;
    navigate(
      {
        pathname: location.pathname.replace(
          `/projects/${projectId}`,
          `/projects/${project.publicId}`,
        ),
        search: location.search,
        hash: location.hash,
      },
      { replace: true },
    );
  }, [location.hash, location.pathname, location.search, navigate, project, projectId]);
  const utilitySection =
    location.pathname === '/members'
      ? t('common.members')
      : location.pathname === '/audit'
        ? t('common.auditLog')
        : location.pathname === '/get-started'
          ? t('common.getStarted')
          : location.pathname === '/pilot'
            ? t('common.pilotFeedback')
            : t('common.workspaces');
  const sectionLabel =
    project?.name ??
    (inWorkspaceData ? t('common.data') : inProjects ? t('common.projects') : utilitySection);
  const projectLinks = projectBase
    ? [
        { to: projectBase, label: t('common.overview'), icon: '⌂', end: true, visible: true },
        {
          to: `${projectBase}/data`,
          label: t('common.engineeringRecords'),
          icon: '▦',
          end: false,
          visible: can(user, 'record.read'),
        },
        {
          to: `${projectBase}/files-datasets`,
          label: t('common.filesDatasets'),
          icon: '⇪',
          end: false,
          visible: can(user, 'file.read'),
        },
        {
          to: `${projectBase}/visualizations`,
          label: t('common.visualizations'),
          icon: '◫',
          end: false,
          visible: can(user, 'dataset.read'),
        },
        {
          to: `${projectBase}/tasks`,
          label: t('common.tasks'),
          icon: '✓',
          end: false,
          visible: can(user, 'task.read'),
        },
      ].filter((item) => item.visible)
    : [];

  async function signOut() {
    await request('/auth/sign-out', { method: 'POST' });
    onSignedOut();
  }

  const commands: Array<{ label: string; hint: string; run: () => void | Promise<void> }> = [
    {
      label: 'Open workspace data',
      hint: 'Navigation',
      run: () => navigate(workspaceBase ? `${workspaceBase}/data` : '/workspaces'),
    },
    ...(workspaceBase
      ? [
          {
            label: 'Open projects',
            hint: 'Navigation',
            run: () => navigate(`${workspaceBase}/projects`),
          },
        ]
      : []),
    ...projectLinks.map((item) => ({
      label: `Open ${item.label}`,
      hint: project?.name ?? 'Project',
      run: () => navigate(item.to),
    })),
    ...(can(user, 'member.manage')
      ? [{ label: 'Manage members and groups', hint: 'Settings', run: () => navigate('/members') }]
      : []),
    ...(can(user, 'audit.read')
      ? [{ label: 'Open audit log', hint: 'Settings', run: () => navigate('/audit') }]
      : []),
    {
      label: theme === 'dark' ? 'Use light theme' : 'Use dark theme',
      hint: 'Appearance',
      run: onToggleTheme,
    },
    { label: 'Sign out', hint: user.displayName, run: signOut },
  ];
  const visibleCommands = commands.filter((command) =>
    `${command.label} ${command.hint}`.toLowerCase().includes(commandQuery.trim().toLowerCase()),
  );
  function runCommand(command: (typeof commands)[number]) {
    setCommandOpen(false);
    setCommandQuery('');
    void command.run();
  }

  return (
    <ServiceSidebarPortalContext.Provider value={portal}>
      <div className="compact-ui flex min-h-screen flex-col text-slate-100 md:flex-row">
        <a
          className="fixed left-4 top-3 z-[60] -translate-y-20 rounded-lg bg-sky-300 px-3 py-2 font-semibold text-slate-950 focus:translate-y-0"
          href="#main-content"
        >
          {t('sidebar.skip')}
        </a>
        <aside
          aria-label="Service sidebar"
          className={`service-sidebar z-40 flex shrink-0 flex-col border-b border-slate-800 bg-slate-950/95 transition-[width] duration-200 md:sticky md:top-0 md:h-screen md:border-b-0 md:border-r ${expanded ? 'md:w-60' : 'md:w-14'}`}
        >
          <div
            className={`flex h-12 shrink-0 items-center justify-between border-b border-slate-800 ${expanded ? 'px-2' : 'px-0.5'}`}
          >
            <Link
              aria-label={t('sidebar.home')}
              className="flex min-w-0 items-center gap-2.5"
              to={workspaceBase ? `${workspaceBase}/data` : '/workspaces'}
            >
              <img
                alt=""
                className={`shrink-0 ${expanded ? 'size-8' : 'size-7'}`}
                height={expanded ? 32 : 28}
                src="/engrove-mark.png"
                width={expanded ? 32 : 28}
              />
              {expanded && (
                <span className="truncate text-sm font-semibold tracking-tight">Engrove</span>
              )}
            </Link>
            <button
              aria-expanded={expanded}
              aria-label={expanded ? t('sidebar.collapse') : t('sidebar.expand')}
              className={`grid shrink-0 place-items-center rounded text-slate-500 hover:bg-slate-800 hover:text-sky-300 ${expanded ? 'size-7 text-sm' : 'size-5 text-xs'}`}
              onClick={() => setExpanded((value) => !value)}
              type="button"
            >
              <span aria-hidden="true">{expanded ? '«' : '»'}</span>
            </button>
          </div>

          <div className="border-b border-slate-800 p-2">
            {expanded ? (
              <label className="block text-[10px] font-medium uppercase tracking-wider text-slate-500">
                {t('common.workspace')}
                <select
                  aria-label={t('sidebar.selectWorkspace')}
                  className="mt-1 min-h-8 w-full rounded-md border border-slate-700 bg-slate-900 px-2 text-xs font-medium text-slate-200 outline-none focus:border-sky-400"
                  value={workspaceId ?? ''}
                  onChange={(event) =>
                    navigate(
                      event.target.value ? `/workspaces/${event.target.value}/data` : '/workspaces',
                    )
                  }
                >
                  <option value="">{t('sidebar.selectWorkspacePlaceholder')}</option>
                  {workspaces.map((item) => (
                    <option key={item.id} value={item.publicId ?? item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <button
                aria-label={t('sidebar.selectWorkspace')}
                className="grid size-9 w-full place-items-center rounded-md border border-slate-700 bg-slate-900 text-xs font-semibold text-sky-300"
                onClick={() => navigate('/workspaces')}
                title={workspace?.name ?? t('sidebar.selectWorkspace')}
                type="button"
              >
                {workspace?.name.slice(0, 1).toUpperCase() ?? 'W'}
              </button>
            )}
          </div>

          <nav aria-label={t('sidebar.serviceNavigation')} className="space-y-1 p-2">
            {workspaceBase ? (
              <>
                <NavLink
                  aria-label={t('common.data')}
                  className={() =>
                    `flex h-8 items-center gap-2 rounded-md px-2 text-xs font-medium ${inWorkspaceData ? 'bg-sky-400/15 text-sky-300' : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-200'}`
                  }
                  to={`${workspaceBase}/data`}
                >
                  <span aria-hidden="true" className="grid w-5 place-items-center text-sm">
                    ▦
                  </span>
                  {expanded && <span>{t('common.data')}</span>}
                </NavLink>
                <NavLink
                  aria-label={t('common.projects')}
                  className={() =>
                    `flex h-8 items-center gap-2 rounded-md px-2 text-xs font-medium ${inProjects ? 'bg-sky-400/15 text-sky-300' : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-200'}`
                  }
                  to={`${workspaceBase}/projects`}
                >
                  <span aria-hidden="true" className="grid w-5 place-items-center text-sm">
                    ◫
                  </span>
                  {expanded && <span>{t('common.projects')}</span>}
                </NavLink>
              </>
            ) : (
              <>
                <button
                  aria-label={t('common.data')}
                  className="flex h-8 w-full cursor-not-allowed items-center gap-2 rounded-md px-2 text-xs font-medium text-slate-600"
                  disabled
                  title={t('sidebar.selectWorkspaceFirst')}
                  type="button"
                >
                  <span aria-hidden="true" className="grid w-5 place-items-center text-sm">
                    ▦
                  </span>
                  {expanded && <span>{t('common.data')}</span>}
                </button>
                <button
                  aria-label={t('common.projects')}
                  className="flex h-8 w-full cursor-not-allowed items-center gap-2 rounded-md px-2 text-xs font-medium text-slate-600"
                  disabled
                  title={t('sidebar.selectWorkspaceFirst')}
                  type="button"
                >
                  <span aria-hidden="true" className="grid w-5 place-items-center text-sm">
                    ◫
                  </span>
                  {expanded && <span>{t('common.projects')}</span>}
                </button>
              </>
            )}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto border-t border-slate-800">
            <div className={expanded ? undefined : 'hidden'} ref={setPortal} />
            {expanded && inProjects && (
              <div className="p-2">
                <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">
                  {t('common.projects')}
                </p>
                <div className="space-y-0.5">
                  {projects.map((item) => (
                    <NavLink
                      className={({ isActive }) =>
                        `block truncate rounded-md px-2 py-1.5 text-xs ${isActive ? 'bg-slate-800 font-medium text-slate-100' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'}`
                      }
                      key={item.id}
                      to={`${workspaceBase}/projects/${item.publicId ?? item.id}`}
                    >
                      {item.name}
                    </NavLink>
                  ))}
                </div>
                {projectBase && (
                  <nav
                    aria-label={t('sidebar.projectNavigation')}
                    className="mt-2 border-t border-slate-800 pt-2"
                  >
                    <p className="truncate px-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-sky-400">
                      {project?.name ?? t('common.project')}
                    </p>
                    {projectLinks.map((item) => (
                      <NavLink
                        aria-label={item.label}
                        className={({ isActive }) =>
                          `flex items-center gap-2 rounded-md px-2 py-1.5 text-xs ${isActive ? 'bg-sky-400/15 text-sky-300' : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-200'}`
                        }
                        end={item.end}
                        key={item.to}
                        to={item.to}
                      >
                        <span aria-hidden="true" className="grid w-4 place-items-center">
                          {item.icon}
                        </span>
                        <span className="truncate">{item.label}</span>
                      </NavLink>
                    ))}
                  </nav>
                )}
              </div>
            )}
          </div>

          <div className="shrink-0 space-y-1 border-t border-slate-800 p-2">
            {expanded ? (
              <>
                <details>
                  <summary className="flex h-8 cursor-pointer list-none items-center gap-2 rounded-md px-2 text-xs text-slate-400 marker:content-none hover:bg-slate-800 hover:text-slate-200">
                    <span aria-hidden="true">?</span> {t('sidebar.help')}
                  </summary>
                  <div className="ml-5 grid gap-0.5 border-l border-slate-800 pl-2">
                    <Link
                      className="rounded px-2 py-1 text-xs text-slate-500 hover:text-sky-300"
                      to="/get-started"
                    >
                      {t('common.getStarted')}
                    </Link>
                    <Link
                      className="rounded px-2 py-1 text-xs text-slate-500 hover:text-sky-300"
                      to="/pilot"
                    >
                      {t('common.pilotFeedback')}
                    </Link>
                  </div>
                </details>
                {(can(user, 'member.manage') || can(user, 'audit.read')) && (
                  <details>
                    <summary className="flex h-8 cursor-pointer list-none items-center gap-2 rounded-md px-2 text-xs text-slate-400 marker:content-none hover:bg-slate-800 hover:text-slate-200">
                      <span aria-hidden="true">⚙</span> {t('sidebar.settings')}
                    </summary>
                    <div className="ml-5 grid gap-0.5 border-l border-slate-800 pl-2">
                      {can(user, 'member.manage') && (
                        <Link
                          className="rounded px-2 py-1 text-xs text-slate-500 hover:text-sky-300"
                          to="/members"
                        >
                          {t('common.members')}
                        </Link>
                      )}
                      {can(user, 'audit.read') && (
                        <Link
                          className="rounded px-2 py-1 text-xs text-slate-500 hover:text-sky-300"
                          to="/audit"
                        >
                          {t('common.auditLog')}
                        </Link>
                      )}
                    </div>
                  </details>
                )}
                <details>
                  <summary
                    aria-label={t('sidebar.openUserMenu')}
                    className="flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-md px-2 marker:content-none hover:bg-slate-800"
                    role="button"
                  >
                    <span className="grid size-7 shrink-0 place-items-center rounded-full border border-slate-700 bg-slate-800 text-xs font-semibold text-sky-300">
                      {user.displayName.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium text-slate-200">
                        {user.displayName}
                      </span>
                      <span className="block text-[10px] uppercase tracking-wider text-slate-500">
                        {user.role}
                      </span>
                    </span>
                  </summary>
                  <div className="mt-1 grid gap-0.5 rounded-md border border-slate-800 bg-slate-900 p-1">
                    <label className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">
                      {t('language.label')}
                      <select
                        aria-label={t('language.label')}
                        className="sidebar-utility-action mt-1 min-h-7 w-full rounded border border-slate-700 bg-slate-950 px-2 normal-case tracking-normal text-slate-300"
                        value={locale}
                        onChange={(event) => setLocale(event.target.value as 'en' | 'ko')}
                      >
                        <option value="en">{t('language.english')}</option>
                        <option value="ko">{t('language.korean')}</option>
                      </select>
                    </label>
                    <button
                      aria-label={t('sidebar.switchTheme', {
                        theme: t(theme === 'dark' ? 'theme.light' : 'theme.dark'),
                      })}
                      className="sidebar-utility-action min-h-7 rounded px-2 py-1 text-left text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                      onClick={onToggleTheme}
                      type="button"
                    >
                      {theme === 'dark' ? t('sidebar.useLightTheme') : t('sidebar.useDarkTheme')}
                    </button>
                    <button
                      aria-label={t('sidebar.signOut')}
                      className="sidebar-utility-action min-h-7 rounded px-2 py-1 text-left text-rose-300 hover:bg-rose-500/10"
                      onClick={() => void signOut()}
                      type="button"
                    >
                      {t('sidebar.signOut')}
                    </button>
                  </div>
                </details>
              </>
            ) : (
              <button
                aria-label={t('sidebar.expandUserMenu')}
                className="grid size-9 w-full place-items-center rounded-md hover:bg-slate-800"
                onClick={() => setExpanded(true)}
                type="button"
              >
                <span className="grid size-7 place-items-center rounded-full border border-slate-700 bg-slate-800 text-xs font-semibold text-sky-300">
                  {user.displayName.slice(0, 1).toUpperCase()}
                </span>
              </button>
            )}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-11 shrink-0 items-center gap-3 border-b border-slate-800/80 bg-slate-950/90 px-3 backdrop-blur-xl">
            <p className="min-w-0 truncate text-xs text-slate-500">
              <span>{workspace?.name ?? t('sidebar.organization')}</span>
              <span className="mx-2 text-slate-700">/</span>
              <strong className="font-medium text-slate-300">{sectionLabel}</strong>
            </p>
            <button
              aria-label="Open command palette"
              className="ml-auto flex h-7 items-center gap-2 rounded-md border border-slate-800 bg-slate-900 px-2 text-[11px] text-slate-500 hover:border-slate-700 hover:text-sky-300"
              onClick={() => setCommandOpen(true)}
              type="button"
            >
              <span>Search commands</span>
              <kbd className="rounded border border-slate-700 px-1 font-mono text-[9px]">⌘K</kbd>
            </button>
          </header>
          <main
            className={`compact-page mx-auto w-full min-w-0 flex-1 ${dataWorkspace ? 'max-w-none px-2 py-2' : 'max-w-[1440px] px-4 py-4'}`}
            id="main-content"
          >
            {children}
          </main>
        </div>
        {commandOpen && (
          <div className="fixed inset-0 z-[90] flex justify-center bg-slate-950/70 px-4 pt-[12vh] backdrop-blur-sm">
            <button
              aria-label="Close command palette"
              className="absolute inset-0 cursor-default"
              onClick={() => setCommandOpen(false)}
              type="button"
            />
            <section
              aria-label="Command palette"
              aria-modal="true"
              className="relative h-fit w-full max-w-xl overflow-hidden rounded-xl border border-slate-700 bg-slate-950 shadow-2xl"
              role="dialog"
            >
              <input
                aria-label="Search commands"
                autoFocus
                className="h-12 w-full border-b border-slate-800 bg-transparent px-4 text-sm text-slate-100 outline-none placeholder:text-slate-600"
                placeholder="Go to a table, dashboard, member setting…"
                type="search"
                value={commandQuery}
                onChange={(event) => setCommandQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && visibleCommands[0]) runCommand(visibleCommands[0]);
                }}
              />
              <div className="max-h-80 overflow-y-auto p-2">
                {visibleCommands.map((command) => (
                  <button
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm text-slate-300 hover:bg-sky-400/10 hover:text-sky-200"
                    key={`${command.hint}:${command.label}`}
                    onClick={() => runCommand(command)}
                    type="button"
                  >
                    <span>{command.label}</span>
                    <span className="text-[10px] text-slate-600">{command.hint}</span>
                  </button>
                ))}
                {!visibleCommands.length && (
                  <p className="px-3 py-8 text-center text-xs text-slate-500">
                    No matching command.
                  </p>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </ServiceSidebarPortalContext.Provider>
  );
}
