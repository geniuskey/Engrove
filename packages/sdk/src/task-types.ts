export interface ProjectReference {
  workspaceId: string;
  projectId: string;
}

export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';
export type TaskStatusCategory = 'todo' | 'in_progress' | 'done';
export type TaskVisibility = 'project' | 'restricted';
export type TaskArchiveState = 'active' | 'archived' | 'all';
export type TaskEntityType =
  | 'record'
  | 'sample'
  | 'issue'
  | 'test_run'
  | 'measurement_result'
  | 'specification_evaluation'
  | 'dataset'
  | 'external_source'
  | 'file';

export interface TaskLink {
  id: string;
  entity_type: TaskEntityType;
  entity_id: string;
  created_at: string;
  title?: string | null;
  detail?: string | null;
  object_type_public_id?: string | null;
  provider?: string | null;
  url?: string | null;
  external_id?: string | null;
  version?: string | null;
  observed_on?: string | null;
  archived_at?: string | null;
  original_name?: string | null;
  content_type?: string | null;
  size_bytes?: number | null;
  file_series_name?: string | null;
  file_version_number?: number | null;
  file_status?: string | null;
}

/** The task API wire representation. Response fields intentionally retain their stable JSON names. */
export interface EngroveTask {
  id: string;
  project_id: string;
  task_number: number;
  task_key: string;
  title: string;
  description: string;
  status: string;
  status_category: TaskStatusCategory;
  priority: TaskPriority;
  visibility: TaskVisibility;
  labels: string[];
  parent_task_id: string | null;
  parent_task_key: string | null;
  parent_task_title: string | null;
  child_count: number;
  child_done_count: number;
  board_position: number;
  assignee_id: string | null;
  assignee_name: string | null;
  due_date: string | null;
  original_estimate_minutes: number | null;
  remaining_estimate_minutes: number | null;
  time_spent_minutes: number;
  row_version: number;
  open_blocker_count: number;
  archived_at: string | null;
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
  links?: TaskLink[];
}

export interface TaskPageInfo {
  limit: number;
  offset: number;
  total: number;
  hasNext: boolean;
}

export interface TaskPage {
  items: EngroveTask[];
  pageInfo: TaskPageInfo;
}

export interface TaskQueryInput {
  archiveState?: TaskArchiveState;
  entityType?: TaskEntityType;
  entityId?: string;
  query?: string;
  assignee?: 'mine' | 'unassigned' | string;
  priority?: TaskPriority;
  statuses?: string[];
  labels?: string[];
  hasDueDate?: boolean;
  sort?: 'rank' | 'title' | 'status' | 'priority' | 'assignee' | 'dueDate';
  direction?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface TaskCreateInput {
  title: string;
  description?: string;
  status?: string;
  priority?: TaskPriority;
  visibility?: TaskVisibility;
  labels?: string[];
  assigneeId?: string;
  dueDate?: string;
  originalEstimateMinutes?: number | null;
  remainingEstimateMinutes?: number | null;
  parentTaskId?: string;
  cloneSourceTaskId?: string;
  links?: Array<{ entityType: TaskEntityType; entityId: string }>;
}

export interface TaskUpdateInput {
  title: string;
  description?: string;
  status: string;
  priority?: TaskPriority;
  labels?: string[];
  assigneeId?: string;
  dueDate?: string;
  originalEstimateMinutes?: number | null;
  remainingEstimateMinutes?: number | null;
  parentTaskId?: string | null;
  rowVersion: number;
}

export interface TaskMoveInput {
  status: string;
  rowVersion: number;
  beforeTaskId?: string | null;
  placement?: 'top' | 'bottom';
}

export interface TaskBulkUpdateInput {
  items: Array<{ id: string; rowVersion: number }>;
  changes: {
    status?: string;
    priority?: TaskPriority;
    assigneeId?: string | null;
  };
}

export interface TaskCommentInput {
  body: string;
  mentionedUserIds?: string[];
  watch?: boolean;
}

export interface TaskComment {
  id: string;
  body: string;
  author_id: string;
  author_name: string;
  mentions: Array<{ id: string; displayName: string }>;
  row_version: number;
  revisions: TaskCommentRevision[];
  revision_count: number;
  edited_at: string | null;
  created_at: string;
}

export interface TaskCommentRevision {
  revision: number;
  body: string;
  mentions: Array<{ id: string; displayName: string }>;
  edited_by_name: string;
  edited_at: string;
}

export interface TaskStatusHistory {
  id: string;
  from_status: string | null;
  to_status: string;
  changed_by: string;
  changed_by_name: string;
  changed_at: string;
}

export interface TaskRelationship {
  id: string;
  relation_type: 'blocks' | 'relates_to';
  direction: 'outward' | 'inward';
  related_task_id: string;
  related_task_key: string;
  related_task_title: string;
  related_task_status: string;
  related_task_archived_at: string | null;
  created_at: string;
}

export interface TaskWorklog {
  id: string;
  duration_minutes: number;
  started_at: string;
  note: string;
  author_id: string;
  author_name: string;
  remaining_estimate_before: number | null;
  remaining_estimate_after: number | null;
  row_version: number;
  created_at: string;
  updated_at: string;
  can_edit: boolean;
}

export interface EngroveTaskDetail extends EngroveTask {
  relationships: TaskRelationship[];
  comments: TaskComment[];
  watchers: Array<{ user_id: string; display_name: string }>;
  status_history: TaskStatusHistory[];
  change_history: unknown[];
  link_history: unknown[];
  activity_page_info: TaskPageInfo;
  worklogs: TaskWorklog[];
  worklog_page_info: TaskPageInfo;
  watcher_count: number;
  watching: boolean;
  children: Array<{
    id: string;
    task_key: string;
    title: string;
    status: string;
    status_category: TaskStatusCategory;
    assignee_id: string | null;
    assignee_name: string | null;
    due_date: string | null;
    archived_at: string | null;
  }>;
  linked_key_dates: Array<{
    id: string;
    title: string;
    status: 'planned' | 'active' | 'at_risk' | 'completed';
    target_date: string;
    archived_at: string | null;
  }>;
}

export interface TaskCreateResponse extends EngroveTaskDetail {
  idempotent_replay: boolean;
}
