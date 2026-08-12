export const roles = ['owner', 'admin', 'engineer', 'contributor', 'reviewer', 'viewer'] as const;
export type Role = (typeof roles)[number];

export const actions = [
  'workspace.read',
  'workspace.manage',
  'workspace.access.manage',
  'project.create',
  'project.read',
  'project.update',
  'project.archive',
  'project.restore',
  'project.access.manage',
  'schema.read',
  'schema.manage',
  'table.permission.manage',
  'view.manage',
  'view.share',
  'record.create',
  'record.comment',
  'record.read',
  'record.update',
  'record.archive',
  'record.restore',
  'review.read',
  'review.create',
  'review.resolve',
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
  'milestone.read',
  'milestone.manage',
  'webhook.manage',
  'task.create',
  'task.comment',
  'task.worklog',
  'task.read',
  'task.personalize',
  'task.workflow.manage',
  'task.automation.manage',
  'task.watch',
  'task.update',
  'task.archive',
  'task.restore',
  'member.manage',
  'notification.read',
  'audit.read',
  'pilot.manage',
  'export.execute',
] as const;
export type Action = (typeof actions)[number];

const readActions: Action[] = [
  ...actions.filter((action) => action.endsWith('.read')),
  'task.personalize',
  'task.watch',
];
const contributorActions: Action[] = [
  ...readActions,
  'view.manage',
  'record.create',
  'record.comment',
  'record.update',
  'review.create',
  'review.resolve',
  'file.upload',
  'dataset.upload',
  'measurement.create',
  'task.create',
  'task.comment',
  'task.worklog',
  'task.update',
  'export.execute',
];
const engineerActions: Action[] = [
  ...contributorActions,
  'project.create',
  'project.update',
  'schema.manage',
  'view.share',
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
  'milestone.manage',
  'webhook.manage',
  'task.automation.manage',
  'task.archive',
  'task.restore',
];
const reviewerActions: Action[] = [
  ...readActions,
  'record.comment',
  'review.create',
  'review.resolve',
  'task.comment',
];

const grants: Record<Role, ReadonlySet<Action>> = {
  owner: new Set(actions),
  admin: new Set(actions),
  engineer: new Set(engineerActions),
  contributor: new Set(contributorActions),
  reviewer: new Set(reviewerActions),
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
