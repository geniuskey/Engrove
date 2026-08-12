import { Button } from '@engrove/ui';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { api, inputClass, NoticeText } from './App.js';
import { useActionDialog } from './ActionDialogProvider.js';
import { FormFieldLabel } from './FormFieldLabel.js';
import { useI18n } from './i18n.js';

type Category = 'todo' | 'in_progress' | 'done';
type Color = 'slate' | 'sky' | 'violet' | 'amber' | 'rose' | 'emerald';
interface WorkflowStatus {
  id: string;
  key: string;
  name: string;
  category: Category;
  color: Color;
  position: number;
  wip_limit: number | null;
  initial: boolean;
  row_version: number;
  task_count: number;
}
interface WorkflowTransition {
  id: string;
  name: string;
  from_status: string;
  to_status: string;
}
interface Workflow {
  statuses: WorkflowStatus[];
  transitions: WorkflowTransition[];
}

const colors: Color[] = ['slate', 'sky', 'violet', 'amber', 'rose', 'emerald'];
const categories: Category[] = ['todo', 'in_progress', 'done'];
const dotColor: Record<Color, string> = {
  slate: 'bg-slate-400',
  sky: 'bg-sky-400',
  violet: 'bg-violet-400',
  amber: 'bg-amber-400',
  rose: 'bg-rose-400',
  emerald: 'bg-emerald-400',
};
const compactInput = `${inputClass} min-h-8 px-2 py-1 text-xs`;

export function TaskWorkflowSettings({
  workspaceId,
  projectId,
}: {
  workspaceId: string;
  projectId: string;
}) {
  const { t } = useI18n();
  const { confirmAction } = useActionDialog();
  const base = `/workspaces/${workspaceId}/projects/${projectId}/task-workflow`;
  const [workflow, setWorkflow] = useState<Workflow>({ statuses: [], transitions: [] });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState<'success' | 'error'>('success');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setWorkflow(await api<Workflow>(base));
      setMessage('');
    } catch (cause) {
      setTone('error');
      setMessage(cause instanceof Error ? cause.message : t('workflow.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [base, t]);
  useEffect(() => void load(), [load]);

  async function run(key: string, operation: () => Promise<Workflow | void>) {
    setBusy(key);
    try {
      const result = await operation();
      if (result) setWorkflow(result);
      else await load();
      setTone('success');
      setMessage(t('common.changesSaved'));
    } catch (cause) {
      setTone('error');
      setMessage(cause instanceof Error ? cause.message : t('workflow.saveFailed'));
    } finally {
      setBusy('');
    }
  }

  async function createStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await run('new-status', async () => {
      const result = await api<Workflow>(`${base}/statuses`, {
        method: 'POST',
        body: JSON.stringify({
          key: data.get('key'),
          name: data.get('name'),
          category: data.get('category'),
          color: data.get('color'),
          wipLimit: String(data.get('wipLimit') ?? '').trim() ? Number(data.get('wipLimit')) : null,
        }),
      });
      form.reset();
      return result;
    });
  }

  async function updateStatus(event: FormEvent<HTMLFormElement>, status: WorkflowStatus) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await run(status.id, () =>
      api<Workflow>(`${base}/statuses/${status.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: data.get('name'),
          category: data.get('category'),
          color: data.get('color'),
          position: Number(data.get('position')),
          wipLimit: String(data.get('wipLimit') ?? '').trim() ? Number(data.get('wipLimit')) : null,
          initial: data.get('initial') === 'on',
          rowVersion: status.row_version,
        }),
      }),
    );
  }

  async function archiveStatus(status: WorkflowStatus) {
    if (
      !(await confirmAction(t('workflow.archiveConfirm', { name: status.name }), {
        tone: 'danger',
      }))
    )
      return;
    await run(status.id, () => api(`${base}/statuses/${status.id}/archive`, { method: 'POST' }));
  }

  async function createTransition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await run('new-transition', async () => {
      const result = await api<Workflow>(`${base}/transitions`, {
        method: 'POST',
        body: JSON.stringify({
          name: data.get('name'),
          fromStatus: data.get('fromStatus'),
          toStatus: data.get('toStatus'),
        }),
      });
      form.reset();
      return result;
    });
  }

  async function deleteTransition(transition: WorkflowTransition) {
    await run(transition.id, () =>
      api(`${base}/transitions/${transition.id}`, { method: 'DELETE' }),
    );
  }

  const statusName = (key: string) =>
    workflow.statuses.find((status) => status.key === key)?.name ?? key;

  return (
    <details className="group mt-6 border-t border-slate-800 pt-5">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
        <span>
          <h2 className="text-sm font-semibold text-slate-200">{t('workflow.heading')}</h2>
          <p className="mt-1 text-xs text-slate-500">{t('workflow.help')}</p>
        </span>
        <span aria-hidden="true" className="text-slate-500 group-open:rotate-180">
          ⌄
        </span>
      </summary>
      {loading ? (
        <p className="mt-4 text-xs text-slate-500">{t('common.loading')}</p>
      ) : (
        <div className="mt-4 space-y-5">
          <div className="overflow-x-auto pb-1">
            <div className="flex min-w-max items-center gap-2" aria-label={t('workflow.axis')}>
              {workflow.statuses.map((status, index) => (
                <span className="contents" key={status.id}>
                  {index > 0 && <span className="text-slate-600">→</span>}
                  <span className="flex items-center gap-2 rounded-full border border-slate-700 px-3 py-1.5 text-xs">
                    <span className={`size-2 rounded-full ${dotColor[status.color]}`} />
                    {status.name}
                    {status.initial && <span title={t('workflow.initial')}>⌂</span>}
                  </span>
                </span>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            {workflow.statuses.map((status) => (
              <form
                className="grid gap-2 rounded-lg border border-slate-800 p-2 md:grid-cols-[minmax(8rem,1fr)_7rem_6rem_4rem_5rem_auto_auto]"
                key={`${status.id}:${status.row_version}`}
                onSubmit={(event) => void updateStatus(event, status)}
              >
                <label className="grid gap-1 text-[10px] text-slate-500">
                  {t('workflow.name')}
                  <input className={compactInput} defaultValue={status.name} name="name" required />
                </label>
                <label className="grid gap-1 text-[10px] text-slate-500">
                  {t('workflow.category')}
                  <select className={compactInput} defaultValue={status.category} name="category">
                    {categories.map((category) => (
                      <option key={category} value={category}>
                        {t(`workflow.category.${category}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-[10px] text-slate-500">
                  {t('workflow.color')}
                  <select className={compactInput} defaultValue={status.color} name="color">
                    {colors.map((color) => (
                      <option key={color} value={color}>
                        {color}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-[10px] text-slate-500">
                  {t('workflow.order')}
                  <input
                    className={compactInput}
                    defaultValue={status.position}
                    min="0"
                    name="position"
                    type="number"
                  />
                </label>
                <label className="grid gap-1 text-[10px] text-slate-500">
                  {t('workflow.wipLimit')}
                  <input
                    className={compactInput}
                    defaultValue={status.wip_limit ?? ''}
                    max="999"
                    min="1"
                    name="wipLimit"
                    placeholder="—"
                    type="number"
                  />
                </label>
                <label className="flex items-end gap-1 pb-2 text-[10px] text-slate-500">
                  <input defaultChecked={status.initial} name="initial" type="checkbox" />
                  {t('workflow.initial')}
                </label>
                <span className="flex items-end justify-end gap-1 pb-0.5">
                  <button
                    aria-label={t('common.save')}
                    className="grid size-8 place-items-center rounded-lg text-sky-300 hover:bg-sky-500/10"
                    disabled={Boolean(busy)}
                    title={t('common.save')}
                    type="submit"
                  >
                    ✓
                  </button>
                  <button
                    aria-label={t('common.archive')}
                    className="grid size-8 place-items-center rounded-lg text-rose-300 hover:bg-rose-500/10"
                    disabled={Boolean(busy) || status.initial || status.task_count > 0}
                    onClick={() => void archiveStatus(status)}
                    title={
                      status.task_count > 0
                        ? t('workflow.taskCount', { count: status.task_count })
                        : t('common.archive')
                    }
                    type="button"
                  >
                    ⌫
                  </button>
                </span>
              </form>
            ))}
          </div>

          <form
            className="grid gap-2 rounded-lg border border-dashed border-slate-700 p-3 sm:grid-cols-5"
            onSubmit={(event) => void createStatus(event)}
          >
            <label className="grid gap-1 text-xs text-slate-500">
              <FormFieldLabel required>{t('workflow.key')}</FormFieldLabel>
              <input
                className={compactInput}
                name="key"
                pattern="[a-z][a-z0-9_]{0,39}"
                placeholder="quality_review"
                required
              />
            </label>
            <label className="grid gap-1 text-xs text-slate-500">
              <FormFieldLabel required>{t('workflow.name')}</FormFieldLabel>
              <input className={compactInput} name="name" required />
            </label>
            <label className="grid gap-1 text-xs text-slate-500">
              <FormFieldLabel required>{t('workflow.category')}</FormFieldLabel>
              <select className={compactInput} defaultValue="in_progress" name="category">
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {t(`workflow.category.${category}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs text-slate-500">
              <FormFieldLabel>{t('workflow.wipLimit')}</FormFieldLabel>
              <input className={compactInput} max="999" min="1" name="wipLimit" type="number" />
            </label>
            <span className="flex items-end gap-2">
              <select
                aria-label={t('workflow.color')}
                className={compactInput}
                defaultValue="violet"
                name="color"
              >
                {colors.map((color) => (
                  <option key={color} value={color}>
                    {color}
                  </option>
                ))}
              </select>
              <Button disabled={Boolean(busy)} type="submit">
                {t('workflow.addStatus')}
              </Button>
            </span>
          </form>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              {t('workflow.transitions')}
            </h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {workflow.transitions.map((transition) => (
                <span
                  className="flex items-center gap-1 rounded-full border border-slate-800 px-2 py-1 text-[11px] text-slate-400"
                  key={transition.id}
                >
                  {statusName(transition.from_status)} → {statusName(transition.to_status)}
                  <button
                    aria-label={t('workflow.deleteTransition')}
                    className="grid size-5 place-items-center rounded-full hover:bg-rose-500/10 hover:text-rose-300"
                    disabled={Boolean(busy)}
                    onClick={() => void deleteTransition(transition)}
                    title={t('workflow.deleteTransition')}
                    type="button"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <form
              className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]"
              onSubmit={(event) => void createTransition(event)}
            >
              <select
                aria-label={t('workflow.from')}
                className={compactInput}
                name="fromStatus"
                required
              >
                {workflow.statuses.map((status) => (
                  <option key={status.key} value={status.key}>
                    {status.name}
                  </option>
                ))}
              </select>
              <select
                aria-label={t('workflow.to')}
                className={compactInput}
                name="toStatus"
                required
              >
                {workflow.statuses.map((status) => (
                  <option key={status.key} value={status.key}>
                    {status.name}
                  </option>
                ))}
              </select>
              <input
                aria-label={t('workflow.transitionName')}
                className={compactInput}
                name="name"
                placeholder={t('workflow.transitionName')}
                required
              />
              <Button disabled={Boolean(busy)} type="submit">
                {t('workflow.addTransition')}
              </Button>
            </form>
          </div>
        </div>
      )}
      <NoticeText tone={tone}>{message}</NoticeText>
    </details>
  );
}
