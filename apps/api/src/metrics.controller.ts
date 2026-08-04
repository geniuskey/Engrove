import { Controller, Get, Header, Inject } from '@nestjs/common';
import type { Runtime } from './runtime.js';
import { RUNTIME } from './runtime.provider.js';

interface HttpSample {
  count: number;
  durationSeconds: number;
}

const httpSamples = new Map<string, HttpSample>();
const errors = new Map<string, number>();
const uuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

export function httpRouteLabel(route: unknown): string {
  if (!route || typeof route !== 'object' || !('path' in route)) return 'unmatched';
  const path = route.path;
  return typeof path === 'string' && path.startsWith('/') ? path : 'unmatched';
}

function label(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
}

export function observeHttp(method: string, path: string, status: number, durationSeconds: number) {
  const route = path.replace(uuid, ':id');
  const key = JSON.stringify([method, route, status]);
  const sample = httpSamples.get(key) ?? { count: 0, durationSeconds: 0 };
  sample.count += 1;
  sample.durationSeconds += durationSeconds;
  httpSamples.set(key, sample);
}

export function observeError(code: string) {
  errors.set(code, (errors.get(code) ?? 0) + 1);
}

function metric(name: string, value: number | string, help: string, type = 'gauge') {
  return [`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, `${name} ${value}`];
}

@Controller()
export class MetricsController {
  constructor(@Inject(RUNTIME) private readonly runtime: Runtime) {}

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async metrics(): Promise<string> {
    const runtime = this.runtime;
    const result = await runtime.pool.query<Record<string, string>>(`
      select
        (select count(*) from background_jobs where status='running') active_jobs,
        (select count(*) from background_jobs where status='failed') job_failures,
        (select count(*) from outbox_events where dispatched_at is null) outbox_undispatched,
        (select coalesce(extract(epoch from now()-min(created_at)),0) from outbox_events where dispatched_at is null) outbox_lag,
        (select count(*) from background_jobs where status='running' and lease_expires_at<now()) expired_leases,
        (select count(*) from background_job_attempts where error_code='RESTORE_INTERRUPTED') reconciliations,
        (select count(*) from file_upload_sessions where status in ('finalized','failed','expired') and created_at<now()-interval '1 hour') cleanup_candidates,
        (select coalesce(sum((payload->>'deleted')::bigint),0) from audit_events where action='storage.cleanup' and payload->>'mode'='execute') cleanup_deletions,
        (select count(*) from file_upload_sessions where status='expired') staging_expiries,
        (select coalesce(extract(epoch from now()-started_at),0) from maintenance_state where singleton=true and lease_expires_at>now()) maintenance_duration,
        (select count(*) from background_jobs where job_type='dataset.process' and completed_at is not null) dataset_parse_count,
        (select coalesce(sum(extract(epoch from completed_at-started_at)),0) from background_jobs where job_type='dataset.process' and completed_at is not null) dataset_parse_duration,
        (select count(*) from audit_events where action='record_projection.rebuilt') projection_rebuilds,
        (select coalesce(sum(size_bytes),0) from file_objects where status='available') uploaded_bytes,
        (select count(*) from pilot_feedback) pilot_feedback,
        (select count(*) from (select actor_id from audit_events where actor_id is not null
          and created_at>=now()-interval '30 days' group by actor_id
          having count(distinct created_at::date)>=2) active) pilot_repeat_users
    `);
    const row = result.rows[0] ?? {};
    const lines = [
      ...metric('engrove_active_jobs', row.active_jobs ?? 0, 'Currently running durable jobs.'),
      ...metric(
        'engrove_job_failures_total',
        row.job_failures ?? 0,
        'Durable jobs in failed state.',
        'counter',
      ),
      ...metric(
        'engrove_outbox_undispatched',
        row.outbox_undispatched ?? 0,
        'Undispatched outbox events.',
      ),
      ...metric(
        'engrove_outbox_dispatch_lag_seconds',
        row.outbox_lag ?? 0,
        'Age of the oldest undispatched event.',
      ),
      ...metric(
        'engrove_expired_job_leases',
        row.expired_leases ?? 0,
        'Running jobs with expired leases.',
      ),
      ...metric(
        'engrove_job_reconciliations_total',
        row.reconciliations ?? 0,
        'Interrupted jobs reconciled by restore.',
        'counter',
      ),
      ...metric(
        'engrove_orphan_cleanup_candidates',
        row.cleanup_candidates ?? 0,
        'Staging objects eligible for cleanup.',
      ),
      ...metric(
        'engrove_orphan_cleanup_deletions_total',
        row.cleanup_deletions ?? 0,
        'Staging objects deleted by cleanup.',
        'counter',
      ),
      ...metric(
        'engrove_staging_upload_expiries_total',
        row.staging_expiries ?? 0,
        'Expired staging uploads.',
        'counter',
      ),
      ...metric(
        'engrove_maintenance_mode_duration_seconds',
        row.maintenance_duration ?? 0,
        'Current maintenance mode duration.',
      ),
      ...metric(
        'engrove_dataset_parse_duration_seconds_count',
        row.dataset_parse_count ?? 0,
        'Completed dataset parses.',
        'counter',
      ),
      ...metric(
        'engrove_dataset_parse_duration_seconds_sum',
        row.dataset_parse_duration ?? 0,
        'Total dataset parse duration.',
        'counter',
      ),
      ...metric(
        'engrove_record_projection_rebuilds_total',
        row.projection_rebuilds ?? 0,
        'Completed record projection rebuilds.',
        'counter',
      ),
      ...metric(
        'engrove_uploaded_bytes_total',
        row.uploaded_bytes ?? 0,
        'Committed source bytes.',
        'counter',
      ),
      ...metric(
        'engrove_pilot_feedback_items',
        row.pilot_feedback ?? 0,
        'Captured Community pilot feedback items.',
      ),
      ...metric(
        'engrove_pilot_repeat_users_30d',
        row.pilot_repeat_users ?? 0,
        'Users with audited activity on two distinct UTC dates in the last 30 days.',
      ),
      ...metric(
        'engrove_database_connections',
        runtime.pool.totalCount,
        'Open database connections.',
      ),
      ...metric(
        'engrove_database_connections_idle',
        runtime.pool.idleCount,
        'Idle database connections.',
      ),
      ...metric(
        'engrove_database_connections_waiting',
        runtime.pool.waitingCount,
        'Waiting database clients.',
      ),
      ...metric(
        'engrove_backup_duration_seconds',
        0,
        'Last backup duration; exported by the admin command.',
      ),
      ...metric(
        'engrove_restore_duration_seconds',
        0,
        'Last restore duration; exported by the admin command.',
      ),
      ...metric('engrove_backup_bytes', 0, 'Last backup size; exported by the admin command.'),
      ...metric(
        'engrove_backup_verification_failures_total',
        0,
        'Backup verification failures; exported by the admin command.',
        'counter',
      ),
      ...metric(
        'engrove_maintenance_failed_drains_total',
        0,
        'Failed maintenance drain attempts; exported by the admin command.',
        'counter',
      ),
      ...metric(
        'engrove_cross_project_rejections_total',
        errors.get('CROSS_PROJECT_ACCESS_REJECTED') ?? 0,
        'Rejected cross-project access attempts.',
        'counter',
      ),
    ];
    lines.push(
      '# HELP engrove_http_requests_total HTTP requests.',
      '# TYPE engrove_http_requests_total counter',
    );
    for (const [key, sample] of httpSamples) {
      const [method, route, status] = JSON.parse(key) as [string, string, number];
      const labels = `method="${label(method)}",route="${label(route)}",status="${status}"`;
      lines.push(`engrove_http_requests_total{${labels}} ${sample.count}`);
      lines.push(`engrove_http_request_duration_seconds_count{${labels}} ${sample.count}`);
      lines.push(`engrove_http_request_duration_seconds_sum{${labels}} ${sample.durationSeconds}`);
    }
    lines.push(
      '# HELP engrove_api_errors_total API errors by stable code.',
      '# TYPE engrove_api_errors_total counter',
    );
    for (const [code, count] of errors)
      lines.push(`engrove_api_errors_total{code="${label(code)}"} ${count}`);
    return `${lines.join('\n')}\n`;
  }
}
