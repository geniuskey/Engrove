import { createHash, randomUUID } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  onboardingSteps,
  PilotRepository,
  resolveProjectIdentifier,
  resolveWorkspaceIdentifier,
  ScopedFileDatasetRepository,
  ScopedProjectRepository,
  ScopedTaskRepository,
  ScopedVisualizationRepository,
  type JsonValue,
  type OnboardingStep,
} from '@engrove/database';
import { assertPermission } from '@engrove/permissions';
import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import { requestId, requireActor } from './community.controller.js';
import type { Runtime } from './runtime.js';
import { RUNTIME } from './runtime.provider.js';

const id = z.string().uuid();
const onboardingStep = z.enum(onboardingSteps);
const demoCsv = `elapsed_s,force_N,displacement_mm\n0,0,0\n1,12.5,0.08\n2,28.1,0.19\n3,44.7,0.31\n4,61.2,0.46\n5,78.4,0.63\n`;

async function objectBytes(body: unknown): Promise<Uint8Array> {
  if (!body || typeof body !== 'object' || !('transformToByteArray' in body))
    throw new Error('OBJECT_BODY_UNAVAILABLE');
  return (body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();
}

@Controller('api/v1')
export class PilotController {
  constructor(@Inject(RUNTIME) private readonly runtime: Runtime) {}

  @Get('onboarding')
  async onboarding(@Req() request: Request) {
    const actor = await requireActor(this.runtime, request);
    return new PilotRepository(this.runtime.pool, actor).onboarding();
  }

  @Patch('onboarding')
  async updateOnboarding(@Req() request: Request, @Body() raw: unknown) {
    const actor = await requireActor(this.runtime, request, undefined, true);
    const body = z
      .object({
        completedSteps: z.array(onboardingStep).max(onboardingSteps.length),
        dismissed: z.boolean().default(false),
      })
      .strict()
      .parse(raw);
    return new PilotRepository(this.runtime.pool, actor).updateOnboarding({
      completedSteps: body.completedSteps as OnboardingStep[],
      dismissed: body.dismissed,
      requestId: requestId(request),
    });
  }

  @Post('pilot-feedback')
  async feedback(@Req() request: Request, @Body() raw: unknown) {
    const actor = await requireActor(this.runtime, request, undefined, true);
    const body = z
      .object({
        projectId: id.optional(),
        category: z.enum(['bug', 'usability', 'workflow', 'idea', 'other']),
        rating: z.number().int().min(1).max(5),
        message: z.string().trim().min(10).max(4_000),
        context: z
          .record(z.string().max(80), z.unknown())
          .refine((value) => JSON.stringify(value).length <= 8_192, 'Context is too large.')
          .default({}),
      })
      .strict()
      .parse(raw);
    return new PilotRepository(this.runtime.pool, actor).captureFeedback({
      ...body,
      requestId: requestId(request),
    });
  }

  @Get('pilot/summary')
  async pilotSummary(@Req() request: Request) {
    const actor = await requireActor(this.runtime, request, 'pilot.manage');
    return new PilotRepository(this.runtime.pool, actor).summary();
  }

  @Get('pilot/feedback')
  async pilotFeedback(@Req() request: Request, @Query('limit') rawLimit?: string) {
    const actor = await requireActor(this.runtime, request, 'pilot.manage');
    const limit = z.coerce.number().int().min(1).max(500).default(100).parse(rawLimit);
    return { items: await new PilotRepository(this.runtime.pool, actor).feedbackItems(limit) };
  }

  @Get('workspaces/:workspaceId/projects/:projectId/demo')
  async demoStatus(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
  ) {
    const actor = await requireActor(this.runtime, request, 'record.read');
    const resolvedProjectId = await resolveProjectIdentifier(this.runtime.pool, projectId);
    await ScopedProjectRepository.open(
      this.runtime.pool,
      actor,
      await resolveWorkspaceIdentifier(this.runtime.pool, workspaceId),
      resolvedProjectId,
    );
    const result = await this.runtime.pool.query(
      `select i.*,d.status dataset_status,d.row_count,c.name chart_name,r.display_name test_run_name
       from project_demo_installations i
       join datasets d on d.id=i.dataset_id and d.project_id=i.project_id
       join charts c on c.id=i.chart_id and c.project_id=i.project_id
       join records r on r.id=i.test_run_record_id and r.project_id=i.project_id
       where i.project_id=$1`,
      [resolvedProjectId],
    );
    return { installed: Boolean(result.rows[0]), installation: result.rows[0] ?? null };
  }

  @Post('workspaces/:workspaceId/projects/:projectId/demo/install')
  async installDemo(
    @Req() request: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
  ) {
    const actor = await requireActor(this.runtime, request, 'schema.manage', true);
    for (const action of [
      'record.create',
      'file.upload',
      'dataset.upload',
      'dashboard.manage',
      'task.create',
    ] as const)
      assertPermission(
        { actorId: actor.actorId, organizationId: actor.organizationId, role: actor.role },
        action,
      );
    const runtime = this.runtime;
    const wid = await resolveWorkspaceIdentifier(runtime.pool, workspaceId);
    const pid = await resolveProjectIdentifier(runtime.pool, projectId);
    const data = await ScopedProjectRepository.open(runtime.pool, actor, wid, pid);
    const files = await ScopedFileDatasetRepository.open(runtime.pool, actor, wid, pid);
    const visualizations = await ScopedVisualizationRepository.open(runtime.pool, actor, wid, pid);
    const tasks = await ScopedTaskRepository.open(runtime.pool, actor, wid, pid);
    const lockClient = await runtime.pool.connect();
    const lockKey = `engrove-demo:${pid}`;
    await lockClient.query('select pg_advisory_lock(hashtext($1))', [lockKey]);
    try {
      const prior = await runtime.pool.query(
        'select * from project_demo_installations where project_id=$1',
        [pid],
      );
      if (prior.rows[0]) return { installed: true, idempotent: true, ...prior.rows[0] };

      const template = await data.installTestCharacterizationTemplate(requestId(request));
      const objectTypes = new Map(template.objectTypes.map((item) => [item.key, item]));
      const fields = new Map<string, Map<string, string>>();
      for (const [key, objectType] of objectTypes) {
        fields.set(
          key,
          new Map((await data.listFields(objectType.id)).map((field) => [field.key, field.id])),
        );
      }
      const field = (type: string, key: string) => {
        const value = fields.get(type)?.get(key);
        if (!value) throw new Error(`DEMO_FIELD_MISSING:${type}.${key}`);
        return value;
      };
      const objectId = (key: string) => {
        const value = objectTypes.get(key)?.id;
        if (!value) throw new Error(`DEMO_OBJECT_TYPE_MISSING:${key}`);
        return value;
      };
      const findRecord = async (objectKey: string, valueKey: string, value: string) => {
        const found = await runtime.pool.query<{ id: string }>(
          `select r.id from records r join object_types o on o.id=r.object_type_id and o.project_id=r.project_id
           where r.project_id=$1 and o.key=$2 and r.values->>$3=$4 order by r.created_at limit 1`,
          [pid, objectKey, valueKey, value],
        );
        return found.rows[0]?.id;
      };
      const ensureRecord = async (
        objectKey: string,
        uniqueKey: string,
        uniqueValue: string,
        displayName: string,
        values: Record<string, JsonValue>,
        relations: Record<string, string[]> = {},
        fileReferences: Record<string, string[]> = {},
        datasetReferences: Record<string, string[]> = {},
      ) => {
        const existing = await findRecord(objectKey, uniqueKey, uniqueValue);
        if (existing) return data.getRecord(objectId(objectKey), existing);
        return data.createRecord({
          objectTypeId: objectId(objectKey),
          displayName,
          values,
          relations,
          fileReferences,
          datasetReferences,
          requestId: requestId(request),
        });
      };

      const item = await ensureRecord('test-item', 'part-number', 'EG-DEMO-001', 'Demo Bracket', {
        name: 'Demo Bracket',
        'part-number': 'EG-DEMO-001',
        revision: 'A',
        description: 'Synthetic tensile characterization example; not production evidence.',
        status: 'active',
      });
      const equipment = await ensureRecord('equipment', 'equipment-id', 'UTM-DEMO-01', 'Demo UTM', {
        'equipment-id': 'UTM-DEMO-01',
        name: 'Demo Universal Test Machine',
        manufacturer: 'Engrove Demo',
        model: 'Synthetic 10 kN',
        'serial-number': 'DEMO-ONLY',
        'calibration-due-date': '2030-01-01',
        status: 'active',
      });
      const method = await ensureRecord(
        'test-method',
        'method-version',
        'DEMO-A',
        'Demo Tensile Method',
        {
          name: 'Demo Tensile Method',
          'method-version': 'DEMO-A',
          description: 'Synthetic onboarding method. Replace with an approved procedure.',
          status: 'active',
        },
        { [field('test-method', 'default-equipment')]: [equipment.id] },
      );
      const sample = await ensureRecord(
        'sample',
        'sample-id',
        'DEMO-SAMPLE-001',
        'Demo Sample 001',
        {
          'sample-id': 'DEMO-SAMPLE-001',
          lot: 'DEMO-LOT',
          batch: 'DEMO-BATCH',
          'serial-number': 'DEMO-001',
          'received-date': '2026-01-15',
          status: 'active',
          notes: 'Synthetic onboarding record; safe to archive after evaluation.',
        },
        { [field('sample', 'test-item')]: [item.id] },
      );

      const csvBytes = new TextEncoder().encode(demoCsv);
      const checksum = createHash('sha256').update(csvBytes).digest('hex');
      let file = (
        await runtime.pool.query(
          `select * from file_objects where project_id=$1 and original_name='engrove-demo-results.csv'
           and checksum=$2 and status='available' order by available_at limit 1`,
          [pid, checksum],
        )
      ).rows[0];
      if (!file) {
        const fileId = uuidv7();
        const uploadId = uuidv7();
        const finalObjectKey = `committed/${pid}/files/${fileId}/engrove-demo-results.csv`;
        await files.issueUpload({
          fileId,
          uploadId,
          seriesName: 'Engrove onboarding demo results',
          originalName: 'engrove-demo-results.csv',
          contentType: 'text/csv',
          sizeBytes: csvBytes.byteLength,
          checksum,
          stagingObjectKey: `staging/${pid}/${uploadId}/${randomUUID()}`,
          finalObjectKey,
          expiresAt: new Date(Date.now() + 15 * 60_000),
          requestId: requestId(request),
        });
        await files.beginFinalization(uploadId);
        const stored = await runtime.s3.send(
          new PutObjectCommand({
            Bucket: runtime.config.S3_BUCKET,
            Key: finalObjectKey,
            Body: csvBytes,
            ContentType: 'text/csv',
            Metadata: { sha256: checksum, demo: 'true' },
          }),
        );
        const reread = await runtime.s3.send(
          new GetObjectCommand({
            Bucket: runtime.config.S3_BUCKET,
            Key: finalObjectKey,
            VersionId: stored.VersionId,
          }),
        );
        const verified = await objectBytes(reread.Body);
        if (createHash('sha256').update(verified).digest('hex') !== checksum)
          throw new Error('DEMO_FILE_CHECKSUM_MISMATCH');
        file = await files.completeFinalization(
          uploadId,
          stored.VersionId ?? null,
          requestId(request),
        );
      }

      const created = await files.createDataset({
        name: 'Engrove demo force results',
        sourceFileId: String(file.id),
        datasetType: 'tabular',
        parameters: { delimiter: ',', demo: true },
        requestId: requestId(request),
      });
      let dataset = created.dataset as Record<string, unknown>;
      const deadline = Date.now() + 30_000;
      while (dataset.status !== 'ready' && dataset.status !== 'failed' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        dataset = (await files.getDataset(String(dataset.id))) as Record<string, unknown>;
      }
      if (dataset.status !== 'ready') throw new Error('DEMO_DATASET_NOT_READY');
      const columns = (dataset.schema as { columns: Array<{ id: string; name?: string }> }).columns;
      const forceColumn = columns.find((column) => column.name === 'force_N') ?? columns[1];
      if (!forceColumn) throw new Error('DEMO_FORCE_COLUMN_MISSING');

      let run = await (async () => {
        const existing = await findRecord('test-run', 'run-id', 'DEMO-RUN-001');
        return existing ? data.getRecord(objectId('test-run'), existing) : undefined;
      })();
      if (!run) {
        run = await data.createRecord({
          objectTypeId: objectId('test-run'),
          displayName: 'Demo Run 001',
          values: {
            'run-id': 'DEMO-RUN-001',
            operator: actor.actorId,
            'start-time': '2026-01-15T14:00:00.000Z',
            'end-time': '2026-01-15T14:05:00.000Z',
            'environment-temperature': { value: '23', unit: 'degC' },
            status: 'complete',
          },
          relations: {
            [field('test-run', 'sample')]: [sample.id],
            [field('test-run', 'test-method')]: [method.id],
            [field('test-run', 'equipment')]: [equipment.id],
          },
          fileReferences: { [field('test-run', 'raw-file')]: [String(file.id)] },
          datasetReferences: { [field('test-run', 'dataset')]: [String(dataset.id)] },
          requestId: requestId(request),
        });
      }

      const existingChart = await runtime.pool.query<{ id: string }>(
        `select c.id from charts c join chart_revisions r on r.id=c.current_revision_id
         join chart_dataset_sources s on s.chart_revision_id=r.id
         where c.project_id=$1 and c.name='Engrove demo force distribution' and s.dataset_id=$2
         order by c.created_at limit 1`,
        [pid, dataset.id],
      );
      const chart = existingChart.rows[0]
        ? await visualizations.getChart(existingChart.rows[0].id)
        : await visualizations.createChart({
            name: 'Engrove demo force distribution',
            description: 'Synthetic onboarding data with exact immutable dataset provenance.',
            chartType: 'histogram',
            configVersion: 1,
            config: {
              title: 'Force distribution',
              sourceKey: 'demo-force',
              columnId: forceColumn.id,
              binStrategy: 'fixed',
              binCount: 6,
              axes: {
                x: { label: 'Force', dimension: 'force', displayUnit: 'N', scale: 'linear' },
                y: {
                  label: 'Count',
                  dimension: 'dimensionless',
                  displayUnit: '1',
                  scale: 'linear',
                },
              },
              filter: null,
              missingData: 'indicate',
            },
            sources: [
              {
                sourceKey: 'demo-force',
                datasetId: String(dataset.id),
                sourceRole: 'values',
                seriesOrder: 0,
              },
            ],
            changeNote: 'Install onboarding demo',
            requestId: requestId(request),
          });

      const existingTask = await runtime.pool.query<{ id: string }>(
        `select t.id from tasks t join task_links l on l.task_id=t.id and l.project_id=t.project_id
         where t.project_id=$1 and t.title='Review the Engrove demo result' and l.entity_type='dataset'
           and l.entity_id=$2 order by t.created_at limit 1`,
        [pid, dataset.id],
      );
      if (!existingTask.rows[0])
        await tasks.createTask({
          title: 'Review the Engrove demo result',
          description: 'Trace the demo chart to its immutable CSV source, then close this task.',
          status: 'todo',
          priority: 'medium',
          links: [
            { entityType: 'test_run', entityId: run.id },
            { entityType: 'dataset', entityId: String(dataset.id) },
          ],
          requestId: requestId(request),
        });

      await runtime.pool.query(
        `with installed as (
           insert into project_demo_installations
             (project_id,template_version,file_id,dataset_id,chart_id,test_run_record_id,installed_by)
           values ($1,6,$2,$3,$4,$5,$6) on conflict (project_id) do nothing
           returning project_id
         )
         insert into audit_events
           (id,organization_id,workspace_id,project_id,actor_id,action,target_type,target_id,request_id,payload)
         select $7,$8,$9,installed.project_id,$6,'pilot.demo_installed','project',installed.project_id,$10,
           jsonb_build_object('templateVersion',6,'fileId',$2::text,'datasetId',$3::text,'chartId',$4::text)
         from installed`,
        [
          pid,
          file.id,
          dataset.id,
          chart.id,
          run.id,
          actor.actorId,
          uuidv7(),
          actor.organizationId,
          wid,
          requestId(request),
        ],
      );
      return {
        installed: true,
        idempotent: false,
        templateVersion: 6,
        fileId: file.id,
        datasetId: dataset.id,
        chartId: chart.id,
        testRunRecordId: run.id,
      };
    } finally {
      await lockClient.query('select pg_advisory_unlock(hashtext($1))', [lockKey]);
      lockClient.release();
    }
  }
}
