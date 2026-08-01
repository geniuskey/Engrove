export const roles = ['owner', 'admin', 'engineer', 'contributor', 'viewer'] as const;
export type Role = (typeof roles)[number];

export const actions = [
  'workspace.read',
  'workspace.manage',
  'project.create',
  'project.read',
  'project.update',
  'project.archive',
  'project.restore',
  'schema.read',
  'schema.manage',
  'record.create',
  'record.read',
  'record.update',
  'record.archive',
  'record.restore',
  'file.upload',
  'file.read',
  'file.archive',
  'file.restore',
  'dataset.upload',
  'dataset.read',
  'dataset.archive',
  'dataset.restore',
  'job.read',
  'job.retry',
  'storage.cleanup',
  'measurement.create',
  'measurement.correct',
  'measurement.read',
  'specification.read',
  'specification.manage',
  'dashboard.manage',
  'task.create',
  'task.read',
  'task.update',
  'task.archive',
  'task.restore',
  'member.manage',
  'audit.read',
  'pilot.manage',
  'export.execute',
] as const;
export type Action = (typeof actions)[number];

const readActions = actions.filter((action) => action.endsWith('.read'));
const contributorActions: Action[] = [
  ...readActions,
  'record.create',
  'record.update',
  'file.upload',
  'dataset.upload',
  'measurement.create',
  'task.create',
  'task.update',
  'export.execute',
];
const engineerActions: Action[] = [
  ...contributorActions,
  'project.create',
  'project.update',
  'schema.manage',
  'record.archive',
  'record.restore',
  'file.archive',
  'file.restore',
  'dataset.archive',
  'dataset.restore',
  'job.retry',
  'measurement.correct',
  'specification.manage',
  'dashboard.manage',
  'task.archive',
  'task.restore',
];

const grants: Record<Role, ReadonlySet<Action>> = {
  owner: new Set(actions),
  admin: new Set(actions),
  engineer: new Set(engineerActions),
  contributor: new Set(contributorActions),
  viewer: new Set(readActions),
};

export interface PermissionContext {
  actorId: string;
  organizationId: string;
  workspaceId?: string;
  projectId?: string;
  role: Role;
}

export function can(context: PermissionContext, action: Action): boolean {
  return grants[context.role].has(action);
}

export function assertPermission(context: PermissionContext, action: Action): void {
  if (!can(context, action)) throw new PermissionDeniedError(action);
}

export class PermissionDeniedError extends Error {
  readonly code = 'PERMISSION_DENIED';

  constructor(readonly action: Action) {
    super(`Permission required: ${action}`);
  }
}
