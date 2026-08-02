import {
  createPool,
  createProject,
  ensureWorkspaceDataProject,
  ScopedProjectRepository,
  type ActorSession,
  type JsonValue,
} from '../packages/database/src/index.js';

const connectionString = process.env.DATABASE_URL;
const workspaceSlug = process.env.WORKSPACE_SLUG;
const ownerEmail = process.env.OWNER_EMAIL ?? 'owner@example.com';

if (!connectionString) throw new Error('DATABASE_URL is required.');
if (!workspaceSlug) throw new Error('WORKSPACE_SLUG is required.');

async function main() {
  const pool = createPool(connectionString!);
  const requestId = `workspace-sample:${Date.now()}`;

  try {
    const ownerResult = await pool.query<{
      id: string;
      email: string;
      display_name: string;
      organization_id: string;
      role: ActorSession['role'];
    }>(
      `select u.id, u.email, u.display_name, m.organization_id, m.role
     from users u join memberships m on m.user_id = u.id
     where lower(u.email) = lower($1) and m.role = 'owner'
     order by m.created_at limit 1`,
      [ownerEmail],
    );
    const owner = ownerResult.rows[0];
    if (!owner) throw new Error(`Owner ${ownerEmail} was not found.`);

    const workspaceResult = await pool.query<{ id: string; name: string }>(
      `select id, name from workspaces
     where organization_id = $1 and slug = $2 and archived_at is null`,
      [owner.organization_id, workspaceSlug],
    );
    const workspace = workspaceResult.rows[0];
    if (!workspace) throw new Error(`Workspace ${workspaceSlug} was not found.`);

    const actor: ActorSession = {
      sessionId: 'workspace-sample-installer',
      actorId: owner.id,
      organizationId: owner.organization_id,
      role: owner.role,
      email: owner.email,
      displayName: owner.display_name,
      csrfTokenHash: '',
    };

    const ensureProject = async (name: string, key: string, description: string) => {
      const existing = await pool.query<{
        id: string;
        name: string;
        key: string;
        archived_at: Date | null;
      }>(
        `select id, name, key, archived_at from projects
       where workspace_id = $1 and key = $2 and system = false`,
        [workspace.id, key],
      );
      if (existing.rows[0]) return existing.rows[0];
      const created = await createProject(pool, actor, {
        workspaceId: workspace.id,
        name,
        key,
        description,
        requestId,
      });
      return { id: created.id, name: created.name, key: created.key, archived_at: null };
    };

    const existingProjects = await pool.query<{
      id: string;
      name: string;
      key: string;
      archived_at: Date | null;
    }>(
      `select id, name, key, archived_at from projects
     where workspace_id = $1 and system = false and archived_at is null
     order by created_at, id`,
      [workspace.id],
    );
    const thermal = await ensureProject(
      'Thermal cycling validation',
      'THERMAL',
      'Sample project for comparing workspace-level portfolio rows.',
    );
    const motor = await ensureProject(
      'Motor redesign pilot',
      'MOTOR',
      'Sample project for comparing workspace-level portfolio rows.',
    );
    const supplier = await ensureProject(
      'Supplier qualification',
      'SUPPLIER',
      'Sample project for comparing workspace-level portfolio rows.',
    );
    const projects = new Map(
      [...existingProjects.rows, thermal, motor, supplier].map((project) => [project.key, project]),
    );

    const backingProject = await ensureWorkspaceDataProject(pool, actor, workspace.id, requestId);
    const data = await ScopedProjectRepository.open(pool, actor, workspace.id, backingProject.id);
    let portfolio = (await data.listObjectTypes()).find((item) => item.key === 'project-portfolio');
    if (!portfolio) {
      portfolio = await data.createObjectType({
        name: 'Project portfolio item',
        pluralName: 'Project portfolio',
        key: 'project-portfolio',
        icon: 'table',
        description: 'Workspace-shared project comparison sample.',
        requestId,
      });
      const fields: Array<{
        name: string;
        key: string;
        fieldType: 'text' | 'long_text' | 'integer' | 'decimal' | 'date' | 'single_select';
        required?: boolean;
        position: number;
        config?: Record<string, JsonValue>;
        defaultValue?: JsonValue;
      }> = [
        {
          name: 'Status',
          key: 'status',
          fieldType: 'single_select',
          required: true,
          position: 0,
          config: {
            options: [
              { key: 'planned', label: 'Planned' },
              { key: 'active', label: 'Active' },
              { key: 'blocked', label: 'Blocked' },
              { key: 'complete', label: 'Complete' },
            ],
          },
          defaultValue: 'planned',
        },
        { name: 'Owner', key: 'owner', fieldType: 'text', position: 1 },
        { name: 'Progress (%)', key: 'progress', fieldType: 'integer', position: 2 },
        { name: 'Target date', key: 'target-date', fieldType: 'date', position: 3 },
        { name: 'Budget (kUSD)', key: 'budget-kusd', fieldType: 'decimal', position: 4 },
        {
          name: 'Risk',
          key: 'risk',
          fieldType: 'single_select',
          position: 5,
          config: {
            options: [
              { key: 'low', label: 'Low' },
              { key: 'medium', label: 'Medium' },
              { key: 'high', label: 'High' },
            ],
          },
        },
        {
          name: 'Next milestone',
          key: 'next-milestone',
          fieldType: 'long_text',
          position: 6,
        },
      ];
      for (const field of fields) {
        await data.createField({
          objectTypeId: portfolio.id,
          ...field,
          requestId,
        });
      }
    }

    const sampleRows: Array<{
      projectKey: string;
      displayName: string;
      values: Record<string, JsonValue>;
    }> = [
      {
        projectKey: existingProjects.rows[0]?.key ?? 'FORCE',
        displayName: 'Force characterization',
        values: {
          status: 'active',
          owner: 'Mina Kim',
          progress: 68,
          'target-date': '2026-09-18',
          'budget-kusd': '42.5',
          risk: 'medium',
          'next-milestone': 'Complete the 500-cycle repeatability run.',
        },
      },
      {
        projectKey: 'THERMAL',
        displayName: 'Thermal cycling validation',
        values: {
          status: 'active',
          owner: 'Daniel Park',
          progress: 45,
          'target-date': '2026-10-02',
          'budget-kusd': '31',
          risk: 'low',
          'next-milestone': 'Review chamber calibration and start lot B.',
        },
      },
      {
        projectKey: 'MOTOR',
        displayName: 'Motor redesign pilot',
        values: {
          status: 'blocked',
          owner: 'Sora Lee',
          progress: 27,
          'target-date': '2026-11-14',
          'budget-kusd': '88.4',
          risk: 'high',
          'next-milestone': 'Resolve the bearing supplier tolerance issue.',
        },
      },
      {
        projectKey: 'SUPPLIER',
        displayName: 'Supplier qualification',
        values: {
          status: 'planned',
          owner: 'Alex Chen',
          progress: 10,
          'target-date': '2026-12-05',
          'budget-kusd': '19.75',
          risk: 'medium',
          'next-milestone': 'Approve the incoming inspection sampling plan.',
        },
      },
    ];

    let createdRows = 0;
    for (const sample of sampleRows) {
      const project = projects.get(sample.projectKey);
      if (!project) continue;
      const existing = await pool.query(
        `select 1 from records
       where project_id = $1 and object_type_id = $2 and context_project_id = $3
         and archived_at is null`,
        [backingProject.id, portfolio.id, project.id],
      );
      if (existing.rowCount) continue;
      await data.createRecord({
        objectTypeId: portfolio.id,
        contextProjectId: project.id,
        displayName: sample.displayName,
        values: sample.values,
        requestId,
      });
      createdRows += 1;
    }

    console.log(
      JSON.stringify({
        workspace: workspace.name,
        workspaceId: workspace.id,
        backingProjectId: backingProject.id,
        table: portfolio.pluralName,
        tableId: portfolio.id,
        projectCount: projects.size,
        createdRows,
      }),
    );
  } finally {
    await pool.end();
  }
}

void main().catch((cause: unknown) => {
  console.error(cause);
  process.exitCode = 1;
});
