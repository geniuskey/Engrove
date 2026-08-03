import { can, type Action, type Role } from '@engrove/permissions';
import type { HealthResponse } from '@engrove/shared';
import { Button } from '@engrove/ui';
import {
  type FormEvent,
  lazy,
  type PropsWithChildren,
  Suspense,
  useCallback,
  useEffect,
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
import type { WorkspaceDataContext } from './DataPage.js';
import { I18nProvider, useI18n } from './i18n.js';
import { ServiceShell } from './ServiceSidebar.js';

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

const VisualizationsPage = lazy(() =>
  import('./VisualizationsPage.js').then((module) => ({ default: module.VisualizationsPage })),
);

function PageLoader({ children, label }: PropsWithChildren<{ label: string }>) {
  return (
    <Suspense fallback={<p className="text-slate-400">Loading {label}…</p>}>{children}</Suspense>
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
  name: string;
  slug: string;
  description: string;
  archivedAt: string | null;
}

interface Project {
  id: string;
  workspaceId: string;
  name: string;
  key: string;
  description: string;
  status: string;
  rowVersion: number;
  archivedAt: string | null;
}

interface Member {
  userId: string;
  email: string;
  displayName: string;
  role: Role;
}

const onboardingSteps = [
  { key: 'create-project', label: 'Create a workspace and project' },
  { key: 'install-template', label: 'Install the Test & Characterization template' },
  { key: 'load-demo', label: 'Load the traceable demo dataset' },
  { key: 'trace-results', label: 'Open its chart and trace it to the raw CSV' },
  { key: 'create-task', label: 'Create or complete a follow-up task' },
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
  const refresh = useCallback(async () => {
    try {
      setItems((await load()).items);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Request failed.');
    }
  }, dependencies);
  useEffect(() => void refresh(), [refresh]);
  return { items, error, refresh };
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
              <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-sky-300 to-cyan-500 font-mono text-sm font-black text-[#082f49] shadow-lg shadow-sky-950/30">
                E
              </span>
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
              <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-sky-300 to-cyan-500 font-mono text-sm font-black text-[#082f49]">
                E
              </span>
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
  'mt-1 min-h-8 w-full rounded-lg border border-slate-700/80 bg-slate-950/80 px-2.5 py-1.5 text-sm text-slate-100 shadow-sm outline-none transition placeholder:text-slate-600 hover:border-slate-600 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/15 disabled:cursor-not-allowed disabled:opacity-50';

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
    <label className="block text-sm text-slate-300">
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
      setMessage(cause instanceof Error ? cause.message : 'Setup failed.');
    }
  }
  return (
    <AuthCard title={t('auth.setup')}>
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <label className="block text-sm text-slate-300">
          Setup token
          <input
            className={inputClass}
            required
            name="token"
            defaultValue={search.get('token') ?? ''}
          />
        </label>
        <Field label="Email" name="email" type="email" />
        <Field label="Display name" name="displayName" />
        <Field label="Password (12+ characters)" name="password" type="password" />
        {message && <p className="text-sm text-rose-300">{message}</p>}
        <Button className="w-full" type="submit">
          Complete setup
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
      setMessage(cause instanceof Error ? cause.message : 'Sign in failed.');
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
            Sign in with OpenID Connect
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
      setMessage(cause instanceof Error ? cause.message : 'The token could not be used.');
    }
  }
  return (
    <AuthCard title={invitation ? t('auth.acceptInvitation') : t('auth.resetPassword')}>
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <label className="block text-sm text-slate-300">
          Token
          <input
            className={inputClass}
            required
            name="token"
            defaultValue={search.get('token') ?? ''}
          />
        </label>
        {invitation && <Field label="Display name" name="displayName" />}
        <Field label="New password (12+ characters)" name="password" type="password" />
        {message && <p className="text-sm text-rose-300">{message}</p>}
        <Button className="w-full" type="submit">
          {invitation ? 'Create account' : 'Reset password'}
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

export function ErrorText({ children }: PropsWithChildren) {
  return <NoticeText tone="error">{children}</NoticeText>;
}

function WorkspacesPage({ user }: { user: User }) {
  const { t } = useI18n();
  const { items, error, refresh } = useAsyncList<Workspace>(() => api('/workspaces'), []);
  const [formError, setFormError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
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
      await refresh();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Workspace creation failed.');
    }
  }
  return (
    <>
      <div className="max-w-2xl">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-sky-400">
          {t('sidebar.organization')}
        </p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">
          {t('common.workspaces')}
        </h1>
        <p className="mt-3 text-slate-400">{t('workspaces.description')}</p>
      </div>
      <ErrorText>{error}</ErrorText>
      <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-slate-800/80 bg-slate-900/35 px-4 py-3 text-xs text-slate-400">
        <strong className="text-slate-200">{t('workspaces.count', { count: items.length })}</strong>
        <span>◆ {t('workspaces.traceable')}</span>
        <span>◇ {t('workspaces.engineeringReady')}</span>
        <span>⌂ {t('workspaces.selfHosted')}</span>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((workspace) => (
          <Link
            className="group rounded-2xl border border-slate-800/90 bg-slate-900/60 p-6 shadow-lg shadow-slate-950/15 hover:-translate-y-0.5 hover:border-sky-500/60 hover:bg-slate-900/90"
            key={workspace.id}
            to={`/workspaces/${workspace.id}`}
          >
            <div className="flex items-start justify-between gap-4">
              <span className="grid size-10 place-items-center rounded-xl border border-slate-700 bg-slate-800 font-mono text-sm text-sky-300">
                {workspace.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="text-slate-600 transition group-hover:translate-x-1 group-hover:text-sky-300">
                →
              </span>
            </div>
            <h2 className="mt-5 text-xl font-semibold tracking-tight">{workspace.name}</h2>
            <p className="mt-1 font-mono text-xs text-slate-500">{workspace.slug}</p>
            <p className="mt-3 line-clamp-2 text-sm text-slate-400">
              {workspace.description || t('workspaces.open')}
            </p>
          </Link>
        ))}
        {items.length === 0 && !error && (
          <p className="rounded-2xl border border-dashed border-slate-700 p-8 text-slate-400">
            {t('workspaces.empty')}
          </p>
        )}
      </div>
      {allowed(user, 'workspace.manage') && (
        <form
          className="mt-10 max-w-2xl rounded-2xl border border-slate-800 bg-slate-900/40 p-5 shadow-lg shadow-slate-950/10 sm:p-6"
          onSubmit={(event) => void submit(event)}
        >
          <h2 className="text-lg font-semibold">{t('workspaces.create')}</h2>
          <p className="mt-1 text-sm text-slate-500">{t('workspaces.stableSlug')}</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="text-sm text-slate-300">
              {t('workspaces.name')}
              <input className={inputClass} name="name" placeholder="Materials R&D" required />
            </label>
            <label className="text-sm text-slate-300">
              {t('workspaces.urlSlug')}
              <input className={inputClass} name="slug" placeholder="materials-rd" required />
            </label>
          </div>
          <label className="mt-4 block text-sm text-slate-300">
            {t('workspaces.descriptionLabel')}
            <textarea
              className={`${inputClass} min-h-20 resize-y`}
              name="description"
              placeholder={t('workspaces.descriptionPlaceholder')}
            />
          </label>
          <Button className="mt-5" type="submit">
            {t('workspaces.create')}
          </Button>
          <ErrorText>{formError}</ErrorText>
        </form>
      )}
    </>
  );
}

function WorkspacePage({ user }: { user: User }) {
  const { t } = useI18n();
  const id = useParams().workspaceId!;
  const { items, error, refresh } = useAsyncList<Project>(
    () => api(`/workspaces/${id}/projects`),
    [id],
  );
  const [formError, setFormError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await api(`/workspaces/${id}/projects`, {
        method: 'POST',
        body: JSON.stringify({ name: data.get('name'), key: data.get('key'), description: '' }),
      });
      form.reset();
      await refresh();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Project creation failed.');
    }
  }
  return (
    <>
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{t('projects.heading')}</h1>
      <p className="mt-3 text-slate-400">{t('projects.description')}</p>
      <ErrorText>{error}</ErrorText>
      <div className="mt-8 divide-y divide-slate-800 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/50 shadow-xl shadow-slate-950/10">
        {items.map((project) => (
          <Link
            className="group flex items-center justify-between gap-4 p-5 hover:bg-slate-800/60 sm:p-6"
            key={project.id}
            to={`/workspaces/${id}/projects/${project.id}`}
          >
            <span className="min-w-0">
              <strong className="block truncate text-base group-hover:text-sky-200">
                {project.name}
              </strong>
              <span className="mt-1 block font-mono text-xs text-slate-500">{project.key}</span>
            </span>
            <span
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${project.archivedAt ? 'bg-amber-500/10 text-amber-300' : 'bg-emerald-500/10 text-emerald-300'}`}
            >
              {project.archivedAt ? t('projects.archived') : project.status}
            </span>
          </Link>
        ))}
        {items.length === 0 && !error && (
          <p className="p-8 text-slate-400">{t('projects.empty')}</p>
        )}
      </div>
      {allowed(user, 'project.create') && (
        <form
          className="mt-10 max-w-2xl rounded-2xl border border-slate-800 bg-slate-900/40 p-5 sm:p-6"
          onSubmit={(event) => void submit(event)}
        >
          <h2 className="text-lg font-semibold">{t('projects.create')}</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="text-sm text-slate-300">
              {t('projects.name')}
              <input
                className={inputClass}
                name="name"
                placeholder="Force characterization"
                required
              />
            </label>
            <label className="text-sm text-slate-300">
              {t('projects.key')}
              <input className={inputClass} name="key" placeholder="FORCE" required />
            </label>
          </div>
          <Button className="mt-5" type="submit">
            {t('projects.create')}
          </Button>
          <ErrorText>{formError}</ErrorText>
        </form>
      )}
    </>
  );
}

function WorkspaceDataPage({ user }: { user: User }) {
  const workspaceId = useParams().workspaceId!;
  const [context, setContext] = useState<WorkspaceDataContext>();
  const [error, setError] = useState('');
  const load = useCallback(async () => {
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
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Workspace data could not be opened.');
    }
  }, [workspaceId]);
  useEffect(() => void load(), [load]);

  if (error)
    return (
      <div className="mx-auto max-w-2xl py-12">
        <ErrorText>{error}</ErrorText>
        <Button className="mt-4" variant="quiet" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  if (!context)
    return (
      <div aria-label="Opening workspace data" className="animate-pulse space-y-3 p-2">
        <div className="h-8 w-52 rounded-lg bg-slate-800/80" />
        <div className="h-10 rounded-xl bg-slate-900/70" />
        <div className="h-64 rounded-2xl border border-slate-800 bg-slate-900/35" />
      </div>
    );
  return (
    <PageLoader label="workspace data">
      <DataPage user={user} workspaceData={context} />
    </PageLoader>
  );
}

function WorkspaceIndexPage() {
  const workspaceId = useParams().workspaceId!;
  return <Navigate replace to={`/workspaces/${workspaceId}/data`} />;
}

function ProjectPage({ user }: { user: User }) {
  const { workspaceId: wid, projectId: pid } = useParams();
  const [project, setProject] = useState<Project>();
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'info' | 'success' | 'error'>('info');
  const [demo, setDemo] = useState<{
    installed: boolean;
    installation?: Record<string, unknown>;
  }>();
  const [installingDemo, setInstallingDemo] = useState(false);
  const load = useCallback(async () => {
    const result = await api<{ items: Project[] }>(`/workspaces/${wid}/projects`);
    setProject(result.items.find((item) => item.id === pid));
  }, [wid, pid]);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    void api<{ installed: boolean; installation?: Record<string, unknown> }>(
      `/workspaces/${wid}/projects/${pid}/demo`,
    )
      .then(setDemo)
      .catch(() => setDemo({ installed: false }));
  }, [wid, pid]);
  if (!project) return <p>Loading project…</p>;

  async function archive(archived: boolean) {
    try {
      await api(`/workspaces/${wid}/projects/${pid}/${archived ? 'archive' : 'restore'}`, {
        method: 'POST',
        body: JSON.stringify(archived ? { reason: 'Archived from project settings' } : {}),
      });
      await load();
      setMessageTone('success');
      setMessage(archived ? 'Project archived.' : 'Project restored.');
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : 'Project update failed.');
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
      setMessage('Project settings saved.');
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : 'Project update failed.');
    }
  }
  async function installDemo() {
    setInstallingDemo(true);
    setMessageTone('info');
    setMessage('Installing the template, immutable CSV, dataset, chart, and follow-up task…');
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
      setMessage('Demo installed. Open Charts & dashboards to inspect exact provenance.');
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : 'Demo installation failed.');
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
        ← Projects
      </Link>
      <div className="relative mt-5 overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900/90 via-slate-900/65 to-sky-950/30 p-6 shadow-2xl shadow-slate-950/20 sm:p-8">
        <div
          aria-hidden="true"
          className="absolute -right-20 -top-24 size-72 rounded-full bg-sky-500/10 blur-3xl"
        />
        <div className="relative">
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-sky-400">
              {project.key}
            </p>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${project.archivedAt ? 'bg-amber-500/10 text-amber-300' : 'bg-emerald-500/10 text-emerald-300'}`}
            >
              {project.archivedAt ? 'Archived' : project.status.replace('_', ' ')}
            </span>
          </div>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">{project.name}</h1>
          <p className="mt-4 text-slate-400">{project.description || 'No description yet.'}</p>
          <p className="mt-4 text-xs text-slate-600">Configuration version {project.rowVersion}</p>
          <nav
            aria-label="Project quick links"
            className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
          >
            {allowed(user, 'record.read') && (
              <Link
                className="rounded-xl border border-slate-700/70 bg-slate-950/35 p-4 text-sm font-medium text-slate-200 hover:border-sky-500/50 hover:bg-sky-500/10 hover:text-sky-200"
                to={`/workspaces/${wid}/projects/${pid}/data`}
              >
                Engineering records <span className="float-right text-sky-400">→</span>
                <span className="mt-1 block text-xs font-normal text-slate-500">
                  Edit typed records
                </span>
              </Link>
            )}
            {allowed(user, 'file.read') && (
              <Link
                className="rounded-xl border border-slate-700/70 bg-slate-950/35 p-4 text-sm font-medium text-slate-200 hover:border-sky-500/50 hover:bg-sky-500/10 hover:text-sky-200"
                to={`/workspaces/${wid}/projects/${pid}/files-datasets`}
              >
                Files &amp; datasets <span className="float-right text-sky-400">→</span>
                <span className="mt-1 block text-xs font-normal text-slate-500">
                  Trace raw evidence
                </span>
              </Link>
            )}
            {allowed(user, 'dataset.read') && (
              <Link
                className="rounded-xl border border-slate-700/70 bg-slate-950/35 p-4 text-sm font-medium text-slate-200 hover:border-sky-500/50 hover:bg-sky-500/10 hover:text-sky-200"
                to={`/workspaces/${wid}/projects/${pid}/visualizations`}
              >
                Visualizations <span className="float-right text-sky-400">→</span>
                <span className="mt-1 block text-xs font-normal text-slate-500">
                  Compare exact revisions
                </span>
              </Link>
            )}
            {allowed(user, 'task.read') && (
              <Link
                className="rounded-xl border border-slate-700/70 bg-slate-950/35 p-4 text-sm font-medium text-slate-200 hover:border-sky-500/50 hover:bg-sky-500/10 hover:text-sky-200"
                to={`/workspaces/${wid}/projects/${pid}/tasks`}
              >
                Tasks <span className="float-right text-sky-400">→</span>
                <span className="mt-1 block text-xs font-normal text-slate-500">
                  Close the follow-up loop
                </span>
              </Link>
            )}
          </nav>
          <section className="mt-8 rounded-2xl border border-sky-800/50 bg-sky-950/30 p-5 sm:p-6">
            <p className="font-mono text-xs uppercase tracking-widest text-sky-400">
              Test &amp; Characterization · v6
            </p>
            <h2 className="mt-2 text-xl font-semibold">Traceable onboarding demo</h2>
            <p className="mt-2 text-sm text-slate-400">
              Creates clearly labelled synthetic records, an immutable raw CSV and dataset, a pinned
              chart, and a linked follow-up task. It is safe to archive after evaluation.
            </p>
            {demo?.installed ? (
              <div className="mt-4 flex flex-wrap gap-3 text-sm">
                <span className="text-emerald-300">Demo installed</span>
                <Link
                  className="text-sky-300"
                  to={`/workspaces/${wid}/projects/${pid}/visualizations`}
                >
                  Inspect chart →
                </Link>
                <Link
                  className="text-sky-300"
                  to={`/workspaces/${wid}/projects/${pid}/files-datasets`}
                >
                  Inspect raw source →
                </Link>
              </div>
            ) : allowed(user, 'schema.manage') ? (
              <Button className="mt-4" disabled={installingDemo} onClick={() => void installDemo()}>
                {installingDemo ? 'Installing demo…' : 'Install template & demo'}
              </Button>
            ) : (
              <p className="mt-4 text-sm text-slate-500">
                Ask an Engineer or Admin to install the demo.
              </p>
            )}
          </section>
          {allowed(user, 'project.update') && !project.archivedAt && (
            <form
              className="mt-8 grid max-w-2xl gap-4 border-t border-slate-800 pt-8"
              onSubmit={(event) => void update(event)}
            >
              <div>
                <h2 className="text-xl font-semibold">Project settings</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Update the project label and lifecycle status.
                </p>
              </div>
              <label className="text-sm text-slate-300">
                Project name
                <input className={inputClass} defaultValue={project.name} name="name" required />
              </label>
              <label className="text-sm text-slate-300">
                Description
                <textarea
                  className={inputClass}
                  defaultValue={project.description}
                  name="description"
                  rows={3}
                />
              </label>
              <label className="text-sm text-slate-300">
                Status
                <select className={inputClass} defaultValue={project.status} name="status">
                  <option value="active">Active</option>
                  <option value="on_hold">On hold</option>
                  <option value="completed">Completed</option>
                </select>
              </label>
              <Button type="submit">Save project settings</Button>
            </form>
          )}
          <div className="mt-8">
            {project.archivedAt
              ? allowed(user, 'project.restore') && (
                  <Button onClick={() => void archive(false)}>Restore project</Button>
                )
              : allowed(user, 'project.archive') && (
                  <Button variant="quiet" onClick={() => void archive(true)}>
                    Archive project
                  </Button>
                )}
          </div>
          <NoticeText tone={messageTone}>{message}</NoticeText>
        </div>
      </div>
    </>
  );
}

function GetStartedPage() {
  const [completed, setCompleted] = useState<OnboardingStep[]>([]);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'success' | 'error'>('success');
  useEffect(() => {
    void api<{ completed_steps: OnboardingStep[] }>('/onboarding')
      .then((result) => setCompleted(result.completed_steps ?? []))
      .catch((cause) => {
        setMessageTone('error');
        setMessage(cause instanceof Error ? cause.message : 'Unable to load onboarding.');
      });
  }, []);
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
        next.length === onboardingSteps.length ? 'Onboarding complete.' : 'Progress saved.',
      );
    } catch (cause) {
      setCompleted(completed);
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : 'Unable to save onboarding.');
    }
  }
  return (
    <>
      <p className="font-mono text-xs uppercase tracking-widest text-sky-400">Community pilot</p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">Get started</h1>
      <p className="mt-3 max-w-2xl text-slate-400">
        This golden path takes a result from immutable raw evidence to a chart and follow-up work.
      </p>
      <div className="mt-8 max-w-2xl">
        <div className="mb-5 flex items-center justify-between gap-4 text-sm">
          <span className="text-slate-400">Setup progress</span>
          <span className="font-medium text-sky-300">
            {completed.length} of {onboardingSteps.length}
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
                <span className="font-mono text-xs text-slate-500">STEP {index + 1}</span>
                <span
                  className={`mt-1 block font-medium ${completed.includes(step.key) ? 'text-slate-400 line-through decoration-slate-600' : 'text-slate-100'}`}
                >
                  {step.label}
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>
      <div className="mt-6 flex gap-4">
        <Link className="text-sky-300" to="/workspaces">
          Open workspaces →
        </Link>
        <Link className="text-sky-300" to="/pilot">
          Share pilot feedback →
        </Link>
      </div>
      <NoticeText tone={messageTone}>{message}</NoticeText>
    </>
  );
}

function PilotPage({ user }: { user: User }) {
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
      setMessage('Thank you. The feedback was stored for your Engrove administrators.');
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : 'Feedback submission failed.');
    }
  }
  return (
    <>
      <p className="font-mono text-xs uppercase tracking-widest text-sky-400">Pilot</p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">
        Feedback &amp; adoption
      </h1>
      {summary && (
        <section className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ['Repeat users', 'repeat_users'],
              ['Records', 'records'],
              ['Ready datasets', 'datasets'],
              ['Feedback items', 'feedback_items'],
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
        <label className="block text-sm text-slate-300">
          Category
          <select className={inputClass} name="category" defaultValue="workflow">
            <option value="workflow">Workflow</option>
            <option value="usability">Usability</option>
            <option value="bug">Bug</option>
            <option value="idea">Idea</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="block text-sm text-slate-300">
          Rating
          <select className={inputClass} name="rating" defaultValue="4">
            {[1, 2, 3, 4, 5].map((rating) => (
              <option key={rating} value={rating}>
                {rating} / 5
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-slate-300">
          What worked, and what blocked you?
          <textarea className={inputClass} minLength={10} name="message" required rows={6} />
        </label>
        <Button type="submit">Submit feedback</Button>
      </form>
      {allowed(user, 'pilot.manage') && feedbackItems.length > 0 && (
        <section className="mt-10">
          <h2 className="text-2xl font-semibold">Recent feedback</h2>
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

function MembersPage() {
  const { items, error, refresh } = useAsyncList<Member>(() => api('/members'), []);
  const [generatedUrl, setGeneratedUrl] = useState('');
  const [message, setMessage] = useState('');
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      const result = await api<{ invitationUrl: string }>('/invitations', {
        method: 'POST',
        body: JSON.stringify({ email: data.get('email'), role: data.get('role') }),
      });
      setGeneratedUrl(result.invitationUrl);
      setMessage('');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Invitation failed.');
    }
  }
  async function changeRole(userId: string, nextRole: Role) {
    try {
      await api(`/members/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role: nextRole }),
      });
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Role update failed.');
    }
  }
  return (
    <>
      <h1 className="text-4xl font-semibold">Members</h1>
      <div className="mt-8 divide-y divide-slate-800 rounded-2xl border border-slate-800">
        {items.map((member) => (
          <div className="flex items-center justify-between p-5" key={member.userId}>
            <span>
              <strong>{member.displayName}</strong>
              <span className="ml-3 text-sm text-slate-500">{member.email}</span>
            </span>
            <select
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
              value={member.role}
              onChange={(event) => void changeRole(member.userId, event.target.value as Role)}
            >
              {['owner', 'admin', 'engineer', 'contributor', 'viewer'].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <form className="mt-10 max-w-xl space-y-4" onSubmit={(event) => void invite(event)}>
        <Field label="Invite email" name="email" type="email" />
        <label className="block text-sm text-slate-300">
          Role
          <select className={inputClass} name="role" defaultValue="contributor">
            <option>admin</option>
            <option>engineer</option>
            <option>contributor</option>
            <option>viewer</option>
          </select>
        </label>
        <Button type="submit">Generate invitation URL</Button>
      </form>
      {generatedUrl && <textarea className={`${inputClass} mt-4`} readOnly value={generatedUrl} />}
      <ErrorText>{error || message}</ErrorText>
    </>
  );
}

function AuditPage() {
  const { items, error } = useAsyncList<Record<string, unknown>>(
    () => api('/audit-events?limit=100'),
    [],
  );
  return (
    <>
      <h1 className="text-4xl font-semibold">Audit events</h1>
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
          <span className="mx-auto grid size-12 animate-pulse place-items-center rounded-2xl bg-gradient-to-br from-sky-300 to-cyan-500 font-mono font-black text-[#082f49]">
            E
          </span>
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
                <DataPage user={user} />
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
        <Route
          path="*"
          element={
            <Navigate
              to={state === 'setup' ? '/setup' : state === 'signed-in' ? '/workspaces' : '/sign-in'}
              replace
            />
          }
        />
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
