import { readFileSync } from 'node:fs';
import {
  createPool,
  ScopedTaskRepository,
  type ActorSession,
  type TaskEntityType,
} from '../packages/database/src/index.js';

function localDatabaseUrl(): string | undefined {
  try {
    return readFileSync(new URL('../.env', import.meta.url), 'utf8')
      .match(/^DATABASE_URL=(.+)$/m)?.[1]
      ?.trim();
  } catch {
    return undefined;
  }
}

const databaseUrl =
  process.env.ENGROVE_SEED_DATABASE_URL ??
  process.env.DATABASE_URL ??
  localDatabaseUrl() ??
  'postgresql://engrove:engrove_dev_only@localhost:5432/engrove';
const workspacePublicId = process.argv[2] ?? 'w8229121e5c82ae';
const projectPublicId = process.argv[3] ?? 'pf3df0667cb3a75';
const seedKey = 'task-demo';

type RecordLocator = { objectKey: string; displayName: string; entityType: TaskEntityType };

const taskSamples = [
  {
    title: 'Investigate blue-channel QE roll-off',
    description:
      'Review the UV-Vis QE curve above 520 nm and confirm whether the blue-channel decrease is expected.',
    status: 'in_progress' as const,
    priority: 'critical' as const,
    dueDate: '2026-08-04',
    assigned: true,
    link: {
      objectKey: 'signal-preview',
      displayName: 'UV-Vis · Sample A',
      entityType: 'record' as const,
    },
  },
  {
    title: 'Validate AR coating RTA balance',
    description:
      'Verify Reflectance + Transmittance + Absorptance equals 100% across the sampled wavelength range.',
    status: 'todo' as const,
    priority: 'high' as const,
    dueDate: '2026-08-06',
    assigned: true,
    link: {
      objectKey: 'material-rta',
      displayName: 'AR-coated polymer film',
      entityType: 'record' as const,
    },
  },
  {
    title: 'Recalibrate Demo UTM before the next run',
    description:
      'Calibration is overdue. Attach the latest certificate before collecting another tensile dataset.',
    status: 'blocked' as const,
    priority: 'critical' as const,
    dueDate: '2026-08-02',
    assigned: true,
    link: {
      objectKey: 'equipment',
      displayName: 'Demo UTM',
      entityType: 'record' as const,
    },
  },
  {
    title: 'Review Demo Run 001 force curve',
    description:
      'Check the force-displacement response for discontinuities and record the engineering disposition.',
    status: 'in_progress' as const,
    priority: 'high' as const,
    dueDate: '2026-08-05',
    assigned: false,
    link: {
      objectKey: 'test-run',
      displayName: 'Demo Run 001',
      entityType: 'test_run' as const,
    },
  },
  {
    title: 'Confirm Sample 001 traceability metadata',
    description:
      'Confirm material lot, preparation date, and custody information are complete before approval.',
    status: 'todo' as const,
    priority: 'medium' as const,
    dueDate: '2026-08-08',
    assigned: true,
    link: {
      objectKey: 'sample',
      displayName: 'Demo Sample 001',
      entityType: 'sample' as const,
    },
  },
  {
    title: 'Compare low-iron glass optical response',
    description:
      'Compare the seeded RTA spectrum with the supplier nominal curve and note material deviations.',
    status: 'todo' as const,
    priority: 'low' as const,
    dueDate: '2026-08-12',
    assigned: false,
    link: {
      objectKey: 'material-rta',
      displayName: 'Low-iron glass · 3 mm',
      entityType: 'record' as const,
    },
  },
  {
    title: 'Document cyclic-response acceptance criteria',
    description:
      'Define the allowable settling time and steady-state temperature band for the cyclic response example.',
    status: 'blocked' as const,
    priority: 'medium' as const,
    dueDate: '2026-08-07',
    assigned: false,
    link: {
      objectKey: 'signal-preview',
      displayName: 'Cyclic response · Sample C',
      entityType: 'record' as const,
    },
  },
  {
    title: 'Publish tensile-method review summary',
    description:
      'Method parameters and review comments were checked; retain this completed item as task-history sample.',
    status: 'done' as const,
    priority: 'medium' as const,
    dueDate: '2026-07-31',
    assigned: true,
    link: {
      objectKey: 'test-method',
      displayName: 'Demo Tensile Method',
      entityType: 'record' as const,
    },
  },
];

const pool = createPool(databaseUrl, { max: 2 });

try {
  const target = await pool.query<{
    workspace_id: string;
    project_id: string;
    organization_id: string;
    actor_id: string;
    email: string;
    display_name: string;
    role: ActorSession['role'];
  }>(
    `select w.id workspace_id, p.id project_id, w.organization_id,
            u.id actor_id, u.email, u.display_name, m.role
       from workspaces w
       join projects p on p.workspace_id = w.id
       join users u on u.id = p.created_by
       join memberships m on m.organization_id = w.organization_id and m.user_id = u.id
      where w.public_id = $1 and p.public_id = $2
        and w.archived_at is null and p.archived_at is null`,
    [workspacePublicId, projectPublicId],
  );
  const row = target.rows[0];
  if (!row) throw new Error('Seed target workspace or project was not found.');

  const actor: ActorSession = {
    sessionId: seedKey,
    actorId: row.actor_id,
    organizationId: row.organization_id,
    role: row.role,
    email: row.email,
    displayName: row.display_name,
    csrfTokenHash: '',
  };
  const repository = await ScopedTaskRepository.open(pool, actor, row.workspace_id, row.project_id);
  const records = await pool.query<{
    id: string;
    object_key: string;
    display_name: string;
  }>(
    `select r.id, o.key object_key, r.display_name
       from records r
       join object_types o on o.id = r.object_type_id and o.project_id = r.project_id
      where r.project_id = $1 and r.archived_at is null`,
    [row.project_id],
  );
  const recordId = ({ objectKey, displayName }: RecordLocator) => {
    const record = records.rows.find(
      (candidate) => candidate.object_key === objectKey && candidate.display_name === displayName,
    );
    if (!record) throw new Error(`Task sample record was not found: ${objectKey}/${displayName}`);
    return record.id;
  };

  const existing = await repository.listTasks({ includeArchived: true });
  let created = 0;
  for (const sample of taskSamples) {
    if (existing.some((task) => task.title === sample.title)) continue;
    await repository.createTask({
      title: sample.title,
      description: sample.description,
      status: sample.status,
      priority: sample.priority,
      assigneeId: sample.assigned ? row.actor_id : undefined,
      dueDate: sample.dueDate,
      links: [
        {
          entityType: sample.link.entityType,
          entityId: recordId(sample.link),
        },
      ],
      requestId: `${seedKey}:${created + 1}`,
    });
    created += 1;
  }

  const available = await repository.listTasks({ includeArchived: false });
  console.log(
    JSON.stringify({
      workspacePublicId,
      projectPublicId,
      tasksCreated: created,
      sampleTasksAvailable: taskSamples.filter((sample) =>
        available.some((task) => task.title === sample.title),
      ).length,
      totalActiveTasks: available.length,
    }),
  );
} finally {
  await pool.end();
}
