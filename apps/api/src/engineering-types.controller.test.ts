import type * as DatabaseModule from '@engrove/database';
import { afterEach, describe, expect, it, vi } from 'vitest';

const community = vi.hoisted(() => ({
  requestId: vi.fn(() => 'request-1'),
  requireActor: vi.fn(async () => ({
    actorId: 'actor-1',
    organizationId: 'organization-1',
    role: 'owner',
  })),
}));
const database = vi.hoisted(() => ({
  open: vi.fn(),
  resolveProjectIdentifier: vi.fn(async () => 'project-1'),
  resolveWorkspaceIdentifier: vi.fn(async () => 'workspace-1'),
}));

vi.mock('./community.controller.js', () => community);
vi.mock('@engrove/database', async (importOriginal) => {
  const actual = await importOriginal<typeof DatabaseModule>();
  return {
    ...actual,
    resolveProjectIdentifier: database.resolveProjectIdentifier,
    resolveWorkspaceIdentifier: database.resolveWorkspaceIdentifier,
    ScopedEngineeringRepository: { open: database.open },
  };
});

import { EngineeringTypesController } from './engineering-types.controller.js';

afterEach(() => vi.clearAllMocks());

describe('EngineeringTypesController list contracts', () => {
  it('normalizes measurement history filters and paging', async () => {
    const listMeasurementPage = vi.fn(async (input) => ({ items: [], pageInfo: input }));
    database.open.mockResolvedValue({ listMeasurementPage });

    await new EngineeringTypesController({ pool: {} } as never).measurements(
      {} as never,
      'workspace-public-id',
      'project-public-id',
      '019fbcf9-e020-71da-935a-6a6a728b3790',
      {
        fieldId: '019fbcf9-e020-71da-935a-6a6a728b3791',
        currentState: 'superseded',
        query: ' mm ',
        limit: '25',
        offset: '50',
      },
    );

    expect(listMeasurementPage).toHaveBeenCalledWith({
      recordId: '019fbcf9-e020-71da-935a-6a6a728b3790',
      fieldId: '019fbcf9-e020-71da-935a-6a6a728b3791',
      currentState: 'superseded',
      query: 'mm',
      limit: 25,
      offset: 50,
    });
  });

  it('keeps includeArchived as a deprecated specification alias', async () => {
    const listSpecificationPage = vi.fn(async (input) => ({ items: [], pageInfo: input }));
    database.open.mockResolvedValue({ listSpecificationPage });

    await new EngineeringTypesController({ pool: {} } as never).specifications(
      {} as never,
      'workspace-public-id',
      'project-public-id',
      { includeArchived: 'true', query: ' force ', limit: '100', offset: '10' },
    );

    expect(listSpecificationPage).toHaveBeenCalledWith({
      archiveState: 'all',
      query: 'force',
      limit: 100,
      offset: 10,
    });
  });

  it('normalizes evaluation status, record, search, and paging', async () => {
    const listEvaluationPage = vi.fn(async (input) => ({ items: [], pageInfo: input }));
    database.open.mockResolvedValue({ listEvaluationPage });

    await new EngineeringTypesController({ pool: {} } as never).evaluations(
      {} as never,
      'workspace-public-id',
      'project-public-id',
      {
        recordId: '019fbcf9-e020-71da-935a-6a6a728b3790',
        status: 'fail',
        query: ' outside ',
        limit: '20',
        offset: '40',
      },
    );

    expect(listEvaluationPage).toHaveBeenCalledWith({
      recordId: '019fbcf9-e020-71da-935a-6a6a728b3790',
      status: 'fail',
      query: 'outside',
      limit: 20,
      offset: 40,
    });
  });
});
