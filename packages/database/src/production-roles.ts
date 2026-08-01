import type { Pool } from 'pg';

export async function grantProductionRoles(pool: Pool): Promise<void> {
  await pool.query(`
    grant usage on schema public to engrove_runtime, engrove_worker, engrove_backup;
    grant select, insert, update, delete on all tables in schema public to engrove_runtime;
    grant usage, select on all sequences in schema public to engrove_runtime;
    grant select on all tables in schema public to engrove_backup;
    grant insert, update, delete on maintenance_state to engrove_backup;
    grant usage on schema drizzle to engrove_runtime, engrove_backup;
    grant select on all tables in schema drizzle to engrove_runtime, engrove_backup;
    grant select on maintenance_state, workspaces, projects, file_objects, file_upload_sessions, datasets,
      dataset_artifacts, background_jobs, background_job_attempts, outbox_events to engrove_worker;
    grant insert, update on datasets, dataset_artifacts, background_jobs,
      background_job_attempts, outbox_events, audit_events to engrove_worker;
    alter default privileges in schema public grant select, insert, update, delete on tables to engrove_runtime;
    alter default privileges in schema public grant usage, select on sequences to engrove_runtime;
    alter default privileges in schema public grant select on tables to engrove_backup;
  `);
}
