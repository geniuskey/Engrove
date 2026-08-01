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
} from 'react-router-dom';
import { DataPage, RecordDetailPage } from './DataPage.js';
import { FilesDatasetsPage } from './FilesDatasetsPage.js';
import { TasksPage } from './TasksPage.js';

const VisualizationsPage = lazy(() =>
  import('./VisualizationsPage.js').then((module) => ({ default: module.VisualizationsPage })),
);

const apiBase = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

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
  const [state, setState] = useState<'loading' | 'available' | 'unavailable'>('loading');
  const [version, setVersion] = useState('');
  const check = useCallback(async () => {
    setState('loading');
    try {
      const response = await fetch(`${apiBase}/health/ready`);
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
    <div aria-live="polite" className="mt-8 rounded-xl border border-slate-800 bg-slate-900/70 p-4">
      {state === 'loading' && <p className="text-sm text-slate-400">Checking the API…</p>}
      {state === 'available' && (
        <p className="text-sm text-emerald-300">API ready · version {version}</p>
      )}
      {state === 'unavailable' && (
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-medium text-amber-300">API unavailable</p>
            <p className="text-sm text-slate-400">Start the local stack, then retry.</p>
          </div>
          <Button variant="quiet" onClick={() => void check()}>
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}

function AuthCard({ title, children }: PropsWithChildren<{ title: string }>) {
  return (
    <main className="min-h-screen bg-slate-950 px-6 py-16 text-slate-100">
      <div className="mx-auto max-w-md">
        <Link to="/" className="font-mono text-sm uppercase tracking-[0.22em] text-sky-400">
          Engrove Community
        </Link>
        <h1 className="mt-6 text-3xl font-semibold">{title}</h1>
        <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
          {children}
        </div>
        <ApiStatus />
      </div>
    </main>
  );
}

export const inputClass =
  'mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-sky-400';

function Field({ label, name, type = 'text' }: { label: string; name: string; type?: string }) {
  return (
    <label className="block text-sm text-slate-300">
      {label}
      <input className={inputClass} required name={name} type={type} />
    </label>
  );
}

function SetupPage() {
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
    <AuthCard title="Create the first Owner">
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
  const navigate = useNavigate();
  const [message, setMessage] = useState('');
  const [oidcEnabled, setOidcEnabled] = useState(false);
  useEffect(() => {
    void api<{ enabled: boolean }>('/auth/oidc/status')
      .then((result) => setOidcEnabled(result.enabled))
      .catch(() => setOidcEnabled(false));
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      const result = await api<{ user: User }>('/auth/sign-in', {
        method: 'POST',
        body: JSON.stringify({ email: data.get('email'), password: data.get('password') }),
      });
      onSignedIn(result.user);
      navigate('/workspaces', { replace: true });
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Sign in failed.');
    }
  }
  return (
    <AuthCard title="Sign in">
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        {oidcEnabled && (
          <a
            className="block rounded-lg border border-sky-500 px-4 py-2 text-center text-sky-300"
            href={`${apiBase}/api/v1/auth/oidc/start`}
          >
            Sign in with OpenID Connect
          </a>
        )}
        <Field label="Email" name="email" type="email" />
        <Field label="Password" name="password" type="password" />
        {message && <p className="text-sm text-rose-300">{message}</p>}
        <Button className="w-full" type="submit">
          Sign in
        </Button>
      </form>
    </AuthCard>
  );
}

function TokenPasswordPage({ invitation }: { invitation: boolean }) {
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
    <AuthCard title={invitation ? 'Accept invitation' : 'Reset password'}>
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

function Shell({
  user,
  onSignedOut,
  children,
}: PropsWithChildren<{ user: User; onSignedOut: () => void }>) {
  async function signOut() {
    await api('/auth/sign-out', { method: 'POST' });
    onSignedOut();
  }
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-950/90">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <nav className="flex items-center gap-6">
            <Link className="font-semibold text-sky-400" to="/workspaces">
              Engrove
            </Link>
            <Link to="/get-started">Get started</Link>
            <Link to="/pilot">Pilot</Link>
            {allowed(user, 'member.manage') && <Link to="/members">Members</Link>}
            {allowed(user, 'audit.read') && <Link to="/audit">Audit</Link>}
          </nav>
          <div className="flex items-center gap-4 text-sm text-slate-400">
            <span>{user.displayName}</span>
            <Button variant="quiet" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
    </div>
  );
}

export function ErrorText({ children }: PropsWithChildren) {
  return children ? <p className="mt-3 text-sm text-rose-300">{children}</p> : null;
}

function WorkspacesPage({ user }: { user: User }) {
  const { items, error, refresh } = useAsyncList<Workspace>(() => api('/workspaces'), []);
  const [formError, setFormError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await api('/workspaces', {
        method: 'POST',
        body: JSON.stringify({ name: data.get('name'), slug: data.get('slug'), description: '' }),
      });
      form.reset();
      await refresh();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Workspace creation failed.');
    }
  }
  return (
    <>
      <p className="font-mono text-xs uppercase tracking-widest text-sky-400">Organization</p>
      <h1 className="mt-2 text-4xl font-semibold">Workspaces</h1>
      <ErrorText>{error}</ErrorText>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {items.map((workspace) => (
          <Link
            className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 hover:border-sky-500"
            key={workspace.id}
            to={`/workspaces/${workspace.id}`}
          >
            <h2 className="text-xl font-semibold">{workspace.name}</h2>
            <p className="mt-1 font-mono text-sm text-slate-500">{workspace.slug}</p>
          </Link>
        ))}
        {items.length === 0 && !error && (
          <p className="rounded-2xl border border-dashed border-slate-700 p-8 text-slate-400">
            No workspaces yet. Create the first workspace below to organize projects.
          </p>
        )}
      </div>
      {allowed(user, 'workspace.manage') && (
        <form
          className="mt-10 flex max-w-xl flex-wrap gap-3"
          onSubmit={(event) => void submit(event)}
        >
          <input className={inputClass} name="name" placeholder="Workspace name" required />
          <input className={inputClass} name="slug" placeholder="workspace-slug" required />
          <Button type="submit">Create workspace</Button>
          <ErrorText>{formError}</ErrorText>
        </form>
      )}
    </>
  );
}

function WorkspacePage({ user }: { user: User }) {
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
      <Link className="text-sm text-sky-400" to="/workspaces">
        ← Workspaces
      </Link>
      <h1 className="mt-4 text-4xl font-semibold">Projects</h1>
      <ErrorText>{error}</ErrorText>
      <div className="mt-8 divide-y divide-slate-800 rounded-2xl border border-slate-800 bg-slate-900/60">
        {items.map((project) => (
          <Link
            className="flex items-center justify-between p-5 hover:bg-slate-800/50"
            key={project.id}
            to={`/workspaces/${id}/projects/${project.id}`}
          >
            <span>
              <strong>{project.name}</strong>
              <span className="ml-3 font-mono text-xs text-slate-500">{project.key}</span>
            </span>
            <span className={project.archivedAt ? 'text-amber-300' : 'text-emerald-300'}>
              {project.archivedAt ? 'Archived' : project.status}
            </span>
          </Link>
        ))}
        {items.length === 0 && !error && (
          <p className="p-8 text-slate-400">
            No projects yet. Create one below, then open its Data grid.
          </p>
        )}
      </div>
      {allowed(user, 'project.create') && (
        <form
          className="mt-10 flex max-w-xl flex-wrap gap-3"
          onSubmit={(event) => void submit(event)}
        >
          <input className={inputClass} name="name" placeholder="Project name" required />
          <input className={inputClass} name="key" placeholder="PROJECT" required />
          <Button type="submit">Create project</Button>
          <ErrorText>{formError}</ErrorText>
        </form>
      )}
    </>
  );
}

function ProjectPage({ user }: { user: User }) {
  const { workspaceId: wid, projectId: pid } = useParams();
  const [project, setProject] = useState<Project>();
  const [message, setMessage] = useState('');
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
    } catch (cause) {
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
      setMessage('Project settings saved.');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Project update failed.');
    }
  }
  async function installDemo() {
    setInstallingDemo(true);
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
      setMessage('Demo installed. Open Charts & dashboards to inspect exact provenance.');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Demo installation failed.');
    } finally {
      setInstallingDemo(false);
    }
  }
  return (
    <>
      <Link className="text-sm text-sky-400" to={`/workspaces/${wid}`}>
        ← Projects
      </Link>
      <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-900/70 p-8">
        <p className="font-mono text-sm text-sky-400">{project.key}</p>
        <h1 className="mt-2 text-4xl font-semibold">{project.name}</h1>
        <p className="mt-4 text-slate-400">{project.description || 'No description yet.'}</p>
        <p className="mt-6 text-sm text-slate-500">Version {project.rowVersion}</p>
        <div className="mt-6 flex flex-wrap gap-3 border-y border-slate-800 py-4">
          <span className="text-sm font-medium text-slate-200">Overview</span>
          {allowed(user, 'record.read') && (
            <Link
              className="text-sm text-sky-400 hover:text-sky-300"
              to={`/workspaces/${wid}/projects/${pid}/data`}
            >
              Data grid →
            </Link>
          )}
          {allowed(user, 'file.read') && (
            <Link
              className="text-sm text-sky-400 hover:text-sky-300"
              to={`/workspaces/${wid}/projects/${pid}/files-datasets`}
            >
              Files &amp; datasets →
            </Link>
          )}
          {allowed(user, 'dataset.read') && (
            <Link
              className="text-sm text-sky-400 hover:text-sky-300"
              to={`/workspaces/${wid}/projects/${pid}/visualizations`}
            >
              Charts &amp; dashboards →
            </Link>
          )}
          {allowed(user, 'task.read') && (
            <Link
              className="text-sm text-sky-400 hover:text-sky-300"
              to={`/workspaces/${wid}/projects/${pid}/tasks`}
            >
              Tasks →
            </Link>
          )}
        </div>
        <section className="mt-6 rounded-xl border border-sky-900 bg-sky-950/30 p-5">
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
          <form className="mt-6 grid max-w-2xl gap-4" onSubmit={(event) => void update(event)}>
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
        <ErrorText>{message}</ErrorText>
      </div>
    </>
  );
}

function GetStartedPage() {
  const [completed, setCompleted] = useState<OnboardingStep[]>([]);
  const [message, setMessage] = useState('');
  useEffect(() => {
    void api<{ completed_steps: OnboardingStep[] }>('/onboarding')
      .then((result) => setCompleted(result.completed_steps ?? []))
      .catch((cause) =>
        setMessage(cause instanceof Error ? cause.message : 'Unable to load onboarding.'),
      );
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
      setMessage(
        next.length === onboardingSteps.length ? 'Onboarding complete.' : 'Progress saved.',
      );
    } catch (cause) {
      setCompleted(completed);
      setMessage(cause instanceof Error ? cause.message : 'Unable to save onboarding.');
    }
  }
  return (
    <>
      <p className="font-mono text-xs uppercase tracking-widest text-sky-400">Community pilot</p>
      <h1 className="mt-2 text-4xl font-semibold">Get started</h1>
      <p className="mt-3 max-w-2xl text-slate-400">
        This golden path takes a result from immutable raw evidence to a chart and follow-up work.
      </p>
      <div className="mt-8 max-w-2xl space-y-3">
        {onboardingSteps.map((step, index) => (
          <label
            className="flex cursor-pointer items-start gap-4 rounded-xl border border-slate-800 bg-slate-900/60 p-5"
            key={step.key}
          >
            <input
              checked={completed.includes(step.key)}
              className="mt-1 size-4 accent-sky-500"
              type="checkbox"
              onChange={() => void toggle(step.key)}
            />
            <span>
              <span className="font-mono text-xs text-slate-500">STEP {index + 1}</span>
              <span className="mt-1 block font-medium">{step.label}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="mt-6 flex gap-4">
        <Link className="text-sky-300" to="/workspaces">
          Open workspaces →
        </Link>
        <Link className="text-sky-300" to="/pilot">
          Share pilot feedback →
        </Link>
      </div>
      <ErrorText>{message}</ErrorText>
    </>
  );
}

function PilotPage({ user }: { user: User }) {
  const [message, setMessage] = useState('');
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
      setMessage('Thank you. The feedback was stored for your Engrove administrators.');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Feedback submission failed.');
    }
  }
  return (
    <>
      <p className="font-mono text-xs uppercase tracking-widest text-sky-400">Pilot</p>
      <h1 className="mt-2 text-4xl font-semibold">Feedback &amp; adoption</h1>
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
      <ErrorText>{message}</ErrorText>
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

export function App() {
  const [user, setUser] = useState<User>();
  const [state, setState] = useState<'loading' | 'setup' | 'signed-out' | 'signed-in'>('loading');

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
    return <main className="min-h-screen bg-slate-950 p-10 text-slate-300">Loading Engrove…</main>;
  }

  const protectedElement = (content: React.ReactNode) =>
    state === 'signed-in' && user ? (
      <Shell user={user} onSignedOut={() => setState('signed-out')}>
        {content}
      </Shell>
    ) : (
      <Navigate to={state === 'setup' ? '/setup' : '/sign-in'} replace />
    );

  return (
    <Routes>
      <Route path="/setup" element={<SetupPage />} />
      <Route
        path="/sign-in"
        element={
          <SignInPage
            onSignedIn={(next) => {
              setUser(next);
              setState('signed-in');
            }}
          />
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
      <Route
        path="/workspaces/:workspaceId"
        element={protectedElement(user && <WorkspacePage user={user} />)}
      />
      <Route
        path="/workspaces/:workspaceId/projects/:projectId"
        element={protectedElement(user && <ProjectPage user={user} />)}
      />
      <Route
        path="/workspaces/:workspaceId/projects/:projectId/data"
        element={protectedElement(user && <DataPage user={user} />)}
      />
      <Route
        path="/workspaces/:workspaceId/projects/:projectId/files-datasets"
        element={protectedElement(user && <FilesDatasetsPage user={user} />)}
      />
      <Route
        path="/workspaces/:workspaceId/projects/:projectId/visualizations"
        element={protectedElement(
          user && (
            <Suspense fallback={<p className="text-slate-400">Loading chart studio…</p>}>
              <VisualizationsPage user={user} />
            </Suspense>
          ),
        )}
      />
      <Route
        path="/workspaces/:workspaceId/projects/:projectId/tasks"
        element={protectedElement(user && <TasksPage user={user} />)}
      />
      <Route
        path="/workspaces/:workspaceId/projects/:projectId/data/:objectTypeId/records/:recordId"
        element={protectedElement(user && <RecordDetailPage user={user} />)}
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
  );
}
