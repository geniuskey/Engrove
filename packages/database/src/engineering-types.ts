import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import {
  compareCanonical,
  convertQuantity,
  REGISTRY_DIGEST,
  REGISTRY_VERSION,
  type Dimension,
} from '@engrove/units';
import { appendAudit, RepositoryError, type ActorSession } from './community.js';

export const EVALUATOR_VERSION = 'scalar-v1';
export const UNIT_REGISTRY_VERSION = `${REGISTRY_VERSION}+sha256:${REGISTRY_DIGEST}`;
type EvaluationStatus = 'pass' | 'warning' | 'fail' | 'missing';
type LimitInput = {
  targetValue?: string | null | undefined;
  lowerLimit?: string | null | undefined;
  upperLimit?: string | null | undefined;
  warningLowerLimit?: string | null | undefined;
  warningUpperLimit?: string | null | undefined;
};
type FieldConfig = {
  dimension: Dimension;
  canonicalUnit: string;
  allowedUnits: string[];
  displayPrecision?: number;
};
type Revision = {
  id: string;
  specification_id: string;
  revision_number: number;
  quantity_dimension: Dimension;
  canonical_unit: string;
  target_value: string | null;
  lower_limit: string | null;
  upper_limit: string | null;
  warning_lower_limit: string | null;
  warning_upper_limit: string | null;
};

async function tx<T>(pool: Pool, callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await callback(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
const fingerprint = (...parts: Array<string | null>) =>
  createHash('sha256')
    .update(parts.map((part) => part ?? 'missing').join('\0'))
    .digest('hex');

function canonicalLimits(input: LimitInput, config: FieldConfig) {
  const convert = (value: string | null | undefined) =>
    value == null
      ? null
      : convertQuantity(value, config.canonicalUnit, config.dimension).canonicalValue;
  const limits = {
    targetValue: convert(input.targetValue),
    lowerLimit: convert(input.lowerLimit),
    upperLimit: convert(input.upperLimit),
    warningLowerLimit: convert(input.warningLowerLimit),
    warningUpperLimit: convert(input.warningUpperLimit),
  };
  if (limits.lowerLimit === null && limits.upperLimit === null)
    throw new RepositoryError(
      'SPECIFICATION_LIMIT_REQUIRED',
      400,
      'At least one hard limit is required.',
    );
  const ordered = [
    limits.lowerLimit,
    limits.warningLowerLimit,
    limits.warningUpperLimit,
    limits.upperLimit,
  ].filter((value): value is string => value !== null);
  for (let index = 1; index < ordered.length; index++)
    if (compareCanonical(ordered[index - 1]!, ordered[index]!) > 0)
      throw new RepositoryError(
        'SPECIFICATION_LIMIT_ORDER_INVALID',
        400,
        'Specification limits are not ordered.',
      );
  if (limits.warningLowerLimit !== null && limits.lowerLimit === null)
    throw new RepositoryError(
      'SPECIFICATION_LIMIT_ORDER_INVALID',
      400,
      'A lower warning limit requires a hard lower limit.',
    );
  if (limits.warningUpperLimit !== null && limits.upperLimit === null)
    throw new RepositoryError(
      'SPECIFICATION_LIMIT_ORDER_INVALID',
      400,
      'An upper warning limit requires a hard upper limit.',
    );
  return limits;
}

function statusFor(
  value: string | null,
  revision: Revision,
): { status: EvaluationStatus; reasonCode: string } {
  if (value === null) return { status: 'missing', reasonCode: 'NO_CURRENT_MEASUREMENT' };
  if (
    (revision.lower_limit !== null && compareCanonical(value, revision.lower_limit) < 0) ||
    (revision.upper_limit !== null && compareCanonical(value, revision.upper_limit) > 0)
  )
    return { status: 'fail', reasonCode: 'OUTSIDE_HARD_LIMIT' };
  if (
    (revision.warning_lower_limit !== null &&
      compareCanonical(value, revision.warning_lower_limit) < 0) ||
    (revision.warning_upper_limit !== null &&
      compareCanonical(value, revision.warning_upper_limit) > 0)
  )
    return { status: 'warning', reasonCode: 'OUTSIDE_WARNING_LIMIT' };
  return { status: 'pass', reasonCode: 'WITHIN_LIMITS' };
}

async function latestRevision(client: PoolClient, specificationId: string): Promise<Revision> {
  const result = await client.query<Revision>(
    'select id,specification_id,revision_number,quantity_dimension,canonical_unit,target_value,lower_limit,upper_limit,warning_lower_limit,warning_upper_limit from specification_revisions where specification_id=$1 order by revision_number desc limit 1',
    [specificationId],
  );
  if (!result.rows[0])
    throw new RepositoryError('SPECIFICATION_NOT_FOUND', 404, 'Specification was not found.');
  return result.rows[0];
}

async function evaluate(
  client: PoolClient,
  projectId: string,
  revision: Revision,
  recordId: string,
  fieldId: string,
  result: { id: string; canonical_value: string } | null,
): Promise<Record<string, unknown>> {
  const inputFingerprint = fingerprint(
    revision.id,
    recordId,
    result?.id ?? null,
    EVALUATOR_VERSION,
  );
  const evaluated = statusFor(result?.canonical_value ?? null, revision);
  const id = uuidv7();
  const inserted = await client.query(
    `insert into specification_evaluations (id,project_id,specification_revision_id,record_id,measurement_field_id,measurement_result_id,status,evaluated_canonical_value,unit_registry_version,evaluator_version,reason_code,input_fingerprint) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict (project_id,input_fingerprint) do nothing returning *`,
    [
      id,
      projectId,
      revision.id,
      recordId,
      fieldId,
      result?.id ?? null,
      evaluated.status,
      result?.canonical_value ?? null,
      UNIT_REGISTRY_VERSION,
      EVALUATOR_VERSION,
      evaluated.reasonCode,
      inputFingerprint,
    ],
  );
  if (inserted.rows[0]) return inserted.rows[0] as Record<string, unknown>;
  const existing = await client.query(
    'select * from specification_evaluations where project_id=$1 and input_fingerprint=$2',
    [projectId, inputFingerprint],
  );
  return existing.rows[0] as Record<string, unknown>;
}

async function currentResult(
  client: PoolClient,
  projectId: string,
  recordId: string,
  fieldId: string,
): Promise<{ id: string; canonical_value: string } | null> {
  const result = await client.query<{ id: string; canonical_value: string }>(
    `select mr.id,mr.canonical_value from measurement_results mr where mr.project_id=$1 and mr.record_id=$2 and mr.field_id=$3 and not exists(select 1 from measurement_results successor where successor.project_id=mr.project_id and successor.supersedes_result_id=mr.id) order by mr.measured_at desc,mr.created_at desc,mr.id desc limit 1`,
    [projectId, recordId, fieldId],
  );
  return result.rows[0] ?? null;
}

export async function evaluateNewRecord(
  client: PoolClient,
  scope: { actor: ActorSession; workspaceId: string; projectId: string },
  recordId: string,
  objectTypeId: string,
  requestId: string,
  actorId: string | null = scope.actor.actorId,
): Promise<void> {
  const specs = await client.query<{ id: string; measurement_field_id: string }>(
    `select s.id,s.measurement_field_id from specifications s join field_definitions f on f.id=s.measurement_field_id and f.project_id=s.project_id where s.project_id=$1 and f.object_type_id=$2 and s.status='active'`,
    [scope.projectId, objectTypeId],
  );
  for (const spec of specs.rows) {
    const evaluation = await evaluate(
      client,
      scope.projectId,
      await latestRevision(client, spec.id),
      recordId,
      spec.measurement_field_id,
      null,
    );
    await appendAudit(client, {
      organizationId: scope.actor.organizationId,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      ...(actorId ? { actorId } : {}),
      action: 'specification.evaluated',
      targetType: 'specification_evaluation',
      targetId: String(evaluation.id),
      requestId,
      payload: { recordId, status: 'missing' },
    });
  }
}

export class ScopedEngineeringRepository {
  private constructor(
    private readonly pool: Pool,
    private readonly actor: ActorSession,
    private readonly workspaceId: string,
    private readonly projectId: string,
  ) {}
  static async open(pool: Pool, actor: ActorSession, workspaceId: string, projectId: string) {
    const found = await pool.query(
      'select 1 from projects p join workspaces w on w.id=p.workspace_id where p.id=$1 and p.workspace_id=$2 and w.organization_id=$3 and p.system=false and project_visible_to(p.id,$2,$3,$4,$5)',
      [projectId, workspaceId, actor.organizationId, actor.actorId, actor.role],
    );
    if (!found.rowCount)
      throw new RepositoryError('PROJECT_NOT_FOUND', 404, 'Project was not found.');
    return new ScopedEngineeringRepository(pool, actor, workspaceId, projectId);
  }
  private audit(
    action: string,
    targetType: string,
    targetId: string,
    requestId: string,
    payload: Record<string, unknown> = {},
  ) {
    return {
      organizationId: this.actor.organizationId,
      workspaceId: this.workspaceId,
      projectId: this.projectId,
      actorId: this.actor.actorId,
      action,
      targetType,
      targetId,
      requestId,
      payload,
    };
  }

  async createMeasurement(input: {
    recordId: string;
    fieldId: string;
    value: string;
    unit: string;
    precision?: number | undefined;
    uncertaintyValue?: string | undefined;
    uncertaintyUnit?: string | undefined;
    measuredAt: string;
    equipmentRecordId?: string | undefined;
    datasetId?: string | undefined;
    supersedesResultId?: string | undefined;
    correctionReason?: string | undefined;
    requestId: string;
  }) {
    return tx(this.pool, async (client) => {
      const fieldResult = await client.query<{ config: FieldConfig }>(
        `select f.config from field_definitions f join records r on r.project_id=f.project_id and r.object_type_id=f.object_type_id where f.project_id=$1 and f.id=$2 and f.field_type='measurement' and r.id=$3`,
        [this.projectId, input.fieldId, input.recordId],
      );
      const field = fieldResult.rows[0];
      if (!field)
        throw new RepositoryError(
          'MEASUREMENT_FIELD_NOT_FOUND',
          404,
          'Compatible measurement field was not found.',
        );
      const quantity = convertQuantity(input.value, input.unit, field.config.dimension);
      if (!field.config.allowedUnits.includes(input.unit))
        throw new RepositoryError(
          'UNIT_NOT_ALLOWED',
          400,
          'The input unit is not allowed for this field.',
        );
      let uncertainty: string | null = null;
      if (input.uncertaintyValue !== undefined) {
        if (!input.uncertaintyUnit)
          throw new RepositoryError(
            'UNCERTAINTY_UNIT_REQUIRED',
            400,
            'Uncertainty unit is required.',
          );
        if (!field.config.allowedUnits.includes(input.uncertaintyUnit))
          throw new RepositoryError(
            'UNIT_NOT_ALLOWED',
            400,
            'The uncertainty unit is not allowed for this field.',
          );
        const uncertaintyQuantity = convertQuantity(
          input.uncertaintyValue,
          input.uncertaintyUnit,
          field.config.dimension,
          true,
        );
        if (compareCanonical(uncertaintyQuantity.canonicalValue, '0') < 0)
          throw new RepositoryError('UNCERTAINTY_INVALID', 400, 'Uncertainty cannot be negative.');
        uncertainty = uncertaintyQuantity.value;
      }
      if (input.equipmentRecordId) {
        const equipment = await client.query(
          'select 1 from records where project_id=$1 and id=$2',
          [this.projectId, input.equipmentRecordId],
        );
        if (!equipment.rowCount)
          throw new RepositoryError('EQUIPMENT_NOT_FOUND', 404, 'Equipment record was not found.');
      }
      if (input.datasetId) {
        const dataset = await client.query(
          "select 1 from datasets where project_id=$1 and id=$2 and status='ready'",
          [this.projectId, input.datasetId],
        );
        if (!dataset.rowCount)
          throw new RepositoryError('DATASET_NOT_READY', 409, 'Supporting dataset must be ready.');
      }
      if (input.supersedesResultId) {
        if (!input.correctionReason?.trim())
          throw new RepositoryError(
            'CORRECTION_REASON_REQUIRED',
            400,
            'A correction reason is required.',
          );
        const previous = await client.query(
          `select 1 from measurement_results old where old.project_id=$1 and old.id=$2 and old.record_id=$3 and old.field_id=$4 and not exists(select 1 from measurement_results successor where successor.supersedes_result_id=old.id) for update`,
          [this.projectId, input.supersedesResultId, input.recordId, input.fieldId],
        );
        if (!previous.rowCount)
          throw new RepositoryError(
            'MEASUREMENT_NOT_CORRECTABLE',
            409,
            'Only a current compatible result can be corrected.',
          );
      }
      const id = uuidv7();
      const inserted = await client.query(
        `insert into measurement_results (id,project_id,record_id,field_id,canonical_value,canonical_unit,original_value,original_unit,precision,uncertainty_value,uncertainty_unit,unit_registry_version,measured_at,equipment_record_id,dataset_id,supersedes_result_id,correction_reason,recorded_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning *`,
        [
          id,
          this.projectId,
          input.recordId,
          input.fieldId,
          quantity.canonicalValue,
          quantity.canonicalUnit,
          quantity.value,
          input.unit,
          input.precision ?? null,
          uncertainty,
          input.uncertaintyUnit ?? null,
          UNIT_REGISTRY_VERSION,
          input.measuredAt,
          input.equipmentRecordId ?? null,
          input.datasetId ?? null,
          input.supersedesResultId ?? null,
          input.correctionReason?.trim() ?? null,
          this.actor.actorId,
        ],
      );
      const spec = await client.query<{ id: string }>(
        "select id from specifications where project_id=$1 and measurement_field_id=$2 and status='active'",
        [this.projectId, input.fieldId],
      );
      let evaluation = null;
      if (spec.rows[0])
        evaluation = await evaluate(
          client,
          this.projectId,
          await latestRevision(client, spec.rows[0].id),
          input.recordId,
          input.fieldId,
          { id, canonical_value: quantity.canonicalValue },
        );
      await appendAudit(
        client,
        this.audit(
          input.supersedesResultId ? 'measurement_result.superseded' : 'measurement_result.created',
          'measurement_result',
          id,
          input.requestId,
          {
            fieldId: input.fieldId,
            recordId: input.recordId,
            supersedesResultId: input.supersedesResultId ?? null,
          },
        ),
      );
      if (evaluation)
        await appendAudit(
          client,
          this.audit(
            'specification.evaluated',
            'specification_evaluation',
            String(evaluation.id),
            input.requestId,
            { recordId: input.recordId, status: evaluation.status },
          ),
        );
      return { ...inserted.rows[0], evaluation };
    });
  }

  async listMeasurementPage(input: {
    recordId: string;
    fieldId?: string | undefined;
    currentState: 'all' | 'current' | 'superseded';
    query: string;
    limit: number;
    offset: number;
  }) {
    const query = input.query.trim().toLowerCase();
    const parameters = [
      this.projectId,
      input.recordId,
      input.fieldId ?? null,
      input.currentState,
      query,
      input.limit,
      input.offset,
    ];
    const successor = `exists(select 1 from measurement_results successor
      where successor.project_id=mr.project_id and successor.supersedes_result_id=mr.id)`;
    const predicate = `mr.project_id=$1 and mr.record_id=$2
      and ($3::uuid is null or mr.field_id=$3)
      and ($4='all' or ($4='current' and not ${successor}) or ($4='superseded' and ${successor}))
      and ($5='' or position($5 in lower(concat_ws(' ',mr.original_value,mr.original_unit,
        mr.canonical_value,mr.canonical_unit,coalesce(mr.correction_reason,''),mr.field_id::text)))>0)`;
    const [items, count] = await Promise.all([
      this.pool.query(
        `select mr.*,not ${successor} as current,
           case when evaluation.id is null then null else row_to_json(evaluation) end evaluation
         from measurement_results mr
         left join lateral (
           select e.id,e.status,e.reason_code,e.evaluated_at,e.measurement_result_id,e.measurement_field_id
           from specification_evaluations e
           where e.project_id=mr.project_id and e.measurement_result_id=mr.id
           order by e.evaluated_at desc,e.id desc limit 1
         ) evaluation on true
         where ${predicate}
         order by mr.measured_at desc,mr.created_at desc,mr.id desc limit $6 offset $7`,
        parameters,
      ),
      this.pool.query<{ total: number }>(
        `select count(*)::int total from measurement_results mr where ${predicate}`,
        parameters.slice(0, 5),
      ),
    ]);
    const total = Number(count.rows[0]?.total ?? 0);
    return {
      items: items.rows,
      pageInfo: {
        limit: input.limit,
        offset: input.offset,
        total,
        hasNext: input.offset + items.rows.length < total,
      },
    };
  }

  async createSpecification(input: {
    name: string;
    measurementFieldId: string;
    limits: LimitInput;
    changeNote: string;
    requestId: string;
  }) {
    return tx(this.pool, async (client) => {
      const field = await client.query<{ config: FieldConfig }>(
        `select config from field_definitions where project_id=$1 and id=$2 and field_type='measurement'`,
        [this.projectId, input.measurementFieldId],
      );
      if (!field.rows[0])
        throw new RepositoryError(
          'MEASUREMENT_FIELD_NOT_FOUND',
          404,
          'Measurement field was not found.',
        );
      const limits = canonicalLimits(input.limits, field.rows[0].config);
      const id = uuidv7();
      try {
        await client.query(
          `insert into specifications (id,project_id,name,measurement_field_id,created_by) values ($1,$2,$3,$4,$5)`,
          [id, this.projectId, input.name.trim(), input.measurementFieldId, this.actor.actorId],
        );
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new RepositoryError(
            'ACTIVE_SPECIFICATION_EXISTS',
            409,
            'The measurement field already has an active specification.',
          );
        throw error;
      }
      const revision = await this.insertRevision(
        client,
        id,
        1,
        field.rows[0].config,
        limits,
        input.changeNote,
      );
      await this.evaluateAll(client, revision, input.measurementFieldId, input.requestId);
      await appendAudit(
        client,
        this.audit('specification.created', 'specification', id, input.requestId, {
          measurementFieldId: input.measurementFieldId,
          revisionId: revision.id,
        }),
      );
      return this.getSpecificationFrom(client, id);
    });
  }

  async reviseSpecification(
    specificationId: string,
    input: { limits: LimitInput; changeNote: string; requestId: string },
  ) {
    return tx(this.pool, async (client) => {
      const spec = await client.query<{ measurement_field_id: string; config: FieldConfig }>(
        `select s.measurement_field_id,f.config from specifications s join field_definitions f on f.id=s.measurement_field_id where s.project_id=$1 and s.id=$2 and s.status='active' for update of s`,
        [this.projectId, specificationId],
      );
      if (!spec.rows[0])
        throw new RepositoryError(
          'SPECIFICATION_NOT_FOUND',
          404,
          'Active specification was not found.',
        );
      const number = await client.query<{ revision_number: number }>(
        'select coalesce(max(revision_number),0)::int revision_number from specification_revisions where project_id=$1 and specification_id=$2',
        [this.projectId, specificationId],
      );
      const limits = canonicalLimits(input.limits, spec.rows[0].config);
      const revision = await this.insertRevision(
        client,
        specificationId,
        (number.rows[0]?.revision_number ?? 0) + 1,
        spec.rows[0].config,
        limits,
        input.changeNote,
      );
      await this.evaluateAll(client, revision, spec.rows[0].measurement_field_id, input.requestId);
      await appendAudit(
        client,
        this.audit('specification.revised', 'specification', specificationId, input.requestId, {
          revisionId: revision.id,
          revisionNumber: revision.revision_number,
        }),
      );
      return this.getSpecificationFrom(client, specificationId);
    });
  }

  private async insertRevision(
    client: PoolClient,
    specificationId: string,
    number: number,
    config: FieldConfig,
    limits: ReturnType<typeof canonicalLimits>,
    changeNote: string,
  ): Promise<Revision> {
    const id = uuidv7();
    const result = await client.query<Revision>(
      `insert into specification_revisions (id,project_id,specification_id,revision_number,quantity_dimension,canonical_unit,target_value,lower_limit,upper_limit,warning_lower_limit,warning_upper_limit,unit_registry_version,change_note,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id,specification_id,revision_number,quantity_dimension,canonical_unit,target_value,lower_limit,upper_limit,warning_lower_limit,warning_upper_limit`,
      [
        id,
        this.projectId,
        specificationId,
        number,
        config.dimension,
        config.canonicalUnit,
        limits.targetValue,
        limits.lowerLimit,
        limits.upperLimit,
        limits.warningLowerLimit,
        limits.warningUpperLimit,
        UNIT_REGISTRY_VERSION,
        changeNote.trim(),
        this.actor.actorId,
      ],
    );
    return result.rows[0]!;
  }
  private async evaluateAll(
    client: PoolClient,
    revision: Revision,
    fieldId: string,
    requestId: string,
  ) {
    const records = await client.query<{ id: string }>(
      `select r.id from records r join field_definitions f on f.object_type_id=r.object_type_id and f.project_id=r.project_id where r.project_id=$1 and f.id=$2 and r.archived_at is null`,
      [this.projectId, fieldId],
    );
    for (const record of records.rows) {
      const evaluation = await evaluate(
        client,
        this.projectId,
        revision,
        record.id,
        fieldId,
        await currentResult(client, this.projectId, record.id, fieldId),
      );
      await appendAudit(
        client,
        this.audit(
          'specification.evaluated',
          'specification_evaluation',
          String(evaluation.id),
          requestId,
          { recordId: record.id, status: evaluation.status },
        ),
      );
    }
  }
  private async getSpecificationFrom(client: PoolClient, id: string) {
    const spec = await client.query('select * from specifications where project_id=$1 and id=$2', [
      this.projectId,
      id,
    ]);
    const revisions = await client.query(
      'select * from specification_revisions where project_id=$1 and specification_id=$2 order by revision_number desc',
      [this.projectId, id],
    );
    return { ...spec.rows[0], revisions: revisions.rows };
  }
  async listSpecificationPage(input: {
    archiveState: 'active' | 'archived' | 'all';
    query: string;
    limit: number;
    offset: number;
  }) {
    const query = input.query.trim().toLowerCase();
    const parameters = [this.projectId, input.archiveState, query, input.limit, input.offset];
    const predicate = `s.project_id=$1
      and ($2='all' or s.status::text=$2)
      and ($3='' or position($3 in lower(concat_ws(' ',s.name,s.status::text,f.name,f.key)))>0)`;
    const [items, count] = await Promise.all([
      this.pool.query(
        `select s.*,coalesce(revisions.items,'[]') revisions
         from specifications s
         join field_definitions f on f.project_id=s.project_id and f.id=s.measurement_field_id
         left join lateral (
           select json_agg(sr order by sr.revision_number desc) items
           from specification_revisions sr
           where sr.project_id=s.project_id and sr.specification_id=s.id
         ) revisions on true
         where ${predicate}
         order by s.created_at desc,s.id desc limit $4 offset $5`,
        parameters,
      ),
      this.pool.query<{ total: number }>(
        `select count(*)::int total from specifications s
         join field_definitions f on f.project_id=s.project_id and f.id=s.measurement_field_id
         where ${predicate}`,
        parameters.slice(0, 3),
      ),
    ]);
    const total = Number(count.rows[0]?.total ?? 0);
    return {
      items: items.rows,
      pageInfo: {
        limit: input.limit,
        offset: input.offset,
        total,
        hasNext: input.offset + items.rows.length < total,
      },
    };
  }
  async listEvaluationPage(input: {
    recordId?: string | undefined;
    status: 'all' | EvaluationStatus;
    query: string;
    limit: number;
    offset: number;
  }) {
    const query = input.query.trim().toLowerCase();
    const parameters = [
      this.projectId,
      input.recordId ?? null,
      input.status,
      query,
      input.limit,
      input.offset,
    ];
    const predicate = `e.project_id=$1 and ($2::uuid is null or e.record_id=$2)
      and ($3='all' or e.status::text=$3)
      and ($4='' or position($4 in lower(concat_ws(' ',e.status::text,e.reason_code,
        e.record_id::text,e.measurement_field_id::text,coalesce(e.measurement_result_id::text,''))))>0)`;
    const [items, count] = await Promise.all([
      this.pool.query(
        `select e.* from specification_evaluations e where ${predicate}
         order by e.evaluated_at desc,e.id desc limit $5 offset $6`,
        parameters,
      ),
      this.pool.query<{ total: number }>(
        `select count(*)::int total from specification_evaluations e where ${predicate}`,
        parameters.slice(0, 4),
      ),
    ]);
    const total = Number(count.rows[0]?.total ?? 0);
    return {
      items: items.rows,
      pageInfo: {
        limit: input.limit,
        offset: input.offset,
        total,
        hasNext: input.offset + items.rows.length < total,
      },
    };
  }
  async retryEvaluation(input: {
    specificationRevisionId: string;
    recordId: string;
    measurementResultId?: string | undefined;
    requestId: string;
  }) {
    return tx(this.pool, async (client) => {
      const revisionResult = await client.query<Revision & { measurement_field_id: string }>(
        `select sr.id,sr.specification_id,sr.revision_number,sr.quantity_dimension,sr.canonical_unit,sr.target_value,sr.lower_limit,sr.upper_limit,sr.warning_lower_limit,sr.warning_upper_limit,s.measurement_field_id from specification_revisions sr join specifications s on s.id=sr.specification_id and s.project_id=sr.project_id join field_definitions f on f.id=s.measurement_field_id and f.project_id=s.project_id join records r on r.object_type_id=f.object_type_id and r.project_id=f.project_id where sr.project_id=$1 and sr.id=$2 and r.id=$3`,
        [this.projectId, input.specificationRevisionId, input.recordId],
      );
      const revision = revisionResult.rows[0];
      if (!revision)
        throw new RepositoryError(
          'EVALUATION_INPUT_NOT_FOUND',
          404,
          'Evaluation inputs were not found.',
        );
      let result: null | { id: string; canonical_value: string } = null;
      if (input.measurementResultId) {
        const found = await client.query<{ id: string; canonical_value: string }>(
          'select id,canonical_value from measurement_results where project_id=$1 and id=$2 and record_id=$3 and field_id=$4',
          [
            this.projectId,
            input.measurementResultId,
            input.recordId,
            revision.measurement_field_id,
          ],
        );
        if (!found.rows[0])
          throw new RepositoryError(
            'EVALUATION_INPUT_NOT_FOUND',
            404,
            'Measurement result was not found.',
          );
        result = found.rows[0];
      }
      const evaluation = await evaluate(
        client,
        this.projectId,
        revision,
        input.recordId,
        revision.measurement_field_id,
        result,
      );
      await appendAudit(
        client,
        this.audit(
          'specification.evaluation_retried',
          'specification_evaluation',
          String(evaluation.id),
          input.requestId,
          { inputFingerprint: evaluation.input_fingerprint },
        ),
      );
      return evaluation;
    });
  }
  async setSpecificationArchived(id: string, archived: boolean, reason: string, requestId: string) {
    return tx(this.pool, async (client) => {
      let result;
      try {
        result = await client.query(
          `update specifications set status=$3,archived_at=${archived ? 'now()' : 'null'},archived_by=${archived ? '$4' : 'null'},archive_reason=${archived ? '$5' : 'null'},updated_at=now() where project_id=$1 and id=$2 and status<>$3 returning *`,
          archived
            ? [this.projectId, id, 'archived', this.actor.actorId, reason.trim()]
            : [this.projectId, id, 'active'],
        );
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new RepositoryError(
            'ACTIVE_SPECIFICATION_EXISTS',
            409,
            'The measurement field already has an active specification.',
          );
        throw error;
      }
      if (!result.rowCount)
        throw new RepositoryError(
          'SPECIFICATION_STATE_CONFLICT',
          409,
          'Specification is already in the requested state.',
        );
      await appendAudit(
        client,
        this.audit(
          archived ? 'specification.archived' : 'specification.restored',
          'specification',
          id,
          requestId,
          { reason: archived ? reason.trim() : null },
        ),
      );
      return result.rows[0];
    });
  }
}
