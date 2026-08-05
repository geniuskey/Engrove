import { can, type Action, type Role } from '@engrove/permissions';
import type { HealthResponse } from '@engrove/shared';
import { Button } from '@engrove/ui';
import {
  type DragEvent,
  type FormEvent,
  lazy,
  type PropsWithChildren,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Link,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router';
import type { WorkspaceDataContext } from './DataPageTypes.js';
import { BrandMark } from './BrandMark.js';
import { I18nProvider, useI18n } from './i18n.js';
import { ServiceShell } from './ServiceSidebar.js';
import { useModalDialog } from './useModalDialog.js';

const DataPage = lazy(() =>
  import('./DataPage.js').then((module) => ({ default: module.DataPage })),
);
const RecordDetailPage = lazy(() =>
  import('./DataPage.js').then((module) => ({ default: module.RecordDetailPage })),
);
const FilesDatasetsPage = lazy(() =>
  import('./FilesDatasetsPage.js').then((module) => ({ default: module.FilesDatasetsPage })),
);
const TasksPage = lazy(() =>
  import('./TasksPage.js').then((module) => ({ default: module.TasksPage })),
);
const MilestonesPage = lazy(() =>
  import('./MilestonesPage.js').then((module) => ({ default: module.MilestonesPage })),
);

const VisualizationsPage = lazy(() =>
  import('./VisualizationsPage.js').then((module) => ({ default: module.VisualizationsPage })),
);

function PageLoader({ children, label }: PropsWithChildren<{ label: string }>) {
  return (
    <Suspense
      fallback={
        <div aria-label={`Loading ${label}`} aria-live="polite" className="space-y-3 py-2">
          <div className="h-8 w-48 animate-pulse rounded-lg bg-slate-800/80" />
          <div className="h-11 animate-pulse rounded-xl bg-slate-900/70" />
          <div className="h-64 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/40" />
          <span className="sr-only">Loading {label}…</span>
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

const apiBase = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';
type Theme = 'light' | 'dark';

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  organizationId: string;
}

interface Workspace {
  id: string;
  publicId?: string;
  name: string;
  slug: string;
  description: string;
  archivedAt: string | null;
}

interface Project {
  id: string;
  publicId?: string;
  workspaceId: string;
  name: string;
  key: string;
  description: string;
  status: string;
  rowVersion: number;
  archivedAt: string | null;
}

interface ProjectOverviewMetrics {
  total_samples: number;
  dataset_count: number;
  failed_evaluations: number;
  pass_rate: string | null;
  overdue_tasks: number;
  recent_datasets: ProjectOverviewDataset[];
}

interface ProjectOverviewTask {
  id: string;
  status: 'todo' | 'in_progress' | 'blocked' | 'done';
  archived_at: string | null;
}

interface ProjectOverviewDataset {
  id: string;
  name: string;
  status: string;
  row_count?: number;
  created_at?: string;
  archived_at?: string | null;
}

interface ProjectOverview {
  metrics: ProjectOverviewMetrics | undefined;
  tasks: ProjectOverviewTask[];
  files: Array<{ archived_at: string | null }>;
  datasets: ProjectOverviewDataset[];
  charts: Array<{ archived_at: string | null }>;
  dashboards: Array<{ archived_at: string | null }>;
  objectTypes: Array<{ id: string }>;
}

interface Member {
  userId: string;
  email: string;
  displayName: string;
  role: Role;
}

type MemberGroupColor = 'slate' | 'sky' | 'emerald' | 'amber' | 'rose' | 'violet';

interface MemberGroup {
  id: string;
  name: string;
  description: string;
  color: MemberGroupColor;
  memberIds: string[];
  updatedAt: string;
}

const memberGroupColors: Array<{ value: MemberGroupColor; label: string; hex: string }> = [
  { value: 'slate', label: 'Slate', hex: '#94a3b8' },
  { value: 'sky', label: 'Sky', hex: '#38bdf8' },
  { value: 'emerald', label: 'Emerald', hex: '#34d399' },
  { value: 'amber', label: 'Amber', hex: '#fbbf24' },
  { value: 'rose', label: 'Rose', hex: '#fb7185' },
  { value: 'violet', label: 'Violet', hex: '#a78bfa' },
];
const memberRoles: Role[] = ['owner', 'admin', 'engineer', 'contributor', 'viewer'];
const formLabelClass = 'text-sm text-slate-300';
const blockFormLabelClass = `block ${formLabelClass}`;
const sectionEyebrowClass = 'font-mono text-xs uppercase tracking-widest text-sky-400';
const pageTitleClass = 'mt-2 text-4xl font-semibold tracking-tight sm:text-5xl';

function memberGroupColor(color: MemberGroupColor): string {
  return memberGroupColors.find((candidate) => candidate.value === color)?.hex ?? '#38bdf8';
}

const onboardingSteps = [
  { key: 'create-project', translationKey: 'onboarding.createProject' },
  { key: 'install-template', translationKey: 'onboarding.installTemplate' },
  { key: 'load-demo', translationKey: 'onboarding.loadDemo' },
  { key: 'trace-results', translationKey: 'onboarding.traceResults' },
  { key: 'create-task', translationKey: 'onboarding.createTask' },
] as const;
type OnboardingStep = (typeof onboardingSteps)[number]['key'];

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function csrfToken(): string | undefined {
  return document.cookie
    .split('; ')
    .find((part) => part.startsWith('engrove_csrf='))
    ?.split('=')[1];
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const response = await fetch(`${apiBase}/api/v1${path}`, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(15_000),
    credentials: 'include',
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(!['GET', 'HEAD'].includes(method) && csrfToken()
        ? { 'x-csrf-token': decodeURIComponent(csrfToken()!) }
        : {}),
      ...init.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string };
  };
  if (!response.ok) {
    throw new ApiError(
      body.error?.code ?? 'REQUEST_FAILED',
      body.error?.message ?? 'Request failed.',
    );
  }
  return body as T;
}

function useAsyncList<T>(load: () => Promise<{ items: T[] }>, dependencies: unknown[]) {
  const [items, setItems] = useState<T[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);
  const refresh = useCallback(async () => {
    const currentRequestId = ++requestId.current;
    setLoading(true);
    try {
      const result = await load();
      if (currentRequestId !== requestId.current) return;
      setItems(result.items);
      setError('');
    } catch (cause) {
      if (currentRequestId !== requestId.current) return;
      setError(cause instanceof Error ? cause.message : 'Request failed.');
    } finally {
      if (currentRequestId === requestId.current) setLoading(false);
    }
  }, dependencies);
  useEffect(() => {
    void refresh();
    return () => {
      requestId.current += 1;
    };
  }, [refresh]);
  return { items, error, loading, refresh };
}

export function ApiStatus() {
  const { t } = useI18n();
  const [state, setState] = useState<'loading' | 'available' | 'unavailable'>('loading');
  const [version, setVersion] = useState('');
  const check = useCallback(async () => {
    setState('loading');
    try {
      const response = await fetch(`${apiBase}/health/ready`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error('not ready');
      const health = (await response.json()) as HealthResponse;
      setVersion(health.version);
      setState('available');
    } catch {
      setState('unavailable');
    }
  }, []);
  useEffect(() => void check(), [check]);

  return (
    <div
      aria-live="polite"
      className="mt-6 rounded-xl border border-slate-800/80 bg-slate-950/45 p-3.5"
    >
      {state === 'loading' && <p className="text-sm text-slate-400">{t('auth.apiChecking')}</p>}
      {state === 'available' && (
        <p className="flex items-center gap-2 text-sm text-emerald-300">
          <span aria-hidden="true" className="status-dot size-1.5 rounded-full bg-emerald-400" />
          {t('auth.apiReady', { version })}
        </p>
      )}
      {state === 'unavailable' && (
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-medium text-amber-300">{t('auth.apiUnavailable')}</p>
            <p className="text-sm text-slate-400">{t('auth.apiUnavailableHint')}</p>
          </div>
          <Button variant="quiet" onClick={() => void check()}>
            {t('common.retry')}
          </Button>
        </div>
      )}
    </div>
  );
}

function AuthCard({ title, children }: PropsWithChildren<{ title: string }>) {
  const { t } = useI18n();
  useEffect(() => {
    document.title = `${title} · Engrove`;
  }, [title]);
  const strengths = [
    ['01', t('auth.evidenceTitle'), t('auth.evidenceBody')],
    ['02', t('auth.unitsTitle'), t('auth.unitsBody')],
    ['03', t('auth.operationsTitle'), t('auth.operationsBody')],
  ] as const;
  return (
    <main className="relative isolate min-h-screen overflow-hidden px-5 py-8 text-slate-100 sm:px-8 lg:grid lg:place-items-center">
      <div aria-hidden="true" className="product-grid absolute inset-0 -z-20" />
      <div
        aria-hidden="true"
        className="absolute -left-32 top-10 -z-10 size-[34rem] rounded-full bg-cyan-500/10 blur-3xl"
      />
      <div className="mx-auto grid w-full max-w-6xl overflow-hidden rounded-3xl border border-slate-800/80 bg-slate-950/55 shadow-2xl shadow-slate-950/25 backdrop-blur-xl lg:grid-cols-[1.15fr_0.85fr]">
        <section className="relative hidden min-h-[600px] overflow-hidden border-r border-slate-800/80 p-10 lg:flex lg:flex-col lg:justify-between">
          <div
            aria-hidden="true"
            className="absolute -right-40 -top-24 size-96 rounded-full bg-sky-400/10 blur-3xl"
          />
          <div>
            <Link to="/" className="relative inline-flex items-center gap-3 text-slate-100">
              <BrandMark className="size-10" />
              <span>
                <span className="block font-semibold tracking-tight">Engrove</span>
                <span className="block font-mono text-[10px] uppercase tracking-[0.2em] text-sky-400">
                  Community
                </span>
              </span>
            </Link>
            <p className="mt-20 max-w-xl break-keep text-4xl font-semibold leading-tight tracking-[-0.035em] xl:text-5xl">
              {t('auth.promise')}
            </p>
            <p className="mt-5 font-mono text-xs uppercase tracking-[0.16em] text-sky-400">
              {t('auth.flow')}
            </p>
          </div>
          <div className="relative grid gap-3">
            {strengths.map(([number, heading, body]) => (
              <div
                className="grid grid-cols-[2rem_1fr] gap-3 rounded-2xl border border-slate-800/80 bg-slate-900/45 p-4"
                key={number}
              >
                <span className="font-mono text-xs text-sky-400">{number}</span>
                <span>
                  <strong className="block text-sm text-slate-200">{heading}</strong>
                  <span className="mt-1 block text-xs leading-relaxed text-slate-500">{body}</span>
                </span>
              </div>
            ))}
          </div>
        </section>
        <section className="flex min-h-[600px] items-center p-6 sm:p-10 lg:p-12">
          <div className="mx-auto w-full max-w-md">
            <Link to="/" className="inline-flex items-center gap-3 text-slate-100 lg:hidden">
              <BrandMark className="size-10" />
              <span className="font-semibold">Engrove</span>
            </Link>
            <p className="mt-10 font-mono text-[10px] uppercase tracking-[0.2em] text-sky-400 lg:mt-0">
              Engrove Community
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-2 text-sm text-slate-400">{t('auth.promise')}</p>
            <div className="mt-7 rounded-2xl border border-slate-700/70 bg-slate-900/55 p-5 shadow-xl shadow-slate-950/15 sm:p-6">
              {children}
            </div>
            <ApiStatus />
          </div>
        </section>
      </div>
    </main>
  );
}

export const inputClass =
  'mt-1 min-h-10 w-full rounded-lg border border-slate-700/80 bg-slate-900/85 px-3 py-2 text-sm text-slate-100 shadow-sm outline-none transition placeholder:text-slate-600 hover:border-slate-600 focus:border-sky-400 focus:ring-3 focus:ring-sky-400/15 disabled:cursor-not-allowed disabled:opacity-50';

function Field({
  autoComplete,
  label,
  name,
  type = 'text',
}: {
  autoComplete?: string;
  label: string;
  name: string;
  type?: string;
}) {
  return (
    <label className={blockFormLabelClass}>
      {label}
      <input autoComplete={autoComplete} className={inputClass} required name={name} type={type} />
    </label>
  );
}

function SetupPage() {
  const { t } = useI18n();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const [message, setMessage] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await api('/setup', {
        method: 'POST',
        body: JSON.stringify({
          token: data.get('token'),
          email: data.get('email'),
          displayName: data.get('displayName'),
          password: data.get('password'),
        }),
      });
      navigate('/sign-in', { replace: true });
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : t('auth.setupFailed'));
    }
  }
  return (
    <AuthCard title={t('auth.setup')}>
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <label className={blockFormLabelClass}>
          {t('auth.setupToken')}
          <input
            className={inputClass}
            required
            name="token"
            defaultValue={search.get('token') ?? ''}
          />
        </label>
        <Field label={t('auth.email')} name="email" type="email" />
        <Field label={t('auth.displayName')} name="displayName" />
        <Field label={t('auth.passwordRequirements')} name="password" type="password" />
        {message && <p className="text-sm text-rose-300">{message}</p>}
        <Button className="w-full" type="submit">
          {t('auth.completeSetup')}
        </Button>
      </form>
    </AuthCard>
  );
}

function SignInPage({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [oidcEnabled, setOidcEnabled] = useState(false);
  useEffect(() => {
    void api<{ enabled: boolean }>('/auth/oidc/status')
      .then((result) => setOidcEnabled(result.enabled))
      .catch(() => setOidcEnabled(false));
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSubmitting(true);
    try {
      const result = await api<{ user: User }>('/auth/sign-in', {
        method: 'POST',
        body: JSON.stringify({ email: data.get('email'), password: data.get('password') }),
      });
      onSignedIn(result.user);
      navigate('/workspaces', { replace: true });
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : t('auth.signInFailed'));
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <AuthCard title={t('auth.signIn')}>
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        {oidcEnabled && (
          <a
            className="block rounded-lg border border-sky-500 px-4 py-2 text-center text-sky-300"
            href={`${apiBase}/api/v1/auth/oidc/start`}
          >
            {t('auth.oidc')}
          </a>
        )}
        <Field autoComplete="email" label={t('auth.email')} name="email" type="email" />
        <Field
          autoComplete="current-password"
          label={t('auth.password')}
          name="password"
          type="password"
        />
        {message && <p className="text-sm text-rose-300">{message}</p>}
        <Button className="w-full" disabled={submitting} type="submit">
          {submitting ? t('auth.signingIn') : t('auth.signIn')}
        </Button>
      </form>
    </AuthCard>
  );
}

function TokenPasswordPage({ invitation }: { invitation: boolean }) {
  const { t } = useI18n();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const [message, setMessage] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await api(invitation ? '/invitations/accept' : '/auth/password-reset', {
        method: 'POST',
        body: JSON.stringify({
          token: data.get('token'),
          ...(invitation ? { displayName: data.get('displayName') } : {}),
          password: data.get('password'),
        }),
      });
      navigate('/sign-in', { replace: true });
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : t('auth.tokenFailed'));
    }
  }
  return (
    <AuthCard title={invitation ? t('auth.acceptInvitation') : t('auth.resetPassword')}>
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <label className={blockFormLabelClass}>
          {t('auth.token')}
          <input
            className={inputClass}
            required
            name="token"
            defaultValue={search.get('token') ?? ''}
          />
        </label>
        {invitation && <Field label={t('auth.displayName')} name="displayName" />}
        <Field label={t('auth.newPasswordRequirements')} name="password" type="password" />
        {message && <p className="text-sm text-rose-300">{message}</p>}
        <Button className="w-full" type="submit">
          {invitation ? t('auth.createAccount') : t('auth.resetPassword')}
        </Button>
      </form>
    </AuthCard>
  );
}

export function allowed(user: User, action: Action): boolean {
  return can({ actorId: user.id, organizationId: user.organizationId, role: user.role }, action);
}

export function NoticeText({
  children,
  tone = 'info',
}: PropsWithChildren<{ tone?: 'info' | 'success' | 'error' }>) {
  const style =
    tone === 'error'
      ? 'border-rose-500/20 bg-rose-500/10 text-rose-200'
      : tone === 'success'
        ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
        : 'border-sky-500/20 bg-sky-500/10 text-sky-200';
  return children ? (
    <p aria-live="polite" className={`mt-4 rounded-xl border px-4 py-3 text-sm ${style}`}>
      {children}
    </p>
  ) : null;
}

export function HelpTip({
  align = 'left',
  children,
  label,
}: PropsWithChildren<{ align?: 'left' | 'right'; label: string }>) {
  return (
    <details className="relative inline-block shrink-0">
      <summary
        aria-label={label}
        className="grid size-6 list-none cursor-pointer place-items-center rounded-full border border-slate-700 text-xs font-semibold text-slate-500 marker:content-none hover:border-sky-500/60 hover:bg-slate-800 hover:text-sky-300"
        title={label}
      >
        ?
      </summary>
      <div
        className={`absolute top-7 z-50 w-80 rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs leading-relaxed text-slate-300 shadow-2xl ${align === 'right' ? 'right-0' : 'left-0'}`}
        role="note"
        style={{ maxWidth: 'calc(100vw - 2rem)' }}
      >
        {children}
      </div>
    </details>
  );
}

export function ErrorText({ children }: PropsWithChildren) {
  return <NoticeText tone="error">{children}</NoticeText>;
}

function NotFoundPage() {
  const { locale } = useI18n();
  const korean = locale === 'ko';
  return (
    <section className="mx-auto max-w-2xl py-16 text-center sm:py-24">
      <p className={sectionEyebrowClass}>404</p>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
        {korean ? '페이지를 찾을 수 없습니다.' : 'Page not found.'}
      </h1>
      <p className="mt-3 text-sm text-slate-500">
        {korean ? '주소를 확인하거나 다시 시작하세요.' : 'Check the address or start again.'}
      </p>
      <Button asChild className="mt-7">
        <Link to="/workspaces">{korean ? '워크스페이스로 이동' : 'Go to workspaces'}</Link>
      </Button>
    </section>
  );
}

function WorkspacesPage({ user }: { user: User }) {
  const { locale, t } = useI18n();
  const { items, error, loading, refresh } = useAsyncList<Workspace>(() => api('/workspaces'), []);
  const [formError, setFormError] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingWorkspaceId, setEditingWorkspaceId] = useState('');
  const [editError, setEditError] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false);
  const [workspaceSearch, setWorkspaceSearch] = useState('');
  const createWorkspaceDialogRef = useModalDialog<HTMLDivElement>(showCreateWorkspace, () => {
    if (!creating) setShowCreateWorkspace(false);
  });
  const openWorkspaceLabel = locale === 'ko' ? '워크스페이스 열기' : 'Open workspace';
  const editingWorkspace = items.find((workspace) => workspace.id === editingWorkspaceId);
  const filteredItems = useMemo(() => {
    const query = workspaceSearch.trim().toLocaleLowerCase(locale);
    if (!query) return items;
    return items.filter((workspace) =>
      [workspace.name, workspace.slug, workspace.description].some((value) =>
        (value ?? '').toLocaleLowerCase(locale).includes(query),
      ),
    );
  }, [items, locale, workspaceSearch]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setCreating(true);
    try {
      await api('/workspaces', {
        method: 'POST',
        body: JSON.stringify({
          name: data.get('name'),
          slug: data.get('slug'),
          description: data.get('description'),
        }),
      });
      form.reset();
      setFormError('');
      setShowCreateWorkspace(false);
      await refresh();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : t('workspaces.creationFailed'));
    } finally {
      setCreating(false);
    }
  }
  async function editWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingWorkspace || savingEdit) return;
    const data = new FormData(event.currentTarget);
    setSavingEdit(true);
    try {
      await api(`/workspaces/${editingWorkspace.publicId ?? editingWorkspace.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: data.get('name'),
          key: data.get('key'),
          description: data.get('description'),
        }),
      });
      await refresh();
      setEditingWorkspaceId('');
      setEditError('');
    } catch (cause) {
      setEditError(cause instanceof Error ? cause.message : t('workspaces.updateFailed'));
    } finally {
      setSavingEdit(false);
    }
  }
  return (
    <>
      <section className="workspace-hero relative isolate overflow-hidden rounded-xl border border-slate-800/80 p-4 sm:p-5">
        <div aria-hidden="true" className="product-grid absolute inset-0 -z-10 opacity-55" />
        <div className="grid items-center gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <div>
              <div className="flex items-center gap-3">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-400">
                  {t('workspaces.homeEyebrow')}
                </p>
                <span className="h-px w-8 bg-gradient-to-r from-sky-400/70 to-transparent" />
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <h1 className="max-w-2xl text-2xl font-semibold tracking-[-0.03em]">
                  {t('workspaces.welcome', { name: user.displayName })}
                </h1>
                <HelpTip label={t('workspaces.about')}>{t('workspaces.description')}</HelpTip>
              </div>
              <p className="mt-1.5 max-w-2xl text-xs leading-5 text-slate-400 sm:text-sm">
                {t('workspaces.homeIntro')}
              </p>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {allowed(user, 'workspace.manage') && (
                <Button onClick={() => setShowCreateWorkspace(true)} type="button">
                  <span aria-hidden="true" className="mr-1 text-base leading-none">
                    +
                  </span>
                  {t('workspaces.create')}
                </Button>
              )}
              <Button asChild variant="quiet">
                <Link to="/get-started">{t('workspaces.guidedSetup')} →</Link>
              </Button>
              <span className="inline-flex items-center gap-2 rounded-full border border-slate-800/80 bg-slate-950/35 px-2.5 py-1 text-[11px] text-slate-400">
                <span className="status-dot size-1.5 rounded-full bg-emerald-400" />
                {t('workspaces.activeCount', { count: items.length })}
              </span>
            </div>
          </div>

          <aside
            aria-label={t('workspaces.traceFlow')}
            className="workspace-trace-panel rounded-xl border border-slate-700/70 bg-slate-950/45 p-3 lg:w-[30rem]"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xs font-semibold text-slate-200">{t('workspaces.traceFlow')}</h2>
              <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                {t('workspaces.traceReady')}
              </span>
            </div>
            <div className="workspace-trace-flow mt-2 grid grid-cols-4 gap-1.5">
              {[
                ['01', t('workspaces.traceEvidence')],
                ['02', t('workspaces.traceData')],
                ['03', t('workspaces.traceDecision')],
                ['04', t('workspaces.traceAction')],
              ].map(([step, label]) => (
                <div
                  className="workspace-trace-step relative rounded-lg border border-slate-800/85 bg-slate-900/70 px-2 py-1.5"
                  key={step}
                >
                  <span className="font-mono text-[8px] text-sky-400">{step}</span>
                  <strong className="mt-0.5 block truncate text-[10px] font-medium text-slate-300">
                    {label}
                  </strong>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </section>
      <ErrorText>{error}</ErrorText>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-400">
            {t('workspaces.portfolio')}
          </p>
          <h2 className="mt-0.5 text-lg font-semibold tracking-tight text-slate-100">
            {t('workspaces.yourWorkspaces')}
          </h2>
          <p aria-live="polite" className="text-[11px] text-slate-500">
            {workspaceSearch
              ? t('workspaces.results', { count: filteredItems.length, total: items.length })
              : t('workspaces.count', { count: items.length })}
          </p>
        </div>
        <div className="relative w-full sm:max-w-xs">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500"
          >
            ⌕
          </span>
          <input
            aria-label={t('workspaces.searchLabel')}
            className={`${inputClass} h-9 pl-9 pr-9`}
            onChange={(event) => setWorkspaceSearch(event.target.value)}
            placeholder={t('workspaces.searchPlaceholder')}
            type="search"
            value={workspaceSearch}
          />
          {workspaceSearch && (
            <button
              aria-label={t('workspaces.clearSearch')}
              className="absolute right-1.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-slate-500 hover:bg-slate-800 hover:text-slate-200"
              onClick={() => setWorkspaceSearch('')}
              type="button"
            >
              ×
            </button>
          )}
        </div>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2 min-[1180px]:grid-cols-3">
        {loading &&
          Array.from({ length: 3 }, (_, index) => (
            <div
              aria-hidden="true"
              className="min-h-44 animate-pulse rounded-xl border border-slate-800 bg-slate-900/55 p-4"
              key={index}
            >
              <div className="size-11 rounded-xl bg-slate-800" />
              <div className="mt-4 h-5 w-2/3 rounded bg-slate-800" />
              <div className="mt-2 h-3 w-1/2 rounded bg-slate-800/80" />
              <div className="mt-4 h-8 rounded bg-slate-800/60" />
            </div>
          ))}
        {filteredItems.map((workspace, index) => (
          <article
            className="workspace-card group relative rounded-xl border border-slate-800/90 bg-slate-900/85 shadow-lg shadow-slate-950/10 hover:border-sky-500/55"
            data-accent={['sky', 'teal', 'amber'][index % 3]}
            key={workspace.id}
          >
            <Link className="block p-4" to={`/workspaces/${workspace.publicId ?? workspace.id}`}>
              <div className="flex items-start justify-between gap-4">
                <span className="workspace-card-icon grid size-9 place-items-center rounded-lg border font-mono text-xs font-semibold shadow-inner">
                  {workspace.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="grid size-8 place-items-center rounded-full border border-slate-800 bg-slate-950/45 text-slate-500 transition group-hover:translate-x-1 group-hover:border-sky-500/30 group-hover:text-sky-300">
                  →
                </span>
              </div>
              <h3 className="mt-3 text-base font-semibold tracking-[-0.01em]">{workspace.name}</h3>
              <p className="mt-1 font-mono text-[11px] text-slate-500">/{workspace.slug}</p>
              <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-400">
                {workspace.description || t('workspaces.open')}
              </p>
              <div className="mt-3 flex items-center gap-2 border-t border-slate-800/80 pt-3 text-[10px] font-medium text-slate-500">
                <span className="status-dot size-1.5 rounded-full bg-emerald-400" />
                {openWorkspaceLabel}
              </div>
            </Link>
            {allowed(user, 'workspace.manage') && (
              <button
                aria-label={`${t('workspaces.edit')} ${workspace.name}`}
                className="absolute right-12 top-4 grid size-8 place-items-center rounded-full text-base text-slate-500 hover:bg-slate-800 hover:text-sky-300 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
                onClick={() => {
                  setEditingWorkspaceId(workspace.id);
                  setEditError('');
                }}
                type="button"
              >
                ⋯
              </button>
            )}
          </article>
        ))}
        {!loading &&
          allowed(user, 'workspace.manage') &&
          !showCreateWorkspace &&
          !workspaceSearch && (
            <button
              aria-label={t('workspaces.create')}
              className="group min-h-44 rounded-xl border border-dashed border-slate-700 bg-slate-900/30 p-4 text-left transition hover:border-sky-500/50 hover:bg-sky-500/5"
              onClick={() => setShowCreateWorkspace(true)}
              type="button"
            >
              <span className="grid size-9 place-items-center rounded-lg border border-slate-700 bg-slate-900 text-lg text-sky-300 transition group-hover:scale-105 group-hover:border-sky-500/40">
                +
              </span>
              <strong className="mt-3 block text-base text-slate-200">
                {t('workspaces.create')}
              </strong>
              <span className="mt-1 block max-w-xs text-xs leading-5 text-slate-500">
                {t('workspaces.stableSlug')}
              </span>
            </button>
          )}
        {!loading && items.length === 0 && !error && (
          <p className="rounded-2xl border border-dashed border-slate-700 p-8 text-slate-400">
            {t('workspaces.empty')}
          </p>
        )}
        {!loading && items.length > 0 && filteredItems.length === 0 && (
          <div className="col-span-full rounded-2xl border border-dashed border-slate-700 bg-slate-900/35 px-6 py-12 text-center">
            <span
              aria-hidden="true"
              className="mx-auto grid size-11 place-items-center rounded-xl border border-slate-700 bg-slate-900 text-lg text-slate-500"
            >
              ⌕
            </span>
            <h3 className="mt-4 text-lg font-semibold text-slate-200">
              {t('workspaces.noSearchResults')}
            </h3>
            <p className="mt-1 text-sm text-slate-500">{t('workspaces.noSearchResultsBody')}</p>
            <Button className="mt-5" onClick={() => setWorkspaceSearch('')} variant="quiet">
              {t('workspaces.showAll')}
            </Button>
          </div>
        )}
      </div>
      {editingWorkspace && allowed(user, 'workspace.manage') && (
        <form
          className="mt-6 max-w-2xl rounded-2xl border border-sky-800/50 bg-slate-900/60 p-5 shadow-lg shadow-slate-950/10 sm:p-6"
          key={editingWorkspace.id}
          onSubmit={(event) => void editWorkspace(event)}
        >
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold">{t('workspaces.edit')}</h2>
            <button
              aria-label={t('workspaces.closeEditor')}
              className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-800 hover:text-slate-200"
              onClick={() => setEditingWorkspaceId('')}
              type="button"
            >
              ×
            </button>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className={formLabelClass}>
              {t('workspaces.name')}
              <input
                className={inputClass}
                defaultValue={editingWorkspace.name}
                name="name"
                required
              />
            </label>
            <label className={formLabelClass}>
              {t('workspaces.key')}
              <input
                className={inputClass}
                defaultValue={editingWorkspace.slug}
                name="key"
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                required
                title={t('workspaces.slugHint')}
              />
            </label>
          </div>
          <label className="mt-4 block text-sm text-slate-300">
            {t('workspaces.descriptionLabel')}
            <textarea
              className={`${inputClass} min-h-20 resize-y`}
              defaultValue={editingWorkspace.description}
              name="description"
            />
          </label>
          <div className="mt-5 flex items-center gap-3">
            <Button disabled={savingEdit} type="submit">
              {savingEdit ? t('common.working') : t('workspaces.save')}
            </Button>
            <button
              className="rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              onClick={() => setEditingWorkspaceId('')}
              type="button"
            >
              {t('common.cancel')}
            </button>
          </div>
          <ErrorText>{editError}</ErrorText>
        </form>
      )}
      {allowed(user, 'workspace.manage') && showCreateWorkspace && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center p-4 sm:p-6"
          role="presentation"
        >
          <button
            aria-label={t('workspaces.closeCreator')}
            className="absolute inset-0 cursor-default bg-slate-950/70 backdrop-blur-sm"
            data-modal-backdrop
            disabled={creating}
            onClick={() => setShowCreateWorkspace(false)}
            type="button"
          />
          <div
            aria-labelledby="workspace-creator-title"
            aria-modal="true"
            className="relative max-h-[min(720px,calc(100vh-2rem))] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl shadow-black/50"
            ref={createWorkspaceDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-800 bg-slate-950/90 px-5 py-4 backdrop-blur-xl sm:px-6">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-sky-400">
                  {t('sidebar.organization')}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <h2 className="text-2xl font-semibold" id="workspace-creator-title">
                    {t('workspaces.create')}
                  </h2>
                  <HelpTip align="right" label={t('workspaces.addressHelp')}>
                    {t('workspaces.stableSlug')}
                  </HelpTip>
                </div>
              </div>
              <button
                aria-label={t('workspaces.closeCreator')}
                className="grid size-9 place-items-center rounded-lg border border-slate-700 text-xl text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                disabled={creating}
                onClick={() => setShowCreateWorkspace(false)}
                type="button"
              >
                ×
              </button>
            </header>
            <form
              className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6"
              onSubmit={(event) => void submit(event)}
            >
              <label className={formLabelClass}>
                {t('workspaces.name')}
                <input
                  className={inputClass}
                  data-dialog-initial-focus
                  name="name"
                  placeholder={t('workspaces.nameExample')}
                  required
                />
              </label>
              <label className={formLabelClass}>
                {t('workspaces.key')}
                <input
                  className={inputClass}
                  name="slug"
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  placeholder={t('workspaces.keyExample')}
                  required
                  title={t('workspaces.slugHint')}
                />
              </label>
              <label className={`${formLabelClass} sm:col-span-2`}>
                {t('workspaces.descriptionLabel')}
                <textarea
                  className={`${inputClass} min-h-24 resize-y`}
                  name="description"
                  placeholder={t('workspaces.descriptionPlaceholder')}
                />
              </label>
              {formError && (
                <div className="sm:col-span-2">
                  <ErrorText>{formError}</ErrorText>
                </div>
              )}
              <div className="flex justify-end gap-2 border-t border-slate-800 pt-4 sm:col-span-2">
                <Button
                  disabled={creating}
                  onClick={() => setShowCreateWorkspace(false)}
                  type="button"
                  variant="quiet"
                >
                  {t('common.cancel')}
                </Button>
                <Button disabled={creating} type="submit">
                  {creating ? t('common.working') : t('workspaces.create')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function WorkspacePage({ user }: { user: User }) {
  const { t } = useI18n();
  const id = useParams().workspaceId!;
  const { items, error, loading, refresh } = useAsyncList<Project>(
    () => api(`/workspaces/${id}/projects`),
    [id],
  );
  const [formError, setFormError] = useState('');
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [creating, setCreating] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setCreating(true);
    try {
      await api(`/workspaces/${id}/projects`, {
        method: 'POST',
        body: JSON.stringify({ name: data.get('name'), key: data.get('key'), description: '' }),
      });
      form.reset();
      setShowCreateProject(false);
      setFormError('');
      await refresh();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : t('projects.creationFailed'));
    } finally {
      setCreating(false);
    }
  }
  const createProjectOpen = showCreateProject || (!loading && items.length === 0);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            {t('projects.heading')}
          </h1>
          <HelpTip label={t('projects.about')}>{t('projects.description')}</HelpTip>
        </div>
        {allowed(user, 'project.create') && !createProjectOpen && (
          <Button onClick={() => setShowCreateProject(true)} type="button">
            <span aria-hidden="true" className="mr-1 text-base leading-none">
              +
            </span>
            {t('projects.create')}
          </Button>
        )}
      </div>
      <ErrorText>{error}</ErrorText>
      <div className="mt-8 divide-y divide-slate-800 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/50 shadow-xl shadow-slate-950/10">
        {loading && (
          <div aria-label={t('common.loading')} className="space-y-4 p-6">
            {Array.from({ length: 3 }, (_, index) => (
              <div className="animate-pulse" key={index}>
                <div className="h-5 w-1/3 rounded bg-slate-800" />
                <div className="mt-2 h-3 w-1/5 rounded bg-slate-800/70" />
              </div>
            ))}
          </div>
        )}
        {items.map((project) => (
          <Link
            className="group flex items-center justify-between gap-4 p-5 hover:bg-slate-800/60 sm:p-6"
            key={project.id}
            to={`/workspaces/${id}/projects/${project.publicId ?? project.id}`}
          >
            <span className="min-w-0">
              <strong className="block truncate text-base group-hover:text-sky-200">
                {project.name}
              </strong>
              <span className="mt-1 block font-mono text-xs text-slate-500">
                {project.key} · {project.publicId ?? project.id}
              </span>
            </span>
            <span
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${project.archivedAt ? 'bg-amber-500/10 text-amber-300' : 'bg-emerald-500/10 text-emerald-300'}`}
            >
              {project.archivedAt ? t('projects.archived') : project.status}
            </span>
          </Link>
        ))}
        {!loading && items.length === 0 && !error && (
          <p className="p-8 text-slate-400">{t('projects.empty')}</p>
        )}
      </div>
      {allowed(user, 'project.create') && createProjectOpen && (
        <form
          className="mt-10 max-w-2xl rounded-2xl border border-slate-800 bg-slate-900/40 p-5 sm:p-6"
          onSubmit={(event) => void submit(event)}
        >
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold">{t('projects.create')}</h2>
            {items.length > 0 && (
              <button
                aria-label={t('common.close')}
                className="grid size-8 place-items-center rounded-lg text-lg text-slate-500 hover:bg-slate-800 hover:text-slate-200"
                onClick={() => setShowCreateProject(false)}
                type="button"
              >
                ×
              </button>
            )}
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className={formLabelClass}>
              {t('projects.name')}
              <input
                className={inputClass}
                name="name"
                placeholder="Force characterization"
                required
              />
            </label>
            <label className={formLabelClass}>
              {t('projects.key')}
              <input className={inputClass} name="key" placeholder="FORCE" required />
            </label>
          </div>
          <Button className="mt-5" disabled={creating} type="submit">
            {creating ? t('common.working') : t('projects.create')}
          </Button>
          <ErrorText>{formError}</ErrorText>
        </form>
      )}
    </>
  );
}

function WorkspaceDataPage({ user }: { user: User }) {
  const { t } = useI18n();
  const workspaceId = useParams().workspaceId!;
  const [context, setContext] = useState<WorkspaceDataContext>();
  const [error, setError] = useState<{ message: string; workspaceId: string }>();
  const requestId = useRef(0);
  const load = useCallback(async () => {
    const currentRequestId = ++requestId.current;
    try {
      const [dataContext, projectResult] = await Promise.all([
        api<{ projectId: string; legacyProjectIds?: string[] }>(
          `/workspaces/${workspaceId}/data-context`,
          {
            method: 'POST',
            body: JSON.stringify({}),
          },
        ),
        api<{ items: Project[] }>(`/workspaces/${workspaceId}/projects`),
      ]);
      if (currentRequestId !== requestId.current) return;
      setContext({
        workspaceId,
        backingProjectId: dataContext.projectId,
        projects: projectResult.items.map(({ id, name, key, archivedAt }) => ({
          id,
          name,
          key,
          archivedAt,
        })),
        legacyProjects: projectResult.items
          .filter((project) => dataContext.legacyProjectIds?.includes(project.id))
          .map(({ id, name }) => ({ id, name })),
      });
      setError(undefined);
    } catch (cause) {
      if (currentRequestId !== requestId.current) return;
      setError({
        workspaceId,
        message: cause instanceof Error ? cause.message : t('workspaces.dataOpenFailed'),
      });
    }
  }, [t, workspaceId]);
  useEffect(() => {
    void load();
    return () => {
      requestId.current += 1;
    };
  }, [load]);

  if (error?.workspaceId === workspaceId)
    return (
      <div className="mx-auto max-w-2xl py-12">
        <ErrorText>{error.message}</ErrorText>
        <Button className="mt-4" variant="quiet" onClick={() => void load()}>
          {t('common.retry')}
        </Button>
      </div>
    );
  if (context?.workspaceId !== workspaceId)
    return (
      <div aria-label={t('workspaces.openingData')} className="animate-pulse space-y-3 p-2">
        <div className="h-8 w-52 rounded-lg bg-slate-800/80" />
        <div className="h-10 rounded-xl bg-slate-900/70" />
        <div className="h-64 rounded-2xl border border-slate-800 bg-slate-900/35" />
      </div>
    );
  return (
    <PageLoader label={t('data.workspaceData')}>
      <DataPage
        key={`${context.workspaceId}:${context.backingProjectId}`}
        user={user}
        workspaceData={context}
      />
    </PageLoader>
  );
}

function ProjectDataPage({ user }: { user: User }) {
  const { projectId = '', workspaceId = '' } = useParams();
  return <DataPage key={`${workspaceId}:${projectId}`} user={user} />;
}

function WorkspaceIndexPage() {
  const workspaceId = useParams().workspaceId!;
  return <Navigate replace to={`/workspaces/${workspaceId}/data`} />;
}

function ProjectPage({ user }: { user: User }) {
  const { formatDate, formatNumber, t } = useI18n();
  const { workspaceId: wid, projectId: pid } = useParams();
  const [project, setProject] = useState<Project>();
  const [overview, setOverview] = useState<ProjectOverview>({
    metrics: undefined,
    tasks: [],
    files: [],
    datasets: [],
    charts: [],
    dashboards: [],
    objectTypes: [],
  });
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewWarning, setOverviewWarning] = useState('');
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'info' | 'success' | 'error'>('info');
  const [demo, setDemo] = useState<{
    installed: boolean;
    installation?: Record<string, unknown>;
  }>();
  const [installingDemo, setInstallingDemo] = useState(false);
  const load = useCallback(async () => {
    const result = await api<{ items: Project[] }>(`/workspaces/${wid}/projects`);
    setProject(result.items.find((item) => (item.publicId ?? item.id) === pid || item.id === pid));
  }, [wid, pid]);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    void api<{ installed: boolean; installation?: Record<string, unknown> }>(
      `/workspaces/${wid}/projects/${pid}/demo`,
    )
      .then(setDemo)
      .catch(() => setDemo({ installed: false }));
  }, [wid, pid]);
  useEffect(() => {
    let cancelled = false;
    let partialFailure = false;
    const base = `/workspaces/${wid}/projects/${pid}`;

    async function safeItems<T>(path: string, enabled: boolean): Promise<T[]> {
      if (!enabled) return [];
      try {
        return (await api<{ items: T[] }>(path)).items;
      } catch {
        partialFailure = true;
        return [];
      }
    }

    async function safeMetrics(): Promise<ProjectOverviewMetrics | undefined> {
      if (!allowed(user, 'dataset.read')) return undefined;
      try {
        return await api<ProjectOverviewMetrics>(`${base}/dashboard-metrics`);
      } catch {
        partialFailure = true;
        return undefined;
      }
    }

    setOverviewLoading(true);
    void Promise.all([
      safeMetrics(),
      safeItems<ProjectOverviewTask>(
        `${base}/tasks?includeArchived=true`,
        allowed(user, 'task.read'),
      ),
      safeItems<{ archived_at: string | null }>(
        `${base}/files?includeArchived=true`,
        allowed(user, 'file.read'),
      ),
      safeItems<ProjectOverviewDataset>(
        `${base}/datasets?includeArchived=true`,
        allowed(user, 'dataset.read'),
      ),
      safeItems<{ archived_at: string | null }>(
        `${base}/charts?includeArchived=true`,
        allowed(user, 'dataset.read'),
      ),
      safeItems<{ archived_at: string | null }>(
        `${base}/dashboards?includeArchived=true`,
        allowed(user, 'dataset.read'),
      ),
      safeItems<{ id: string }>(`${base}/object-types`, allowed(user, 'schema.read')),
    ]).then(([metrics, tasks, files, datasets, charts, dashboards, objectTypes]) => {
      if (cancelled) return;
      setOverview({ metrics, tasks, files, datasets, charts, dashboards, objectTypes });
      setOverviewWarning(partialFailure ? t('projects.overviewLoadPartial') : '');
      setOverviewLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [pid, t, user, wid]);
  if (!project) return <p>{t('projects.loading')}</p>;

  const activeTasks = overview.tasks.filter((task) => !task.archived_at);
  const openTasks = activeTasks.filter((task) => task.status !== 'done');
  const completedTasks = activeTasks.filter((task) => task.status === 'done');
  const blockedTasks = activeTasks.filter((task) => task.status === 'blocked');
  const taskProgress = activeTasks.length
    ? Math.round((completedTasks.length / activeTasks.length) * 100)
    : 0;
  const activeFiles = overview.files.filter((file) => !file.archived_at);
  const activeDatasets = overview.datasets.filter((dataset) => !dataset.archived_at);
  const readyDatasets = activeDatasets.filter((dataset) => dataset.status === 'ready');
  const activeCharts = overview.charts.filter((chart) => !chart.archived_at);
  const activeDashboards = overview.dashboards.filter((dashboard) => !dashboard.archived_at);
  const passRateValue = overview.metrics?.pass_rate
    ? Number(overview.metrics.pass_rate)
    : undefined;
  const passRate = Number.isFinite(passRateValue) ? Math.min(100, Math.max(0, passRateValue!)) : 0;
  const failedEvaluations = overview.metrics?.failed_evaluations ?? 0;
  const overdueTasks = overview.metrics?.overdue_tasks ?? 0;
  const recentDatasets = overview.metrics?.recent_datasets.length
    ? overview.metrics.recent_datasets
    : activeDatasets.slice(0, 4);
  const needsAttention = failedEvaluations + overdueTasks + blockedTasks.length > 0;
  const basePath = `/workspaces/${wid}/projects/${pid}`;

  async function archive(archived: boolean) {
    try {
      await api(`/workspaces/${wid}/projects/${pid}/${archived ? 'archive' : 'restore'}`, {
        method: 'POST',
        body: JSON.stringify(archived ? { reason: 'Archived from project settings' } : {}),
      });
      await load();
      setMessageTone('success');
      setMessage(archived ? t('projects.archived') : t('projects.restored'));
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('projects.updateFailed'));
    }
  }
  async function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      const updated = await api<Project>(`/workspaces/${wid}/projects/${pid}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: data.get('name'),
          description: data.get('description'),
          status: data.get('status'),
          rowVersion: project!.rowVersion,
        }),
      });
      setProject(updated);
      setMessageTone('success');
      setMessage(t('projects.settingsSaved'));
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('projects.updateFailed'));
    }
  }
  async function installDemo() {
    setInstallingDemo(true);
    setMessageTone('info');
    setMessage(t('projects.installing'));
    try {
      const result = await api<Record<string, unknown>>(
        `/workspaces/${wid}/projects/${pid}/demo/install`,
        { method: 'POST', body: '{}' },
      );
      setDemo({ installed: true, installation: result });
      const progress = await api<{ completed_steps: OnboardingStep[] }>('/onboarding');
      await api('/onboarding', {
        method: 'PATCH',
        body: JSON.stringify({
          completedSteps: Array.from(
            new Set([
              ...(progress.completed_steps ?? []),
              'create-project',
              'install-template',
              'load-demo',
            ]),
          ),
          dismissed: false,
        }),
      });
      setMessageTone('success');
      setMessage(t('projects.installedMessage'));
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('projects.demoFailed'));
    } finally {
      setInstallingDemo(false);
    }
  }
  return (
    <>
      <Link
        className="text-sm text-slate-400 hover:text-sky-300"
        to={`/workspaces/${wid}/projects`}
      >
        ← {t('common.projects')}
      </Link>
      <section className="relative mt-5 overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-900/90 to-sky-950/70 p-6 shadow-2xl shadow-slate-950/20 sm:p-8">
        <div
          aria-hidden="true"
          className="absolute -right-20 -top-24 size-72 rounded-full bg-sky-500/10 blur-3xl"
        />
        <div className="relative">
          <div className="grid items-center gap-8 lg:grid-cols-[1fr_auto]">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <p className="font-mono text-xs uppercase tracking-[0.18em] text-sky-400">
                  {t('projects.dashboardEyebrow')} · {project.key}
                </p>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${project.archivedAt ? 'bg-amber-500/10 text-amber-300' : 'bg-emerald-500/10 text-emerald-300'}`}
                >
                  {project.archivedAt
                    ? t('common.archived')
                    : project.status === 'active'
                      ? t('projects.active')
                      : project.status === 'on_hold'
                        ? t('projects.onHold')
                        : t('projects.completed')}
                </span>
              </div>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
                {project.name}
              </h1>
              <p className="mt-4 max-w-2xl text-slate-400">
                {project.description || t('projects.noDescription')}
              </p>
              {allowed(user, 'record.read') && (
                <Link
                  className="mt-6 inline-flex items-center gap-2 rounded-xl bg-sky-400 px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-sky-950/30 transition hover:bg-sky-300"
                  to={`${basePath}/data`}
                >
                  {t('projects.openData')} <span aria-hidden="true">→</span>
                </Link>
              )}
            </div>
            {allowed(user, 'dataset.read') && (
              <div className="flex items-center gap-5 rounded-2xl border border-white/10 bg-slate-950/35 p-4 backdrop-blur">
                <div
                  aria-label={`${t('projects.passRate')} ${passRateValue === undefined ? t('projects.noQualityData') : `${passRate}%`}`}
                  className="grid size-28 shrink-0 place-items-center rounded-full"
                  style={{
                    background: `conic-gradient(rgb(56 189 248) ${passRate}%, rgb(30 41 59) ${passRate}% 100%)`,
                  }}
                >
                  <div className="grid size-20 place-items-center rounded-full bg-slate-950 text-center">
                    <span className="text-xl font-semibold">
                      {overviewLoading || passRateValue === undefined
                        ? '—'
                        : `${formatNumber(passRate)}%`}
                    </span>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                    {t('projects.health')}
                  </p>
                  <p className="mt-1 text-sm font-medium text-slate-200">
                    {t('projects.passRate')}
                  </p>
                  {passRateValue === undefined && !overviewLoading && (
                    <p className="mt-1 text-xs text-slate-500">{t('projects.noQualityData')}</p>
                  )}
                </div>
              </div>
            )}
          </div>
          <div
            aria-hidden="true"
            className="absolute -bottom-28 left-1/3 size-64 rounded-full bg-indigo-500/10 blur-3xl"
          />
        </div>
      </section>

      <section
        aria-label={t('projects.health')}
        className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        {[
          {
            label: t('projects.passRate'),
            value:
              overviewLoading || passRateValue === undefined ? '—' : `${formatNumber(passRate)}%`,
            accent: 'bg-sky-400',
          },
          {
            label: t('projects.openTasks'),
            value: overviewLoading ? '—' : formatNumber(openTasks.length),
            accent: 'bg-amber-400',
          },
          {
            label: t('projects.readyDatasets'),
            value: overviewLoading
              ? '—'
              : formatNumber(overview.metrics?.dataset_count ?? readyDatasets.length),
            accent: 'bg-emerald-400',
          },
          {
            label: t('projects.dataTables'),
            value: overviewLoading ? '—' : formatNumber(overview.objectTypes.length),
            accent: 'bg-violet-400',
          },
        ].map((metric) => (
          <article
            className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/55 p-5"
            key={metric.label}
          >
            <span className={`absolute inset-y-0 left-0 w-1 ${metric.accent}`} />
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
              {metric.label}
            </p>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-100">
              {metric.value}
            </p>
          </article>
        ))}
      </section>

      {overviewWarning && <NoticeText tone="error">{overviewWarning}</NoticeText>}

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.15fr_0.85fr_1fr]">
        <section className="rounded-2xl border border-slate-800 bg-slate-900/45 p-5">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold">{t('projects.needsAttention')}</h2>
            <span
              className={`size-2.5 rounded-full ${needsAttention ? 'bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.65)]' : 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.55)]'}`}
            />
          </div>
          {overviewLoading ? (
            <div className="mt-5 space-y-3" aria-hidden="true">
              <div className="h-11 animate-pulse rounded-xl bg-slate-800/70" />
              <div className="h-11 animate-pulse rounded-xl bg-slate-800/70" />
            </div>
          ) : needsAttention ? (
            <div className="mt-4 divide-y divide-slate-800">
              {[
                [t('projects.failedEvaluations'), failedEvaluations],
                [t('projects.overdueTasks'), overdueTasks],
                [t('projects.blockedTasks'), blockedTasks.length],
              ].map(([label, value]) => (
                <div className="flex items-center justify-between py-3 text-sm" key={String(label)}>
                  <span className="text-slate-400">{label}</span>
                  <span
                    className={
                      Number(value) > 0 ? 'font-semibold text-amber-300' : 'text-slate-600'
                    }
                  >
                    {formatNumber(Number(value))}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-5 rounded-xl border border-emerald-500/15 bg-emerald-500/5 p-4">
              <p className="font-medium text-emerald-300">{t('projects.allClear')}</p>
              <p className="mt-1 text-sm text-slate-500">{t('projects.allClearBody')}</p>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/45 p-5">
          <h2 className="text-lg font-semibold">{t('projects.taskProgress')}</h2>
          <div className="mt-5 flex items-end justify-between gap-4">
            <p className="text-4xl font-semibold tracking-tight">
              {overviewLoading ? '—' : `${taskProgress}%`}
            </p>
            <p className="text-right text-xs text-slate-500">
              {activeTasks.length
                ? t('projects.tasksCompleted', {
                    done: formatNumber(completedTasks.length),
                    total: formatNumber(activeTasks.length),
                  })
                : t('projects.noTasksYet')}
            </p>
          </div>
          <div
            aria-label={t('projects.taskProgress')}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={taskProgress}
            className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800"
            role="progressbar"
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-400 transition-[width]"
              style={{ width: `${taskProgress}%` }}
            />
          </div>
          {allowed(user, 'task.read') && (
            <Link
              className="mt-6 inline-flex text-sm font-medium text-sky-300 hover:text-sky-200"
              to={`${basePath}/tasks`}
            >
              {t('common.tasks')}{' '}
              <span aria-hidden="true" className="ml-2">
                →
              </span>
            </Link>
          )}
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/45 p-5">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold">{t('projects.recentDatasets')}</h2>
            {allowed(user, 'file.read') && (
              <Link
                className="text-xs font-medium text-sky-300 hover:text-sky-200"
                to={`${basePath}/files-datasets`}
              >
                {t('common.filesDatasets')} →
              </Link>
            )}
          </div>
          {overviewLoading ? (
            <div className="mt-4 space-y-3" aria-hidden="true">
              <div className="h-10 animate-pulse rounded-lg bg-slate-800/70" />
              <div className="h-10 animate-pulse rounded-lg bg-slate-800/70" />
            </div>
          ) : recentDatasets.length ? (
            <div className="mt-3 divide-y divide-slate-800">
              {recentDatasets.slice(0, 4).map((dataset) => (
                <div className="flex items-center justify-between gap-3 py-3" key={dataset.id}>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-200">{dataset.name}</p>
                    <p className="mt-0.5 text-xs text-slate-600">
                      {dataset.row_count === undefined
                        ? dataset.status
                        : t('projects.rows', { count: formatNumber(dataset.row_count) })}
                    </p>
                  </div>
                  {dataset.created_at && (
                    <time className="shrink-0 text-xs text-slate-600" dateTime={dataset.created_at}>
                      {formatDate(dataset.created_at, { month: 'short', day: 'numeric' })}
                    </time>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-5 text-sm text-slate-500">{t('projects.noDatasetsYet')}</p>
          )}
        </section>
      </div>
      <section className="mt-8">
        <p className={sectionEyebrowClass}>{t('projects.continueWorking')}</p>
        <div className="mt-2 flex items-end justify-between gap-4">
          <h2 className="text-2xl font-semibold">{t('projects.quickLinks')}</h2>
          <p className="hidden text-sm text-slate-500 sm:block">{t('projects.dashboardHint')}</p>
        </div>
        <nav
          aria-label={t('projects.quickLinks')}
          className="mt-4 grid gap-4 sm:grid-cols-2 min-[1280px]:grid-cols-5"
        >
          {allowed(user, 'record.read') && (
            <Link
              className="group rounded-2xl border border-slate-800 bg-slate-900/45 p-5 transition hover:-translate-y-0.5 hover:border-sky-500/50 hover:bg-sky-500/5"
              to={`${basePath}/data`}
            >
              <span className="grid size-10 place-items-center rounded-xl bg-sky-500/10 text-lg text-sky-300">
                ▦
              </span>
              <span className="mt-5 flex items-center justify-between font-semibold">
                <span>{t('common.engineeringRecords')}</span>
                <span className="text-sky-400 transition group-hover:translate-x-1">→</span>
              </span>
              <span className="mt-2 block text-sm text-slate-500">
                {t('projects.tableCount', { count: formatNumber(overview.objectTypes.length) })} ·{' '}
                {t('projects.recordCount', {
                  count: formatNumber(overview.metrics?.total_samples ?? 0),
                })}
              </span>
            </Link>
          )}
          {allowed(user, 'file.read') && (
            <Link
              className="group rounded-2xl border border-slate-800 bg-slate-900/45 p-5 transition hover:-translate-y-0.5 hover:border-emerald-500/50 hover:bg-emerald-500/5"
              to={`${basePath}/files-datasets`}
            >
              <span className="grid size-10 place-items-center rounded-xl bg-emerald-500/10 text-lg text-emerald-300">
                ◫
              </span>
              <span className="mt-5 flex items-center justify-between font-semibold">
                <span>{t('common.filesDatasets')}</span>
                <span className="text-emerald-400 transition group-hover:translate-x-1">→</span>
              </span>
              <span className="mt-2 block text-sm text-slate-500">
                {t('projects.fileDatasetCount', {
                  files: formatNumber(activeFiles.length),
                  datasets: formatNumber(activeDatasets.length),
                })}
              </span>
            </Link>
          )}
          {allowed(user, 'dataset.read') && (
            <Link
              className="group rounded-2xl border border-slate-800 bg-slate-900/45 p-5 transition hover:-translate-y-0.5 hover:border-violet-500/50 hover:bg-violet-500/5"
              to={`${basePath}/visualizations`}
            >
              <span className="grid size-10 place-items-center rounded-xl bg-violet-500/10 text-lg text-violet-300">
                ⌁
              </span>
              <span className="mt-5 flex items-center justify-between font-semibold">
                <span>{t('common.visualizations')}</span>
                <span className="text-violet-400 transition group-hover:translate-x-1">→</span>
              </span>
              <span className="mt-2 block text-sm text-slate-500">
                {t('projects.chartDashboardCount', {
                  charts: formatNumber(activeCharts.length),
                  dashboards: formatNumber(activeDashboards.length),
                })}
              </span>
            </Link>
          )}
          {allowed(user, 'task.read') && (
            <Link
              className="group rounded-2xl border border-slate-800 bg-slate-900/45 p-5 transition hover:-translate-y-0.5 hover:border-amber-500/50 hover:bg-amber-500/5"
              to={`${basePath}/tasks`}
            >
              <span className="grid size-10 place-items-center rounded-xl bg-amber-500/10 text-lg text-amber-300">
                ✓
              </span>
              <span className="mt-5 flex items-center justify-between font-semibold">
                <span>{t('common.tasks')}</span>
                <span className="text-amber-400 transition group-hover:translate-x-1">→</span>
              </span>
              <span className="mt-2 block text-sm text-slate-500">
                {t('projects.taskCount', {
                  open: formatNumber(openTasks.length),
                  blocked: formatNumber(blockedTasks.length),
                })}
              </span>
            </Link>
          )}
          <Link
            className="group rounded-2xl border border-slate-800 bg-slate-900/45 p-5 transition hover:-translate-y-0.5 hover:border-cyan-500/50 hover:bg-cyan-500/5"
            to={`${basePath}/milestones`}
          >
            <span className="grid size-10 place-items-center rounded-xl bg-cyan-500/10 text-lg text-cyan-300">
              ◆
            </span>
            <span className="mt-5 flex items-center justify-between font-semibold">
              <span>{t('milestones.nav')}</span>
              <span className="text-cyan-400 transition group-hover:translate-x-1">→</span>
            </span>
            <span className="mt-2 block text-sm text-slate-500">
              {t('projects.milestoneSummary')}
            </span>
          </Link>
        </nav>
      </section>

      <section className="mt-6 flex flex-col gap-4 rounded-2xl border border-sky-500/20 bg-gradient-to-r from-sky-500/10 to-transparent p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium text-slate-200">
            {demo?.installed ? t('projects.demoReady') : t('projects.setupWorkspace')}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {demo?.installed ? t('projects.demoReadyBody') : t('projects.demoBody')}
          </p>
        </div>
        {demo?.installed ? (
          <div className="flex shrink-0 flex-wrap gap-4 text-sm">
            <Link className="text-sky-300 hover:text-sky-200" to={`${basePath}/visualizations`}>
              {t('projects.inspectChart')}
            </Link>
            <Link className="text-sky-300 hover:text-sky-200" to={`${basePath}/files-datasets`}>
              {t('projects.inspectRaw')}
            </Link>
          </div>
        ) : allowed(user, 'schema.manage') ? (
          <Button className="shrink-0" disabled={installingDemo} onClick={() => void installDemo()}>
            {installingDemo ? t('projects.installingDemo') : t('projects.installDemo')}
          </Button>
        ) : (
          <p className="shrink-0 text-sm text-slate-500">{t('projects.askInstaller')}</p>
        )}
      </section>

      {(allowed(user, 'project.update') ||
        allowed(user, 'project.archive') ||
        allowed(user, 'project.restore')) && (
        <details className="group mt-6 rounded-2xl border border-slate-800 bg-slate-900/35">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 marker:content-none">
            <span>
              <span className="block font-medium text-slate-200">
                {t('projects.settingsSummary')}
              </span>
              <span className="mt-1 block text-sm text-slate-500">
                {t('projects.settingsHint')}
              </span>
            </span>
            <span aria-hidden="true" className="text-slate-500 transition group-open:rotate-180">
              ⌄
            </span>
          </summary>
          <div className="border-t border-slate-800 p-5">
            {allowed(user, 'project.update') && !project.archivedAt && (
              <form className="grid max-w-2xl gap-4" onSubmit={(event) => void update(event)}>
                <h2 className="text-xl font-semibold">{t('projects.settings')}</h2>
                <label className={formLabelClass}>
                  {t('projects.name')}
                  <input className={inputClass} defaultValue={project.name} name="name" required />
                </label>
                <label className={formLabelClass}>
                  {t('workspaces.descriptionLabel')}
                  <textarea
                    className={inputClass}
                    defaultValue={project.description}
                    name="description"
                    rows={3}
                  />
                </label>
                <label className={formLabelClass}>
                  {t('projects.status')}
                  <select className={inputClass} defaultValue={project.status} name="status">
                    <option value="active">{t('projects.active')}</option>
                    <option value="on_hold">{t('projects.onHold')}</option>
                    <option value="completed">{t('projects.completed')}</option>
                  </select>
                </label>
                <Button type="submit">{t('projects.saveSettings')}</Button>
              </form>
            )}
            <div
              className={
                allowed(user, 'project.update') && !project.archivedAt
                  ? 'mt-6 border-t border-slate-800 pt-6'
                  : ''
              }
            >
              {project.archivedAt
                ? allowed(user, 'project.restore') && (
                    <Button onClick={() => void archive(false)}>{t('projects.restore')}</Button>
                  )
                : allowed(user, 'project.archive') && (
                    <Button variant="quiet" onClick={() => void archive(true)}>
                      {t('projects.archive')}
                    </Button>
                  )}
            </div>
          </div>
        </details>
      )}
      <NoticeText tone={messageTone}>{message}</NoticeText>
    </>
  );
}

function GetStartedPage() {
  const { t } = useI18n();
  const [completed, setCompleted] = useState<OnboardingStep[]>([]);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'success' | 'error'>('success');
  useEffect(() => {
    void api<{ completed_steps: OnboardingStep[] }>('/onboarding')
      .then((result) => setCompleted(result.completed_steps ?? []))
      .catch((cause) => {
        setMessageTone('error');
        setMessage(cause instanceof Error ? cause.message : t('onboarding.loadFailed'));
      });
  }, [t]);
  async function toggle(step: OnboardingStep) {
    const next = completed.includes(step)
      ? completed.filter((candidate) => candidate !== step)
      : [...completed, step];
    setCompleted(next);
    try {
      await api('/onboarding', {
        method: 'PATCH',
        body: JSON.stringify({ completedSteps: next, dismissed: false }),
      });
      setMessageTone('success');
      setMessage(
        next.length === onboardingSteps.length ? t('onboarding.complete') : t('onboarding.saved'),
      );
    } catch (cause) {
      setCompleted(completed);
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('onboarding.saveFailed'));
    }
  }
  return (
    <>
      <p className={sectionEyebrowClass}>{t('onboarding.eyebrow')}</p>
      <h1 className={pageTitleClass}>{t('onboarding.heading')}</h1>
      <p className="mt-3 max-w-2xl text-slate-400">{t('onboarding.body')}</p>
      <div className="mt-8 max-w-2xl">
        <div className="mb-5 flex items-center justify-between gap-4 text-sm">
          <span className="text-slate-400">{t('onboarding.progress')}</span>
          <span className="font-medium text-sky-300">
            {t('onboarding.progressCount', {
              completed: completed.length,
              total: onboardingSteps.length,
            })}
          </span>
        </div>
        <div className="mb-6 h-2 overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-sky-400 to-cyan-300 transition-[width] duration-300"
            style={{ width: `${(completed.length / onboardingSteps.length) * 100}%` }}
          />
        </div>
        <div className="space-y-3">
          {onboardingSteps.map((step, index) => (
            <label
              className={`flex cursor-pointer items-start gap-4 rounded-2xl border p-5 transition hover:border-sky-500/40 ${completed.includes(step.key) ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-slate-800 bg-slate-900/55 hover:bg-slate-900/80'}`}
              key={step.key}
            >
              <input
                checked={completed.includes(step.key)}
                className="mt-1 size-4 accent-sky-400"
                type="checkbox"
                onChange={() => void toggle(step.key)}
              />
              <span>
                <span className="font-mono text-xs text-slate-500">
                  {t('onboarding.step', { number: index + 1 })}
                </span>
                <span
                  className={`mt-1 block font-medium ${completed.includes(step.key) ? 'text-slate-400 line-through decoration-slate-600' : 'text-slate-100'}`}
                >
                  {t(step.translationKey)}
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>
      <div className="mt-6 flex gap-4">
        <Link className="text-sky-300" to="/workspaces">
          {t('onboarding.openWorkspaces')}
        </Link>
        <Link className="text-sky-300" to="/pilot">
          {t('onboarding.shareFeedback')}
        </Link>
      </div>
      <NoticeText tone={messageTone}>{message}</NoticeText>
    </>
  );
}

function PilotPage({ user }: { user: User }) {
  const { t } = useI18n();
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'success' | 'error'>('success');
  const [summary, setSummary] = useState<Record<string, number | string>>();
  const [feedbackItems, setFeedbackItems] = useState<Array<Record<string, unknown>>>([]);
  useEffect(() => {
    if (allowed(user, 'pilot.manage')) {
      void api<Record<string, number | string>>('/pilot/summary')
        .then(setSummary)
        .catch(() => undefined);
      void api<{ items: Array<Record<string, unknown>> }>('/pilot/feedback')
        .then((result) => setFeedbackItems(result.items))
        .catch(() => undefined);
    }
  }, [user]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await api('/pilot-feedback', {
        method: 'POST',
        body: JSON.stringify({
          category: data.get('category'),
          rating: Number(data.get('rating')),
          message: data.get('message'),
          context: { path: window.location.pathname, app: 'community-pilot' },
        }),
      });
      form.reset();
      setMessageTone('success');
      setMessage(t('feedback.thanks'));
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('feedback.failed'));
    }
  }
  return (
    <>
      <p className={sectionEyebrowClass}>{t('feedback.eyebrow')}</p>
      <h1 className={pageTitleClass}>{t('feedback.heading')}</h1>
      {summary && (
        <section className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              [t('feedback.repeatUsers'), 'repeat_users'],
              [t('feedback.records'), 'records'],
              [t('feedback.readyDatasets'), 'datasets'],
              [t('feedback.items'), 'feedback_items'],
            ] as const
          ).map(([label, key]) => (
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5" key={key}>
              <p className="text-sm text-slate-500">{label}</p>
              <p className="mt-1 text-3xl font-semibold">{String(summary[key] ?? 0)}</p>
            </div>
          ))}
        </section>
      )}
      <form
        className="mt-8 max-w-2xl space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-6"
        onSubmit={(event) => void submit(event)}
      >
        <label className={blockFormLabelClass}>
          {t('feedback.category')}
          <select className={inputClass} name="category" defaultValue="workflow">
            <option value="workflow">{t('feedback.workflow')}</option>
            <option value="usability">{t('feedback.usability')}</option>
            <option value="bug">{t('feedback.bug')}</option>
            <option value="idea">{t('feedback.idea')}</option>
            <option value="other">{t('feedback.other')}</option>
          </select>
        </label>
        <label className={blockFormLabelClass}>
          {t('feedback.rating')}
          <select className={inputClass} name="rating" defaultValue="4">
            {[1, 2, 3, 4, 5].map((rating) => (
              <option key={rating} value={rating}>
                {rating} / 5
              </option>
            ))}
          </select>
        </label>
        <label className={blockFormLabelClass}>
          {t('feedback.prompt')}
          <textarea className={inputClass} minLength={10} name="message" required rows={6} />
        </label>
        <Button type="submit">{t('feedback.submit')}</Button>
      </form>
      {allowed(user, 'pilot.manage') && feedbackItems.length > 0 && (
        <section className="mt-10">
          <h2 className="text-2xl font-semibold">{t('feedback.recent')}</h2>
          <div className="mt-4 space-y-3">
            {feedbackItems.map((item) => (
              <article
                className="rounded-xl border border-slate-800 bg-slate-900/60 p-5"
                key={String(item.id)}
              >
                <div className="flex flex-wrap gap-3 text-xs uppercase tracking-wide text-slate-500">
                  <span>{String(item.category)}</span>
                  <span>{String(item.rating)} / 5</span>
                  <span>{String(item.actor_name)}</span>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-slate-300">{String(item.message)}</p>
              </article>
            ))}
          </div>
        </section>
      )}
      <NoticeText tone={messageTone}>{message}</NoticeText>
    </>
  );
}

export function MembersPage() {
  const { t } = useI18n();
  const { items, error, refresh } = useAsyncList<Member>(() => api('/members'), []);
  const {
    items: groups,
    error: groupsError,
    refresh: refreshGroups,
  } = useAsyncList<MemberGroup>(() => api('/member-groups'), []);
  const [generatedUrl, setGeneratedUrl] = useState('');
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'success' | 'error'>('success');
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [groupMemberDraft, setGroupMemberDraft] = useState<Set<string>>(() => new Set());
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(() => new Set());
  const [bulkRole, setBulkRole] = useState<Role>('contributor');
  const [memberSearch, setMemberSearch] = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [busy, setBusy] = useState(false);
  const selectedGroup = groups.find((group) => group.id === selectedGroupId);
  const normalizedMemberSearch = memberSearch.trim().toLowerCase();
  const normalizedGroupSearch = groupSearch.trim().toLowerCase();
  const filteredMembers = items.filter(
    (member) =>
      !normalizedMemberSearch ||
      member.displayName.toLowerCase().includes(normalizedMemberSearch) ||
      member.email.toLowerCase().includes(normalizedMemberSearch) ||
      member.role.toLowerCase().includes(normalizedMemberSearch),
  );
  const filteredGroups = groups.filter(
    (group) =>
      !normalizedGroupSearch ||
      group.name.toLowerCase().includes(normalizedGroupSearch) ||
      group.description.toLowerCase().includes(normalizedGroupSearch),
  );

  useEffect(() => {
    if (selectedGroupId && groups.some((group) => group.id === selectedGroupId)) return;
    setSelectedGroupId(groups[0]?.id ?? '');
  }, [groups, selectedGroupId]);

  useEffect(() => {
    setGroupMemberDraft(new Set(selectedGroup?.memberIds ?? []));
  }, [selectedGroup]);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      const result = await api<{ invitationUrl: string }>('/invitations', {
        method: 'POST',
        body: JSON.stringify({ email: data.get('email'), role: data.get('role') }),
      });
      setGeneratedUrl(result.invitationUrl);
      setMessageTone('success');
      setMessage(t('members.invitationGenerated'));
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('members.invitationFailed'));
    }
  }
  function toggleMemberSelection(userId: string, checked: boolean) {
    setSelectedMemberIds((current) => {
      const next = new Set(current);
      if (checked) next.add(userId);
      else next.delete(userId);
      return next;
    });
  }

  async function changeSelectedRoles() {
    if (selectedMemberIds.size === 0) return;
    setBusy(true);
    try {
      await api('/members/roles', {
        method: 'PATCH',
        body: JSON.stringify({ memberIds: [...selectedMemberIds], role: bulkRole }),
      });
      await refresh();
      setMessageTone('success');
      setMessage(t('members.rolesChanged', { count: selectedMemberIds.size, role: bulkRole }));
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('members.rolesFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function addMembersToGroup(group: MemberGroup, memberIds: string[]) {
    const nextMemberIds = [...new Set([...group.memberIds, ...memberIds])];
    const addedCount = nextMemberIds.length - group.memberIds.length;
    setSelectedGroupId(group.id);
    if (addedCount === 0) {
      setMessageTone('success');
      setMessage(t('members.alreadyInGroup', { group: group.name }));
      return;
    }
    setBusy(true);
    try {
      await api(`/member-groups/${group.id}/members`, {
        method: 'PATCH',
        body: JSON.stringify({ memberIds: nextMemberIds }),
      });
      await refreshGroups();
      setMessageTone('success');
      setMessage(t('members.addedToGroup', { count: addedCount, group: group.name }));
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('members.addFailed'));
    } finally {
      setBusy(false);
    }
  }

  function startMemberDrag(event: DragEvent<HTMLElement>, memberId: string) {
    const memberIds = selectedMemberIds.has(memberId) ? [...selectedMemberIds] : [memberId];
    if (!selectedMemberIds.has(memberId)) setSelectedMemberIds(new Set([memberId]));
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('text/plain', memberIds.join(','));
  }

  function dropMembersOnGroup(event: DragEvent<HTMLElement>, group: MemberGroup) {
    event.preventDefault();
    const memberIds = event.dataTransfer.getData('text/plain').split(',').filter(Boolean);
    if (memberIds.length > 0) void addMembersToGroup(group, memberIds);
  }

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    try {
      const created = await api<MemberGroup>('/member-groups', {
        method: 'POST',
        body: JSON.stringify({
          name: data.get('name'),
          description: data.get('description'),
          color: data.get('color'),
        }),
      });
      form.reset();
      await refreshGroups();
      setSelectedGroupId(created.id);
      setShowCreateGroup(false);
      setMessageTone('success');
      setMessage(t('groups.created', { name: created.name }));
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('groups.createFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function saveGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedGroup) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await api(`/member-groups/${selectedGroup.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: data.get('name'),
          description: data.get('description'),
          color: data.get('color'),
        }),
      });
      await api(`/member-groups/${selectedGroup.id}/members`, {
        method: 'PATCH',
        body: JSON.stringify({ memberIds: [...groupMemberDraft] }),
      });
      await refreshGroups();
      setMessageTone('success');
      setMessage(t('groups.updated', { name: String(data.get('name')) }));
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('groups.updateFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function archiveGroup(group: MemberGroup) {
    if (!window.confirm(t('groups.archiveConfirm', { name: group.name }))) {
      return;
    }
    setBusy(true);
    try {
      await api(`/member-groups/${group.id}/archive`, { method: 'POST' });
      await refreshGroups();
      setMessageTone('success');
      setMessage(t('groups.archived', { name: group.name }));
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : t('groups.archiveFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-sky-400">
            {t('pilot.organization')}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="text-3xl font-semibold">{t('members.heading')}</h1>
            <HelpTip label={t('members.help')}>{t('members.helpBody')}</HelpTip>
          </div>
        </div>
        <div className="flex gap-2 text-xs text-slate-400">
          <span className="rounded-full border border-slate-800 px-3 py-1.5">
            {t('members.count', { count: items.length })}
          </span>
          <span className="rounded-full border border-slate-800 px-3 py-1.5">
            {t('members.groupCount', { count: groups.length })}
          </span>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-800 bg-slate-900/45">
          <header className="border-b border-slate-800 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-100">{t('members.directory')}</h2>
                <HelpTip label={t('members.roleHelp')}>{t('members.roleHelpBody')}</HelpTip>
              </div>
              <details className="relative">
                <summary className="cursor-pointer list-none rounded-md border border-slate-700 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800">
                  {t('members.invite')}
                </summary>
                <div className="absolute right-0 top-10 z-40 w-80 rounded-xl border border-slate-700 bg-slate-950 p-4 shadow-2xl">
                  <form className="space-y-3" onSubmit={(event) => void invite(event)}>
                    <Field label={t('members.inviteEmail')} name="email" type="email" />
                    <label className="block text-xs font-medium text-slate-300">
                      {t('members.role')}
                      <select
                        className={`${inputClass} mt-1.5`}
                        name="role"
                        defaultValue="contributor"
                      >
                        <option>admin</option>
                        <option>engineer</option>
                        <option>contributor</option>
                        <option>viewer</option>
                      </select>
                    </label>
                    <Button className="w-full" type="submit">
                      {t('members.generateInvitation')}
                    </Button>
                  </form>
                  {generatedUrl && (
                    <textarea
                      aria-label={t('members.invitationUrl')}
                      className={`${inputClass} mt-3 min-h-20 text-xs`}
                      readOnly
                      value={generatedUrl}
                    />
                  )}
                </div>
              </details>
            </div>
            <input
              aria-label={t('members.search')}
              className={`${inputClass} mt-3`}
              placeholder={t('members.searchPlaceholder')}
              type="search"
              value={memberSearch}
              onChange={(event) => setMemberSearch(event.target.value)}
            />
            <p className="mt-2 text-xs text-slate-600">
              {t('members.shown', { count: filteredMembers.length })}
            </p>
          </header>
          {selectedMemberIds.size > 0 && (
            <div
              aria-label={t('members.bulkActions')}
              className="border-b border-sky-500/20 bg-sky-500/5 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-auto text-xs font-semibold text-sky-200">
                  {t('members.selected', { count: selectedMemberIds.size })}
                </span>
                <select
                  aria-label={t('members.selectedRole')}
                  className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-300"
                  value={bulkRole}
                  onChange={(event) => setBulkRole(event.target.value as Role)}
                >
                  {memberRoles.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
                <Button disabled={busy} onClick={() => void changeSelectedRoles()} type="button">
                  {t('members.applyRole')}
                </Button>
              </div>
              <button
                className="mt-2 text-xs text-slate-500 hover:text-slate-200"
                onClick={() => setSelectedMemberIds(new Set())}
                type="button"
              >
                {t('members.clearSelection')}
              </button>
            </div>
          )}
          <div className="divide-y divide-slate-800 overflow-y-auto" style={{ maxHeight: '34rem' }}>
            {filteredMembers.map((member) => {
              const memberGroups = groups.filter((group) =>
                group.memberIds.includes(member.userId),
              );
              return (
                <article
                  className={`flex items-center gap-2 px-3 py-3 transition ${
                    selectedMemberIds.has(member.userId) ? 'bg-sky-500/5' : 'hover:bg-slate-800'
                  }`}
                  key={member.userId}
                >
                  <input
                    aria-label={t('members.selectPerson', { name: member.displayName })}
                    checked={selectedMemberIds.has(member.userId)}
                    className="accent-sky-500"
                    type="checkbox"
                    onChange={(event) => toggleMemberSelection(member.userId, event.target.checked)}
                  />
                  <button
                    aria-label={t('members.dragPerson', { name: member.displayName })}
                    className="cursor-grab select-none px-1 text-sm text-slate-600 hover:text-slate-200 active:cursor-grabbing"
                    draggable
                    title={t('members.dragHint')}
                    type="button"
                    onDragStart={(event) => startMemberDrag(event, member.userId)}
                  >
                    ⋮⋮
                  </button>
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-slate-800 text-xs font-semibold text-slate-300">
                    {member.displayName.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-200">
                      {member.displayName}
                    </p>
                    <p className="truncate text-xs text-slate-500">{member.email}</p>
                    {memberGroups.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {memberGroups.map((group) => (
                          <button
                            className="rounded-full border border-slate-800 px-2 py-0.5 text-[10px] text-slate-400 hover:text-slate-200"
                            key={group.id}
                            onClick={() => setSelectedGroupId(group.id)}
                            type="button"
                          >
                            <span
                              aria-hidden="true"
                              className="mr-1 inline-block size-1.5 rounded-full"
                              style={{ backgroundColor: memberGroupColor(group.color) }}
                            />
                            {group.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className="rounded-md border border-slate-800 px-2 py-1 text-xs text-slate-400">
                    {member.role}
                  </span>
                </article>
              );
            })}
            {filteredMembers.length === 0 && (
              <p className="p-8 text-center text-xs text-slate-500">{t('members.noMatch')}</p>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/45">
          <header className="border-b border-slate-800 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-100">{t('groups.heading')}</h2>
                <HelpTip label={t('groups.assignmentHelp')}>
                  {t('groups.assignmentHelpBody')}
                </HelpTip>
              </div>
              <Button
                aria-expanded={showCreateGroup}
                variant="quiet"
                onClick={() => setShowCreateGroup((value) => !value)}
                type="button"
              >
                + {t('groups.new')}
              </Button>
            </div>
            {showCreateGroup && (
              <form className="mt-3 grid gap-2" onSubmit={(event) => void createGroup(event)}>
                <input
                  aria-label={t('groups.newName')}
                  autoFocus
                  className={inputClass}
                  maxLength={80}
                  name="name"
                  placeholder={t('groups.namePlaceholder')}
                  required
                />
                <textarea
                  aria-label={t('groups.newDescription')}
                  className={`${inputClass} min-h-20 resize-y`}
                  maxLength={500}
                  name="description"
                  placeholder={t('groups.descriptionPlaceholder')}
                />
                <div className="flex items-center gap-2">
                  <select
                    aria-label={t('groups.newColor')}
                    className={`${inputClass} flex-1`}
                    defaultValue="sky"
                    name="color"
                  >
                    {memberGroupColors.map((color) => (
                      <option key={color.value} value={color.value}>
                        {color.label}
                      </option>
                    ))}
                  </select>
                  <Button disabled={busy} type="submit">
                    {busy ? t('groups.creating') : t('common.create')}
                  </Button>
                </div>
              </form>
            )}
            <input
              aria-label={t('groups.search')}
              className={`${inputClass} mt-3`}
              placeholder={t('groups.search')}
              type="search"
              value={groupSearch}
              onChange={(event) => setGroupSearch(event.target.value)}
            />
          </header>

          <div className="grid sm:grid-cols-2">
            <nav
              aria-label={t('groups.navigation')}
              className="overflow-y-auto border-b border-slate-800 p-2 sm:border-b-0 sm:border-r"
              style={{ maxHeight: '34rem' }}
            >
              {filteredGroups.map((group) => (
                <button
                  aria-current={selectedGroupId === group.id ? 'true' : undefined}
                  aria-label={t(
                    group.memberIds.length === 1 ? 'groups.dropLabelOne' : 'groups.dropLabel',
                    {
                      name: group.name,
                      count: group.memberIds.length,
                    },
                  )}
                  className={`flex w-full items-center gap-2 rounded-md border px-2 py-2 text-left transition ${
                    selectedGroupId === group.id
                      ? 'border-sky-500/20 bg-sky-500/10 text-sky-200'
                      : 'border-transparent text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                  }`}
                  key={group.id}
                  onClick={() => setSelectedGroupId(group.id)}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'copy';
                  }}
                  onDrop={(event) => dropMembersOnGroup(event, group)}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: memberGroupColor(group.color) }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{group.name}</span>
                    <span className="block text-[10px] text-slate-600">
                      {t('groups.memberCount', { count: group.memberIds.length })}
                    </span>
                  </span>
                </button>
              ))}
              {filteredGroups.length === 0 && (
                <p className="p-5 text-center text-xs text-slate-500">{t('groups.none')}</p>
              )}
            </nav>

            <div className="min-w-0 p-4">
              {selectedGroup ? (
                <form key={selectedGroup.id} onSubmit={(event) => void saveGroup(event)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[10px] font-medium uppercase tracking-widest text-sky-400">
                        {t('groups.details')}
                      </p>
                      <h3 className="mt-1 truncate text-sm font-semibold text-slate-200">
                        {selectedGroup.name}
                      </h3>
                    </div>
                    <button
                      aria-label={t('groups.archiveLabel', { name: selectedGroup.name })}
                      className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-rose-500/10 hover:text-rose-300"
                      disabled={busy}
                      onClick={() => void archiveGroup(selectedGroup)}
                      type="button"
                    >
                      {t('groups.archive')}
                    </button>
                  </div>
                  <input
                    aria-label={t('groups.name')}
                    className={`${inputClass} mt-3`}
                    defaultValue={selectedGroup.name}
                    maxLength={80}
                    name="name"
                    required
                  />
                  <textarea
                    aria-label={t('groups.description')}
                    className={`${inputClass} mt-2 min-h-20 resize-y`}
                    defaultValue={selectedGroup.description}
                    maxLength={500}
                    name="description"
                    placeholder={t('groups.description')}
                  />
                  <select
                    aria-label={t('groups.color')}
                    className={`${inputClass} mt-2`}
                    defaultValue={selectedGroup.color}
                    name="color"
                  >
                    {memberGroupColors.map((color) => (
                      <option key={color.value} value={color.value}>
                        {color.label}
                      </option>
                    ))}
                  </select>
                  <fieldset className="mt-4">
                    <legend className="text-xs font-medium text-slate-300">
                      {t('groups.members', { count: groupMemberDraft.size })}
                    </legend>
                    <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-800 p-2">
                      {items.map((member) => (
                        <label
                          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                          key={member.userId}
                        >
                          <input
                            aria-label={t('groups.addMember', {
                              member: member.displayName,
                              group: selectedGroup.name,
                            })}
                            checked={groupMemberDraft.has(member.userId)}
                            className="accent-sky-500"
                            type="checkbox"
                            onChange={(event) => {
                              setGroupMemberDraft((current) => {
                                const next = new Set(current);
                                if (event.target.checked) next.add(member.userId);
                                else next.delete(member.userId);
                                return next;
                              });
                            }}
                          />
                          <span className="min-w-0 flex-1 truncate">{member.displayName}</span>
                          <span className="truncate text-[10px] text-slate-600">{member.role}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <Button className="mt-4 w-full" disabled={busy} type="submit">
                    {busy ? t('groups.saving') : t('groups.save')}
                  </Button>
                </form>
              ) : (
                <div className="p-6 text-center">
                  <p className="text-sm font-medium text-slate-400">{t('groups.first')}</p>
                  <p className="mt-1 text-xs text-slate-600">{t('groups.firstBody')}</p>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      {message && (
        <p
          aria-live="polite"
          className={`mt-4 text-sm ${messageTone === 'error' ? 'text-rose-300' : 'text-emerald-300'}`}
        >
          {message}
        </p>
      )}
      <ErrorText>{error || groupsError}</ErrorText>
    </section>
  );
}

function AuditPage() {
  const { t } = useI18n();
  const { items, error } = useAsyncList<Record<string, unknown>>(
    () => api('/audit-events?limit=100'),
    [],
  );
  return (
    <>
      <h1 className="text-4xl font-semibold">{t('audit.heading')}</h1>
      <ErrorText>{error}</ErrorText>
      <div className="mt-8 space-y-2 font-mono text-sm">
        {items.map((event) => (
          <div
            className="rounded-lg border border-slate-800 bg-slate-900/60 p-4"
            key={String(event.id)}
          >
            <span className="text-sky-300">{String(event.action)}</span>
            <span className="ml-4 text-slate-500">{String(event.createdAt)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function AppContent() {
  const { locale, setLocale, t } = useI18n();
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = window.localStorage.getItem('engrove-theme');
    const explicit = window.localStorage.getItem('engrove-theme-explicit') === 'true';
    const selected = explicit && (stored === 'light' || stored === 'dark') ? stored : 'light';
    document.documentElement.dataset.theme = selected;
    return selected;
  });
  const [user, setUser] = useState<User>();
  const [state, setState] = useState<'loading' | 'setup' | 'signed-out' | 'signed-in'>('loading');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('engrove-theme', theme);
  }, [theme]);

  function toggleTheme() {
    window.localStorage.setItem('engrove-theme-explicit', 'true');
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }

  useEffect(() => {
    void (async () => {
      try {
        const setup = await api<{ available: boolean }>('/setup/status');
        if (setup.available) {
          setState('setup');
          return;
        }
        const auth = await api<{ user: User }>('/auth/me');
        setUser(auth.user);
        setState('signed-in');
      } catch {
        setState('signed-out');
      }
    })();
  }, []);

  if (state === 'loading') {
    return (
      <main className="product-grid grid min-h-screen place-items-center bg-slate-950 p-10 text-slate-300">
        <div className="text-center">
          <BrandMark className="mx-auto size-12 animate-pulse" />
          <p className="mt-4 text-sm text-slate-400">{t('app.loading')}</p>
        </div>
      </main>
    );
  }

  const protectedElement = (content: React.ReactNode) =>
    state === 'signed-in' && user ? (
      <ServiceShell
        can={allowed}
        request={api}
        user={user}
        theme={theme}
        onSignedOut={() => setState('signed-out')}
        onToggleTheme={toggleTheme}
      >
        {content}
      </ServiceShell>
    ) : (
      <Navigate to={state === 'setup' ? '/setup' : '/sign-in'} replace />
    );

  return (
    <>
      {state !== 'signed-in' && (
        <>
          <select
            aria-label={t('language.label')}
            className="fixed right-16 top-4 z-[80] min-h-9 rounded-lg border border-slate-700 bg-slate-900 px-2 text-xs text-slate-300 shadow-sm"
            value={locale}
            onChange={(event) => setLocale(event.target.value as 'en' | 'ko')}
          >
            <option value="en">{t('language.english')}</option>
            <option value="ko">{t('language.korean')}</option>
          </select>
          <button
            aria-label={t('sidebar.switchTheme', {
              theme: t(theme === 'dark' ? 'theme.light' : 'theme.dark'),
            })}
            className="fixed right-4 top-4 z-[80] grid size-9 place-items-center rounded-lg border border-slate-700 bg-slate-900 text-slate-300 shadow-sm"
            onClick={toggleTheme}
            type="button"
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </>
      )}
      <Routes>
        <Route path="/" element={protectedElement(user && <WorkspacesPage user={user} />)} />
        <Route path="/setup" element={<SetupPage />} />
        <Route
          path="/sign-in"
          element={
            state === 'signed-in' ? (
              <Navigate replace to="/workspaces" />
            ) : (
              <SignInPage
                onSignedIn={(next) => {
                  setUser(next);
                  setState('signed-in');
                }}
              />
            )
          }
        />
        <Route path="/accept-invitation" element={<TokenPasswordPage invitation />} />
        <Route path="/reset-password" element={<TokenPasswordPage invitation={false} />} />
        <Route
          path="/workspaces"
          element={protectedElement(user && <WorkspacesPage user={user} />)}
        />
        <Route path="/get-started" element={protectedElement(<GetStartedPage />)} />
        <Route path="/pilot" element={protectedElement(user && <PilotPage user={user} />)} />
        <Route path="/workspaces/:workspaceId" element={protectedElement(<WorkspaceIndexPage />)} />
        <Route
          path="/workspaces/:workspaceId/data"
          element={protectedElement(user && <WorkspaceDataPage user={user} />)}
        />
        <Route
          path="/workspaces/:workspaceId/:objectTypeId"
          element={protectedElement(user && <WorkspaceDataPage user={user} />)}
        />
        <Route
          path="/workspaces/:workspaceId/projects"
          element={protectedElement(user && <WorkspacePage user={user} />)}
        />
        <Route
          path="/workspaces/:workspaceId/projects/:projectId"
          element={protectedElement(user && <ProjectPage user={user} />)}
        />
        <Route
          path="/workspaces/:workspaceId/projects/:projectId/data"
          element={protectedElement(
            user && (
              <PageLoader label="records">
                <ProjectDataPage user={user} />
              </PageLoader>
            ),
          )}
        />
        <Route
          path="/workspaces/:workspaceId/projects/:projectId/files-datasets"
          element={protectedElement(
            user && (
              <PageLoader label="files and datasets">
                <FilesDatasetsPage user={user} />
              </PageLoader>
            ),
          )}
        />
        <Route
          path="/workspaces/:workspaceId/projects/:projectId/visualizations"
          element={protectedElement(
            user && (
              <PageLoader label="chart studio">
                <VisualizationsPage user={user} />
              </PageLoader>
            ),
          )}
        />
        <Route
          path="/workspaces/:workspaceId/projects/:projectId/tasks"
          element={protectedElement(
            user && (
              <PageLoader label="tasks">
                <TasksPage user={user} />
              </PageLoader>
            ),
          )}
        />
        <Route
          path="/workspaces/:workspaceId/projects/:projectId/milestones"
          element={protectedElement(
            user && (
              <PageLoader label="milestones">
                <MilestonesPage user={user} />
              </PageLoader>
            ),
          )}
        />
        <Route
          path="/workspaces/:workspaceId/projects/:projectId/data/:objectTypeId/records/:recordId"
          element={protectedElement(
            user && (
              <PageLoader label="record details">
                <RecordDetailPage user={user} />
              </PageLoader>
            ),
          )}
        />
        <Route path="/members" element={protectedElement(<MembersPage />)} />
        <Route path="/audit" element={protectedElement(<AuditPage />)} />
        <Route path="*" element={protectedElement(<NotFoundPage />)} />
      </Routes>
    </>
  );
}

export function App() {
  return (
    <I18nProvider>
      <AppContent />
    </I18nProvider>
  );
}
