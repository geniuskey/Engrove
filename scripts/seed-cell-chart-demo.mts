import {
  createPool,
  ScopedProjectRepository,
  type ActorSession,
} from '../packages/database/src/index.js';
import { readFileSync } from 'node:fs';

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
const seedKey = 'cell-chart-demo';

function rounded(value: number): number {
  return Number(value.toFixed(5));
}

function gaussian(x: number, center: number, width: number, height: number): number {
  return height * Math.exp(-Math.pow((x - center) / width, 2));
}

function stableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableJson(item)]),
    );
  return value;
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(stableJson(left)) === JSON.stringify(stableJson(right));
}

const wavelength = Array.from({ length: 51 }, (_, index) => 380 + index * 8);
const elapsedTime = Array.from({ length: 41 }, (_, index) => index * 0.25);

const samples = [
  {
    displayName: 'UV-Vis · Sample A',
    spectrum: {
      x: wavelength,
      series: [
        {
          name: 'r',
          values: wavelength.map((x) => rounded(5 + gaussian(x, 620, 72, 83))),
        },
        {
          name: 'g',
          values: wavelength.map((x) => rounded(4 + gaussian(x, 535, 64, 88))),
        },
        {
          name: 'b',
          values: wavelength.map((x) => rounded(3 + gaussian(x, 455, 55, 80))),
        },
      ],
    },
    xy: {
      columns: ['Time', 'Force'],
      rows: elapsedTime.map((time) => [time, rounded(8 + time * 4.6 + Math.sin(time * 1.7) * 2.2)]),
    },
  },
  {
    displayName: 'Fluorescence · Sample B',
    spectrum: {
      x: wavelength,
      series: [
        {
          name: 'r',
          values: wavelength.map((x) => rounded(4 + gaussian(x, 635, 78, 76))),
        },
        {
          name: 'g',
          values: wavelength.map((x) => rounded(5 + gaussian(x, 545, 70, 84))),
        },
        {
          name: 'b',
          values: wavelength.map((x) => rounded(6 + gaussian(x, 465, 60, 86))),
        },
      ],
    },
    xy: {
      columns: ['Displacement', 'Load'],
      rows: Array.from({ length: 45 }, (_, index) => {
        const displacement = index * 0.1;
        return [
          rounded(displacement),
          rounded(3.2 * displacement + 0.52 * displacement ** 2 + Math.sin(index / 3) * 0.35),
        ];
      }),
    },
  },
  {
    displayName: 'Cyclic response · Sample C',
    spectrum: {
      x: wavelength,
      series: [
        {
          name: 'r',
          values: wavelength.map((x) => rounded(7 + gaussian(x, 610, 82, 70))),
        },
        {
          name: 'g',
          values: wavelength.map((x) => rounded(6 + gaussian(x, 525, 74, 78))),
        },
        {
          name: 'b',
          values: wavelength.map((x) => rounded(5 + gaussian(x, 445, 64, 72))),
        },
      ],
    },
    xy: {
      columns: ['Time', 'Temperature'],
      rows: Array.from({ length: 61 }, (_, index) => {
        const time = index * 0.5;
        return [time, rounded(24 + 38 * (1 - Math.exp(-time / 7)) + Math.sin(time) * 0.8)];
      }),
    },
  },
];

function rtaSeries(
  reflectance: (wavelength: number) => number,
  transmittance: (wavelength: number) => number,
) {
  const reflectanceValues = wavelength.map((x) => Math.max(0, Math.min(100, reflectance(x))));
  const transmittanceValues = wavelength.map((x, index) =>
    Math.max(0, Math.min(100 - reflectanceValues[index]!, transmittance(x))),
  );
  return {
    x: wavelength,
    series: [
      { name: 'Reflectance', values: reflectanceValues.map(rounded) },
      { name: 'Transmittance', values: transmittanceValues.map(rounded) },
      {
        name: 'Absorptance',
        values: reflectanceValues.map((value, index) =>
          rounded(100 - value - transmittanceValues[index]!),
        ),
      },
    ],
  };
}

const materialSamples = [
  {
    displayName: 'Low-iron glass · 3 mm',
    rta: rtaSeries(
      (x) => 7.2 + Math.sin(x / 62) * 0.8,
      (x) => 89 - gaussian(x, 390, 38, 13) - gaussian(x, 760, 80, 2.5),
    ),
  },
  {
    displayName: 'AR-coated polymer film',
    rta: rtaSeries(
      (x) => 2.2 + gaussian(x, 410, 45, 2.6) + gaussian(x, 740, 70, 1.4),
      (x) => 94 - gaussian(x, 395, 42, 10) - Math.sin(x / 75) * 0.7,
    ),
  },
  {
    displayName: 'Anodized aluminum',
    rta: rtaSeries(
      (x) => 82 + gaussian(x, 690, 145, 9) - gaussian(x, 420, 48, 8),
      (x) => 0.15 + gaussian(x, 520, 90, 0.12),
    ),
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
  const repository = await ScopedProjectRepository.open(
    pool,
    actor,
    row.workspace_id,
    row.project_id,
  );
  const existingObjectTypes = await repository.listObjectTypes();
  const objectType =
    existingObjectTypes.find((candidate) => candidate.key === 'signal-preview') ??
    (await repository.createObjectType({
      name: 'Signal Preview',
      pluralName: 'Signal Previews',
      key: 'signal-preview',
      icon: 'waveform',
      description: 'Mini chart rendering samples for spectral and two-column XY cell data.',
      requestId: `${seedKey}:table`,
    }));

  const existingFields = await repository.listFields(objectType.id);
  let spectrumField =
    existingFields.find((candidate) => candidate.key === 'spectrum') ??
    (await repository.createField({
      objectTypeId: objectType.id,
      name: 'QE',
      key: 'spectrum',
      description: 'RGB quantum-efficiency curves rendered with semantic series colors.',
      fieldType: 'spectral_data',
      position: 0,
      config: {
        xLabel: 'Wavelength',
        xUnit: 'nm',
        yLabel: 'QE',
        yUnit: '%',
      },
      requestId: `${seedKey}:spectrum-field`,
    }));
  const qeConfig = {
    xLabel: 'Wavelength',
    xUnit: 'nm',
    yLabel: 'QE',
    yUnit: '%',
  };
  if (
    spectrumField.name !== 'QE' ||
    spectrumField.description !==
      'RGB quantum-efficiency curves rendered with semantic series colors.' ||
    !jsonEqual(spectrumField.config, qeConfig)
  ) {
    spectrumField = await repository.updateField({
      objectTypeId: objectType.id,
      fieldId: spectrumField.id,
      name: 'QE',
      description: 'RGB quantum-efficiency curves rendered with semantic series colors.',
      required: spectrumField.required,
      unique: spectrumField.unique,
      position: spectrumField.position,
      config: qeConfig,
      requestId: `${seedKey}:qe-field-update`,
    });
  }
  const xyField =
    existingFields.find((candidate) => candidate.key === 'xy-response') ??
    (await repository.createField({
      objectTypeId: objectType.id,
      name: 'XY Response',
      key: 'xy-response',
      description: 'Numeric two-column data automatically rendered as an inline chart.',
      fieldType: 'tabular_data',
      position: 1,
      config: { firstRowHeader: true },
      requestId: `${seedKey}:xy-field`,
    }));

  const existingRecords = await repository.queryRecords(objectType.id, {
    pageSize: 100,
    includeArchived: true,
  });
  let created = 0;
  let updated = 0;
  for (const sample of samples) {
    const existing = existingRecords.items.find(
      (candidate) => candidate.displayName === sample.displayName,
    );
    const desiredValues = {
      ...(existing?.values ?? {}),
      [spectrumField.key]: sample.spectrum,
      [xyField.key]: sample.xy,
    };
    if (!existing) {
      await repository.createRecord({
        objectTypeId: objectType.id,
        displayName: sample.displayName,
        values: desiredValues,
        requestId: `${seedKey}:qe-record:${created + 1}`,
      });
      created += 1;
    } else if (
      !jsonEqual(existing.values[spectrumField.key], sample.spectrum) ||
      !jsonEqual(existing.values[xyField.key], sample.xy)
    ) {
      await repository.updateRecord({
        objectTypeId: objectType.id,
        recordId: existing.id,
        contextProjectId: existing.contextProjectId,
        displayName: existing.displayName,
        values: desiredValues,
        relations: existing.relations,
        fileReferences: existing.fileReferences,
        datasetReferences: existing.datasetReferences,
        rowVersion: existing.rowVersion,
        requestId: `${seedKey}:qe-record-update:${updated + 1}`,
      });
      updated += 1;
    }
  }

  const rtaObjectType =
    existingObjectTypes.find((candidate) => candidate.key === 'material-rta') ??
    (await repository.createObjectType({
      name: 'Material RTA',
      pluralName: 'Material RTA',
      key: 'material-rta',
      icon: 'layers',
      description: 'Wavelength-dependent reflectance, transmittance, and absorptance by material.',
      requestId: `${seedKey}:rta-table`,
    }));
  const rtaFields = await repository.listFields(rtaObjectType.id);
  const rtaField =
    rtaFields.find((candidate) => candidate.key === 'rta') ??
    (await repository.createField({
      objectTypeId: rtaObjectType.id,
      name: 'RTA',
      key: 'rta',
      description: 'Reflectance, transmittance, and absorptance; R + T + A = 100%.',
      fieldType: 'spectral_data',
      position: 0,
      config: {
        xLabel: 'Wavelength',
        xUnit: 'nm',
        yLabel: 'R / T / A',
        yUnit: '%',
      },
      requestId: `${seedKey}:rta-field`,
    }));
  const existingRtaRecords = await repository.queryRecords(rtaObjectType.id, {
    pageSize: 100,
    includeArchived: true,
  });
  let rtaCreated = 0;
  let rtaUpdated = 0;
  for (const sample of materialSamples) {
    const existing = existingRtaRecords.items.find(
      (candidate) => candidate.displayName === sample.displayName,
    );
    const desiredValues = { ...(existing?.values ?? {}), [rtaField.key]: sample.rta };
    if (!existing) {
      await repository.createRecord({
        objectTypeId: rtaObjectType.id,
        displayName: sample.displayName,
        values: desiredValues,
        requestId: `${seedKey}:rta-record:${rtaCreated + 1}`,
      });
      rtaCreated += 1;
    } else if (!jsonEqual(existing.values[rtaField.key], sample.rta)) {
      await repository.updateRecord({
        objectTypeId: rtaObjectType.id,
        recordId: existing.id,
        contextProjectId: existing.contextProjectId,
        displayName: existing.displayName,
        values: desiredValues,
        relations: existing.relations,
        fileReferences: existing.fileReferences,
        datasetReferences: existing.datasetReferences,
        rowVersion: existing.rowVersion,
        requestId: `${seedKey}:rta-record-update:${rtaUpdated + 1}`,
      });
      rtaUpdated += 1;
    }
  }

  console.log(
    JSON.stringify({
      workspacePublicId,
      projectPublicId,
      objectTypePublicId: objectType.publicId,
      table: objectType.name,
      recordsCreated: created,
      recordsUpdated: updated,
      recordsAvailable: samples.length,
      rtaObjectTypePublicId: rtaObjectType.publicId,
      rtaTable: rtaObjectType.name,
      rtaRecordsCreated: rtaCreated,
      rtaRecordsUpdated: rtaUpdated,
      rtaRecordsAvailable: materialSamples.length,
    }),
  );
} finally {
  await pool.end();
}
