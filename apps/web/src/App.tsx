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
const projectLinkClass =
  'rounded-xl border border-slate-700/70 bg-slate-950/35 p-4 text-sm font-medium text-slate-200 hover:border-sky-500/50 hover:bg-sky-500/10 hover:text-sky-200';
const formLabelClass = 'text-sm text-slate-300';
const blockFormLabelClass = `block ${formLabelClass}`;
const projectLinkHintClass = 'mt-1 block text-xs font-normal text-slate-500';
const sectionEyebrowClass = 'font-mono text-xs uppercase tracking-widest text-sky-400';
const pageTitleClass = 'mt-2 text-4xl font-semibold tracking-tight sm:text-5xl';
const projectLinkArrowClass = 'float-right text-sky-400';

function memberGroupColor(color: MemberGroupColor): string {
  return memberGroupColors.find((candidate) => candidate.value === color)?.hex ?? '#38bdf8';
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
              <img alt="" className="size-10" height="40" src="/engrove-mark.png" width="40" />
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
              <img alt="" className="size-10" height="40" src="/engrove-mark.png" width="40" />
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
      setMessage(cause instanceof Error ? cause.message : 'Setup failed.');
    }
  }
  return (
    <AuthCard title={t('auth.setup')}>
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <label className={blockFormLabelClass}>
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
        <label className={blockFormLabelClass}>
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
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            {t('common.workspaces')}
          </h1>
          <HelpTip label="About workspaces">{t('workspaces.description')}</HelpTip>
        </div>
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
            to={`/workspaces/${workspace.publicId ?? workspace.id}`}
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
            <p className="mt-1 font-mono text-xs text-slate-500">
              {workspace.slug} · {workspace.publicId ?? workspace.id}
            </p>
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
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{t('workspaces.create')}</h2>
            <HelpTip label="Workspace address help">{t('workspaces.stableSlug')}</HelpTip>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className={formLabelClass}>
              {t('workspaces.name')}
              <input className={inputClass} name="name" placeholder="Materials R&D" required />
            </label>
            <label className={formLabelClass}>
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
      <div className="flex items-center gap-3">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          {t('projects.heading')}
        </h1>
        <HelpTip label="About projects">{t('projects.description')}</HelpTip>
      </div>
      <ErrorText>{error}</ErrorText>
      <div className="mt-8 divide-y divide-slate-800 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/50 shadow-xl shadow-slate-950/10">
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
              <Link className={projectLinkClass} to={`/workspaces/${wid}/projects/${pid}/data`}>
                Engineering records <span className={projectLinkArrowClass}>→</span>
                <span className={projectLinkHintClass}>Edit typed records</span>
              </Link>
            )}
            {allowed(user, 'file.read') && (
              <Link
                className={projectLinkClass}
                to={`/workspaces/${wid}/projects/${pid}/files-datasets`}
              >
                Files &amp; datasets <span className={projectLinkArrowClass}>→</span>
                <span className={projectLinkHintClass}>Trace raw evidence</span>
              </Link>
            )}
            {allowed(user, 'dataset.read') && (
              <Link
                className={projectLinkClass}
                to={`/workspaces/${wid}/projects/${pid}/visualizations`}
              >
                Visualizations <span className={projectLinkArrowClass}>→</span>
                <span className={projectLinkHintClass}>Compare exact revisions</span>
              </Link>
            )}
            {allowed(user, 'task.read') && (
              <Link className={projectLinkClass} to={`/workspaces/${wid}/projects/${pid}/tasks`}>
                Tasks <span className={projectLinkArrowClass}>→</span>
                <span className={projectLinkHintClass}>Close the follow-up loop</span>
              </Link>
            )}
          </nav>
          <section className="mt-8 rounded-2xl border border-sky-800/50 bg-sky-950/30 p-5 sm:p-6">
            <p className={sectionEyebrowClass}>Test &amp; Characterization · v6</p>
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
              <h2 className="text-xl font-semibold">Project settings</h2>
              <label className={formLabelClass}>
                Project name
                <input className={inputClass} defaultValue={project.name} name="name" required />
              </label>
              <label className={formLabelClass}>
                Description
                <textarea
                  className={inputClass}
                  defaultValue={project.description}
                  name="description"
                  rows={3}
                />
              </label>
              <label className={formLabelClass}>
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
      <p className={sectionEyebrowClass}>Community pilot</p>
      <h1 className={pageTitleClass}>Get started</h1>
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
      <p className={sectionEyebrowClass}>Pilot</p>
      <h1 className={pageTitleClass}>Feedback &amp; adoption</h1>
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
        <label className={blockFormLabelClass}>
          Category
          <select className={inputClass} name="category" defaultValue="workflow">
            <option value="workflow">Workflow</option>
            <option value="usability">Usability</option>
            <option value="bug">Bug</option>
            <option value="idea">Idea</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className={blockFormLabelClass}>
          Rating
          <select className={inputClass} name="rating" defaultValue="4">
            {[1, 2, 3, 4, 5].map((rating) => (
              <option key={rating} value={rating}>
                {rating} / 5
              </option>
            ))}
          </select>
        </label>
        <label className={blockFormLabelClass}>
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

export function MembersPage() {
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
      setMessage('Invitation link generated.');
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : 'Invitation failed.');
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
      setMessage(`${selectedMemberIds.size} selected members changed to ${bulkRole}.`);
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : 'Roles could not be updated.');
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
      setMessage(`Selected members are already in ${group.name}.`);
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
      setMessage(`${addedCount} member${addedCount === 1 ? '' : 's'} added to ${group.name}.`);
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : 'Members could not be added.');
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
      setMessage(`${created.name} group created.`);
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : 'Group creation failed.');
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
      setMessage(`${String(data.get('name'))} group updated.`);
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : 'Group update failed.');
    } finally {
      setBusy(false);
    }
  }

  async function archiveGroup(group: MemberGroup) {
    if (!window.confirm(`Archive “${group.name}”? Members will keep their organization roles.`)) {
      return;
    }
    setBusy(true);
    try {
      await api(`/member-groups/${group.id}/archive`, { method: 'POST' });
      await refreshGroups();
      setMessageTone('success');
      setMessage(`${group.name} group archived.`);
    } catch (cause) {
      setMessageTone('error');
      setMessage(cause instanceof Error ? cause.message : 'Group could not be archived.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-sky-400">Organization</p>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="text-3xl font-semibold">Members & groups</h1>
            <HelpTip label="Member management help">
              Select people for bulk access changes, or drag them directly into a group.
            </HelpTip>
          </div>
        </div>
        <div className="flex gap-2 text-xs text-slate-400">
          <span className="rounded-full border border-slate-800 px-3 py-1.5">
            {items.length} members
          </span>
          <span className="rounded-full border border-slate-800 px-3 py-1.5">
            {groups.length} groups
          </span>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-800 bg-slate-900/45">
          <header className="border-b border-slate-800 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-100">Member directory</h2>
                <HelpTip label="Member role help">Roles control product access.</HelpTip>
              </div>
              <details className="relative">
                <summary className="cursor-pointer list-none rounded-md border border-slate-700 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800">
                  Invite member
                </summary>
                <div className="absolute right-0 top-10 z-40 w-80 rounded-xl border border-slate-700 bg-slate-950 p-4 shadow-2xl">
                  <form className="space-y-3" onSubmit={(event) => void invite(event)}>
                    <Field label="Invite email" name="email" type="email" />
                    <label className="block text-xs font-medium text-slate-300">
                      Role
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
                      Generate invitation link
                    </Button>
                  </form>
                  {generatedUrl && (
                    <textarea
                      aria-label="Invitation URL"
                      className={`${inputClass} mt-3 min-h-20 text-xs`}
                      readOnly
                      value={generatedUrl}
                    />
                  )}
                </div>
              </details>
            </div>
            <input
              aria-label="Search members"
              className={`${inputClass} mt-3`}
              placeholder="Search name, email, or role"
              type="search"
              value={memberSearch}
              onChange={(event) => setMemberSearch(event.target.value)}
            />
            <p className="mt-2 text-xs text-slate-600">{filteredMembers.length} members shown</p>
          </header>
          {selectedMemberIds.size > 0 && (
            <div
              aria-label="Bulk member actions"
              className="border-b border-sky-500/20 bg-sky-500/5 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-auto text-xs font-semibold text-sky-200">
                  {selectedMemberIds.size} selected
                </span>
                <select
                  aria-label="Role for selected members"
                  className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-300"
                  value={bulkRole}
                  onChange={(event) => setBulkRole(event.target.value as Role)}
                >
                  {memberRoles.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
                <Button disabled={busy} onClick={() => void changeSelectedRoles()} type="button">
                  Apply role
                </Button>
              </div>
              <button
                className="mt-2 text-xs text-slate-500 hover:text-slate-200"
                onClick={() => setSelectedMemberIds(new Set())}
                type="button"
              >
                Clear selection
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
                    aria-label={`Select ${member.displayName}`}
                    checked={selectedMemberIds.has(member.userId)}
                    className="accent-sky-500"
                    type="checkbox"
                    onChange={(event) => toggleMemberSelection(member.userId, event.target.checked)}
                  />
                  <button
                    aria-label={`Drag ${member.displayName}`}
                    className="cursor-grab select-none px-1 text-sm text-slate-600 hover:text-slate-200 active:cursor-grabbing"
                    draggable
                    title="Drag into a group"
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
              <p className="p-8 text-center text-xs text-slate-500">No matching members.</p>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/45">
          <header className="border-b border-slate-800 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-100">Groups</h2>
                <HelpTip label="Group assignment help">
                  Drop one member—or your current selection—onto a group.
                </HelpTip>
              </div>
              <Button
                aria-expanded={showCreateGroup}
                variant="quiet"
                onClick={() => setShowCreateGroup((value) => !value)}
                type="button"
              >
                + New group
              </Button>
            </div>
            {showCreateGroup && (
              <form className="mt-3 grid gap-2" onSubmit={(event) => void createGroup(event)}>
                <input
                  aria-label="New group name"
                  autoFocus
                  className={inputClass}
                  maxLength={80}
                  name="name"
                  placeholder="e.g. Materials laboratory"
                  required
                />
                <textarea
                  aria-label="New group description"
                  className={`${inputClass} min-h-20 resize-y`}
                  maxLength={500}
                  name="description"
                  placeholder="What this group works on"
                />
                <div className="flex items-center gap-2">
                  <select
                    aria-label="New group color"
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
                    {busy ? 'Creating…' : 'Create'}
                  </Button>
                </div>
              </form>
            )}
            <input
              aria-label="Search groups"
              className={`${inputClass} mt-3`}
              placeholder="Search groups"
              type="search"
              value={groupSearch}
              onChange={(event) => setGroupSearch(event.target.value)}
            />
          </header>

          <div className="grid sm:grid-cols-2">
            <nav
              aria-label="Member groups"
              className="overflow-y-auto border-b border-slate-800 p-2 sm:border-b-0 sm:border-r"
              style={{ maxHeight: '34rem' }}
            >
              {filteredGroups.map((group) => (
                <button
                  aria-current={selectedGroupId === group.id ? 'true' : undefined}
                  aria-label={`${group.name}, ${group.memberIds.length} member${group.memberIds.length === 1 ? '' : 's'}. Drop members here`}
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
                      {group.memberIds.length} members
                    </span>
                  </span>
                </button>
              ))}
              {filteredGroups.length === 0 && (
                <p className="p-5 text-center text-xs text-slate-500">No groups yet.</p>
              )}
            </nav>

            <div className="min-w-0 p-4">
              {selectedGroup ? (
                <form key={selectedGroup.id} onSubmit={(event) => void saveGroup(event)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[10px] font-medium uppercase tracking-widest text-sky-400">
                        Group details
                      </p>
                      <h3 className="mt-1 truncate text-sm font-semibold text-slate-200">
                        {selectedGroup.name}
                      </h3>
                    </div>
                    <button
                      aria-label={`Archive group ${selectedGroup.name}`}
                      className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-rose-500/10 hover:text-rose-300"
                      disabled={busy}
                      onClick={() => void archiveGroup(selectedGroup)}
                      type="button"
                    >
                      Archive
                    </button>
                  </div>
                  <input
                    aria-label="Group name"
                    className={`${inputClass} mt-3`}
                    defaultValue={selectedGroup.name}
                    maxLength={80}
                    name="name"
                    required
                  />
                  <textarea
                    aria-label="Group description"
                    className={`${inputClass} mt-2 min-h-20 resize-y`}
                    defaultValue={selectedGroup.description}
                    maxLength={500}
                    name="description"
                    placeholder="Group description"
                  />
                  <select
                    aria-label="Group color"
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
                      Members · {groupMemberDraft.size}
                    </legend>
                    <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-800 p-2">
                      {items.map((member) => (
                        <label
                          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                          key={member.userId}
                        >
                          <input
                            aria-label={`Add ${member.displayName} to ${selectedGroup.name}`}
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
                    {busy ? 'Saving…' : 'Save group'}
                  </Button>
                </form>
              ) : (
                <div className="p-6 text-center">
                  <p className="text-sm font-medium text-slate-400">Create your first group</p>
                  <p className="mt-1 text-xs text-slate-600">
                    Group members by team, laboratory, discipline, or responsibility.
                  </p>
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
          <img
            alt=""
            className="mx-auto size-12 animate-pulse"
            height="48"
            src="/engrove-mark.png"
            width="48"
          />
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
