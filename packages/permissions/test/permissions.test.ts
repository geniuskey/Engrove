import { describe, expect, it } from 'vitest';
import { can, type PermissionContext } from '../src/index.js';

const viewer: PermissionContext = {
  actorId: 'actor',
  organizationId: 'organization',
  role: 'viewer',
};

describe('role grants', () => {
  it('lets viewers read projects but never update them', () => {
    expect(can(viewer, 'project.read')).toBe(true);
    expect(can(viewer, 'project.update')).toBe(false);
  });

  it('reserves member and audit management for administrators', () => {
    expect(can(viewer, 'member.manage')).toBe(false);
    expect(can({ ...viewer, role: 'admin' }, 'member.manage')).toBe(true);
    expect(can({ ...viewer, role: 'admin' }, 'audit.read')).toBe(true);
  });

  it('reserves table permission policy management for administrators', () => {
    expect(can(viewer, 'table.permission.manage')).toBe(false);
    expect(can({ ...viewer, role: 'contributor' }, 'table.permission.manage')).toBe(false);
    expect(can({ ...viewer, role: 'engineer' }, 'table.permission.manage')).toBe(false);
    expect(can({ ...viewer, role: 'admin' }, 'table.permission.manage')).toBe(true);
    expect(can({ ...viewer, role: 'owner' }, 'table.permission.manage')).toBe(true);
  });

  it('reserves workspace and project access policy management for administrators', () => {
    for (const role of ['viewer', 'reviewer', 'contributor', 'engineer'] as const) {
      expect(can({ ...viewer, role }, 'workspace.access.manage')).toBe(false);
      expect(can({ ...viewer, role }, 'project.access.manage')).toBe(false);
    }
    for (const role of ['admin', 'owner'] as const) {
      expect(can({ ...viewer, role }, 'workspace.access.manage')).toBe(true);
      expect(can({ ...viewer, role }, 'project.access.manage')).toBe(true);
    }
  });

  it('limits pilot feedback and adoption reporting to administrators', () => {
    expect(can(viewer, 'pilot.manage')).toBe(false);
    expect(can({ ...viewer, role: 'engineer' }, 'pilot.manage')).toBe(false);
    expect(can({ ...viewer, role: 'admin' }, 'pilot.manage')).toBe(true);
    expect(can({ ...viewer, role: 'owner' }, 'pilot.manage')).toBe(true);
  });

  it('lets viewers read reviews while contributors can participate and decide', () => {
    expect(can(viewer, 'review.read')).toBe(true);
    expect(can(viewer, 'review.create')).toBe(false);
    expect(can({ ...viewer, role: 'contributor' }, 'review.create')).toBe(true);
    expect(can({ ...viewer, role: 'contributor' }, 'review.resolve')).toBe(true);
    expect(can({ ...viewer, role: 'reviewer' }, 'record.read')).toBe(true);
    expect(can({ ...viewer, role: 'reviewer' }, 'review.create')).toBe(true);
    expect(can({ ...viewer, role: 'reviewer' }, 'record.update')).toBe(false);
  });

  it('lets record editors manage views without granting schema control', () => {
    expect(can(viewer, 'view.manage')).toBe(false);
    expect(can({ ...viewer, role: 'reviewer' }, 'view.manage')).toBe(false);
    expect(can({ ...viewer, role: 'contributor' }, 'view.manage')).toBe(true);
    expect(can({ ...viewer, role: 'contributor' }, 'schema.manage')).toBe(false);
    expect(can({ ...viewer, role: 'engineer' }, 'view.manage')).toBe(true);
    expect(can({ ...viewer, role: 'contributor' }, 'view.share')).toBe(false);
    expect(can({ ...viewer, role: 'engineer' }, 'view.share')).toBe(true);
  });

  it('keeps comments collaborative while treating watches and notifications as personal state', () => {
    expect(can(viewer, 'record.comment')).toBe(false);
    expect(can(viewer, 'task.comment')).toBe(false);
    expect(can(viewer, 'task.watch')).toBe(true);
    expect(can(viewer, 'task.personalize')).toBe(true);
    expect(can(viewer, 'notification.read')).toBe(true);
    expect(can({ ...viewer, role: 'reviewer' }, 'task.comment')).toBe(true);
    expect(can({ ...viewer, role: 'reviewer' }, 'record.comment')).toBe(true);
    expect(can({ ...viewer, role: 'contributor' }, 'record.comment')).toBe(true);
    expect(can({ ...viewer, role: 'contributor' }, 'task.comment')).toBe(true);
    expect(can(viewer, 'task.automation.manage')).toBe(false);
    expect(can({ ...viewer, role: 'engineer' }, 'task.automation.manage')).toBe(true);
  });

  it('lets task editors log work without granting time changes to review-only roles', () => {
    expect(can(viewer, 'task.worklog')).toBe(false);
    expect(can({ ...viewer, role: 'reviewer' }, 'task.worklog')).toBe(false);
    expect(can({ ...viewer, role: 'contributor' }, 'task.worklog')).toBe(true);
    expect(can({ ...viewer, role: 'engineer' }, 'task.worklog')).toBe(true);
    expect(can({ ...viewer, role: 'admin' }, 'task.worklog')).toBe(true);
    expect(can({ ...viewer, role: 'owner' }, 'task.worklog')).toBe(true);
  });
});
