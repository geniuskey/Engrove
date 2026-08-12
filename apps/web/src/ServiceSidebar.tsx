import type { Action } from '@engrove/permissions';
import {
  createContext,
  type FormEvent,
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
import { FormFieldLabel } from './FormFieldLabel.js';
import { NotificationCenter } from './NotificationCenter.js';
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
  key?: string;
  archivedAt: string | null;
}

interface WorkspaceSearchItem {
  type: 'project' | 'task' | 'milestone' | 'table';
  id: string;
  publicId: string | null;
  title: string;
  key: string;
  projectPublicId: string | null;
  projectName: string | null;
  workspaceShared: boolean;
}

interface WorkspaceSearchResponse {
  items: WorkspaceSearchItem[];
  pageInfo: { limit: number; total: number; hasMore: boolean };
}

interface PaletteCommand {
  label: string;
  hint: string;
  icon?: string;
  source: 'command' | 'search';
  run: () => void | Promise<void>;
}

interface OwnMemberGroup {
  id: string;
  name: string;
  description: string;
  color: 'slate' | 'sky' | 'emerald' | 'amber' | 'rose' | 'violet';
}

interface ApiTokenSummary {
  id: string;
  name: string;
  tokenPrefix: string;
  accessLevel: 'read' | 'write';
  scopes: Array<'workspace' | 'project' | 'data' | 'tasks' | 'schedule' | 'reviews'>;
  workspaceId: string | null;
  workspaceName: string | null;
  expiresAt: string;
  lastUsedAt: string | null;
  createdAt: string;
}

interface IssuedApiToken extends ApiTokenSummary {
  token: string;
}

interface NotificationPreferences {
  autoWatchCreated: boolean;
  autoWatchCommented: boolean;
  notifyAssigned: boolean;
  notifyMentioned: boolean;
  notifyTaskActivity: boolean;
  notifyDueDates: boolean;
  dueReminderDays: 0 | 1 | 3 | 7;
}

const memberGroupColors: Record<OwnMemberGroup['color'], string> = {
  slate: '#94a3b8',
  sky: '#38bdf8',
  emerald: '#34d399',
  amber: '#fbbf24',
  rose: '#fb7185',
  violet: '#a78bfa',
};

type Theme = 'light' | 'dark';
type RequestApi = <T>(path: string, init?: RequestInit) => Promise<T>;

function ServiceIcon({ name }: { name: 'data' | 'help' | 'overview' | 'settings' | 'work' }) {
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
      {name === 'overview' && (
        <>
          <rect height="7" rx="2" width="7" x="3" y="3" />
          <rect height="7" rx="2" width="7" x="14" y="3" />
          <rect height="7" rx="2" width="7" x="3" y="14" />
          <rect height="7" rx="2" width="7" x="14" y="14" />
        </>
      )}
      {name === 'work' && (
        <>
          <path d="M9 11.5 11 14l4.5-5" />
          <rect height="17" rx="2.5" width="15" x="4.5" y="3.5" />
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

function ProjectPickerOption({
  current,
  item,
  onSelect,
}: {
  current: boolean;
  item: ProjectSummary;
  onSelect: (projectId: string) => void;
}) {
  return (
    <button
      aria-selected={current}
      className={`flex min-h-8 w-full items-center rounded-md px-2 text-left text-xs hover:bg-slate-800 ${current ? 'bg-sky-400/10 text-sky-300' : 'text-slate-300'}`}
      onClick={() => onSelect(item.publicId ?? item.id)}
      role="option"
      type="button"
    >
      <span className="truncate">{item.name}</span>
    </button>
  );
}

function WorkspacePickerOption({
  current,
  item,
  onSelect,
}: {
  current: boolean;
  item: WorkspaceSummary;
  onSelect: (workspaceId: string) => void;
}) {
  return (
    <button
      aria-selected={current}
      className={`flex min-h-8 w-full items-center rounded-md px-2 text-left text-xs hover:bg-slate-800 ${current ? 'bg-sky-400/10 text-sky-300' : 'text-slate-300'}`}
      onClick={() => onSelect(item.publicId ?? item.id)}
      role="option"
      type="button"
    >
      <span className="truncate">{item.name}</span>
    </button>
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
  const inWorkspaceOverview = Boolean(workspaceBase && location.pathname === workspaceBase);
  const inMyWork = Boolean(
    workspaceBase && location.pathname.startsWith(`${workspaceBase}/my-work`),
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
  const [currentWorkspace, setCurrentWorkspace] = useState<WorkspaceSummary>();
  const [workspacePickerItems, setWorkspacePickerItems] = useState<WorkspaceSummary[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceLoadError, setWorkspaceLoadError] = useState('');
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const [workspaceQuery, setWorkspaceQuery] = useState('');
  const [workspaceSearchHasMore, setWorkspaceSearchHasMore] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [currentProject, setCurrentProject] = useState<ProjectSummary>();
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsLoadError, setProjectsLoadError] = useState('');
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [projectQuery, setProjectQuery] = useState('');
  const [projectSearchHasMore, setProjectSearchHasMore] = useState(false);
  const [recentProjectIds, setRecentProjectIds] = useState<string[]>([]);
  const [ownGroups, setOwnGroups] = useState<OwnMemberGroup[]>([]);
  const [ownGroupsLoading, setOwnGroupsLoading] = useState(false);
  const [ownGroupsError, setOwnGroupsError] = useState('');
  const [apiTokens, setApiTokens] = useState<ApiTokenSummary[]>([]);
  const [apiTokensOpen, setApiTokensOpen] = useState(false);
  const [apiTokensLoading, setApiTokensLoading] = useState(false);
  const [apiTokensError, setApiTokensError] = useState('');
  const [apiTokenBusy, setApiTokenBusy] = useState(false);
  const [issuedApiToken, setIssuedApiToken] = useState<IssuedApiToken>();
  const [apiTokenCopied, setApiTokenCopied] = useState(false);
  const [apiTokenScopeCount, setApiTokenScopeCount] = useState(0);
  const [confirmRevokeTokenId, setConfirmRevokeTokenId] = useState('');
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [commandIndex, setCommandIndex] = useState(0);
  const [commandSearchItems, setCommandSearchItems] = useState<WorkspaceSearchItem[]>([]);
  const [commandSearchLoading, setCommandSearchLoading] = useState(false);
  const [commandSearchError, setCommandSearchError] = useState('');
  const [commandSearchHasMore, setCommandSearchHasMore] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferences>();
  const [notificationPreferencesLoading, setNotificationPreferencesLoading] = useState(false);
  const [notificationPreferencesSaving, setNotificationPreferencesSaving] = useState(false);
  const [notificationPreferencesError, setNotificationPreferencesError] = useState('');
  const [notificationPreferencesSaved, setNotificationPreferencesSaved] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const commandButtonRef = useRef<HTMLButtonElement>(null);
  const commandSearchRequestId = useRef(0);
  const workspaceSearchRequestId = useRef(0);
  const projectSearchRequestId = useRef(0);
  const workspacePickerRef = useRef<HTMLDivElement>(null);
  const projectPickerRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const settingsPopoverRef = useRef<HTMLElement>(null);
  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const closeCommands = useCallback(() => {
    setCommandOpen(false);
    setCommandQuery('');
    setCommandIndex(0);
    setCommandSearchItems([]);
    setCommandSearchError('');
    setCommandSearchHasMore(false);
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
  const loadWorkspaces = useCallback(async () => {
    setWorkspaceLoading(true);
    try {
      const result = await request<{
        items: WorkspaceSummary[];
        pageInfo?: { hasNext: boolean };
      }>('/workspaces');
      let selected = workspaceId
        ? result.items.find(
            (item) => (item.publicId ?? item.id) === workspaceId || item.id === workspaceId,
          )
        : undefined;
      if (workspaceId && !selected) {
        try {
          selected = await request<WorkspaceSummary>(`/workspaces/${workspaceId}`);
        } catch {
          selected = undefined;
        }
      }
      setCurrentWorkspace(selected);
      setWorkspaces(
        selected
          ? [selected, ...result.items.filter((item) => item.id !== selected.id)]
          : result.items,
      );
      setWorkspacePickerItems(result.items);
      setWorkspaceSearchHasMore(Boolean(result.pageInfo?.hasNext));
      setWorkspaceLoadError('');
    } catch {
      setCurrentWorkspace(undefined);
      setWorkspaces([]);
      setWorkspacePickerItems([]);
      setWorkspaceLoadError(t('sidebar.workspacesUnavailable'));
    } finally {
      setWorkspaceLoading(false);
    }
  }, [request, t, workspaceId]);
  const loadOwnGroups = useCallback(async () => {
    setOwnGroupsLoading(true);
    try {
      const result = await request<{ items: OwnMemberGroup[] }>('/me/member-groups');
      setOwnGroups(result.items);
      setOwnGroupsError('');
    } catch {
      setOwnGroupsError(t('settings.groupsUnavailable'));
    } finally {
      setOwnGroupsLoading(false);
    }
  }, [request, t]);
  const loadApiTokens = useCallback(async () => {
    setApiTokensLoading(true);
    try {
      const result = await request<{ items: ApiTokenSummary[] }>('/api-tokens');
      setApiTokens(result.items);
      setApiTokensError('');
    } catch {
      setApiTokensError(t('apiTokens.loadFailed'));
    } finally {
      setApiTokensLoading(false);
    }
  }, [request, t]);
  const loadNotificationPreferences = useCallback(async () => {
    setNotificationPreferencesLoading(true);
    try {
      const result = await request<NotificationPreferences>('/notifications/preferences');
      setNotificationPreferences(result);
      setNotificationPreferencesError('');
    } catch {
      setNotificationPreferencesError(t('notificationPreferences.loadFailed'));
    } finally {
      setNotificationPreferencesLoading(false);
    }
  }, [request, t]);
  const loadProjects = useCallback(async () => {
    if (!workspaceId || !projectId) {
      setProjects([]);
      setCurrentProject(undefined);
      setProjectsLoading(false);
      setProjectsLoadError('');
      return;
    }
    setProjectsLoading(true);
    try {
      const [loadedProject, result] = await Promise.all([
        request<ProjectSummary>(`/workspaces/${workspaceId}/projects/${projectId}`),
        request<{
          items: ProjectSummary[];
          pageInfo: { limit: number; total: number; hasMore: boolean };
        }>(`/workspaces/${workspaceId}/project-options?limit=20`),
      ]);
      setCurrentProject(loadedProject);
      setProjects([loadedProject, ...result.items.filter((item) => item.id !== loadedProject.id)]);
      setProjectSearchHasMore(result.pageInfo.hasMore);
      setProjectsLoadError('');
    } catch {
      setProjects([]);
      setCurrentProject(undefined);
      setProjectsLoadError(t('sidebar.projectsUnavailable'));
    } finally {
      setProjectsLoading(false);
    }
  }, [projectId, request, t, workspaceId]);
  useEffect(() => void loadWorkspaces(), [loadWorkspaces]);
  useEffect(() => {
    if (!workspacePickerOpen) return;
    const currentRequest = ++workspaceSearchRequestId.current;
    setWorkspaceLoading(true);
    setWorkspaceLoadError('');
    const timeout = window.setTimeout(() => {
      const parameters = new URLSearchParams({ limit: '20', offset: '0' });
      const normalizedQuery = workspaceQuery.trim();
      if (normalizedQuery) parameters.set('query', normalizedQuery);
      void request<{
        items: WorkspaceSummary[];
        pageInfo: { hasNext: boolean };
      }>(`/workspaces?${parameters.toString()}`)
        .then((result) => {
          if (currentRequest !== workspaceSearchRequestId.current) return;
          setWorkspacePickerItems(result.items);
          setWorkspaceSearchHasMore(result.pageInfo.hasNext);
        })
        .catch(() => {
          if (currentRequest !== workspaceSearchRequestId.current) return;
          setWorkspacePickerItems([]);
          setWorkspaceSearchHasMore(false);
          setWorkspaceLoadError(t('sidebar.workspacesUnavailable'));
        })
        .finally(() => {
          if (currentRequest === workspaceSearchRequestId.current) setWorkspaceLoading(false);
        });
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [request, t, workspacePickerOpen, workspaceQuery]);
  useEffect(() => {
    if (!workspacePickerOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!workspacePickerRef.current?.contains(event.target as Node)) {
        setWorkspacePickerOpen(false);
        setWorkspaceQuery('');
      }
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setWorkspacePickerOpen(false);
      setWorkspaceQuery('');
      workspacePickerRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    };
    document.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', closeWithEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('keydown', closeWithEscape);
    };
  }, [workspacePickerOpen]);
  useEffect(() => void loadProjects(), [loadProjects]);
  useEffect(() => {
    if (!projectPickerOpen || !workspaceId) return;
    const currentRequest = ++projectSearchRequestId.current;
    setProjectsLoading(true);
    setProjectsLoadError('');
    const timeout = window.setTimeout(() => {
      const parameters = new URLSearchParams({ limit: '20' });
      const normalizedQuery = projectQuery.trim();
      if (normalizedQuery) parameters.set('query', normalizedQuery);
      void request<{
        items: ProjectSummary[];
        pageInfo: { limit: number; total: number; hasMore: boolean };
      }>(`/workspaces/${workspaceId}/project-options?${parameters.toString()}`)
        .then((result) => {
          if (currentRequest !== projectSearchRequestId.current) return;
          setProjects((current) => {
            const selected = current.find(
              (item) => (item.publicId ?? item.id) === projectId || item.id === projectId,
            );
            return selected
              ? [selected, ...result.items.filter((item) => item.id !== selected.id)]
              : result.items;
          });
          setProjectSearchHasMore(result.pageInfo.hasMore);
        })
        .catch(() => {
          if (currentRequest !== projectSearchRequestId.current) return;
          setProjectsLoadError(t('sidebar.projectsUnavailable'));
          setProjectSearchHasMore(false);
        })
        .finally(() => {
          if (currentRequest === projectSearchRequestId.current) setProjectsLoading(false);
        });
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [projectId, projectPickerOpen, projectQuery, request, t, workspaceId]);
  useEffect(() => {
    if (!projectPickerOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!projectPickerRef.current?.contains(event.target as Node)) {
        setProjectPickerOpen(false);
        setProjectQuery('');
      }
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setProjectPickerOpen(false);
      setProjectQuery('');
      projectPickerRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    };
    document.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', closeWithEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('keydown', closeWithEscape);
    };
  }, [projectPickerOpen]);
  useEffect(() => {
    if (!workspaceId) {
      setRecentProjectIds([]);
      return;
    }
    try {
      const stored = JSON.parse(
        window.localStorage.getItem(`engrove-recent-projects:${workspaceId}`) ?? '[]',
      ) as unknown;
      setRecentProjectIds(
        Array.isArray(stored)
          ? stored.filter((item): item is string => typeof item === 'string')
          : [],
      );
    } catch {
      setRecentProjectIds([]);
    }
  }, [workspaceId]);
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
  useEffect(() => {
    const query = commandQuery.trim();
    const currentRequest = ++commandSearchRequestId.current;
    if (!commandOpen || !workspaceId || query.length < 2) {
      setCommandSearchItems([]);
      setCommandSearchLoading(false);
      setCommandSearchError('');
      setCommandSearchHasMore(false);
      return;
    }
    setCommandSearchLoading(true);
    setCommandSearchError('');
    const timeout = window.setTimeout(() => {
      const parameters = new URLSearchParams({ query, limit: '12' });
      void request<WorkspaceSearchResponse>(
        `/workspaces/${workspaceId}/search?${parameters.toString()}`,
      )
        .then((result) => {
          if (currentRequest !== commandSearchRequestId.current) return;
          setCommandSearchItems(result.items);
          setCommandSearchHasMore(result.pageInfo.hasMore);
        })
        .catch(() => {
          if (currentRequest !== commandSearchRequestId.current) return;
          setCommandSearchItems([]);
          setCommandSearchHasMore(false);
          setCommandSearchError(t('command.searchUnavailable'));
        })
        .finally(() => {
          if (currentRequest === commandSearchRequestId.current) setCommandSearchLoading(false);
        });
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [commandOpen, commandQuery, request, t, workspaceId]);
  useEffect(() => {
    if (!settingsOpen) return;
    settingsPopoverRef.current
      ?.querySelector<HTMLElement>('[data-settings-initial-focus]')
      ?.focus();
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        settingsPopoverRef.current?.contains(target) ||
        settingsButtonRef.current?.contains(target)
      ) {
        return;
      }
      setSettingsOpen(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setSettingsOpen(false);
      settingsButtonRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', closeWithEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('keydown', closeWithEscape);
    };
  }, [settingsOpen]);
  useEffect(() => {
    if (settingsOpen) return;
    setIssuedApiToken(undefined);
    setApiTokenCopied(false);
    setConfirmRevokeTokenId('');
  }, [settingsOpen]);

  const workspace = [currentWorkspace, ...workspaces].find(
    (item) => item && ((item.publicId ?? item.id) === workspaceId || item.id === workspaceId),
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
  const project =
    currentProject &&
    ((currentProject.publicId ?? currentProject.id) === projectId ||
      currentProject.id === projectId)
      ? currentProject
      : undefined;
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
  useEffect(() => {
    if (!workspaceId || !project) return;
    const identifier = project.publicId ?? project.id;
    setRecentProjectIds((current) => {
      const next = [identifier, ...current.filter((item) => item !== identifier)].slice(0, 4);
      window.localStorage.setItem(`engrove-recent-projects:${workspaceId}`, JSON.stringify(next));
      return next;
    });
  }, [project, workspaceId]);
  const activeProjects = projects.filter((item) => !item.archivedAt);
  const recentProjects = recentProjectIds
    .map((identifier) =>
      activeProjects.find(
        (item) => (item.publicId ?? item.id) === identifier || item.id === identifier,
      ),
    )
    .filter((item): item is ProjectSummary => Boolean(item));
  const remainingProjects = activeProjects.filter(
    (item) => !recentProjects.some((recent) => recent.id === item.id),
  );
  const normalizedProjectQuery = projectQuery.trim().toLocaleLowerCase();
  const visibleProjectOptions = normalizedProjectQuery
    ? activeProjects.filter(
        (item) =>
          item.id !== project?.id ||
          item.name.toLocaleLowerCase().includes(normalizedProjectQuery) ||
          item.key?.toLocaleLowerCase().includes(normalizedProjectQuery),
      )
    : remainingProjects;
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
    (inWorkspaceOverview
      ? t('workspaces.overview')
      : inMyWork
        ? t('myWork.heading')
        : inWorkspaceData
          ? t('data.library')
          : inProjects
            ? t('common.projects')
            : utilitySection);
  useEffect(() => {
    document.title = `${sectionLabel} · Engrove`;
  }, [sectionLabel]);
  const projectLinks = projectBase
    ? [
        { to: projectBase, label: t('common.overview'), icon: '⌂', end: true, visible: true },
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
        {
          to: `${projectBase}/reviews`,
          label: t('reviewInbox.nav'),
          icon: '◉',
          end: false,
          visible: can(user, 'review.read'),
        },
        {
          to: `${projectBase}/data`,
          label: t('data.projectRecords'),
          icon: '▦',
          end: false,
          visible: can(user, 'record.read'),
        },
        {
          to: `${projectBase}/sources`,
          label: t('sources.nav'),
          icon: '⌁',
          end: false,
          visible: can(user, 'project.read'),
        },
        {
          to: `${projectBase}/visualizations`,
          label: t('visualizations.nav'),
          icon: '◫',
          end: false,
          visible: can(user, 'dataset.read'),
        },
        {
          to: `${projectBase}/settings`,
          label: t('projects.settings'),
          icon: '⚙',
          end: false,
          visible:
            can(user, 'project.update') ||
            can(user, 'project.archive') ||
            can(user, 'project.restore'),
        },
      ].filter((item) => item.visible)
    : [];

  async function signOut() {
    await request('/auth/sign-out', { method: 'POST' });
    onSignedOut();
  }

  const commands: PaletteCommand[] = [
    {
      label: t('command.openWorkspaceOverview'),
      hint: t('command.navigation'),
      source: 'command',
      run: () => navigate(workspaceBase ?? '/workspaces'),
    },
    {
      label: t('command.openDataLibrary'),
      hint: t('command.navigation'),
      source: 'command',
      run: () => navigate(workspaceBase ? `${workspaceBase}/data` : '/workspaces'),
    },
    {
      label: t('command.openMyWork'),
      hint: t('command.navigation'),
      source: 'command',
      run: () => navigate(workspaceBase ? `${workspaceBase}/my-work` : '/workspaces'),
    },
    ...projectLinks.map((item) => ({
      label: t('command.openSection', { section: item.label }),
      hint: project?.name ?? t('common.project'),
      source: 'command' as const,
      run: () => navigate(item.to),
    })),
    ...(can(user, 'member.manage')
      ? [
          {
            label: t('command.manageMembers'),
            hint: t('command.settings'),
            source: 'command' as const,
            run: () => navigate('/members'),
          },
        ]
      : []),
    ...(can(user, 'audit.read')
      ? [
          {
            label: t('command.openAudit'),
            hint: t('command.settings'),
            source: 'command' as const,
            run: () => navigate('/audit'),
          },
        ]
      : []),
    {
      label: theme === 'dark' ? t('sidebar.useLightTheme') : t('sidebar.useDarkTheme'),
      hint: t('command.appearance'),
      source: 'command',
      run: onToggleTheme,
    },
    {
      label: t('sidebar.signOut'),
      hint: user.displayName,
      source: 'command',
      run: signOut,
    },
  ];
  const matchingCommands = commands.filter((command) =>
    `${command.label} ${command.hint}`.toLowerCase().includes(commandQuery.trim().toLowerCase()),
  );
  const workspaceSearchPath = (item: WorkspaceSearchItem): string | undefined => {
    if (!workspaceBase) return undefined;
    if (item.type === 'project' && item.publicId)
      return `${workspaceBase}/projects/${item.publicId}`;
    if (item.type === 'task' && item.projectPublicId)
      return `${workspaceBase}/projects/${item.projectPublicId}/tasks?task=${item.key}`;
    if (item.type === 'milestone' && item.projectPublicId)
      return `${workspaceBase}/projects/${item.projectPublicId}/milestones?milestone=${item.id}`;
    if (item.type === 'table' && item.publicId) {
      if (item.workspaceShared) return `${workspaceBase}/${item.publicId}`;
      if (item.projectPublicId)
        return `${workspaceBase}/projects/${item.projectPublicId}/data?type=${item.publicId}`;
    }
    return undefined;
  };
  const searchCommands: PaletteCommand[] = commandSearchItems.flatMap((item) => {
    const path = workspaceSearchPath(item);
    if (!path) return [];
    const typeLabel = t(`command.resultType.${item.type}`);
    return [
      {
        label: item.type === 'task' ? `${item.key} · ${item.title}` : item.title,
        hint:
          item.type === 'project'
            ? typeLabel
            : item.type === 'milestone' && item.projectName
              ? `${typeLabel} · ${item.key} · ${item.projectName}`
              : item.projectName
                ? `${typeLabel} · ${item.projectName}`
                : item.type === 'table'
                  ? `${typeLabel} · ${t('data.library')}`
                  : `${typeLabel} · ${item.key}`,
        icon:
          item.type === 'project'
            ? '◇'
            : item.type === 'task'
              ? '✓'
              : item.type === 'milestone'
                ? '◆'
                : '▦',
        source: 'search',
        run: () => navigate(path),
      },
    ];
  });
  const visibleCommands = [...searchCommands, ...matchingCommands];
  useEffect(() => {
    setCommandIndex(0);
  }, [commandQuery, commandOpen]);
  const safeCommandIndex = Math.min(commandIndex, Math.max(visibleCommands.length - 1, 0));
  function runCommand(command: PaletteCommand) {
    closeCommands();
    void command.run();
  }
  function openSettings() {
    if (!settingsOpen) {
      void loadOwnGroups();
      void loadNotificationPreferences();
    }
    setSettingsOpen((current) => !current);
  }
  async function setNotificationPreference<K extends keyof NotificationPreferences>(
    key: K,
    value: NotificationPreferences[K],
  ) {
    if (!notificationPreferences || notificationPreferencesSaving) return;
    const next = { ...notificationPreferences, [key]: value };
    setNotificationPreferences(next);
    setNotificationPreferencesSaving(true);
    setNotificationPreferencesSaved(false);
    try {
      const saved = await request<NotificationPreferences>('/notifications/preferences', {
        method: 'PATCH',
        body: JSON.stringify(next),
      });
      setNotificationPreferences(saved);
      setNotificationPreferencesError('');
      setNotificationPreferencesSaved(true);
      window.dispatchEvent(new CustomEvent('engrove-notification-preferences', { detail: saved }));
    } catch {
      setNotificationPreferences(notificationPreferences);
      setNotificationPreferencesError(t('notificationPreferences.saveFailed'));
    } finally {
      setNotificationPreferencesSaving(false);
    }
  }
  function toggleApiTokens() {
    const next = !apiTokensOpen;
    setApiTokensOpen(next);
    if (next) {
      void loadApiTokens();
    } else {
      setIssuedApiToken(undefined);
      setApiTokenCopied(false);
      setApiTokenScopeCount(0);
      setConfirmRevokeTokenId('');
    }
  }
  async function createApiToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setApiTokenBusy(true);
    setApiTokensError('');
    try {
      const data = new FormData(form);
      const workspaceId = String(data.get('workspaceId') ?? '');
      const scopes = data.getAll('scopes').map(String);
      if (scopes.length === 0) {
        setApiTokensError(t('apiTokens.scopeRequired'));
        return;
      }
      const token = await request<IssuedApiToken>('/api-tokens', {
        method: 'POST',
        body: JSON.stringify({
          name: data.get('name'),
          accessLevel: data.get('accessLevel'),
          scopes,
          expiresInDays: Number(data.get('expiresInDays')),
          ...(workspaceId ? { workspaceId } : {}),
        }),
      });
      setIssuedApiToken(token);
      setApiTokens((current) => [token, ...current]);
      form.reset();
      setApiTokenScopeCount(0);
    } catch {
      setApiTokensError(t('apiTokens.createFailed'));
    } finally {
      setApiTokenBusy(false);
    }
  }
  async function copyApiToken() {
    if (!issuedApiToken) return;
    try {
      await navigator.clipboard.writeText(issuedApiToken.token);
      setApiTokenCopied(true);
    } catch {
      setApiTokensError(t('common.copyDenied'));
    }
  }
  async function revokeToken(tokenId: string) {
    if (confirmRevokeTokenId !== tokenId) {
      setConfirmRevokeTokenId(tokenId);
      return;
    }
    setApiTokenBusy(true);
    try {
      await request(`/api-tokens/${tokenId}/revoke`, { method: 'POST' });
      setApiTokens((current) => current.filter((token) => token.id !== tokenId));
      setConfirmRevokeTokenId('');
      setApiTokensError('');
    } catch {
      setApiTokensError(t('apiTokens.revokeFailed'));
    } finally {
      setApiTokenBusy(false);
    }
  }
  function selectWorkspace(nextWorkspaceId: string) {
    setWorkspacePickerOpen(false);
    setWorkspaceQuery('');
    if (!nextWorkspaceId) {
      setCurrentWorkspace(undefined);
      navigate('/workspaces');
      return;
    }
    setCurrentWorkspace(
      workspacePickerItems.find(
        (item) => (item.publicId ?? item.id) === nextWorkspaceId || item.id === nextWorkspaceId,
      ),
    );
    const preservedSection = inWorkspaceData ? '/data' : '';
    navigate(`/workspaces/${nextWorkspaceId}${preservedSection}`);
  }
  function selectProject(nextProjectId: string) {
    if (!workspaceBase) return;
    setProjectPickerOpen(false);
    setProjectQuery('');
    if (!nextProjectId) {
      navigate(workspaceBase);
      return;
    }
    const section = projectBase
      ? location.pathname.slice(projectBase.length).split('/').filter(Boolean)[0]
      : undefined;
    const preservedSection =
      section &&
      ['milestones', 'tasks', 'reviews', 'data', 'sources', 'visualizations', 'settings'].includes(
        section,
      )
        ? `/${section}`
        : '';
    navigate(`${workspaceBase}/projects/${nextProjectId}${preservedSection}`);
  }
  const sidebarExpanded = expanded || isMobile;
  const settingsPopover = settingsOpen && (
    <section
      aria-labelledby="service-settings-title"
      className={`absolute z-[100] w-80 overflow-y-auto rounded-xl border border-slate-700 bg-slate-950 shadow-2xl shadow-black/40 ${sidebarExpanded ? 'left-0' : 'bottom-0 left-full ml-2'}`}
      id="service-settings-popover"
      ref={settingsPopoverRef}
      role="dialog"
      style={{
        maxHeight: 'calc(100vh - 5rem)',
        ...(sidebarExpanded ? { bottom: '2.75rem' } : {}),
      }}
    >
      <header className="flex items-center justify-between border-b border-slate-800 px-3 py-2.5">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-wider text-sky-400">
            {t('settings.preferences')}
          </p>
          <h2 className="mt-0.5 text-sm font-semibold" id="service-settings-title">
            {t('sidebar.settings')}
          </h2>
        </div>
        <button
          aria-label={t('settings.close')}
          className="grid size-7 place-items-center rounded-md text-base text-slate-500 hover:bg-slate-800 hover:text-slate-100"
          onClick={() => setSettingsOpen(false)}
          title={t('settings.close')}
          type="button"
        >
          ×
        </button>
      </header>

      <div className="grid gap-3 p-3">
        <label className="flex items-center justify-between gap-3 text-xs font-medium text-slate-300">
          {t('language.label')}
          <select
            aria-label={t('language.label')}
            className="min-h-8 w-1/2 rounded-md border border-slate-700 bg-slate-900 px-2 text-xs text-slate-200 outline-none focus:border-sky-400"
            data-settings-initial-focus
            value={locale}
            onChange={(event) => setLocale(event.target.value as 'en' | 'ko')}
          >
            <option value="en">{t('language.english')}</option>
            <option value="ko">{t('language.korean')}</option>
          </select>
        </label>

        <div className="flex items-center justify-between gap-3 border-t border-slate-800 pt-3">
          <span className="text-xs font-medium text-slate-300">{t('settings.theme')}</span>
          <div className="grid w-1/2 grid-cols-2 rounded-md border border-slate-700 bg-slate-900 p-0.5">
            {(['light', 'dark'] as const).map((option) => (
              <button
                aria-pressed={theme === option}
                className={`rounded px-1.5 py-1 text-[10px] font-medium ${theme === option ? 'bg-sky-400/15 text-sky-300' : 'text-slate-500 hover:text-slate-200'}`}
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

        <div className="border-t border-slate-800 pt-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-medium uppercase tracking-wider text-slate-600">
              {t('notificationPreferences.heading')}
            </p>
            {notificationPreferencesLoading && (
              <span className="text-[10px] text-slate-600">{t('common.loading')}</span>
            )}
            {!notificationPreferencesLoading && notificationPreferencesSaved && (
              <span aria-live="polite" className="text-[10px] text-emerald-300">
                {t('notificationPreferences.saved')}
              </span>
            )}
          </div>
          <p className="mt-1 text-[10px] leading-4 text-slate-500">
            {t('notificationPreferences.help')}
          </p>
          {notificationPreferencesError && (
            <p aria-live="polite" className="mt-1 text-[10px] text-amber-300">
              {notificationPreferencesError}
            </p>
          )}
          {notificationPreferences && (
            <div className="mt-2 grid gap-1">
              {(
                [
                  ['autoWatchCreated', 'notificationPreferences.autoWatchCreated'],
                  ['autoWatchCommented', 'notificationPreferences.autoWatchCommented'],
                  ['notifyAssigned', 'notificationPreferences.notifyAssigned'],
                  ['notifyMentioned', 'notificationPreferences.notifyMentioned'],
                  ['notifyTaskActivity', 'notificationPreferences.notifyTaskActivity'],
                  ['notifyDueDates', 'notificationPreferences.notifyDueDates'],
                ] as const
              ).map(([key, label]) => (
                <label
                  className="flex min-h-8 items-center justify-between gap-3 rounded-md px-2 text-[11px] text-slate-300 hover:bg-slate-900"
                  key={key}
                >
                  <span>{t(label)}</span>
                  <input
                    checked={notificationPreferences[key]}
                    disabled={notificationPreferencesSaving}
                    onChange={(event) => void setNotificationPreference(key, event.target.checked)}
                    type="checkbox"
                  />
                </label>
              ))}
              <label className="flex min-h-8 items-center justify-between gap-3 rounded-md px-2 text-[11px] text-slate-300 hover:bg-slate-900">
                <span>{t('notificationPreferences.dueReminderDays')}</span>
                <select
                  aria-label={t('notificationPreferences.dueReminderDays')}
                  className="rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px] text-slate-200"
                  disabled={
                    notificationPreferencesSaving || !notificationPreferences.notifyDueDates
                  }
                  onChange={(event) =>
                    void setNotificationPreference(
                      'dueReminderDays',
                      Number(event.target.value) as 0 | 1 | 3 | 7,
                    )
                  }
                  value={notificationPreferences.dueReminderDays}
                >
                  {([0, 1, 3, 7] as const).map((days) => (
                    <option key={days} value={days}>
                      {t(`notificationPreferences.dueReminderDays.${days}`)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>

        <div className="border-t border-slate-800 pt-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-medium uppercase tracking-wider text-slate-600">
              {t('settings.myGroups')}
            </p>
            <button
              aria-label={t('settings.refreshGroups')}
              className="grid size-6 place-items-center rounded text-slate-600 hover:bg-slate-800 hover:text-sky-300"
              disabled={ownGroupsLoading}
              onClick={() => void loadOwnGroups()}
              title={t('settings.refreshGroups')}
              type="button"
            >
              <span aria-hidden="true">↻</span>
            </button>
          </div>
          <div aria-live="polite" className="mt-1 flex flex-wrap gap-1">
            {ownGroupsLoading && (
              <span className="text-[10px] text-slate-500">{t('common.loading')}</span>
            )}
            {!ownGroupsLoading && ownGroupsError && (
              <span className="text-[10px] text-amber-300">{ownGroupsError}</span>
            )}
            {!ownGroupsLoading && !ownGroupsError && ownGroups.length === 0 && (
              <span className="text-[10px] text-slate-500">{t('settings.noGroups')}</span>
            )}
            {!ownGroupsLoading &&
              !ownGroupsError &&
              ownGroups.map((group) => (
                <span
                  className="inline-flex items-center gap-1 rounded-full border border-slate-800 px-2 py-1 text-[10px] text-slate-300"
                  key={group.id}
                  title={group.description || group.name}
                >
                  <span
                    aria-hidden="true"
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: memberGroupColors[group.color] }}
                  />
                  {group.name}
                </span>
              ))}
          </div>
        </div>

        <div className="border-t border-slate-800 pt-3">
          <button
            aria-expanded={apiTokensOpen}
            aria-label={t('apiTokens.heading')}
            className="flex w-full items-center justify-between gap-2 rounded-md py-1 text-left text-xs font-medium text-slate-300 hover:text-sky-300"
            onClick={toggleApiTokens}
            type="button"
          >
            <span>{t('apiTokens.heading')}</span>
            <span className="text-[10px] text-slate-600">
              {apiTokens.length || ''} {apiTokensOpen ? '▴' : '▾'}
            </span>
          </button>
          {apiTokensOpen && (
            <div className="mt-2 grid gap-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[10px] leading-4 text-slate-500">{t('apiTokens.help')}</p>
                <a
                  className="shrink-0 rounded px-1 text-[10px] text-sky-400 hover:bg-slate-900 hover:text-sky-300"
                  href={`${import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'}/api/docs`}
                  target="_blank"
                  title={t('apiTokens.docs')}
                >
                  {t('apiTokens.docs')} ↗
                </a>
              </div>
              {issuedApiToken && (
                <section
                  aria-label={t('apiTokens.created')}
                  className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-2"
                >
                  <strong className="block text-[10px] text-amber-200">
                    {t('apiTokens.copyNow')}
                  </strong>
                  <div className="mt-1 flex gap-1">
                    <input
                      aria-label={t('apiTokens.secret')}
                      className="min-w-0 flex-1 rounded border border-amber-400/20 bg-slate-950 px-2 py-1 font-mono text-[9px] text-amber-100"
                      readOnly
                      value={issuedApiToken.token}
                    />
                    <button
                      aria-label={t('apiTokens.copy')}
                      className="grid size-7 shrink-0 place-items-center rounded border border-amber-400/20 text-amber-200 hover:bg-amber-400/10"
                      onClick={() => void copyApiToken()}
                      title={t('apiTokens.copy')}
                      type="button"
                    >
                      ⧉
                    </button>
                  </div>
                  {apiTokenCopied && (
                    <span aria-live="polite" className="mt-1 block text-[10px] text-emerald-300">
                      {t('common.copied')}
                    </span>
                  )}
                  <pre className="mt-2 overflow-x-auto rounded bg-slate-950 p-2 text-[8px] leading-4 text-slate-400">
                    {`curl -H "Authorization: Bearer ${issuedApiToken.token}" "${import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'}/api/v1/workspaces"`}
                  </pre>
                </section>
              )}
              <form
                aria-label={t('apiTokens.create')}
                className="grid gap-2 rounded-lg border border-slate-800 bg-slate-900/50 p-2"
                onSubmit={(event) => void createApiToken(event)}
              >
                <label className="grid gap-1 text-[10px] text-slate-400">
                  <FormFieldLabel required>{t('apiTokens.name')}</FormFieldLabel>
                  <input
                    className="min-h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200 outline-none focus:border-sky-400"
                    maxLength={80}
                    name="name"
                    placeholder={t('apiTokens.namePlaceholder')}
                    required
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="grid gap-1 text-[10px] text-slate-400">
                    <FormFieldLabel required>{t('apiTokens.access')}</FormFieldLabel>
                    <select
                      className="min-h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-[10px] text-slate-200 outline-none focus:border-sky-400"
                      defaultValue="read"
                      name="accessLevel"
                      required
                    >
                      <option value="read">{t('apiTokens.read')}</option>
                      <option value="write">{t('apiTokens.write')}</option>
                    </select>
                  </label>
                  <label className="grid gap-1 text-[10px] text-slate-400">
                    <FormFieldLabel required>{t('apiTokens.expiry')}</FormFieldLabel>
                    <select
                      className="min-h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-[10px] text-slate-200 outline-none focus:border-sky-400"
                      defaultValue="90"
                      name="expiresInDays"
                      required
                    >
                      <option value="30">{t('apiTokens.days', { count: 30 })}</option>
                      <option value="90">{t('apiTokens.days', { count: 90 })}</option>
                      <option value="365">{t('apiTokens.days', { count: 365 })}</option>
                    </select>
                  </label>
                </div>
                <fieldset className="grid gap-1 rounded-md border border-slate-800 p-2">
                  <legend className="px-1 text-[10px] text-slate-400">
                    {t('apiTokens.scopes')} · {t('common.required')}
                  </legend>
                  <span className="text-[9px] leading-4 text-slate-600">
                    {t('apiTokens.scopesHelp')}
                  </span>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                    {(
                      ['workspace', 'project', 'data', 'tasks', 'schedule', 'reviews'] as const
                    ).map((scope) => (
                      <label
                        className="flex min-h-7 items-center gap-2 text-[10px] text-slate-300"
                        key={scope}
                      >
                        <input
                          name="scopes"
                          onChange={(event) =>
                            setApiTokenScopeCount(
                              (current) => current + (event.target.checked ? 1 : -1),
                            )
                          }
                          type="checkbox"
                          value={scope}
                        />
                        {t(`apiTokens.scope.${scope}`)}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="grid gap-1 text-[10px] text-slate-400">
                  <FormFieldLabel>{t('apiTokens.workspace')}</FormFieldLabel>
                  <select
                    className="min-h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-[10px] text-slate-200 outline-none focus:border-sky-400"
                    defaultValue=""
                    name="workspaceId"
                  >
                    <option value="">{t('apiTokens.allWorkspaces')}</option>
                    {workspaces.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="min-h-8 rounded-md bg-sky-400 px-3 text-xs font-semibold text-slate-950 hover:bg-sky-300 disabled:opacity-50"
                  disabled={apiTokenBusy || apiTokenScopeCount === 0}
                  type="submit"
                >
                  {apiTokenBusy ? t('common.working') : t('apiTokens.create')}
                </button>
              </form>
              {apiTokensLoading && (
                <span className="text-[10px] text-slate-500">{t('common.loading')}</span>
              )}
              {apiTokensError && (
                <span aria-live="polite" className="text-[10px] text-amber-300">
                  {apiTokensError}
                </span>
              )}
              {!apiTokensLoading && apiTokens.length === 0 && (
                <p className="text-[10px] text-slate-500">{t('apiTokens.empty')}</p>
              )}
              {apiTokens.map((token) => (
                <article className="rounded-lg border border-slate-800 p-2" key={token.id}>
                  <div className="flex items-start gap-2">
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-[10px] text-slate-200">
                        {token.name}
                      </strong>
                      <span className="block font-mono text-[9px] text-slate-600">
                        {token.tokenPrefix}… · {t(`apiTokens.${token.accessLevel}`)}
                      </span>
                      <span className="block text-[9px] text-slate-600">
                        {token.scopes.map((scope) => t(`apiTokens.scope.${scope}`)).join(' · ')}
                      </span>
                      <span className="block text-[9px] text-slate-600">
                        {token.workspaceName ?? t('apiTokens.allWorkspaces')} ·{' '}
                        {t('apiTokens.expires', {
                          date: new Date(token.expiresAt).toLocaleDateString(locale),
                        })}
                      </span>
                      <span className="block text-[9px] text-slate-600">
                        {token.lastUsedAt
                          ? t('apiTokens.lastUsed', {
                              date: new Date(token.lastUsedAt).toLocaleString(locale),
                            })
                          : t('apiTokens.neverUsed')}
                      </span>
                    </span>
                    <button
                      aria-label={
                        confirmRevokeTokenId === token.id
                          ? t('apiTokens.confirmRevoke', { name: token.name })
                          : t('apiTokens.revoke', { name: token.name })
                      }
                      className={`grid min-h-7 shrink-0 place-items-center rounded px-2 text-[10px] ${confirmRevokeTokenId === token.id ? 'bg-rose-500/15 text-rose-200' : 'text-slate-600 hover:bg-slate-800 hover:text-rose-300'}`}
                      disabled={apiTokenBusy}
                      onClick={() => void revokeToken(token.id)}
                      title={
                        confirmRevokeTokenId === token.id
                          ? t('apiTokens.confirmRevoke', { name: token.name })
                          : t('apiTokens.revoke', { name: token.name })
                      }
                      type="button"
                    >
                      {confirmRevokeTokenId === token.id ? t('apiTokens.confirm') : '⌫'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        {(can(user, 'member.manage') || can(user, 'audit.read')) && (
          <div className="border-t border-slate-800 pt-3">
            <p className="text-[10px] font-medium uppercase tracking-wider text-slate-600">
              {t('settings.organization')}
            </p>
            <div className="mt-1 grid grid-cols-2 gap-1">
              {can(user, 'member.manage') && (
                <Link
                  className="rounded-md px-2 py-1.5 text-xs text-slate-400 hover:bg-slate-800 hover:text-sky-300"
                  onClick={() => setSettingsOpen(false)}
                  to="/members"
                >
                  {t('common.members')}
                </Link>
              )}
              {can(user, 'audit.read') && (
                <Link
                  className="rounded-md px-2 py-1.5 text-xs text-slate-400 hover:bg-slate-800 hover:text-sky-300"
                  onClick={() => setSettingsOpen(false)}
                  to="/audit"
                >
                  {t('common.auditLog')}
                </Link>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 border-t border-slate-800 pt-3">
          <span className="grid size-7 shrink-0 place-items-center rounded-full border border-slate-700 bg-slate-800 text-xs font-semibold text-sky-300">
            {user.displayName.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <strong className="block truncate text-xs font-medium text-slate-200">
              {user.displayName}
            </strong>
            <span className="block truncate text-[10px] text-slate-500">{user.email}</span>
            <span className="block truncate text-[10px] text-slate-600">
              {t('settings.role', { role: t(`roles.${user.role}`) })}
            </span>
          </span>
          <button
            className="rounded-md px-2 py-1.5 text-[10px] font-medium text-rose-300 hover:bg-rose-500/10"
            onClick={() => void signOut()}
            type="button"
          >
            {t('sidebar.signOut')}
          </button>
        </div>
      </div>
    </section>
  );

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
                <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                  {t('common.workspace')}
                </p>
                <div className="relative mt-1" ref={workspacePickerRef}>
                  <input
                    aria-autocomplete="list"
                    aria-controls="service-workspace-options"
                    aria-expanded={workspacePickerOpen}
                    aria-label={t('sidebar.selectWorkspace')}
                    className="min-h-8 w-full rounded-md border border-slate-700 bg-slate-900 px-2 text-xs font-medium text-slate-200 outline-none placeholder:text-slate-600 focus:border-sky-400"
                    onChange={(event) => {
                      setWorkspaceQuery(event.target.value);
                      setWorkspacePickerOpen(true);
                    }}
                    onFocus={() => {
                      setWorkspaceQuery('');
                      setWorkspacePickerOpen(true);
                    }}
                    placeholder={t('common.search')}
                    role="combobox"
                    value={workspacePickerOpen ? workspaceQuery : (workspace?.name ?? '')}
                  />
                  {workspacePickerOpen && (
                    <div
                      className="absolute inset-x-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-lg border border-slate-700 bg-slate-950 p-1 shadow-xl shadow-black/40"
                      id="service-workspace-options"
                      role="listbox"
                    >
                      {!workspaceQuery.trim() && (
                        <button
                          aria-selected={!workspaceId}
                          className="flex min-h-8 w-full items-center rounded-md px-2 text-left text-xs text-slate-300 hover:bg-slate-800"
                          onClick={() => selectWorkspace('')}
                          role="option"
                          type="button"
                        >
                          {t('sidebar.allWorkspaces')}
                        </button>
                      )}
                      {workspacePickerItems.map((item) => (
                        <WorkspacePickerOption
                          current={item.id === workspace?.id}
                          item={item}
                          key={item.id}
                          onSelect={selectWorkspace}
                        />
                      ))}
                      {!workspaceLoading && workspacePickerItems.length === 0 && (
                        <p className="px-2 py-3 text-center text-[10px] text-slate-500">
                          {t('sidebar.noWorkspacesFound')}
                        </p>
                      )}
                      {workspaceSearchHasMore && (
                        <p className="border-t border-slate-800 px-2 py-2 text-[9px] text-slate-500">
                          {t('sidebar.refineWorkspaceSearch')}
                        </p>
                      )}
                    </div>
                  )}
                </div>
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
                  aria-label={t('workspaces.overview')}
                  className={() =>
                    `flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-xs font-medium ${inWorkspaceOverview ? 'bg-sky-400/15 text-sky-300 shadow-sm' : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-200'}`
                  }
                  end
                  to={workspaceBase}
                >
                  <ServiceIcon name="overview" />
                  {sidebarExpanded && <span>{t('workspaces.overview')}</span>}
                </NavLink>
                <NavLink
                  aria-label={t('myWork.heading')}
                  className={() =>
                    `flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-xs font-medium ${inMyWork ? 'bg-sky-400/15 text-sky-300 shadow-sm' : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-200'}`
                  }
                  to={`${workspaceBase}/my-work`}
                >
                  <ServiceIcon name="work" />
                  {sidebarExpanded && <span>{t('myWork.heading')}</span>}
                </NavLink>
                <NavLink
                  aria-label={t('data.library')}
                  className={() =>
                    `flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-xs font-medium ${inWorkspaceData ? 'bg-sky-400/15 text-sky-300 shadow-sm' : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-200'}`
                  }
                  to={`${workspaceBase}/data`}
                >
                  <ServiceIcon name="data" />
                  {sidebarExpanded && <span>{t('data.library')}</span>}
                </NavLink>
              </>
            ) : (
              <>
                <button
                  aria-label={t('workspaces.overview')}
                  className="flex h-9 w-full cursor-not-allowed items-center gap-2.5 rounded-lg px-2.5 text-xs font-medium text-slate-600"
                  disabled
                  title={t('sidebar.selectWorkspaceFirst')}
                  type="button"
                >
                  <ServiceIcon name="overview" />
                  {sidebarExpanded && <span>{t('workspaces.overview')}</span>}
                </button>
                <button
                  aria-label={t('myWork.heading')}
                  className="flex h-9 w-full cursor-not-allowed items-center gap-2.5 rounded-lg px-2.5 text-xs font-medium text-slate-600"
                  disabled
                  title={t('sidebar.selectWorkspaceFirst')}
                  type="button"
                >
                  <ServiceIcon name="work" />
                  {sidebarExpanded && <span>{t('myWork.heading')}</span>}
                </button>
                <button
                  aria-label={t('data.library')}
                  className="flex h-9 w-full cursor-not-allowed items-center gap-2.5 rounded-lg px-2.5 text-xs font-medium text-slate-600"
                  disabled
                  title={t('sidebar.selectWorkspaceFirst')}
                  type="button"
                >
                  <ServiceIcon name="data" />
                  {sidebarExpanded && <span>{t('data.library')}</span>}
                </button>
              </>
            )}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto border-t border-slate-800">
            {sidebarExpanded && inProjects && (
              <div className="p-2">
                {projectBase && (
                  <>
                    <p className="px-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">
                      {t('sidebar.currentProject')}
                    </p>
                    <div className="relative mt-1" ref={projectPickerRef}>
                      <input
                        aria-autocomplete="list"
                        aria-controls="service-project-options"
                        aria-expanded={projectPickerOpen}
                        aria-label={t('sidebar.selectProject')}
                        className="min-h-8 w-full rounded-md border border-slate-700 bg-slate-900 px-2 text-xs font-medium text-slate-200 outline-none placeholder:text-slate-600 focus:border-sky-400"
                        onChange={(event) => {
                          setProjectQuery(event.target.value);
                          setProjectPickerOpen(true);
                        }}
                        onFocus={() => {
                          setProjectQuery('');
                          setProjectPickerOpen(true);
                        }}
                        placeholder={t('common.search')}
                        role="combobox"
                        value={projectPickerOpen ? projectQuery : (project?.name ?? '')}
                      />
                      {projectPickerOpen && (
                        <div
                          className="absolute inset-x-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-lg border border-slate-700 bg-slate-950 p-1 shadow-xl shadow-black/40"
                          id="service-project-options"
                          role="listbox"
                        >
                          {!projectQuery.trim() && (
                            <button
                              aria-selected={!project}
                              className="flex min-h-8 w-full items-center rounded-md px-2 text-left text-xs text-slate-300 hover:bg-slate-800"
                              onClick={() => selectProject('')}
                              role="option"
                              type="button"
                            >
                              {t('workspaces.overview')}
                            </button>
                          )}
                          {project?.archivedAt && !projectQuery.trim() && (
                            <button
                              aria-selected="true"
                              className="flex min-h-8 w-full items-center justify-between rounded-md bg-slate-800 px-2 text-left text-xs text-slate-300"
                              onClick={() => selectProject(project.publicId ?? project.id)}
                              role="option"
                              type="button"
                            >
                              <span className="truncate">{project.name}</span>
                              <span className="ml-2 text-[9px] text-amber-300">
                                {t('common.archived')}
                              </span>
                            </button>
                          )}
                          {!projectQuery.trim() && recentProjects.length > 0 && (
                            <div aria-label={t('sidebar.recentProjects')} role="group">
                              <p className="px-2 pb-1 pt-2 text-[9px] font-medium uppercase tracking-wider text-slate-600">
                                {t('sidebar.recentProjects')}
                              </p>
                              {recentProjects.map((item) => (
                                <ProjectPickerOption
                                  current={item.id === project?.id}
                                  item={item}
                                  key={`recent-${item.id}`}
                                  onSelect={selectProject}
                                />
                              ))}
                            </div>
                          )}
                          <div aria-label={t('common.projects')} role="group">
                            {!projectQuery.trim() && (
                              <p className="px-2 pb-1 pt-2 text-[9px] font-medium uppercase tracking-wider text-slate-600">
                                {t('common.projects')}
                              </p>
                            )}
                            {visibleProjectOptions.map((item) => (
                              <ProjectPickerOption
                                current={item.id === project?.id}
                                item={item}
                                key={item.id}
                                onSelect={selectProject}
                              />
                            ))}
                          </div>
                          {!projectsLoading && visibleProjectOptions.length === 0 && (
                            <p className="px-2 py-3 text-center text-[10px] text-slate-500">
                              {t('sidebar.noProjectsFound')}
                            </p>
                          )}
                          {projectSearchHasMore && (
                            <p className="border-t border-slate-800 px-2 py-2 text-[9px] text-slate-500">
                              {t('sidebar.refineProjectSearch')}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                    {projectsLoading && (
                      <span className="mt-1 block px-1 text-[10px] text-slate-600">
                        {t('common.loading')}
                      </span>
                    )}
                    {projectsLoadError && (
                      <span className="mt-1 flex items-center justify-between gap-2 px-1 text-[10px] text-amber-300">
                        <span>{projectsLoadError}</span>
                        <button
                          className="rounded px-1 py-0.5 text-sky-300 hover:bg-slate-800"
                          onClick={() => void loadProjects()}
                          type="button"
                        >
                          {t('common.retry')}
                        </button>
                      </span>
                    )}
                    <nav
                      aria-label={t('sidebar.projectNavigation')}
                      className="mt-2 border-t border-slate-800 pt-2"
                    >
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
                  </>
                )}
              </div>
            )}
            <div
              className={
                sidebarExpanded
                  ? projectBase && inProjects
                    ? 'mb-2 ml-6 border-l border-slate-800 pl-1'
                    : undefined
                  : 'hidden'
              }
              ref={setPortal}
            />
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
                <NotificationCenter
                  expanded
                  navigate={navigate}
                  onOpen={() => setSettingsOpen(false)}
                  request={request}
                />
                <div className="relative">
                  <button
                    aria-controls="service-settings-popover"
                    aria-expanded={settingsOpen}
                    aria-haspopup="dialog"
                    className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                    onClick={openSettings}
                    ref={settingsButtonRef}
                    type="button"
                  >
                    <ServiceIcon name="settings" /> {t('sidebar.settings')}
                  </button>
                  {settingsPopover}
                </div>
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
              <div className="grid gap-1">
                <NotificationCenter
                  expanded={false}
                  navigate={navigate}
                  onOpen={() => setSettingsOpen(false)}
                  request={request}
                />
                <div className="relative">
                  <button
                    aria-controls="service-settings-popover"
                    aria-expanded={settingsOpen}
                    aria-label={t('sidebar.settings')}
                    aria-haspopup="dialog"
                    className="grid size-9 w-full place-items-center rounded-md hover:bg-slate-800"
                    onClick={openSettings}
                    ref={settingsButtonRef}
                    type="button"
                  >
                    <ServiceIcon name="settings" />
                  </button>
                  {settingsPopover}
                </div>
              </div>
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
                placeholder={t('command.searchPlaceholder')}
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
                {commandQuery.trim().length >= 2 && workspaceId && (
                  <div aria-live="polite" className="flex min-h-6 items-center px-3 text-[10px]">
                    {commandSearchLoading ? (
                      <span className="text-slate-500">{t('command.searching')}</span>
                    ) : commandSearchError ? (
                      <span className="text-amber-300">{commandSearchError}</span>
                    ) : searchCommands.length ? (
                      <span className="text-slate-600">
                        {t('command.resultCount', { count: searchCommands.length })}
                        {commandSearchHasMore ? ` · ${t('command.moreResults')}` : ''}
                      </span>
                    ) : null}
                  </div>
                )}
                {visibleCommands.map((command, index) => (
                  <div key={`${command.source}:${command.hint}:${command.label}:${index}`}>
                    {index === 0 && searchCommands.length > 0 && (
                      <p className="px-3 pb-1 pt-1 text-[9px] font-medium uppercase tracking-wider text-slate-600">
                        {t('command.searchResults')}
                      </p>
                    )}
                    {index === searchCommands.length && matchingCommands.length > 0 && (
                      <p className="px-3 pb-1 pt-2 text-[9px] font-medium uppercase tracking-wider text-slate-600">
                        {t('command.commands')}
                      </p>
                    )}
                    <button
                      aria-current={index === safeCommandIndex ? 'true' : undefined}
                      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm ${index === safeCommandIndex ? 'bg-sky-400/10 text-sky-200' : 'text-slate-300 hover:bg-slate-800 hover:text-slate-100'}`}
                      id={`command-option-${index}`}
                      onClick={() => runCommand(command)}
                      onMouseEnter={() => setCommandIndex(index)}
                      type="button"
                    >
                      {command.icon && (
                        <span
                          aria-hidden="true"
                          className="grid w-4 shrink-0 place-items-center text-sky-400"
                        >
                          {command.icon}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate">{command.label}</span>
                      <span className="shrink-0 text-[10px] text-slate-600">{command.hint}</span>
                    </button>
                  </div>
                ))}
                {!visibleCommands.length && !commandSearchLoading && !commandSearchError && (
                  <p className="px-3 py-8 text-center text-xs text-slate-500">
                    {commandQuery.trim().length >= 2 && workspaceId
                      ? t('command.noResults')
                      : t('command.noMatch')}
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
