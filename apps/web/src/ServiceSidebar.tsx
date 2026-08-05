import type { Action } from '@engrove/permissions';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import type { User } from './App.js';
import { BrandMark } from './BrandMark.js';
import { useI18n } from './i18n.js';
import { useModalDialog } from './useModalDialog.js';

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

function ServiceIcon({ name }: { name: 'data' | 'help' | 'projects' | 'settings' }) {
  return (
    <svg
      aria-hidden="true"
      className="size-4 shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      {name === 'data' && (
        <>
          <rect height="16" rx="2.5" width="16" x="4" y="4" />
          <path d="M4 9h16M9 4v16" />
        </>
      )}
      {name === 'projects' && (
        <>
          <path d="M3.5 7.5h6l2-2h9v13a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
          <path d="M3.5 10h17" />
        </>
      )}
      {name === 'help' && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.8 9a2.4 2.4 0 1 1 3.3 2.2c-.8.4-1.1.9-1.1 1.8M12 16.8h.01" />
        </>
      )}
      {name === 'settings' && (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
        </>
      )}
    </svg>
  );
}

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
  const inWorkspaceTable = /^\/workspaces\/[^/]+\/[mt][0-9a-z]{14}(?:\/|$)/.test(location.pathname);
  const inWorkspaceData = Boolean(
    workspaceBase && (location.pathname.startsWith(`${workspaceBase}/data`) || inWorkspaceTable),
  );
  const inProjects = Boolean(
    workspaceBase && location.pathname.startsWith(`${workspaceBase}/projects`),
  );
  const dataWorkspace =
    inWorkspaceTable ||
    /^\/workspaces\/[^/]+\/(?:data|projects\/[^/]+\/data)(?:\/|$)/.test(location.pathname);
  const [expanded, setExpanded] = useState(
    () => window.localStorage.getItem('engrove-service-sidebar') !== 'collapsed',
  );
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceLoadError, setWorkspaceLoadError] = useState('');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [commandIndex, setCommandIndex] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const commandButtonRef = useRef<HTMLButtonElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const closeCommands = useCallback(() => {
    setCommandOpen(false);
    setCommandQuery('');
    setCommandIndex(0);
  }, []);
  const mobileSidebarRef = useModalDialog<HTMLElement>(
    mobileOpen && isMobile,
    closeMobile,
    mobileMenuButtonRef,
  );
  const commandDialogRef = useModalDialog<HTMLElement>(
    commandOpen,
    closeCommands,
    commandButtonRef,
  );
  const settingsDialogRef = useModalDialog<HTMLElement>(
    settingsOpen,
    () => setSettingsOpen(false),
    settingsButtonRef,
  );

  const loadWorkspaces = useCallback(async () => {
    setWorkspaceLoading(true);
    try {
      const result = await request<{ items: WorkspaceSummary[] }>('/workspaces');
      setWorkspaces(result.items);
      setWorkspaceLoadError('');
    } catch {
      setWorkspaceLoadError(t('sidebar.workspacesUnavailable'));
    } finally {
      setWorkspaceLoading(false);
    }
  }, [request, t]);
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
    if (!window.matchMedia) return;
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen((current) => !current);
      }
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
  useEffect(() => {
    document.title = `${sectionLabel} · Engrove`;
  }, [sectionLabel]);
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
          to: `${projectBase}/milestones`,
          label: t('milestones.nav'),
          icon: '◆',
          end: false,
          visible: true,
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
      label: t('command.openWorkspaceData'),
      hint: t('command.navigation'),
      run: () => navigate(workspaceBase ? `${workspaceBase}/data` : '/workspaces'),
    },
    ...(workspaceBase
      ? [
          {
            label: t('command.openProjects'),
            hint: t('command.navigation'),
            run: () => navigate(`${workspaceBase}/projects`),
          },
        ]
      : []),
    ...projectLinks.map((item) => ({
      label: t('command.openSection', { section: item.label }),
      hint: project?.name ?? t('common.project'),
      run: () => navigate(item.to),
    })),
    ...(can(user, 'member.manage')
      ? [
          {
            label: t('command.manageMembers'),
            hint: t('command.settings'),
            run: () => navigate('/members'),
          },
        ]
      : []),
    ...(can(user, 'audit.read')
      ? [
          {
            label: t('command.openAudit'),
            hint: t('command.settings'),
            run: () => navigate('/audit'),
          },
        ]
      : []),
    {
      label: theme === 'dark' ? t('sidebar.useLightTheme') : t('sidebar.useDarkTheme'),
      hint: t('command.appearance'),
      run: onToggleTheme,
    },
    { label: t('sidebar.signOut'), hint: user.displayName, run: signOut },
  ];
  const visibleCommands = commands.filter((command) =>
    `${command.label} ${command.hint}`.toLowerCase().includes(commandQuery.trim().toLowerCase()),
  );
  useEffect(() => {
    setCommandIndex(0);
  }, [commandQuery, commandOpen]);
  const safeCommandIndex = Math.min(commandIndex, Math.max(visibleCommands.length - 1, 0));
  function runCommand(command: (typeof commands)[number]) {
    closeCommands();
    void command.run();
  }
  function openSettings() {
    setSettingsOpen(true);
    if (isMobile) setMobileOpen(false);
  }
  const sidebarExpanded = expanded || isMobile;

  return (
    <ServiceSidebarPortalContext.Provider value={portal}>
      <div className="compact-ui flex min-h-screen flex-col text-slate-100 md:flex-row">
        <a
          className="skip-link fixed left-4 top-3 z-[60] rounded-lg bg-sky-300 px-3 py-2 font-semibold text-slate-950"
          href="#main-content"
        >
          {t('sidebar.skip')}
        </a>
        {mobileOpen && (
          <button
            aria-label={t('sidebar.closeMenu')}
            className="fixed inset-0 z-30 cursor-default bg-slate-950/70 backdrop-blur-sm md:hidden"
            data-modal-backdrop
            onClick={closeMobile}
            type="button"
          />
        )}
        <aside
          aria-label={t('sidebar.label')}
          aria-modal={isMobile && mobileOpen ? 'true' : undefined}
          className={`service-sidebar fixed inset-y-0 left-0 z-40 flex w-72 shrink-0 flex-col border-r border-slate-800 bg-slate-950/95 transition-[transform,width] duration-200 md:sticky md:top-0 md:h-screen md:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} ${expanded ? 'md:w-64' : 'md:w-16'}`}
          ref={mobileSidebarRef}
          role={isMobile && mobileOpen ? 'dialog' : undefined}
          tabIndex={isMobile && mobileOpen ? -1 : undefined}
          id="service-navigation-drawer"
        >
          <div
            className={`flex h-14 shrink-0 items-center justify-between border-b border-slate-800 ${sidebarExpanded ? 'px-3' : 'px-1.5'}`}
          >
            <Link aria-label={t('sidebar.home')} className="flex min-w-0 items-center gap-3" to="/">
              <BrandMark
                className={`shrink-0 ${sidebarExpanded ? 'size-8' : 'size-7'}`}
                variant="auto"
              />
              {sidebarExpanded && (
                <span className="truncate text-sm font-semibold tracking-tight">Engrove</span>
              )}
            </Link>
            <button
              aria-expanded={expanded}
              aria-label={expanded ? t('sidebar.collapse') : t('sidebar.expand')}
              className={`hidden shrink-0 place-items-center rounded text-slate-500 hover:bg-slate-800 hover:text-sky-300 md:grid ${expanded ? 'size-7 text-sm' : 'size-5 text-xs'}`}
              onClick={() => setExpanded((value) => !value)}
              type="button"
            >
              <span aria-hidden="true">{expanded ? '«' : '»'}</span>
            </button>
          </div>

          <div className="border-b border-slate-800 p-2">
            {sidebarExpanded ? (
              <div>
                <label className="block text-[10px] font-medium uppercase tracking-wider text-slate-500">
                  {t('common.workspace')}
                  <select
                    aria-label={t('sidebar.selectWorkspace')}
                    className="mt-1 min-h-8 w-full rounded-md border border-slate-700 bg-slate-900 px-2 text-xs font-medium text-slate-200 outline-none focus:border-sky-400"
                    value={workspaceId ?? ''}
                    onChange={(event) =>
                      navigate(
                        event.target.value
                          ? `/workspaces/${event.target.value}/data`
                          : '/workspaces',
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
                {workspaceLoading && (
                  <span className="mt-1 block text-[10px] font-normal normal-case tracking-normal text-slate-500">
                    {t('common.loading')}
                  </span>
                )}
                {workspaceLoadError && (
                  <span className="mt-1 flex items-center justify-between gap-2 text-[10px] font-normal normal-case tracking-normal text-amber-300">
                    <span>{workspaceLoadError}</span>
                    <button
                      className="rounded px-1.5 py-1 text-sky-300 hover:bg-slate-800"
                      onClick={(event) => {
                        event.preventDefault();
                        void loadWorkspaces();
                      }}
                      type="button"
                    >
                      {t('common.retry')}
                    </button>
                  </span>
                )}
              </div>
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
                    `flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-xs font-medium ${inWorkspaceData ? 'bg-sky-400/15 text-sky-300 shadow-sm' : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-200'}`
                  }
                  to={`${workspaceBase}/data`}
                >
                  <ServiceIcon name="data" />
                  {sidebarExpanded && <span>{t('common.data')}</span>}
                </NavLink>
                <NavLink
                  aria-label={t('common.projects')}
                  className={() =>
                    `flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-xs font-medium ${inProjects ? 'bg-sky-400/15 text-sky-300 shadow-sm' : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-200'}`
                  }
                  to={`${workspaceBase}/projects`}
                >
                  <ServiceIcon name="projects" />
                  {sidebarExpanded && <span>{t('common.projects')}</span>}
                </NavLink>
              </>
            ) : (
              <>
                <button
                  aria-label={t('common.data')}
                  className="flex h-9 w-full cursor-not-allowed items-center gap-2.5 rounded-lg px-2.5 text-xs font-medium text-slate-600"
                  disabled
                  title={t('sidebar.selectWorkspaceFirst')}
                  type="button"
                >
                  <ServiceIcon name="data" />
                  {sidebarExpanded && <span>{t('common.data')}</span>}
                </button>
                <button
                  aria-label={t('common.projects')}
                  className="flex h-9 w-full cursor-not-allowed items-center gap-2.5 rounded-lg px-2.5 text-xs font-medium text-slate-600"
                  disabled
                  title={t('sidebar.selectWorkspaceFirst')}
                  type="button"
                >
                  <ServiceIcon name="projects" />
                  {sidebarExpanded && <span>{t('common.projects')}</span>}
                </button>
              </>
            )}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto border-t border-slate-800">
            <div className={sidebarExpanded ? undefined : 'hidden'} ref={setPortal} />
            {sidebarExpanded && inProjects && (
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
            {sidebarExpanded ? (
              <>
                <details>
                  <summary className="flex h-9 cursor-pointer list-none items-center gap-2.5 rounded-lg px-2.5 text-xs text-slate-400 marker:content-none hover:bg-slate-800 hover:text-slate-200">
                    <ServiceIcon name="help" /> {t('sidebar.help')}
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
                <button
                  aria-haspopup="dialog"
                  className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  onClick={openSettings}
                  ref={settingsButtonRef}
                  type="button"
                >
                  <ServiceIcon name="settings" /> {t('sidebar.settings')}
                </button>
                <div className="flex min-h-9 items-center gap-2 border-t border-slate-800/80 px-2 pt-2">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full border border-slate-700 bg-slate-800 text-xs font-semibold text-sky-300">
                    {user.displayName.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium text-slate-200">
                      {user.displayName}
                    </span>
                    <span className="block truncate text-[10px] text-slate-500">{user.email}</span>
                  </span>
                </div>
              </>
            ) : (
              <button
                aria-label={t('sidebar.settings')}
                aria-haspopup="dialog"
                className="grid size-9 w-full place-items-center rounded-md hover:bg-slate-800"
                onClick={openSettings}
                ref={settingsButtonRef}
                type="button"
              >
                <ServiceIcon name="settings" />
              </button>
            )}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="app-header sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-slate-800/80 bg-slate-950/90 px-4 backdrop-blur-xl">
            <button
              aria-controls="service-navigation-drawer"
              aria-expanded={mobileOpen}
              aria-label={t('sidebar.openMenu')}
              className="grid size-8 shrink-0 place-items-center rounded-md border border-slate-800 text-lg text-slate-400 hover:bg-slate-800 hover:text-sky-300 md:hidden"
              onClick={() => setMobileOpen(true)}
              ref={mobileMenuButtonRef}
              type="button"
            >
              <span aria-hidden="true">☰</span>
            </button>
            <p className="min-w-0 truncate text-sm text-slate-500">
              <span>{workspace?.name ?? t('sidebar.organization')}</span>
              <span className="mx-2 text-slate-700">/</span>
              <strong className="font-medium text-slate-300">{sectionLabel}</strong>
            </p>
            <button
              aria-label={t('command.open')}
              className="ml-auto flex h-9 items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/90 px-3 text-xs text-slate-500 shadow-sm hover:border-slate-700 hover:text-sky-300"
              onClick={() => setCommandOpen(true)}
              ref={commandButtonRef}
              type="button"
            >
              <span className="hidden sm:inline">{t('command.search')}</span>
              <kbd className="rounded border border-slate-700 px-1 font-mono text-[9px]">⌘K</kbd>
            </button>
          </header>
          <main
            className={`compact-page mx-auto w-full min-w-0 flex-1 ${dataWorkspace ? 'max-w-none px-3 py-3' : 'max-w-[1500px] px-4 py-4 lg:px-5'}`}
            id="main-content"
          >
            <p aria-live="polite" className="sr-only">
              {sectionLabel}
            </p>
            {children}
          </main>
        </div>
        {settingsOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
            <button
              aria-label={t('settings.close')}
              className="absolute inset-0 cursor-default bg-slate-950/70 backdrop-blur-sm"
              data-modal-backdrop
              onClick={() => setSettingsOpen(false)}
              type="button"
            />
            <section
              aria-labelledby="service-settings-title"
              aria-modal="true"
              className="relative w-full max-w-md overflow-hidden rounded-xl border border-slate-700 bg-slate-950 shadow-2xl shadow-black/40"
              ref={settingsDialogRef}
              role="dialog"
              tabIndex={-1}
            >
              <header className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-sky-400">
                    {t('settings.preferences')}
                  </p>
                  <h2 className="mt-1 text-lg font-semibold" id="service-settings-title">
                    {t('sidebar.settings')}
                  </h2>
                </div>
                <button
                  aria-label={t('settings.close')}
                  className="grid size-8 place-items-center rounded-lg text-lg text-slate-500 hover:bg-slate-800 hover:text-slate-100"
                  onClick={() => setSettingsOpen(false)}
                  type="button"
                >
                  ×
                </button>
              </header>

              <div className="grid gap-5 p-5">
                <div className="grid grid-cols-[minmax(0,1fr)_9rem] items-center gap-4">
                  <div>
                    <label
                      className="text-sm font-medium text-slate-200"
                      htmlFor="settings-language"
                    >
                      {t('language.label')}
                    </label>
                    <p className="mt-0.5 text-xs text-slate-500">{t('settings.languageHelp')}</p>
                  </div>
                  <select
                    className="min-h-9 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-200 outline-none focus:border-sky-400"
                    data-dialog-initial-focus
                    id="settings-language"
                    value={locale}
                    onChange={(event) => setLocale(event.target.value as 'en' | 'ko')}
                  >
                    <option value="en">{t('language.english')}</option>
                    <option value="ko">{t('language.korean')}</option>
                  </select>
                </div>

                <div className="grid grid-cols-[minmax(0,1fr)_9rem] items-center gap-4 border-t border-slate-800 pt-5">
                  <div>
                    <span className="text-sm font-medium text-slate-200">
                      {t('settings.theme')}
                    </span>
                    <p className="mt-0.5 text-xs text-slate-500">{t('settings.themeHelp')}</p>
                  </div>
                  <div className="grid grid-cols-2 rounded-lg border border-slate-700 bg-slate-900 p-1">
                    {(['light', 'dark'] as const).map((option) => (
                      <button
                        aria-pressed={theme === option}
                        className={`rounded-md px-2 py-1.5 text-xs font-medium ${theme === option ? 'bg-sky-400/15 text-sky-300' : 'text-slate-500 hover:text-slate-200'}`}
                        key={option}
                        onClick={() => {
                          if (theme !== option) onToggleTheme();
                        }}
                        type="button"
                      >
                        {t(`theme.${option}`)}
                      </button>
                    ))}
                  </div>
                </div>

                {(can(user, 'member.manage') || can(user, 'audit.read')) && (
                  <div className="border-t border-slate-800 pt-5">
                    <p className="text-sm font-medium text-slate-200">
                      {t('settings.organization')}
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {can(user, 'member.manage') && (
                        <Link
                          className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-400 hover:border-slate-700 hover:text-sky-300"
                          onClick={() => setSettingsOpen(false)}
                          to="/members"
                        >
                          {t('common.members')} →
                        </Link>
                      )}
                      {can(user, 'audit.read') && (
                        <Link
                          className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-400 hover:border-slate-700 hover:text-sky-300"
                          onClick={() => setSettingsOpen(false)}
                          to="/audit"
                        >
                          {t('common.auditLog')} →
                        </Link>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3 border-t border-slate-800 pt-5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full border border-slate-700 bg-slate-800 text-sm font-semibold text-sky-300">
                    {user.displayName.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-sm font-medium text-slate-200">
                      {user.displayName}
                    </strong>
                    <span className="block truncate text-xs text-slate-500">{user.email}</span>
                  </span>
                  <button
                    className="rounded-lg px-3 py-2 text-xs font-medium text-rose-300 hover:bg-rose-500/10"
                    onClick={() => void signOut()}
                    type="button"
                  >
                    {t('sidebar.signOut')}
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}
        {commandOpen && (
          <div className="fixed inset-0 z-[90] flex justify-center bg-slate-950/70 px-4 pt-[12vh] backdrop-blur-sm">
            <button
              aria-label={t('command.close')}
              className="absolute inset-0 cursor-default"
              data-modal-backdrop
              onClick={() => setCommandOpen(false)}
              type="button"
            />
            <section
              aria-label={t('command.label')}
              aria-modal="true"
              className="relative h-fit w-full max-w-xl overflow-hidden rounded-xl border border-slate-700 bg-slate-950 shadow-2xl"
              role="dialog"
              ref={commandDialogRef}
              tabIndex={-1}
            >
              <input
                aria-activedescendant={
                  visibleCommands.length ? `command-option-${safeCommandIndex}` : undefined
                }
                aria-controls="command-results"
                aria-expanded="true"
                aria-label={t('command.search')}
                data-dialog-initial-focus
                className="h-12 w-full border-b border-slate-800 bg-transparent px-4 text-sm text-slate-100 outline-none placeholder:text-slate-600"
                placeholder={t('command.placeholder')}
                type="search"
                value={commandQuery}
                onChange={(event) => setCommandQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setCommandIndex((current) =>
                      visibleCommands.length ? (current + 1) % visibleCommands.length : 0,
                    );
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    setCommandIndex((current) =>
                      visibleCommands.length
                        ? (current - 1 + visibleCommands.length) % visibleCommands.length
                        : 0,
                    );
                  }
                  if (event.key === 'Enter' && visibleCommands[safeCommandIndex]) {
                    event.preventDefault();
                    runCommand(visibleCommands[safeCommandIndex]);
                  }
                }}
              />
              <div className="max-h-80 overflow-y-auto p-2" id="command-results">
                {visibleCommands.map((command, index) => (
                  <button
                    aria-current={index === safeCommandIndex ? 'true' : undefined}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm ${index === safeCommandIndex ? 'bg-sky-400/10 text-sky-200' : 'text-slate-300 hover:bg-slate-800 hover:text-slate-100'}`}
                    id={`command-option-${index}`}
                    key={`${command.hint}:${command.label}`}
                    onClick={() => runCommand(command)}
                    onMouseEnter={() => setCommandIndex(index)}
                    type="button"
                  >
                    <span>{command.label}</span>
                    <span className="text-[10px] text-slate-600">{command.hint}</span>
                  </button>
                ))}
                {!visibleCommands.length && (
                  <p className="px-3 py-8 text-center text-xs text-slate-500">
                    {t('command.noMatch')}
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
