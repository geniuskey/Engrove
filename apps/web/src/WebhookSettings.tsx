import { Button } from '@engrove/ui';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from './App.js';
import { useActionDialog } from './ActionDialogProvider.js';
import { FormFieldLabel } from './FormFieldLabel.js';
import { useI18n } from './i18n.js';

type WebhookEventType =
  | 'record.created'
  | 'record.updated'
  | 'record.archived'
  | 'record.restored'
  | 'task.created'
  | 'task.updated'
  | 'task.archived'
  | 'task.restored';
type WebhookDeliveryEventType = WebhookEventType | 'webhook.test';

interface ObjectTypeSummary {
  id: string;
  name: string;
}

interface WebhookEndpoint {
  id: string;
  name: string;
  url: string;
  objectTypeId: string | null;
  objectTypeName: string | null;
  eventTypes: WebhookEventType[];
  secretVersion: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

interface IssuedWebhookEndpoint extends WebhookEndpoint {
  signingSecret: string;
}

interface WebhookDelivery {
  id: string;
  eventType: WebhookDeliveryEventType;
  status: 'queued' | 'sending' | 'succeeded' | 'failed';
  attemptCount: number;
  responseStatus: number | null;
  responseSnippet: string | null;
  lastError: string | null;
  nextAttemptAt: string;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type WebhookDeliveryStatus = WebhookDelivery['status'];
type WebhookDeliveryFilter = WebhookDeliveryStatus | 'all';

interface WebhookDeliveryPage {
  items: WebhookDelivery[];
  pageInfo: { limit: number; offset: number; total: number; hasNext: boolean };
  summary: Record<WebhookDeliveryStatus, number>;
}

interface WebhookEndpointPage {
  items: WebhookEndpoint[];
  pageInfo: { limit: number; offset: number; total: number; hasNext: boolean };
}

const events: WebhookEventType[] = [
  'record.created',
  'record.updated',
  'record.archived',
  'record.restored',
  'task.created',
  'task.updated',
  'task.archived',
  'task.restored',
];
const fieldClass =
  'min-h-10 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-200 outline-none focus:border-sky-400';
const DELIVERY_PAGE_SIZE = 25;
const ENDPOINT_PAGE_SIZE = 50;
const deliveryStatuses: WebhookDeliveryStatus[] = ['queued', 'sending', 'succeeded', 'failed'];

export function WebhookSettings({
  workspaceId,
  projectId,
}: {
  workspaceId: string;
  projectId: string;
}) {
  const { locale, t } = useI18n();
  const { confirmAction } = useActionDialog();
  const base = `/workspaces/${workspaceId}/projects/${projectId}`;
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [endpointPage, setEndpointPage] = useState<WebhookEndpointPage>();
  const [objectTypes, setObjectTypes] = useState<ObjectTypeSummary[]>([]);
  const [editing, setEditing] = useState<WebhookEndpoint>();
  const [selectedObjectTypeId, setSelectedObjectTypeId] = useState('');
  const [issued, setIssued] = useState<IssuedWebhookEndpoint>();
  const [deliveries, setDeliveries] = useState<Record<string, WebhookDelivery[]>>({});
  const [deliveryPages, setDeliveryPages] = useState<Record<string, WebhookDeliveryPage>>({});
  const [deliveryFilters, setDeliveryFilters] = useState<Record<string, WebhookDeliveryFilter>>({});
  const [deliveryLoading, setDeliveryLoading] = useState('');
  const [deliveryLoadingMore, setDeliveryLoadingMore] = useState('');
  const [expandedDeliveryId, setExpandedDeliveryId] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMoreEndpoints, setLoadingMoreEndpoints] = useState(false);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [endpointResult, objectTypeResult] = await Promise.all([
        api<WebhookEndpointPage>(`${base}/webhooks`),
        api<{ items: ObjectTypeSummary[] }>(`${base}/object-types`),
      ]);
      setEndpoints(endpointResult.items);
      setEndpointPage({
        ...endpointResult,
        pageInfo: endpointResult.pageInfo ?? {
          limit: ENDPOINT_PAGE_SIZE,
          offset: 0,
          total: endpointResult.items.length,
          hasNext: false,
        },
      });
      setObjectTypes(objectTypeResult.items);
      setMessage('');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : t('webhooks.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [base, t]);
  useEffect(() => void load(), [load]);

  async function loadMoreEndpoints() {
    if (!endpointPage?.pageInfo.hasNext || loadingMoreEndpoints) return;
    setLoadingMoreEndpoints(true);
    try {
      const result = await api<WebhookEndpointPage>(
        `${base}/webhooks?limit=${ENDPOINT_PAGE_SIZE}&offset=${endpoints.length}`,
      );
      setEndpoints((current) => [
        ...current,
        ...result.items.filter((item) => !current.some((candidate) => candidate.id === item.id)),
      ]);
      setEndpointPage(result);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : t('webhooks.loadFailed'));
    } finally {
      setLoadingMoreEndpoints(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const eventTypes = events.filter((eventType) => data.getAll('eventTypes').includes(eventType));
    setBusy('save');
    setMessage('');
    try {
      const body = {
        name: data.get('name'),
        url: data.get('url'),
        objectTypeId: data.get('objectTypeId') || null,
        eventTypes,
      };
      if (editing) {
        const updated = await api<WebhookEndpoint>(`${base}/webhooks/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...body, active: editing.active }),
        });
        setEndpoints((current) =>
          current.map((endpoint) => (endpoint.id === updated.id ? updated : endpoint)),
        );
        setEditing(undefined);
        setSelectedObjectTypeId('');
        setMessage(t('webhooks.updated'));
      } else {
        const created = await api<IssuedWebhookEndpoint>(`${base}/webhooks`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        setEndpoints((current) => [created, ...current]);
        setEndpointPage((current) =>
          current
            ? {
                ...current,
                pageInfo: {
                  ...current.pageInfo,
                  total: current.pageInfo.total + 1,
                },
              }
            : current,
        );
        setIssued(created);
        form.reset();
        setSelectedObjectTypeId('');
        setMessage(t('webhooks.created'));
      }
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : t('webhooks.saveFailed'));
    } finally {
      setBusy('');
    }
  }

  async function toggle(endpoint: WebhookEndpoint) {
    setBusy(endpoint.id);
    try {
      const updated = await api<WebhookEndpoint>(`${base}/webhooks/${endpoint.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: endpoint.name,
          url: endpoint.url,
          objectTypeId: endpoint.objectTypeId,
          eventTypes: endpoint.eventTypes,
          active: !endpoint.active,
        }),
      });
      setEndpoints((current) => current.map((item) => (item.id === endpoint.id ? updated : item)));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : t('webhooks.saveFailed'));
    } finally {
      setBusy('');
    }
  }

  async function rotate(endpoint: WebhookEndpoint) {
    if (
      !(await confirmAction(t('webhooks.rotateConfirm', { name: endpoint.name }), {
        tone: 'danger',
      }))
    )
      return;
    setBusy(endpoint.id);
    try {
      const rotated = await api<IssuedWebhookEndpoint>(
        `${base}/webhooks/${endpoint.id}/rotate-secret`,
        { method: 'POST' },
      );
      setEndpoints((current) => current.map((item) => (item.id === endpoint.id ? rotated : item)));
      setIssued(rotated);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : t('webhooks.rotateFailed'));
    } finally {
      setBusy('');
    }
  }

  async function loadDeliveries(
    endpointId: string,
    status: WebhookDeliveryFilter,
    offset = 0,
    append = false,
  ) {
    if (append) setDeliveryLoadingMore(endpointId);
    else setDeliveryLoading(endpointId);
    try {
      const result = await api<WebhookDeliveryPage>(
        `${base}/webhooks/${endpointId}/deliveries?status=${status}&limit=${DELIVERY_PAGE_SIZE}&offset=${offset}`,
      );
      setDeliveries((current) => {
        if (!append) return { ...current, [endpointId]: result.items };
        const known = new Set((current[endpointId] ?? []).map((delivery) => delivery.id));
        return {
          ...current,
          [endpointId]: [
            ...(current[endpointId] ?? []),
            ...result.items.filter((delivery) => !known.has(delivery.id)),
          ],
        };
      });
      setDeliveryPages((current) => ({ ...current, [endpointId]: result }));
      setMessage('');
    } finally {
      if (append) setDeliveryLoadingMore('');
      else setDeliveryLoading('');
    }
  }

  async function toggleDeliveries(endpointId: string) {
    if (expandedDeliveryId === endpointId) {
      setExpandedDeliveryId('');
      return;
    }
    setExpandedDeliveryId(endpointId);
    try {
      await loadDeliveries(endpointId, deliveryFilters[endpointId] ?? 'all');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : t('webhooks.deliveriesFailed'));
    }
  }

  async function filterDeliveries(endpointId: string, status: WebhookDeliveryFilter) {
    setDeliveryFilters((current) => ({ ...current, [endpointId]: status }));
    try {
      await loadDeliveries(endpointId, status);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : t('webhooks.deliveriesFailed'));
    }
  }

  async function loadMoreDeliveries(endpointId: string) {
    const current = deliveries[endpointId] ?? [];
    const page = deliveryPages[endpointId];
    if (!page?.pageInfo.hasNext || deliveryLoadingMore) return;
    try {
      await loadDeliveries(endpointId, deliveryFilters[endpointId] ?? 'all', current.length, true);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : t('webhooks.deliveriesFailed'));
    }
  }

  async function sendTest(endpoint: WebhookEndpoint) {
    if (!(await confirmAction(t('webhooks.testConfirm', { name: endpoint.name })))) return;
    setBusy(endpoint.id);
    try {
      const queued = await api<WebhookDelivery>(`${base}/webhooks/${endpoint.id}/test`, {
        method: 'POST',
      });
      setDeliveryFilters((current) => ({ ...current, [endpoint.id]: 'all' }));
      setDeliveries((current) => ({
        ...current,
        [endpoint.id]: [
          queued,
          ...(current[endpoint.id] ?? []).filter((delivery) => delivery.id !== queued.id),
        ],
      }));
      setExpandedDeliveryId(endpoint.id);
      try {
        await loadDeliveries(endpoint.id, 'all');
      } catch {
        setDeliveries((current) => ({
          ...current,
          [endpoint.id]: [
            queued,
            ...(current[endpoint.id] ?? []).filter((delivery) => delivery.id !== queued.id),
          ],
        }));
      }
      setMessage(t('webhooks.testQueued'));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : t('webhooks.testFailed'));
    } finally {
      setBusy('');
    }
  }

  async function retryDelivery(endpointId: string, deliveryId: string) {
    setBusy(deliveryId);
    try {
      const queued = await api<WebhookDelivery>(
        `${base}/webhooks/${endpointId}/deliveries/${deliveryId}/retry`,
        { method: 'POST' },
      );
      setDeliveries((current) => ({
        ...current,
        [endpointId]: (current[endpointId] ?? []).map((delivery) =>
          delivery.id === queued.id ? queued : delivery,
        ),
      }));
      try {
        await loadDeliveries(endpointId, deliveryFilters[endpointId] ?? 'all');
      } catch {
        // Keep the successfully queued delivery visible if refreshing history fails.
      }
      setMessage(t('webhooks.retryQueued'));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : t('webhooks.retryFailed'));
    } finally {
      setBusy('');
    }
  }

  async function copySecret() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.signingSecret);
      setMessage(t('common.copied'));
    } catch {
      setMessage(t('common.copyDenied'));
    }
  }

  return (
    <details className="group mt-6 border-t border-slate-800 pt-5">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
        <span>
          <h2 className="text-sm font-semibold text-slate-200">{t('webhooks.heading')}</h2>
          <p className="mt-1 text-xs text-slate-500">{t('webhooks.help')}</p>
        </span>
        <span aria-hidden="true" className="text-slate-500 group-open:rotate-180">
          ⌄
        </span>
      </summary>
      <div className="mt-3 flex justify-end">
        <a
          className="text-xs text-sky-400 hover:text-sky-300"
          href={`${import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'}/api/docs`}
          title={t('webhooks.docs')}
        >
          {t('webhooks.docs')} ↗
        </a>
      </div>
      {issued && (
        <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3">
          <strong className="text-xs text-amber-200">{t('webhooks.copyNow')}</strong>
          <div className="mt-2 flex gap-2">
            <input
              aria-label={t('webhooks.secret')}
              className={`${fieldClass} min-w-0 flex-1 font-mono text-xs`}
              readOnly
              value={issued.signingSecret}
            />
            <button
              aria-label={t('webhooks.copySecret')}
              className="grid size-10 shrink-0 place-items-center rounded-lg border border-amber-400/30 text-amber-200 hover:bg-amber-400/10"
              onClick={() => void copySecret()}
              title={t('webhooks.copySecret')}
              type="button"
            >
              ⧉
            </button>
            <button
              aria-label={t('common.close')}
              className="grid size-10 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-800"
              onClick={() => setIssued(undefined)}
              title={t('common.close')}
              type="button"
            >
              ×
            </button>
          </div>
        </div>
      )}
      <form className="mt-4 grid gap-3 rounded-xl border border-slate-800 p-4" onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs text-slate-400">
            <FormFieldLabel required>{t('webhooks.name')}</FormFieldLabel>
            <input
              aria-label={t('webhooks.name')}
              className={fieldClass}
              defaultValue={editing?.name ?? ''}
              key={`name-${editing?.id ?? 'new'}`}
              maxLength={80}
              name="name"
              required
            />
          </label>
          <label className="grid gap-1 text-xs text-slate-400">
            <FormFieldLabel>{t('webhooks.objectType')}</FormFieldLabel>
            <select
              aria-label={t('webhooks.objectType')}
              className={fieldClass}
              name="objectTypeId"
              onChange={(event) => setSelectedObjectTypeId(event.target.value)}
              value={selectedObjectTypeId}
            >
              <option value="">{t('webhooks.allTables')}</option>
              {objectTypes.map((objectType) => (
                <option key={objectType.id} value={objectType.id}>
                  {objectType.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="grid gap-1 text-xs text-slate-400">
          <FormFieldLabel required>{t('webhooks.url')}</FormFieldLabel>
          <input
            aria-label={t('webhooks.url')}
            className={fieldClass}
            defaultValue={editing?.url ?? ''}
            key={`url-${editing?.id ?? 'new'}`}
            name="url"
            placeholder="https://example.com/hooks/engrove"
            required
            type="url"
          />
        </label>
        <fieldset className="grid gap-2">
          <legend className="text-xs text-slate-400">
            <FormFieldLabel required>{t('webhooks.events')}</FormFieldLabel>
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {events.map((eventType) => (
              <label className="flex items-center gap-2 text-xs text-slate-300" key={eventType}>
                <input
                  defaultChecked={
                    editing
                      ? editing.eventTypes.includes(eventType)
                      : eventType.startsWith('record.')
                  }
                  disabled={Boolean(selectedObjectTypeId) && eventType.startsWith('task.')}
                  key={`${editing?.id ?? 'new'}-${eventType}`}
                  name="eventTypes"
                  type="checkbox"
                  value={eventType}
                />
                {t(`webhooks.${eventType}`)}
              </label>
            ))}
          </div>
          {selectedObjectTypeId && (
            <p className="text-[11px] text-slate-500">{t('webhooks.taskScopeHint')}</p>
          )}
        </fieldset>
        <div className="flex gap-2">
          <button
            className="min-h-9 rounded-lg bg-sky-400 px-4 text-xs font-semibold text-slate-950 disabled:opacity-50"
            disabled={busy === 'save'}
            type="submit"
          >
            {busy === 'save'
              ? t('common.working')
              : editing
                ? t('webhooks.save')
                : t('webhooks.create')}
          </button>
          {editing && (
            <button
              className="min-h-9 rounded-lg px-3 text-xs text-slate-400 hover:bg-slate-800"
              onClick={() => {
                setEditing(undefined);
                setSelectedObjectTypeId('');
              }}
              type="button"
            >
              {t('common.cancel')}
            </button>
          )}
        </div>
      </form>
      {message && <p className="mt-3 text-xs text-slate-400">{message}</p>}
      {loading && <p className="mt-4 text-xs text-slate-500">{t('common.loading')}</p>}
      {!loading && endpoints.length === 0 && (
        <p className="mt-4 text-xs text-slate-500">{t('webhooks.empty')}</p>
      )}
      <div className="mt-4 grid gap-2">
        {endpoints.map((endpoint) => (
          <article className="rounded-xl border border-slate-800 p-3" key={endpoint.id}>
            <div className="flex items-start gap-3">
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-sm text-slate-200">{endpoint.name}</strong>
                <span className="block truncate font-mono text-[10px] text-slate-500">
                  {endpoint.url}
                </span>
                <span className="mt-1 block text-[10px] text-slate-600">
                  {endpoint.objectTypeName ?? t('webhooks.allTables')} ·{' '}
                  {endpoint.active ? t('webhooks.active') : t('webhooks.paused')}
                </span>
              </span>
              <span className="flex gap-1">
                {[
                  {
                    label: t('webhooks.edit', { name: endpoint.name }),
                    icon: '✎',
                    run: () => {
                      setEditing(endpoint);
                      setSelectedObjectTypeId(endpoint.objectTypeId ?? '');
                    },
                  },
                  {
                    label: endpoint.active
                      ? t('webhooks.pause', { name: endpoint.name })
                      : t('webhooks.resume', { name: endpoint.name }),
                    icon: endpoint.active ? 'Ⅱ' : '▶',
                    run: () => void toggle(endpoint),
                  },
                  {
                    label: t('webhooks.test', { name: endpoint.name }),
                    icon: '↗',
                    run: () => void sendTest(endpoint),
                  },
                  {
                    label: t('webhooks.rotate', { name: endpoint.name }),
                    icon: '↻',
                    run: () => void rotate(endpoint),
                  },
                  {
                    label: t('webhooks.deliveries', { name: endpoint.name }),
                    icon: '⌁',
                    run: () => void toggleDeliveries(endpoint.id),
                  },
                ].map((action) => (
                  <button
                    aria-label={action.label}
                    className="grid size-8 place-items-center rounded-lg text-xs text-slate-500 hover:bg-slate-800 hover:text-sky-300 disabled:opacity-40"
                    disabled={busy === endpoint.id}
                    key={action.label}
                    onClick={action.run}
                    title={action.label}
                    type="button"
                  >
                    {action.icon}
                  </button>
                ))}
              </span>
            </div>
            {expandedDeliveryId === endpoint.id && (
              <div className="mt-3 border-t border-slate-800 pt-2">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-[10px] text-slate-500">
                    <span>{t('webhooks.deliveryFilter')}</span>
                    <select
                      aria-label={t('webhooks.deliveryFilter')}
                      className="min-h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200 outline-none focus:border-sky-400"
                      disabled={deliveryLoading === endpoint.id}
                      onChange={(event) =>
                        void filterDeliveries(
                          endpoint.id,
                          event.target.value as WebhookDeliveryFilter,
                        )
                      }
                      value={deliveryFilters[endpoint.id] ?? 'all'}
                    >
                      <option value="all">{t('webhooks.status.all')}</option>
                      {deliveryStatuses.map((status) => (
                        <option key={status} value={status}>
                          {t(`webhooks.status.${status}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {deliveryPages[endpoint.id] && (
                    <dl aria-label={t('webhooks.deliverySummary')} className="flex flex-wrap gap-1">
                      {deliveryStatuses.map((status) => (
                        <div
                          className="flex items-center gap-1 rounded-md bg-slate-900 px-1.5 py-1 text-[10px]"
                          key={status}
                        >
                          <dt className="text-slate-500">{t(`webhooks.status.${status}`)}</dt>
                          <dd className="font-mono text-slate-300">
                            {deliveryPages[endpoint.id]?.summary[status] ?? 0}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
                {deliveryLoading === endpoint.id && (deliveries[endpoint.id] ?? []).length === 0 ? (
                  <p className="text-[10px] text-slate-600">{t('common.loading')}</p>
                ) : (deliveries[endpoint.id] ?? []).length === 0 ? (
                  <p className="text-[10px] text-slate-600">
                    {(deliveryFilters[endpoint.id] ?? 'all') === 'all'
                      ? t('webhooks.noDeliveries')
                      : t('webhooks.noMatchingDeliveries')}
                  </p>
                ) : (
                  (deliveries[endpoint.id] ?? []).map((delivery) => (
                    <article
                      className="border-b border-slate-800/70 py-2 last:border-0"
                      key={delivery.id}
                    >
                      <div className="flex items-center justify-between gap-2 text-[10px] text-slate-500">
                        <span className="min-w-0 truncate">
                          {delivery.eventType === 'webhook.test'
                            ? t('webhooks.testEvent')
                            : t(`webhooks.${delivery.eventType}`)}{' '}
                          · {t(`webhooks.status.${delivery.status}`)} ·{' '}
                          {t('webhooks.attempts', { count: delivery.attemptCount })}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span>
                            {delivery.responseStatus ?? '—'} ·{' '}
                            {new Date(delivery.createdAt).toLocaleString(locale)}
                          </span>
                          {delivery.status === 'failed' && (
                            <button
                              aria-label={t('webhooks.retryDelivery')}
                              className="grid size-7 place-items-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-sky-300 disabled:opacity-40"
                              disabled={busy === delivery.id}
                              onClick={() => void retryDelivery(endpoint.id, delivery.id)}
                              title={t('webhooks.retryDelivery')}
                              type="button"
                            >
                              ↻
                            </button>
                          )}
                        </span>
                      </div>
                      {delivery.status === 'queued' && (
                        <p className="mt-1 text-[10px] text-slate-600">
                          {t('webhooks.nextAttempt', {
                            date: new Date(delivery.nextAttemptAt).toLocaleString(locale),
                          })}
                        </p>
                      )}
                      {delivery.lastError && (
                        <p className="mt-1 break-all font-mono text-[10px] text-rose-300/80">
                          {delivery.lastError}
                        </p>
                      )}
                      {delivery.responseSnippet && (
                        <p className="mt-1 line-clamp-2 break-all font-mono text-[10px] text-slate-600">
                          {t('webhooks.response')}: {delivery.responseSnippet}
                        </p>
                      )}
                    </article>
                  ))
                )}
                {deliveryPages[endpoint.id]?.pageInfo.hasNext && (
                  <Button
                    className="mt-2 w-full"
                    disabled={deliveryLoadingMore === endpoint.id}
                    onClick={() => void loadMoreDeliveries(endpoint.id)}
                    type="button"
                    variant="quiet"
                  >
                    {deliveryLoadingMore === endpoint.id
                      ? t('common.loading')
                      : t('webhooks.loadMoreDeliveries', {
                          shown: (deliveries[endpoint.id] ?? []).length,
                          total: deliveryPages[endpoint.id]?.pageInfo.total ?? 0,
                        })}
                  </Button>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
      {endpointPage?.pageInfo.hasNext && (
        <Button
          className="mt-3 w-full"
          disabled={loadingMoreEndpoints}
          onClick={() => void loadMoreEndpoints()}
          type="button"
          variant="quiet"
        >
          {loadingMoreEndpoints
            ? t('common.loading')
            : t('webhooks.loadMoreEndpoints', {
                shown: endpoints.length,
                total: endpointPage.pageInfo.total,
              })}
        </Button>
      )}
    </details>
  );
}
