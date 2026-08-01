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

  it('limits pilot feedback and adoption reporting to administrators', () => {
    expect(can(viewer, 'pilot.manage')).toBe(false);
    expect(can({ ...viewer, role: 'engineer' }, 'pilot.manage')).toBe(false);
    expect(can({ ...viewer, role: 'admin' }, 'pilot.manage')).toBe(true);
    expect(can({ ...viewer, role: 'owner' }, 'pilot.manage')).toBe(true);
  });
});
