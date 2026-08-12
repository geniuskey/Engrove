import { sql } from 'drizzle-orm';
import {
  boolean,
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const auditColumns = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const memberRole = pgEnum('member_role', [
  'owner',
  'admin',
  'engineer',
  'contributor',
  'reviewer',
  'viewer',
]);
export const tablePermissionMode = pgEnum('table_permission_mode', [
  'everyone',
  'editors',
  'engineers',
  'administrators',
  'specific',
  'nobody',
]);
export const tablePermissionAction = pgEnum('table_permission_action', [
  'visibility',
  'create',
  'update',
  'archive',
]);
export const securityTokenType = pgEnum('security_token_type', ['invitation', 'password_reset']);
export const fieldType = pgEnum('field_type', [
  'text',
  'long_text',
  'integer',
  'decimal',
  'boolean',
  'date',
  'datetime',
  'single_select',
  'multi_select',
  'user',
  'relation',
  'quantity',
  'measurement',
  'range',
  'spectral_data',
  'tabular_data',
  'formula',
  'lookup',
  'rollup',
  'file',
  'dataset',
]);
export const recordValueKind = pgEnum('record_value_kind', [
  'text',
  'numeric',
  'boolean',
  'date',
  'datetime',
  'uuid',
]);
export const projectionStatus = pgEnum('projection_status', ['ready', 'rebuilding', 'failed']);
export const specificationStatus = pgEnum('specification_status', ['active', 'archived']);
export const evaluationStatus = pgEnum('evaluation_status', ['pass', 'warning', 'fail', 'missing']);
export const fileStatus = pgEnum('file_status', [
  'pending_upload',
  'verifying',
  'available',
  'failed',
]);
export const uploadStatus = pgEnum('upload_status', [
  'issued',
  'verifying',
  'finalized',
  'expired',
  'failed',
]);
export const datasetType = pgEnum('dataset_type', ['tabular', 'xy']);
export const datasetStatus = pgEnum('dataset_status', ['pending', 'processing', 'ready', 'failed']);
export const jobStatus = pgEnum('job_status', ['queued', 'running', 'succeeded', 'failed']);
export const attemptStatus = pgEnum('attempt_status', ['running', 'succeeded', 'failed']);
export const taskPriority = pgEnum('task_priority', ['low', 'medium', 'high', 'critical']);
export const taskFilterVisibility = pgEnum('task_filter_visibility', ['personal', 'project']);
export const taskVisibility = pgEnum('task_visibility', ['project', 'restricted']);
export const workspaceVisibility = pgEnum('workspace_visibility', ['organization', 'restricted']);
export const projectVisibility = pgEnum('project_visibility', ['workspace', 'restricted']);
export const milestoneStatus = pgEnum('milestone_status', [
  'planned',
  'active',
  'at_risk',
  'completed',
]);

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  singleton: boolean('singleton').notNull().default(true).unique(),
  ...auditColumns,
});

export const installationSetup = pgTable(
  'installation_setup',
  {
    singleton: boolean('singleton').primaryKey().default(true),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    setupTokenHash: text('setup_token_hash'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [check('installation_setup_singleton', sql`${table.singleton} = true`)],
);

export const maintenanceState = pgTable(
  'maintenance_state',
  {
    singleton: boolean('singleton').primaryKey().default(true),
    mode: text('mode').notNull(),
    leaseOwner: text('lease_owner').notNull(),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('maintenance_state_singleton', sql`${table.singleton} = true`),
    check('maintenance_state_mode', sql`${table.mode} in ('backup','restore')`),
  ],
);

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  ...auditColumns,
});

export const oidcIdentities = pgTable(
  'oidc_identities',
  {
    id: uuid('id').primaryKey(),
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex('oidc_identities_issuer_subject_key').on(table.issuer, table.subject),
    index('oidc_identities_user_idx').on(table.userId),
    check(
      'oidc_identities_issuer_subject_length_check',
      sql`length(${table.issuer}) between 1 and 2048 and length(${table.subject}) between 1 and 255`,
    ),
  ],
);

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    role: memberRole('role').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex('memberships_organization_user_key').on(table.organizationId, table.userId),
  ],
);

export const memberGroups = pgTable(
  'member_groups',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    color: text('color').notNull().default('sky'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedBy: uuid('archived_by').references(() => users.id, { onDelete: 'restrict' }),
    ...auditColumns,
  },
  (table) => [
    unique('member_groups_organization_id_key').on(table.organizationId, table.id),
    uniqueIndex('member_groups_active_organization_name_key')
      .on(table.organizationId, sql`lower(${table.name})`)
      .where(sql`${table.archivedAt} is null`),
    index('member_groups_organization_idx').on(table.organizationId, table.name, table.id),
    check(
      'member_groups_color_check',
      sql`${table.color} in ('slate', 'sky', 'emerald', 'amber', 'rose', 'violet')`,
    ),
  ],
);

export const memberGroupMemberships = pgTable(
  'member_group_memberships',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    groupId: uuid('group_id').notNull(),
    userId: uuid('user_id').notNull(),
    assignedBy: uuid('assigned_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.groupId],
      foreignColumns: [memberGroups.organizationId, memberGroups.id],
      name: 'member_group_memberships_organization_group_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [memberships.organizationId, memberships.userId],
      name: 'member_group_memberships_organization_user_fk',
    }).onDelete('cascade'),
    uniqueIndex('member_group_memberships_group_user_key').on(table.groupId, table.userId),
    index('member_group_memberships_organization_user_idx').on(table.organizationId, table.userId),
  ],
);

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').primaryKey(),
    publicId: text('public_id').notNull(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description').notNull().default(''),
    visibility: workspaceVisibility('visibility').notNull().default('organization'),
    accessVersion: integer('access_version').notNull().default(1),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedBy: uuid('archived_by').references(() => users.id, { onDelete: 'restrict' }),
    archiveReason: text('archive_reason'),
    ...auditColumns,
  },
  (table) => [
    unique('workspaces_organization_id_key').on(table.organizationId, table.id),
    uniqueIndex('workspaces_public_id_key').on(table.publicId),
    uniqueIndex('workspaces_organization_slug_key').on(table.organizationId, table.slug),
    index('workspaces_organization_idx').on(table.organizationId),
    check('workspaces_public_id_check', sql`${table.publicId} ~ '^w[0-9a-z]{14}$'`),
  ],
);

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey(),
    publicId: text('public_id').notNull(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    key: text('key').notNull(),
    description: text('description').notNull().default(''),
    status: text('status').notNull().default('active'),
    visibility: projectVisibility('visibility').notNull().default('workspace'),
    accessVersion: integer('access_version').notNull().default(1),
    system: boolean('system').notNull().default(false),
    rowVersion: integer('row_version').notNull().default(1),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedBy: uuid('archived_by').references(() => users.id, { onDelete: 'restrict' }),
    archiveReason: text('archive_reason'),
    ...auditColumns,
  },
  (table) => [
    unique('projects_workspace_id_key').on(table.workspaceId, table.id),
    uniqueIndex('projects_public_id_key').on(table.publicId),
    uniqueIndex('projects_workspace_key_key').on(table.workspaceId, table.key),
    uniqueIndex('projects_workspace_system_key')
      .on(table.workspaceId)
      .where(sql`${table.system} = true`),
    index('projects_workspace_idx').on(table.workspaceId),
    check('projects_public_id_check', sql`${table.publicId} ~ '^p[0-9a-z]{14}$'`),
    check('projects_status_check', sql`${table.status} in ('active', 'on_hold', 'completed')`),
  ],
);

export const workspaceAccessSubjects = pgTable(
  'workspace_access_subjects',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.workspaceId],
      foreignColumns: [workspaces.organizationId, workspaces.id],
      name: 'workspace_access_subjects_organization_workspace_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.groupId],
      foreignColumns: [memberGroups.organizationId, memberGroups.id],
      name: 'workspace_access_subjects_organization_group_fk',
    }).onDelete('cascade'),
    uniqueIndex('workspace_access_subjects_user_key')
      .on(table.workspaceId, table.userId)
      .where(sql`${table.userId} is not null`),
    uniqueIndex('workspace_access_subjects_group_key')
      .on(table.workspaceId, table.groupId)
      .where(sql`${table.groupId} is not null`),
    index('workspace_access_subjects_workspace_idx').on(table.workspaceId),
    check(
      'workspace_access_subjects_exactly_one_subject_check',
      sql`(${table.userId} is null) <> (${table.groupId} is null)`,
    ),
  ],
);

export const projectAccessSubjects = pgTable(
  'project_access_subjects',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.workspaceId],
      foreignColumns: [workspaces.organizationId, workspaces.id],
      name: 'project_access_subjects_organization_workspace_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
      name: 'project_access_subjects_workspace_project_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.groupId],
      foreignColumns: [memberGroups.organizationId, memberGroups.id],
      name: 'project_access_subjects_organization_group_fk',
    }).onDelete('cascade'),
    uniqueIndex('project_access_subjects_user_key')
      .on(table.projectId, table.userId)
      .where(sql`${table.userId} is not null`),
    uniqueIndex('project_access_subjects_group_key')
      .on(table.projectId, table.groupId)
      .where(sql`${table.groupId} is not null`),
    index('project_access_subjects_project_idx').on(table.projectId),
    check(
      'project_access_subjects_exactly_one_subject_check',
      sql`(${table.userId} is null) <> (${table.groupId} is null)`,
    ),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    tokenHash: text('token_hash').notNull().unique(),
    csrfTokenHash: text('csrf_token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    idleExpiresAt: timestamp('idle_expires_at', { withTimezone: true }).notNull(),
    absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true }).notNull(),
    rotatedFromSessionId: uuid('rotated_from_session_id'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
  },
  (table) => [
    index('sessions_user_idx').on(table.userId),
    index('sessions_expiry_idx').on(table.idleExpiresAt),
  ],
);

export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    tokenPrefix: text('token_prefix').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    accessLevel: text('access_level').notNull(),
    scopes: text('scopes').array(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
  },
  (table) => [
    uniqueIndex('api_tokens_active_user_name_key')
      .on(table.userId, sql`lower(${table.name})`)
      .where(sql`${table.revokedAt} is null`),
    index('api_tokens_user_created_idx').on(table.userId, table.createdAt),
    index('api_tokens_expiry_idx').on(table.expiresAt),
    check('api_tokens_access_level_check', sql`${table.accessLevel} in ('read', 'write')`),
    check(
      'api_tokens_scopes_check',
      sql`${table.scopes} is null or (
        cardinality(${table.scopes}) between 1 and 6 and
        ${table.scopes} <@ array['workspace','project','data','tasks','schedule','reviews']::text[]
      )`,
    ),
  ],
);

export const securityTokens = pgTable(
  'security_tokens',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    type: securityTokenType('type').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    subjectEmail: text('subject_email'),
    subjectUserId: uuid('subject_user_id').references(() => users.id, { onDelete: 'restrict' }),
    role: memberRole('role'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [index('security_tokens_expiry_idx').on(table.expiresAt)],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'restrict' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'restrict' }),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id'),
    requestId: text('request_id').notNull(),
    payload: jsonb('payload').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_events_organization_created_idx').on(table.organizationId, table.createdAt),
    index('audit_events_project_created_idx').on(table.projectId, table.createdAt),
    index('audit_events_project_target_created_idx').on(
      table.projectId,
      table.targetType,
      table.targetId,
      table.createdAt,
      table.id,
    ),
  ],
);

export const objectTypes = pgTable(
  'object_types',
  {
    id: uuid('id').primaryKey(),
    publicId: text('public_id').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    pluralName: text('plural_name').notNull(),
    key: text('key').notNull(),
    icon: text('icon').notNull().default('table'),
    description: text('description').notNull().default(''),
    system: boolean('system').notNull().default(false),
    visibilityMode: tablePermissionMode('visibility_mode').notNull().default('everyone'),
    createMode: tablePermissionMode('create_mode').notNull().default('editors'),
    updateMode: tablePermissionMode('update_mode').notNull().default('editors'),
    archiveMode: tablePermissionMode('archive_mode').notNull().default('editors'),
    permissionRowVersion: integer('permission_row_version').notNull().default(1),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex('object_types_public_id_key').on(table.publicId),
    uniqueIndex('object_types_project_key_key').on(table.projectId, table.key),
    uniqueIndex('object_types_project_id_key').on(table.projectId, table.id),
    index('object_types_project_idx').on(table.projectId),
    check('object_types_public_id_check', sql`${table.publicId} ~ '^t[0-9a-z]{14}$'`),
    check('object_types_permission_row_version_check', sql`${table.permissionRowVersion} > 0`),
  ],
);

export const objectTypePermissionSubjects = pgTable(
  'object_type_permission_subjects',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').notNull(),
    objectTypeId: uuid('object_type_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    action: tablePermissionAction('action').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.objectTypeId],
      foreignColumns: [objectTypes.projectId, objectTypes.id],
      name: 'object_type_permission_subjects_project_object_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.groupId],
      foreignColumns: [memberGroups.organizationId, memberGroups.id],
      name: 'object_type_permission_subjects_organization_group_fk',
    }).onDelete('cascade'),
    uniqueIndex('object_type_permission_subjects_user_key')
      .on(table.objectTypeId, table.action, table.userId)
      .where(sql`${table.userId} is not null`),
    uniqueIndex('object_type_permission_subjects_group_key')
      .on(table.objectTypeId, table.action, table.groupId)
      .where(sql`${table.groupId} is not null`),
    index('object_type_permission_subjects_object_action_idx').on(table.objectTypeId, table.action),
    check(
      'object_type_permission_subjects_exactly_one_subject_check',
      sql`(${table.userId} is null) <> (${table.groupId} is null)`,
    ),
  ],
);

export const fieldDefinitions = pgTable(
  'field_definitions',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').notNull(),
    objectTypeId: uuid('object_type_id').notNull(),
    name: text('name').notNull(),
    key: text('key').notNull(),
    description: text('description').notNull().default(''),
    fieldType: fieldType('field_type').notNull(),
    required: boolean('required').notNull().default(false),
    unique: boolean('unique').notNull().default(false),
    position: integer('position').notNull().default(0),
    config: jsonb('config').notNull().default({}),
    defaultValue: jsonb('default_value'),
    system: boolean('system').notNull().default(false),
    projectionStatus: projectionStatus('projection_status').notNull().default('ready'),
    projectionVersion: integer('projection_version').notNull().default(1),
    ...auditColumns,
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.objectTypeId],
      foreignColumns: [objectTypes.projectId, objectTypes.id],
      name: 'field_definitions_project_object_type_fk',
    }).onDelete('restrict'),
    uniqueIndex('field_definitions_object_key_key').on(table.objectTypeId, table.key),
    uniqueIndex('field_definitions_project_id_key').on(table.projectId, table.id),
    index('field_definitions_object_order_idx').on(table.objectTypeId, table.position, table.id),
    check(
      'field_definitions_unique_type_check',
      sql`not ${table.unique} or ${table.fieldType} in ('text', 'long_text', 'integer', 'decimal', 'date', 'datetime', 'single_select', 'user', 'quantity')`,
    ),
  ],
);

export const recordViews = pgTable(
  'record_views',
  {
    id: uuid('id').primaryKey(),
    publicId: text('public_id').notNull(),
    projectId: uuid('project_id').notNull(),
    objectTypeId: uuid('object_type_id').notNull(),
    name: text('name').notNull(),
    viewType: text('view_type').notNull().default('grid'),
    permissionType: text('permission_type').notNull().default('collaborative'),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'restrict' }),
    lockReason: text('lock_reason'),
    config: jsonb('config').notNull().default({}),
    rowVersion: integer('row_version').notNull().default(1),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedBy: uuid('archived_by').references(() => users.id, { onDelete: 'restrict' }),
    archiveReason: text('archive_reason'),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex('record_views_public_id_key').on(table.publicId),
    foreignKey({
      columns: [table.projectId, table.objectTypeId],
      foreignColumns: [objectTypes.projectId, objectTypes.id],
      name: 'record_views_project_object_type_fk',
    }).onDelete('restrict'),
    uniqueIndex('record_views_active_object_name_key')
      .on(table.objectTypeId, sql`lower(${table.name})`)
      .where(sql`${table.archivedAt} is null`),
    uniqueIndex('record_views_project_id_key').on(table.projectId, table.id),
    index('record_views_object_updated_idx').on(table.objectTypeId, table.updatedAt, table.id),
    index('record_views_owner_idx').on(table.ownerId, table.objectTypeId, table.id),
    check(
      'record_views_type_check',
      sql`${table.viewType} in ('grid', 'form', 'gallery', 'kanban', 'calendar')`,
    ),
    check('record_views_public_id_check', sql`${table.publicId} ~ '^v[0-9a-z]{14}$'`),
    check('record_views_row_version_check', sql`${table.rowVersion} > 0`),
    check(
      'record_views_permission_type_check',
      sql`${table.permissionType} in ('collaborative', 'personal', 'locked')`,
    ),
    check(
      'record_views_permission_owner_check',
      sql`(${table.permissionType} = 'personal') = (${table.ownerId} is not null)`,
    ),
    check(
      'record_views_lock_reason_check',
      sql`${table.permissionType} = 'locked' or ${table.lockReason} is null`,
    ),
  ],
);

export const recordViewShares = pgTable(
  'record_view_shares',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').notNull(),
    recordViewId: uuid('record_view_id').notNull(),
    tokenPrefix: text('token_prefix').notNull(),
    tokenHash: text('token_hash').notNull(),
    passwordHash: text('password_hash'),
    allowDownload: boolean('allow_download').notNull().default(false),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    rowVersion: integer('row_version').notNull().default(1),
    accessCount: bigint('access_count', { mode: 'number' }).notNull().default(0),
    lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: uuid('revoked_by').references(() => users.id, { onDelete: 'restrict' }),
    revokedReason: text('revoked_reason'),
    ...auditColumns,
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.recordViewId],
      foreignColumns: [recordViews.projectId, recordViews.id],
      name: 'record_view_shares_project_view_fk',
    }).onDelete('restrict'),
    uniqueIndex('record_view_shares_token_hash_key').on(table.tokenHash),
    uniqueIndex('record_view_shares_active_view_key')
      .on(table.recordViewId)
      .where(sql`${table.revokedAt} is null`),
    index('record_view_shares_expiry_idx').on(table.expiresAt),
    index('record_view_shares_project_created_idx').on(table.projectId, table.createdAt, table.id),
    check(
      'record_view_shares_token_prefix_check',
      sql`length(${table.tokenPrefix}) between 8 and 20`,
    ),
    check('record_view_shares_row_version_check', sql`${table.rowVersion} > 0`),
    check('record_view_shares_access_count_check', sql`${table.accessCount} >= 0`),
    check(
      'record_view_shares_expiry_check',
      sql`${table.expiresAt} is null or ${table.expiresAt} > ${table.createdAt}`,
    ),
  ],
);

export const records = pgTable(
  'records',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').notNull(),
    objectTypeId: uuid('object_type_id').notNull(),
    displayName: text('display_name').notNull(),
    contextProjectId: uuid('context_project_id').references(() => projects.id, {
      onDelete: 'restrict',
    }),
    values: jsonb('values').notNull().default({}),
    rowVersion: integer('row_version').notNull().default(1),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'restrict' }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedBy: uuid('archived_by').references(() => users.id, { onDelete: 'restrict' }),
    archiveReason: text('archive_reason'),
    ...auditColumns,
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.objectTypeId],
      foreignColumns: [objectTypes.projectId, objectTypes.id],
      name: 'records_project_object_type_fk',
    }).onDelete('restrict'),
    uniqueIndex('records_project_id_key').on(table.projectId, table.id),
    uniqueIndex('records_project_object_id_key').on(table.projectId, table.objectTypeId, table.id),
    index('records_context_project_idx').on(table.contextProjectId, table.updatedAt, table.id),
    index('records_object_updated_idx').on(table.objectTypeId, table.updatedAt, table.id),
  ],
);

export const recordComments = pgTable(
  'record_comments',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').notNull(),
    objectTypeId: uuid('object_type_id').notNull(),
    recordId: uuid('record_id').notNull(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    body: text('body').notNull(),
    rowVersion: integer('row_version').notNull().default(1),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.objectTypeId],
      foreignColumns: [objectTypes.projectId, objectTypes.id],
      name: 'record_comments_project_object_type_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.projectId, table.objectTypeId, table.recordId],
      foreignColumns: [records.projectId, records.objectTypeId, records.id],
      name: 'record_comments_project_record_fk',
    }).onDelete('restrict'),
    index('record_comments_record_created_idx').on(table.recordId, table.createdAt, table.id),
    check(
      'record_comments_body_length_check',
      sql`length(btrim(${table.body})) between 1 and 10000`,
    ),
    check('record_comments_row_version_check', sql`${table.rowVersion} > 0`),
  ],
);

export const recordCommentMentions = pgTable(
  'record_comment_mentions',
  {
    commentId: uuid('comment_id')
      .notNull()
      .references(() => recordComments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('record_comment_mentions_comment_user_key').on(table.commentId, table.userId),
    index('record_comment_mentions_user_idx').on(table.userId, table.createdAt),
  ],
);

export const publicFormSubmissions = pgTable(
  'public_form_submissions',
  {
    id: uuid('id').primaryKey(),
    shareId: uuid('share_id')
      .notNull()
      .references(() => recordViewShares.id, { onDelete: 'restrict' }),
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id, { onDelete: 'restrict' }),
    idempotencyHash: text('idempotency_hash').notNull(),
    requestHash: text('request_hash').notNull(),
    networkFingerprint: text('network_fingerprint').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('public_form_submissions_share_idempotency_key').on(
      table.shareId,
      table.idempotencyHash,
    ),
    uniqueIndex('public_form_submissions_record_key').on(table.recordId),
    index('public_form_submissions_share_created_idx').on(table.shareId, table.createdAt, table.id),
    check(
      'public_form_submissions_hashes_check',
      sql`length(${table.idempotencyHash}) = 64 and length(${table.requestHash}) = 64 and length(${table.networkFingerprint}) = 64`,
    ),
  ],
);

export const recordReviewThreads = pgTable(
  'record_review_threads',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').notNull(),
    objectTypeId: uuid('object_type_id').notNull(),
    recordId: uuid('record_id').notNull(),
    subject: text('subject').notNull(),
    status: text('status').notNull().default('open'),
    reviewStatus: text('review_status').notNull().default('discussion'),
    reviewerId: uuid('reviewer_id').references(() => users.id, { onDelete: 'restrict' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'restrict' }),
    ...auditColumns,
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.objectTypeId],
      foreignColumns: [objectTypes.projectId, objectTypes.id],
      name: 'record_review_threads_project_object_type_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.projectId, table.recordId],
      foreignColumns: [records.projectId, records.id],
      name: 'record_review_threads_project_record_fk',
    }).onDelete('cascade'),
    index('record_review_threads_record_updated_idx').on(
      table.recordId,
      table.status,
      table.updatedAt,
    ),
    index('record_review_threads_reviewer_idx').on(table.reviewerId, table.status, table.updatedAt),
    check('record_review_threads_status_check', sql`${table.status} in ('open','resolved')`),
    check(
      'record_review_threads_review_status_check',
      sql`${table.reviewStatus} in ('discussion','requested','approved','changes_requested')`,
    ),
    check(
      'record_review_threads_resolution_check',
      sql`(${table.status} = 'open' and ${table.resolvedAt} is null and ${table.resolvedBy} is null)
          or (${table.status} = 'resolved' and ${table.resolvedAt} is not null and ${table.resolvedBy} is not null)`,
    ),
  ],
);

export const recordReviewMessages = pgTable(
  'record_review_messages',
  {
    id: uuid('id').primaryKey(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => recordReviewThreads.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    body: text('body').notNull(),
    mentionedUserIds: jsonb('mentioned_user_ids').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('record_review_messages_thread_created_idx').on(
      table.threadId,
      table.createdAt,
      table.id,
    ),
    check(
      'record_review_messages_body_length_check',
      sql`length(btrim(${table.body})) between 1 and 10000`,
    ),
  ],
);

export const recordIndexValues = pgTable(
  'record_index_values',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').notNull(),
    objectTypeId: uuid('object_type_id').notNull(),
    recordId: uuid('record_id').notNull(),
    fieldId: uuid('field_id').notNull(),
    ordinal: integer('ordinal').notNull().default(0),
    valueKind: recordValueKind('value_kind').notNull(),
    textValue: text('text_value'),
    numericValue: numeric('numeric_value'),
    booleanValue: boolean('boolean_value'),
    dateValue: date('date_value'),
    datetimeValue: timestamp('datetime_value', { withTimezone: true }),
    uuidValue: uuid('uuid_value'),
    uniqueKey: text('unique_key'),
    projectionVersion: integer('projection_version').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.recordId],
      foreignColumns: [records.projectId, records.id],
      name: 'record_index_values_project_record_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.projectId, table.fieldId],
      foreignColumns: [fieldDefinitions.projectId, fieldDefinitions.id],
      name: 'record_index_values_project_field_fk',
    }).onDelete('cascade'),
    uniqueIndex('record_index_values_record_field_ordinal_key').on(
      table.recordId,
      table.fieldId,
      table.ordinal,
    ),
    uniqueIndex('record_index_values_field_unique_key')
      .on(table.fieldId, table.uniqueKey)
      .where(sql`${table.uniqueKey} is not null`),
    index('record_index_values_filter_idx').on(table.fieldId, table.recordId),
    check(
      'record_index_values_exactly_one_value_check',
      sql`num_nonnulls(${table.textValue}, ${table.numericValue}, ${table.booleanValue}, ${table.dateValue}, ${table.datetimeValue}, ${table.uuidValue}) = 1`,
    ),
  ],
);

export const relationEdges = pgTable(
  'relation_edges',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').notNull(),
    sourceRecordId: uuid('source_record_id').notNull(),
    sourceFieldId: uuid('source_field_id').notNull(),
    targetRecordId: uuid('target_record_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.sourceRecordId],
      foreignColumns: [records.projectId, records.id],
      name: 'relation_edges_project_source_record_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.projectId, table.sourceFieldId],
      foreignColumns: [fieldDefinitions.projectId, fieldDefinitions.id],
      name: 'relation_edges_project_source_field_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.projectId, table.targetRecordId],
      foreignColumns: [records.projectId, records.id],
      name: 'relation_edges_project_target_record_fk',
    }).onDelete('restrict'),
    uniqueIndex('relation_edges_source_field_target_key').on(
      table.sourceRecordId,
      table.sourceFieldId,
      table.targetRecordId,
    ),
    index('relation_edges_target_idx').on(table.targetRecordId),
  ],
);

export const templateInstallations = pgTable(
  'template_installations',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    templateKey: text('template_key').notNull(),
    version: integer('version').notNull(),
    installedBy: uuid('installed_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('template_installations_project_template_key').on(
      table.projectId,
      table.templateKey,
    ),
  ],
);

export const onboardingProgress = pgTable('onboarding_progress', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'restrict' }),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'restrict' }),
  completedSteps: jsonb('completed_steps').notNull().default([]),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
  ...auditColumns,
});

export const pilotFeedback = pgTable(
  'pilot_feedback',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'restrict' }),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    category: text('category').notNull(),
    rating: integer('rating').notNull(),
    message: text('message').notNull(),
    context: jsonb('context').notNull().default({}),
    status: text('status').notNull().default('new'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('pilot_feedback_organization_created_idx').on(table.organizationId, table.createdAt),
    check(
      'pilot_feedback_category_check',
      sql`${table.category} in ('bug','usability','workflow','idea','other')`,
    ),
    check('pilot_feedback_rating_check', sql`${table.rating} between 1 and 5`),
    check('pilot_feedback_status_check', sql`${table.status} in ('new','reviewed','resolved')`),
  ],
);

export const projectDemoInstallations = pgTable('project_demo_installations', {
  projectId: uuid('project_id')
    .primaryKey()
    .references(() => projects.id, { onDelete: 'restrict' }),
  templateVersion: integer('template_version').notNull(),
  fileId: uuid('file_id')
    .notNull()
    .references(() => fileObjects.id, { onDelete: 'restrict' }),
  datasetId: uuid('dataset_id')
    .notNull()
    .references(() => datasets.id, { onDelete: 'restrict' }),
  chartId: uuid('chart_id')
    .notNull()
    .references(() => charts.id, { onDelete: 'restrict' }),
  testRunRecordId: uuid('test_run_record_id')
    .notNull()
    .references(() => records.id, { onDelete: 'restrict' }),
  installedBy: uuid('installed_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
});

export const csvImports = pgTable(
  'csv_imports',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    objectTypeId: uuid('object_type_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    requestHash: text('request_hash').notNull(),
    result: jsonb('result').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.objectTypeId],
      foreignColumns: [objectTypes.projectId, objectTypes.id],
      name: 'csv_imports_project_object_type_fk',
    }).onDelete('restrict'),
    uniqueIndex('csv_imports_project_actor_key').on(
      table.projectId,
      table.requestedBy,
      table.idempotencyKey,
    ),
  ],
);

export const recordBatchRequests = pgTable(
  'record_batch_requests',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    objectTypeId: uuid('object_type_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    requestHash: text('request_hash').notNull(),
    result: jsonb('result').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.objectTypeId],
      foreignColumns: [objectTypes.projectId, objectTypes.id],
      name: 'record_batch_requests_project_object_type_fk',
    }).onDelete('restrict'),
    uniqueIndex('record_batch_requests_scope_key').on(
      table.projectId,
      table.objectTypeId,
      table.requestedBy,
      table.idempotencyKey,
    ),
  ],
);

export const projectIdempotencyRequests = pgTable(
  'project_idempotency_requests',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    operation: text('operation').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    requestHash: text('request_hash').notNull(),
    resourceId: uuid('resource_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '24 hours'`),
  },
  (table) => [
    uniqueIndex('project_idempotency_requests_scope_key').on(
      table.projectId,
      table.operation,
      table.requestedBy,
      table.idempotencyKey,
    ),
    index('project_idempotency_requests_expiry_idx').on(table.expiresAt),
    check(
      'project_idempotency_requests_operation_check',
      sql`${table.operation} in ('task.create','milestone.create')`,
    ),
    check(
      'project_idempotency_requests_key_length_check',
      sql`length(${table.idempotencyKey}) between 8 and 200`,
    ),
  ],
);

export const specifications = pgTable(
  'specifications',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').notNull(),
    name: text('name').notNull(),
    measurementFieldId: uuid('measurement_field_id').notNull(),
    status: specificationStatus('status').notNull().default('active'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedBy: uuid('archived_by').references(() => users.id, { onDelete: 'restrict' }),
    archiveReason: text('archive_reason'),
    ...auditColumns,
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.measurementFieldId],
      foreignColumns: [fieldDefinitions.projectId, fieldDefinitions.id],
      name: 'specifications_project_measurement_field_fk',
    }).onDelete('restrict'),
    uniqueIndex('specifications_active_measurement_field_key')
      .on(table.measurementFieldId)
      .where(sql`${table.status} = 'active'`),
    uniqueIndex('specifications_project_id_key').on(table.projectId, table.id),
    index('specifications_project_idx').on(table.projectId),
  ],
);

export const specificationRevisions = pgTable(
  'specification_revisions',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').notNull(),
    specificationId: uuid('specification_id').notNull(),
    revisionNumber: integer('revision_number').notNull(),
    quantityDimension: text('quantity_dimension').notNull(),
    canonicalUnit: text('canonical_unit').notNull(),
    targetValue: numeric('target_value'),
    lowerLimit: numeric('lower_limit'),
    upperLimit: numeric('upper_limit'),
    warningLowerLimit: numeric('warning_lower_limit'),
    warningUpperLimit: numeric('warning_upper_limit'),
    unitRegistryVersion: text('unit_registry_version').notNull(),
    changeNote: text('change_note').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.specificationId],
      foreignColumns: [specifications.projectId, specifications.id],
      name: 'specification_revisions_project_specification_fk',
    }).onDelete('restrict'),
    uniqueIndex('specification_revisions_specification_number_key').on(
      table.specificationId,
      table.revisionNumber,
    ),
    uniqueIndex('specification_revisions_project_id_key').on(table.projectId, table.id),
    check(
      'specification_revisions_hard_limit_check',
      sql`${table.lowerLimit} is not null or ${table.upperLimit} is not null`,
    ),
    check(
      'specification_revisions_hard_order_check',
      sql`${table.lowerLimit} is null or ${table.upperLimit} is null or ${table.lowerLimit} <= ${table.upperLimit}`,
    ),
  ],
);

export const measurementResults = pgTable(
  'measurement_results',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').notNull(),
    recordId: uuid('record_id').notNull(),
    fieldId: uuid('field_id').notNull(),
    canonicalValue: numeric('canonical_value').notNull(),
    canonicalUnit: text('canonical_unit').notNull(),
    originalValue: numeric('original_value').notNull(),
    originalUnit: text('original_unit').notNull(),
    precision: integer('precision'),
    uncertaintyValue: numeric('uncertainty_value'),
    uncertaintyUnit: text('uncertainty_unit'),
    unitRegistryVersion: text('unit_registry_version').notNull(),
    measuredAt: timestamp('measured_at', { withTimezone: true }).notNull(),
    equipmentRecordId: uuid('equipment_record_id'),
    datasetId: uuid('dataset_id'),
    supersedesResultId: uuid('supersedes_result_id'),
    correctionReason: text('correction_reason'),
    recordedBy: uuid('recorded_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.recordId],
      foreignColumns: [records.projectId, records.id],
      name: 'measurement_results_project_record_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.projectId, table.fieldId],
      foreignColumns: [fieldDefinitions.projectId, fieldDefinitions.id],
      name: 'measurement_results_project_field_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.projectId, table.equipmentRecordId],
      foreignColumns: [records.projectId, records.id],
      name: 'measurement_results_project_equipment_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.projectId, table.supersedesResultId],
      foreignColumns: [table.projectId, table.id],
      name: 'measurement_results_project_supersedes_fk',
    }).onDelete('restrict'),
    uniqueIndex('measurement_results_supersedes_key')
      .on(table.supersedesResultId)
      .where(sql`${table.supersedesResultId} is not null`),
    uniqueIndex('measurement_results_project_id_key').on(table.projectId, table.id),
    index('measurement_results_current_idx').on(
      table.projectId,
      table.recordId,
      table.fieldId,
      table.measuredAt,
    ),
    check(
      'measurement_results_correction_reason_check',
      sql`(${table.supersedesResultId} is null and ${table.correctionReason} is null) or (${table.supersedesResultId} is not null and length(trim(${table.correctionReason})) > 0)`,
    ),
    check(
      'measurement_results_uncertainty_check',
      sql`${table.uncertaintyValue} is null or ${table.uncertaintyValue} >= 0`,
    ),
  ],
);

export const specificationEvaluations = pgTable(
  'specification_evaluations',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').notNull(),
    specificationRevisionId: uuid('specification_revision_id').notNull(),
    recordId: uuid('record_id').notNull(),
    measurementFieldId: uuid('measurement_field_id').notNull(),
    measurementResultId: uuid('measurement_result_id'),
    status: evaluationStatus('status').notNull(),
    evaluatedCanonicalValue: numeric('evaluated_canonical_value'),
    unitRegistryVersion: text('unit_registry_version').notNull(),
    evaluatorVersion: text('evaluator_version').notNull(),
    reasonCode: text('reason_code').notNull(),
    inputFingerprint: text('input_fingerprint').notNull(),
    evaluatedAt: timestamp('evaluated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.specificationRevisionId],
      foreignColumns: [specificationRevisions.projectId, specificationRevisions.id],
      name: 'specification_evaluations_project_revision_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.projectId, table.recordId],
      foreignColumns: [records.projectId, records.id],
      name: 'specification_evaluations_project_record_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.projectId, table.measurementFieldId],
      foreignColumns: [fieldDefinitions.projectId, fieldDefinitions.id],
      name: 'specification_evaluations_project_field_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.projectId, table.measurementResultId],
      foreignColumns: [measurementResults.projectId, measurementResults.id],
      name: 'specification_evaluations_project_result_fk',
    }).onDelete('restrict'),
    uniqueIndex('specification_evaluations_project_fingerprint_key').on(
      table.projectId,
      table.inputFingerprint,
    ),
    index('specification_evaluations_current_idx').on(
      table.projectId,
      table.recordId,
      table.measurementFieldId,
      table.evaluatedAt,
    ),
    check(
      'specification_evaluations_missing_value_check',
      sql`(${table.status} = 'missing' and ${table.measurementResultId} is null and ${table.evaluatedCanonicalValue} is null) or (${table.status} <> 'missing' and ${table.measurementResultId} is not null and ${table.evaluatedCanonicalValue} is not null)`,
    ),
  ],
);

export const fileSeries = pgTable(
  'file_series',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    latestVersionNumber: integer('latest_version_number').notNull().default(0),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedBy: uuid('archived_by').references(() => users.id, { onDelete: 'restrict' }),
    archiveReason: text('archive_reason'),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex('file_series_project_id_key').on(table.projectId, table.id),
    index('file_series_project_idx').on(table.projectId),
  ],
);

export const fileObjects = pgTable(
  'file_objects',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').notNull(),
    fileSeriesId: uuid('file_series_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    previousFileId: uuid('previous_file_id'),
    finalObjectKey: text('final_object_key').notNull().unique(),
    storageVersionId: text('storage_version_id'),
    originalName: text('original_name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    checksumAlgorithm: text('checksum_algorithm').notNull().default('sha256'),
    checksum: text('checksum').notNull(),
    status: fileStatus('status').notNull().default('pending_upload'),
    failureCode: text('failure_code'),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    availableAt: timestamp('available_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedBy: uuid('archived_by').references(() => users.id, { onDelete: 'restrict' }),
    archiveReason: text('archive_reason'),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.fileSeriesId],
      foreignColumns: [fileSeries.projectId, fileSeries.id],
      name: 'file_objects_project_series_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.projectId, table.previousFileId],
      foreignColumns: [table.projectId, table.id],
      name: 'file_objects_project_previous_fk',
    }).onDelete('restrict'),
    uniqueIndex('file_objects_series_version_key').on(table.fileSeriesId, table.versionNumber),
    uniqueIndex('file_objects_project_id_key').on(table.projectId, table.id),
    index('file_objects_project_idx').on(table.projectId),
  ],
);

export const fileUploadSessions = pgTable(
  'file_upload_sessions',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').notNull(),
    fileId: uuid('file_id').notNull(),
    stagingObjectKey: text('staging_object_key').notNull().unique(),
    expectedSizeBytes: bigint('expected_size_bytes', { mode: 'number' }).notNull(),
    expectedChecksum: text('expected_checksum').notNull(),
    status: uploadStatus('status').notNull().default('issued'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    failureCode: text('failure_code'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.fileId],
      foreignColumns: [fileObjects.projectId, fileObjects.id],
      name: 'file_upload_sessions_project_file_fk',
    }).onDelete('restrict'),
    uniqueIndex('file_upload_sessions_project_id_key').on(table.projectId, table.id),
    index('file_upload_sessions_expiry_idx').on(table.expiresAt),
  ],
);

export const datasets = pgTable(
  'datasets',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').notNull(),
    sourceFileId: uuid('source_file_id'),
    sourceDatasetId: uuid('source_dataset_id'),
    datasetType: datasetType('dataset_type').notNull(),
    name: text('name').notNull(),
    status: datasetStatus('status').notNull().default('pending'),
    transformationName: text('transformation_name').notNull(),
    transformationVersion: text('transformation_version').notNull(),
    parameters: jsonb('parameters').notNull().default({}),
    inputFingerprint: text('input_fingerprint').notNull(),
    schema: jsonb('schema').notNull().default({}),
    statistics: jsonb('statistics').notNull().default({}),
    rowCount: bigint('row_count', { mode: 'number' }),
    unitRegistryVersion: text('unit_registry_version').notNull(),
    failureCode: text('failure_code'),
    failureDetails: jsonb('failure_details').notNull().default({}),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    readyAt: timestamp('ready_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedBy: uuid('archived_by').references(() => users.id, { onDelete: 'restrict' }),
    archiveReason: text('archive_reason'),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.sourceFileId],
      foreignColumns: [fileObjects.projectId, fileObjects.id],
      name: 'datasets_project_source_file_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.projectId, table.sourceDatasetId],
      foreignColumns: [table.projectId, table.id],
      name: 'datasets_project_source_dataset_fk',
    }).onDelete('restrict'),
    uniqueIndex('datasets_project_fingerprint_key').on(table.projectId, table.inputFingerprint),
    uniqueIndex('datasets_project_id_key').on(table.projectId, table.id),
    index('datasets_project_status_idx').on(table.projectId, table.status),
    check(
      'datasets_exactly_one_source_check',
      sql`num_nonnulls(${table.sourceFileId},${table.sourceDatasetId}) = 1`,
    ),
  ],
);

export const datasetArtifacts = pgTable(
  'dataset_artifacts',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').notNull(),
    datasetId: uuid('dataset_id').notNull(),
    artifactKind: text('artifact_kind').notNull(),
    objectKey: text('object_key').notNull().unique(),
    storageVersionId: text('storage_version_id'),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    checksumAlgorithm: text('checksum_algorithm').notNull().default('sha256'),
    checksum: text('checksum').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.datasetId],
      foreignColumns: [datasets.projectId, datasets.id],
      name: 'dataset_artifacts_project_dataset_fk',
    }).onDelete('restrict'),
    uniqueIndex('dataset_artifacts_dataset_kind_key').on(table.datasetId, table.artifactKind),
  ],
);

export const recordFileReferences = pgTable(
  'record_file_references',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').notNull(),
    recordId: uuid('record_id').notNull(),
    fieldId: uuid('field_id').notNull(),
    fileId: uuid('file_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.recordId],
      foreignColumns: [records.projectId, records.id],
      name: 'record_file_references_project_record_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.projectId, table.fieldId],
      foreignColumns: [fieldDefinitions.projectId, fieldDefinitions.id],
      name: 'record_file_references_project_field_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.projectId, table.fileId],
      foreignColumns: [fileObjects.projectId, fileObjects.id],
      name: 'record_file_references_project_file_fk',
    }).onDelete('restrict'),
    uniqueIndex('record_file_references_record_field_key').on(table.recordId, table.fieldId),
    index('record_file_references_file_idx').on(table.fileId),
  ],
);

export const recordDatasetReferences = pgTable(
  'record_dataset_references',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').notNull(),
    recordId: uuid('record_id').notNull(),
    fieldId: uuid('field_id').notNull(),
    datasetId: uuid('dataset_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.recordId],
      foreignColumns: [records.projectId, records.id],
      name: 'record_dataset_references_project_record_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.projectId, table.fieldId],
      foreignColumns: [fieldDefinitions.projectId, fieldDefinitions.id],
      name: 'record_dataset_references_project_field_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.projectId, table.datasetId],
      foreignColumns: [datasets.projectId, datasets.id],
      name: 'record_dataset_references_project_dataset_fk',
    }).onDelete('restrict'),
    uniqueIndex('record_dataset_references_record_field_key').on(table.recordId, table.fieldId),
    index('record_dataset_references_dataset_idx').on(table.datasetId),
  ],
);

export const charts = pgTable(
  'charts',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    currentRevisionId: uuid('current_revision_id'),
    system: boolean('system').notNull().default(false),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedBy: uuid('archived_by').references(() => users.id, { onDelete: 'restrict' }),
    archiveReason: text('archive_reason'),
    ...auditColumns,
  },
  (table) => [
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [projects.id],
      name: 'charts_project_fk',
    }).onDelete('restrict'),
    uniqueIndex('charts_project_id_key').on(table.projectId, table.id),
    index('charts_project_idx').on(table.projectId),
  ],
);

export const chartRevisions = pgTable(
  'chart_revisions',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').notNull(),
    chartId: uuid('chart_id').notNull(),
    revisionNumber: integer('revision_number').notNull(),
    configVersion: integer('config_version').notNull(),
    chartType: text('chart_type').notNull(),
    config: jsonb('config').notNull(),
    changeNote: text('change_note').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.chartId],
      foreignColumns: [charts.projectId, charts.id],
      name: 'chart_revisions_project_chart_fk',
    }).onDelete('restrict'),
    uniqueIndex('chart_revisions_chart_number_key').on(table.chartId, table.revisionNumber),
    uniqueIndex('chart_revisions_project_id_key').on(table.projectId, table.id),
  ],
);

export const chartDatasetSources = pgTable(
  'chart_dataset_sources',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').notNull(),
    chartRevisionId: uuid('chart_revision_id').notNull(),
    sourceKey: text('source_key').notNull(),
    datasetId: uuid('dataset_id').notNull(),
    sourceRole: text('source_role').notNull(),
    seriesOrder: integer('series_order').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.chartRevisionId],
      foreignColumns: [chartRevisions.projectId, chartRevisions.id],
      name: 'chart_dataset_sources_project_revision_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.projectId, table.datasetId],
      foreignColumns: [datasets.projectId, datasets.id],
      name: 'chart_dataset_sources_project_dataset_fk',
    }).onDelete('restrict'),
    uniqueIndex('chart_dataset_sources_revision_key').on(table.chartRevisionId, table.sourceKey),
    index('chart_dataset_sources_dataset_idx').on(table.datasetId),
  ],
);

export const dashboards = pgTable(
  'dashboards',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    currentRevisionId: uuid('current_revision_id'),
    system: boolean('system').notNull().default(false),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedBy: uuid('archived_by').references(() => users.id, { onDelete: 'restrict' }),
    archiveReason: text('archive_reason'),
    ...auditColumns,
  },
  (table) => [
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [projects.id],
      name: 'dashboards_project_fk',
    }).onDelete('restrict'),
    uniqueIndex('dashboards_project_id_key').on(table.projectId, table.id),
    index('dashboards_project_idx').on(table.projectId),
  ],
);

export const dashboardRevisions = pgTable(
  'dashboard_revisions',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').notNull(),
    dashboardId: uuid('dashboard_id').notNull(),
    revisionNumber: integer('revision_number').notNull(),
    layoutVersion: integer('layout_version').notNull(),
    changeNote: text('change_note').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.dashboardId],
      foreignColumns: [dashboards.projectId, dashboards.id],
      name: 'dashboard_revisions_project_dashboard_fk',
    }).onDelete('restrict'),
    uniqueIndex('dashboard_revisions_dashboard_number_key').on(
      table.dashboardId,
      table.revisionNumber,
    ),
    uniqueIndex('dashboard_revisions_project_id_key').on(table.projectId, table.id),
  ],
);

export const dashboardCards = pgTable(
  'dashboard_cards',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').notNull(),
    dashboardRevisionId: uuid('dashboard_revision_id').notNull(),
    cardType: text('card_type').notNull(),
    chartRevisionId: uuid('chart_revision_id'),
    configVersion: integer('config_version').notNull(),
    config: jsonb('config').notNull(),
    x: integer('x').notNull(),
    y: integer('y').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    position: integer('position').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.dashboardRevisionId],
      foreignColumns: [dashboardRevisions.projectId, dashboardRevisions.id],
      name: 'dashboard_cards_project_revision_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.projectId, table.chartRevisionId],
      foreignColumns: [chartRevisions.projectId, chartRevisions.id],
      name: 'dashboard_cards_project_chart_revision_fk',
    }).onDelete('restrict'),
    uniqueIndex('dashboard_cards_revision_position_key').on(
      table.dashboardRevisionId,
      table.position,
    ),
    check(
      'dashboard_cards_layout_check',
      sql`${table.x} >= 0 and ${table.y} >= 0 and ${table.width} between 1 and 12 and ${table.height} between 1 and 12 and ${table.x} + ${table.width} <= 12`,
    ),
  ],
);

export const taskWorkflowStatuses = pgTable(
  'task_workflow_statuses',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    category: text('category').notNull(),
    color: text('color').notNull(),
    position: integer('position').notNull(),
    wipLimit: integer('wip_limit'),
    initial: boolean('initial').notNull().default(false),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedBy: uuid('archived_by').references(() => users.id, { onDelete: 'restrict' }),
    rowVersion: integer('row_version').notNull().default(1),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex('task_workflow_statuses_project_key').on(table.projectId, table.key),
    uniqueIndex('task_workflow_statuses_project_id_key').on(table.projectId, table.id),
    uniqueIndex('task_workflow_statuses_project_initial_key')
      .on(table.projectId)
      .where(sql`${table.initial} and ${table.archivedAt} is null`),
    index('task_workflow_statuses_project_position_idx').on(
      table.projectId,
      table.archivedAt,
      table.position,
    ),
    check('task_workflow_statuses_key_check', sql`${table.key} ~ '^[a-z][a-z0-9_]{0,39}$'`),
    check('task_workflow_statuses_name_check', sql`length(btrim(${table.name})) between 1 and 80`),
    check(
      'task_workflow_statuses_category_check',
      sql`${table.category} in ('todo','in_progress','done')`,
    ),
    check(
      'task_workflow_statuses_color_check',
      sql`${table.color} in ('slate','sky','violet','amber','rose','emerald')`,
    ),
    check('task_workflow_statuses_position_check', sql`${table.position} >= 0`),
    check(
      'task_workflow_statuses_wip_limit_check',
      sql`${table.wipLimit} is null or ${table.wipLimit} between 1 and 999`,
    ),
    check('task_workflow_statuses_version_check', sql`${table.rowVersion} > 0`),
  ],
);

export const taskWorkflowTransitions = pgTable(
  'task_workflow_transitions',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    fromStatus: text('from_status').notNull(),
    toStatus: text('to_status').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    ...auditColumns,
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.fromStatus],
      foreignColumns: [taskWorkflowStatuses.projectId, taskWorkflowStatuses.key],
      name: 'task_workflow_transitions_project_from_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.projectId, table.toStatus],
      foreignColumns: [taskWorkflowStatuses.projectId, taskWorkflowStatuses.key],
      name: 'task_workflow_transitions_project_to_fk',
    }).onDelete('restrict'),
    uniqueIndex('task_workflow_transitions_project_pair_key').on(
      table.projectId,
      table.fromStatus,
      table.toStatus,
    ),
    index('task_workflow_transitions_project_from_idx').on(table.projectId, table.fromStatus),
    check(
      'task_workflow_transitions_name_check',
      sql`length(btrim(${table.name})) between 1 and 80`,
    ),
    check(
      'task_workflow_transitions_distinct_check',
      sql`${table.fromStatus} <> ${table.toStatus}`,
    ),
  ],
);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    taskNumber: integer('task_number').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    status: text('status').notNull().default('todo'),
    priority: taskPriority('priority').notNull().default('medium'),
    visibility: taskVisibility('visibility').notNull().default('project'),
    labels: text('labels')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    parentTaskId: uuid('parent_task_id'),
    boardPosition: integer('board_position').notNull().default(0),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'restrict' }),
    dueDate: date('due_date'),
    originalEstimateMinutes: integer('original_estimate_minutes'),
    remainingEstimateMinutes: integer('remaining_estimate_minutes'),
    rowVersion: integer('row_version').notNull().default(1),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedBy: uuid('archived_by').references(() => users.id, { onDelete: 'restrict' }),
    archiveReason: text('archive_reason'),
    ...auditColumns,
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.status],
      foreignColumns: [taskWorkflowStatuses.projectId, taskWorkflowStatuses.key],
      name: 'tasks_project_status_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.projectId, table.parentTaskId],
      foreignColumns: [table.projectId, table.id],
      name: 'tasks_project_parent_fk',
    }).onDelete('restrict'),
    uniqueIndex('tasks_project_id_key').on(table.projectId, table.id),
    uniqueIndex('tasks_project_number_key').on(table.projectId, table.taskNumber),
    index('tasks_project_board_idx').on(table.projectId, table.status, table.priority),
    index('tasks_project_lifecycle_board_idx').on(
      table.projectId,
      table.archivedAt,
      table.status,
      table.priority,
    ),
    index('tasks_project_board_position_idx').on(
      table.projectId,
      table.status,
      table.archivedAt,
      table.boardPosition,
      table.id,
    ),
    index('tasks_project_due_idx').on(table.projectId, table.dueDate),
    index('tasks_assignee_lifecycle_due_idx')
      .on(table.assigneeId, table.archivedAt, table.dueDate, table.updatedAt)
      .where(sql`${table.assigneeId} is not null`),
    index('tasks_project_parent_idx').on(table.projectId, table.parentTaskId, table.archivedAt),
    index('tasks_labels_idx').using('gin', table.labels),
    check('tasks_board_position_check', sql`${table.boardPosition} >= 0`),
    check('tasks_labels_count_check', sql`cardinality(${table.labels}) <= 12`),
    check(
      'tasks_original_estimate_check',
      sql`${table.originalEstimateMinutes} is null or ${table.originalEstimateMinutes} between 0 and 5256000`,
    ),
    check(
      'tasks_remaining_estimate_check',
      sql`${table.remainingEstimateMinutes} is null or ${table.remainingEstimateMinutes} between 0 and 5256000`,
    ),
    check(
      'tasks_parent_not_self_check',
      sql`${table.parentTaskId} is null or ${table.parentTaskId} <> ${table.id}`,
    ),
  ],
);

export const taskVisibilitySubjects = pgTable(
  'task_visibility_subjects',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').notNull(),
    taskId: uuid('task_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.taskId],
      foreignColumns: [tasks.projectId, tasks.id],
      name: 'task_visibility_subjects_project_task_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.groupId],
      foreignColumns: [memberGroups.organizationId, memberGroups.id],
      name: 'task_visibility_subjects_organization_group_fk',
    }).onDelete('cascade'),
    uniqueIndex('task_visibility_subjects_user_key')
      .on(table.taskId, table.userId)
      .where(sql`${table.userId} is not null`),
    uniqueIndex('task_visibility_subjects_group_key')
      .on(table.taskId, table.groupId)
      .where(sql`${table.groupId} is not null`),
    index('task_visibility_subjects_task_idx').on(table.taskId),
    check(
      'task_visibility_subjects_exactly_one_subject_check',
      sql`(${table.userId} is null) <> (${table.groupId} is null)`,
    ),
  ],
);

export const taskWorklogs = pgTable(
  'task_worklogs',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').notNull(),
    taskId: uuid('task_id').notNull(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    durationMinutes: integer('duration_minutes').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    note: text('note').notNull().default(''),
    remainingEstimateBefore: integer('remaining_estimate_before'),
    remainingEstimateAfter: integer('remaining_estimate_after'),
    rowVersion: integer('row_version').notNull().default(1),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.taskId],
      foreignColumns: [tasks.projectId, tasks.id],
      name: 'task_worklogs_project_task_fk',
    }).onDelete('restrict'),
    index('task_worklogs_task_started_idx')
      .on(table.taskId, table.startedAt, table.id)
      .where(sql`${table.deletedAt} is null`),
    index('task_worklogs_author_started_idx')
      .on(table.authorId, table.startedAt, table.id)
      .where(sql`${table.deletedAt} is null`),
    check('task_worklogs_duration_check', sql`${table.durationMinutes} between 1 and 525600`),
    check('task_worklogs_note_check', sql`length(${table.note}) <= 2000`),
    check('task_worklogs_row_version_check', sql`${table.rowVersion} > 0`),
    check(
      'task_worklogs_remaining_before_check',
      sql`${table.remainingEstimateBefore} is null or ${table.remainingEstimateBefore} between 0 and 5256000`,
    ),
    check(
      'task_worklogs_remaining_after_check',
      sql`${table.remainingEstimateAfter} is null or ${table.remainingEstimateAfter} between 0 and 5256000`,
    ),
    check(
      'task_worklogs_deleted_by_check',
      sql`(${table.deletedAt} is null) = (${table.deletedBy} is null)`,
    ),
  ],
);

export const taskSavedFilters = pgTable(
  'task_saved_filters',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    visibility: taskFilterVisibility('visibility').notNull().default('personal'),
    config: jsonb('config').notNull(),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex('task_saved_filters_personal_name_key')
      .on(table.projectId, table.userId, sql`lower(${table.name})`)
      .where(sql`${table.visibility} = 'personal'`),
    uniqueIndex('task_saved_filters_project_name_key')
      .on(table.projectId, sql`lower(${table.name})`)
      .where(sql`${table.visibility} = 'project'`),
    index('task_saved_filters_user_idx').on(table.userId, table.updatedAt),
    index('task_saved_filters_project_visibility_idx').on(
      table.projectId,
      table.visibility,
      table.updatedAt,
    ),
  ],
);

export const taskSavedFilterFavorites = pgTable(
  'task_saved_filter_favorites',
  {
    filterId: uuid('filter_id')
      .notNull()
      .references(() => taskSavedFilters.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.filterId, table.userId] }),
    index('task_saved_filter_favorites_user_idx').on(table.userId, table.createdAt),
  ],
);

export const taskAutomationRules = pgTable(
  'task_automation_rules',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    triggerType: text('trigger_type').notNull(),
    triggerConfig: jsonb('trigger_config').notNull(),
    conditionConfig: jsonb('condition_config').notNull(),
    actionConfig: jsonb('action_config').notNull(),
    active: boolean('active').notNull().default(true),
    executionCount: integer('execution_count').notNull().default(0),
    lastExecutedAt: timestamp('last_executed_at', { withTimezone: true }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedBy: uuid('archived_by').references(() => users.id, { onDelete: 'restrict' }),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex('task_automation_rules_project_id_key').on(table.projectId, table.id),
    uniqueIndex('task_automation_rules_project_name_key').on(
      table.projectId,
      sql`lower(${table.name})`,
    ),
    index('task_automation_rules_project_trigger_idx').on(
      table.projectId,
      table.active,
      table.triggerType,
    ),
    check(
      'task_automation_rules_trigger_type_check',
      sql`${table.triggerType} in ('task.created','task.status_changed','task.priority_changed','task.assignee_changed')`,
    ),
    check(
      'task_automation_rules_trigger_json_check',
      sql`jsonb_typeof(${table.triggerConfig})='object'`,
    ),
    check(
      'task_automation_rules_condition_json_check',
      sql`jsonb_typeof(${table.conditionConfig})='object'`,
    ),
    check(
      'task_automation_rules_action_json_check',
      sql`jsonb_typeof(${table.actionConfig})='object'`,
    ),
    check('task_automation_rules_execution_count_check', sql`${table.executionCount} >= 0`),
  ],
);

export const taskAutomationExecutions = pgTable(
  'task_automation_executions',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').notNull(),
    ruleId: uuid('rule_id').notNull(),
    ruleName: text('rule_name').notNull(),
    triggerType: text('trigger_type').notNull(),
    triggerEvent: jsonb('trigger_event').notNull(),
    taskId: uuid('task_id').notNull(),
    traceId: uuid('trace_id').notNull(),
    depth: integer('depth').notNull(),
    outcome: text('outcome').notNull(),
    changes: jsonb('changes').notNull(),
    errorCode: text('error_code'),
    durationMs: integer('duration_ms').notNull().default(0),
    executedBy: uuid('executed_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.ruleId],
      foreignColumns: [taskAutomationRules.projectId, taskAutomationRules.id],
      name: 'task_automation_executions_project_rule_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.projectId, table.taskId],
      foreignColumns: [tasks.projectId, tasks.id],
      name: 'task_automation_executions_project_task_fk',
    }).onDelete('restrict'),
    uniqueIndex('task_automation_executions_rule_trace_key').on(table.ruleId, table.traceId),
    index('task_automation_executions_project_created_idx').on(table.projectId, table.createdAt),
    check('task_automation_executions_depth_check', sql`${table.depth} between 0 and 10`),
    check('task_automation_executions_duration_check', sql`${table.durationMs} >= 0`),
    check(
      'task_automation_executions_trigger_json_check',
      sql`jsonb_typeof(${table.triggerEvent})='object'`,
    ),
    check(
      'task_automation_executions_outcome_check',
      sql`${table.outcome} in ('succeeded','no_change','failed')`,
    ),
    check(
      'task_automation_executions_changes_json_check',
      sql`jsonb_typeof(${table.changes})='object'`,
    ),
  ],
);

export const projectMilestones = pgTable(
  'project_milestones',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    status: milestoneStatus('status').notNull().default('planned'),
    targetDate: date('target_date').notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    rowVersion: integer('row_version').notNull().default(1),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedBy: uuid('archived_by').references(() => users.id, { onDelete: 'restrict' }),
    archiveReason: text('archive_reason'),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex('project_milestones_project_id_key').on(table.projectId, table.id),
    index('project_milestones_timeline_idx').on(table.projectId, table.targetDate, table.status),
  ],
);

export const projectMilestoneTasks = pgTable(
  'project_milestone_tasks',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    milestoneId: uuid('milestone_id').notNull(),
    taskId: uuid('task_id').notNull(),
    linkedBy: uuid('linked_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.projectId, table.milestoneId, table.taskId],
      name: 'project_milestone_tasks_pk',
    }),
    foreignKey({
      columns: [table.projectId, table.milestoneId],
      foreignColumns: [projectMilestones.projectId, projectMilestones.id],
      name: 'project_milestone_tasks_project_milestone_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.projectId, table.taskId],
      foreignColumns: [tasks.projectId, tasks.id],
      name: 'project_milestone_tasks_project_task_fk',
    }).onDelete('restrict'),
    index('project_milestone_tasks_task_idx').on(table.projectId, table.taskId),
  ],
);

export const externalSources = pgTable(
  'external_sources',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    provider: text('provider').notNull(),
    url: text('url').notNull(),
    externalId: text('external_id').notNull().default(''),
    version: text('version').notNull().default(''),
    observedOn: date('observed_on').notNull(),
    notes: text('notes').notNull().default(''),
    rowVersion: integer('row_version').notNull().default(1),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedBy: uuid('archived_by').references(() => users.id, { onDelete: 'restrict' }),
    archiveReason: text('archive_reason'),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex('external_sources_project_id_key').on(table.projectId, table.id),
    index('external_sources_project_updated_idx').on(
      table.projectId,
      table.archivedAt,
      table.updatedAt,
    ),
    index('external_sources_provider_idx').on(table.projectId, table.provider),
    check('external_sources_url_check', sql`${table.url} ~ '^https?://[^[:space:]]+$'`),
  ],
);

export const taskLinks = pgTable(
  'task_links',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').notNull(),
    taskId: uuid('task_id').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.taskId],
      foreignColumns: [tasks.projectId, tasks.id],
      name: 'task_links_project_task_fk',
    }).onDelete('restrict'),
    index('task_links_task_entity_idx').on(table.taskId, table.entityType, table.entityId),
    index('task_links_entity_idx').on(table.projectId, table.entityType, table.entityId),
    check(
      'task_links_entity_type_check',
      sql`${table.entityType} in ('record','sample','issue','test_run','measurement_result','specification_evaluation','dataset','external_source','file')`,
    ),
  ],
);

export const taskLinkRemovals = pgTable(
  'task_link_removals',
  {
    id: uuid('id').primaryKey(),
    linkId: uuid('link_id')
      .notNull()
      .references(() => taskLinks.id, { onDelete: 'restrict' }),
    removedBy: uuid('removed_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    removedAt: timestamp('removed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('task_link_removals_link_key').on(table.linkId),
    index('task_link_removals_actor_idx').on(table.removedBy, table.removedAt),
  ],
);

export const taskStatusHistory = pgTable(
  'task_status_history',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').notNull(),
    taskId: uuid('task_id').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    changedBy: uuid('changed_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.taskId],
      foreignColumns: [tasks.projectId, tasks.id],
      name: 'task_status_history_project_task_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.projectId, table.fromStatus],
      foreignColumns: [taskWorkflowStatuses.projectId, taskWorkflowStatuses.key],
      name: 'task_status_history_project_from_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.projectId, table.toStatus],
      foreignColumns: [taskWorkflowStatuses.projectId, taskWorkflowStatuses.key],
      name: 'task_status_history_project_to_fk',
    }).onDelete('restrict'),
    index('task_status_history_task_idx').on(table.taskId, table.changedAt),
    index('task_status_history_project_task_changed_idx').on(
      table.projectId,
      table.taskId,
      table.changedAt,
    ),
  ],
);

export const taskRelationships = pgTable(
  'task_relationships',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').notNull(),
    sourceTaskId: uuid('source_task_id').notNull(),
    targetTaskId: uuid('target_task_id').notNull(),
    relationType: text('relation_type').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.sourceTaskId],
      foreignColumns: [tasks.projectId, tasks.id],
      name: 'task_relationships_project_source_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.projectId, table.targetTaskId],
      foreignColumns: [tasks.projectId, tasks.id],
      name: 'task_relationships_project_target_fk',
    }).onDelete('restrict'),
    uniqueIndex('task_relationships_project_type_pair_key').on(
      table.projectId,
      table.relationType,
      table.sourceTaskId,
      table.targetTaskId,
    ),
    index('task_relationships_source_idx').on(table.projectId, table.sourceTaskId),
    index('task_relationships_target_idx').on(table.projectId, table.targetTaskId),
    check('task_relationships_distinct_tasks', sql`${table.sourceTaskId} <> ${table.targetTaskId}`),
    check('task_relationships_type_check', sql`${table.relationType} in ('blocks','relates_to')`),
    check(
      'task_relationships_relates_order_check',
      sql`${table.relationType} <> 'relates_to' or ${table.sourceTaskId} < ${table.targetTaskId}`,
    ),
  ],
);

export const taskWatchers = pgTable(
  'task_watchers',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').notNull(),
    taskId: uuid('task_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.taskId],
      foreignColumns: [tasks.projectId, tasks.id],
      name: 'task_watchers_project_task_fk',
    }).onDelete('restrict'),
    uniqueIndex('task_watchers_task_user_key').on(table.taskId, table.userId),
    index('task_watchers_user_idx').on(table.userId, table.createdAt),
  ],
);

export const taskComments = pgTable(
  'task_comments',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').notNull(),
    taskId: uuid('task_id').notNull(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    body: text('body').notNull(),
    rowVersion: integer('row_version').notNull().default(1),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.taskId],
      foreignColumns: [tasks.projectId, tasks.id],
      name: 'task_comments_project_task_fk',
    }).onDelete('restrict'),
    index('task_comments_task_created_idx').on(table.taskId, table.createdAt),
    check('task_comments_body_nonempty', sql`length(btrim(${table.body})) > 0`),
  ],
);

export const taskCommentMentions = pgTable(
  'task_comment_mentions',
  {
    commentId: uuid('comment_id')
      .notNull()
      .references(() => taskComments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('task_comment_mentions_comment_user_key').on(table.commentId, table.userId),
    index('task_comment_mentions_user_idx').on(table.userId, table.createdAt),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id').notNull(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id').notNull(),
    taskId: uuid('task_id'),
    objectTypeId: uuid('object_type_id'),
    recordId: uuid('record_id'),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull().default({}),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.taskId],
      foreignColumns: [tasks.projectId, tasks.id],
      name: 'notifications_project_task_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.projectId, table.objectTypeId, table.recordId],
      foreignColumns: [records.projectId, records.objectTypeId, records.id],
      name: 'notifications_project_record_fk',
    }).onDelete('restrict'),
    uniqueIndex('notifications_event_recipient_key').on(table.eventId, table.recipientId),
    index('notifications_recipient_unread_idx').on(
      table.recipientId,
      table.readAt,
      table.createdAt,
    ),
    index('notifications_record_idx').on(table.recordId, table.createdAt),
    check(
      'notifications_type',
      sql`${table.type} in ('task.assigned','task.updated','task.status_changed','task.commented','task.mentioned','task.archived','task.restored','task.due_soon','task.overdue','record.mentioned')`,
    ),
    check(
      'notifications_target_check',
      sql`((${table.type} like 'task.%') and ${table.taskId} is not null and ${table.objectTypeId} is null and ${table.recordId} is null) or (${table.type} = 'record.mentioned' and ${table.taskId} is null and ${table.objectTypeId} is not null and ${table.recordId} is not null)`,
    ),
  ],
);

export const userNotificationPreferences = pgTable(
  'user_notification_preferences',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    autoWatchCreated: boolean('auto_watch_created').notNull().default(true),
    autoWatchCommented: boolean('auto_watch_commented').notNull().default(true),
    notifyAssigned: boolean('notify_assigned').notNull().default(true),
    notifyMentioned: boolean('notify_mentioned').notNull().default(true),
    notifyTaskActivity: boolean('notify_task_activity').notNull().default(true),
    notifyDueDates: boolean('notify_due_dates').notNull().default(true),
    dueReminderDays: integer('due_reminder_days').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.organizationId, table.userId],
      name: 'user_notification_preferences_organization_user_pk',
    }),
    index('user_notification_preferences_user_idx').on(table.userId),
    check(
      'user_notification_preferences_due_reminder_days_check',
      sql`${table.dueReminderDays} in (0, 1, 3, 7)`,
    ),
  ],
);

export const backgroundJobs = pgTable(
  'background_jobs',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    jobType: text('job_type').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    inputFingerprint: text('input_fingerprint').notNull(),
    payload: jsonb('payload').notNull(),
    status: jobStatus('status').notNull().default('queued'),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    progress: integer('progress').notNull().default(0),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    errorCode: text('error_code'),
    errorDetails: jsonb('error_details').notNull().default({}),
    retryable: boolean('retryable').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('background_jobs_project_fingerprint_key').on(
      table.projectId,
      table.inputFingerprint,
    ),
    uniqueIndex('background_jobs_project_id_key').on(table.projectId, table.id),
    index('background_jobs_claim_idx').on(table.status, table.scheduledAt),
  ],
);

export const backgroundJobAttempts = pgTable(
  'background_job_attempts',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').notNull(),
    jobId: uuid('job_id').notNull(),
    attemptNumber: integer('attempt_number').notNull(),
    workerIdentity: text('worker_identity').notNull(),
    status: attemptStatus('status').notNull().default('running'),
    progress: integer('progress').notNull().default(0),
    resultCheckpoint: jsonb('result_checkpoint').notNull().default({}),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    errorCode: text('error_code'),
    errorDetails: jsonb('error_details').notNull().default({}),
    retryable: boolean('retryable').notNull().default(true),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.jobId],
      foreignColumns: [backgroundJobs.projectId, backgroundJobs.id],
      name: 'background_job_attempts_project_job_fk',
    }).onDelete('restrict'),
    uniqueIndex('background_job_attempts_job_number_key').on(table.jobId, table.attemptNumber),
  ],
);

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    eventType: text('event_type').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastError: text('last_error'),
  },
  (table) => [index('outbox_undispatched_idx').on(table.dispatchedAt, table.createdAt)],
);

export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    objectTypeId: uuid('object_type_id').references(() => objectTypes.id, {
      onDelete: 'restrict',
    }),
    name: text('name').notNull(),
    url: text('url').notNull(),
    eventTypes: jsonb('event_types').$type<string[]>().notNull(),
    secretVersion: integer('secret_version').notNull().default(1),
    active: boolean('active').notNull().default(true),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex('webhook_endpoints_project_name_key').on(
      table.projectId,
      sql`lower(${table.name})`,
    ),
    index('webhook_endpoints_project_active_idx').on(table.projectId, table.active),
    check('webhook_endpoints_events_nonempty', sql`jsonb_array_length(${table.eventTypes}) > 0`),
    check('webhook_endpoints_secret_version_positive', sql`${table.secretVersion} > 0`),
  ],
);

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').primaryKey(),
    endpointId: uuid('endpoint_id')
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => outboxEvents.id, { onDelete: 'restrict' }),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    status: text('status').notNull().default('queued'),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    responseStatus: integer('response_status'),
    responseSnippet: text('response_snippet'),
    lastError: text('last_error'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('webhook_deliveries_endpoint_event_key').on(table.endpointId, table.eventId),
    index('webhook_deliveries_claim_idx').on(table.status, table.nextAttemptAt),
    index('webhook_deliveries_project_created_idx').on(table.projectId, table.createdAt),
    check(
      'webhook_deliveries_status',
      sql`${table.status} in ('queued','sending','succeeded','failed')`,
    ),
    check('webhook_deliveries_attempt_nonnegative', sql`${table.attemptCount} >= 0`),
  ],
);
