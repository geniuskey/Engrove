import { expect, test, type Page, type Request } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const workspaceId = '019fbcf9-e020-71da-935a-6a6a728b3700';
const backingProjectId = '019fbcf9-e020-71da-935a-6a6a728b3701';
const linkedProjectId = '019fbcf9-e020-71da-935a-6a6a728b3702';
const legacyProjectId = '019fbcf9-e020-71da-935a-6a6a728b3703';
const objectTypeId = '019fbcf9-e020-71da-935a-6a6a728b3704';
const stateFieldId = '019fbcf9-e020-71da-935a-6a6a728b3705';
const dateFieldId = '019fbcf9-e020-71da-935a-6a6a728b3706';
const measurementFieldId = '019fbcf9-e020-71da-935a-6a6a728b3718';
const temperatureFieldId = '019fbcf9-e020-71da-935a-6a6a728b3725';
const recordId = '019fbcf9-e020-71da-935a-6a6a728b3707';
const kanbanViewId = '019fbcf9-e020-71da-935a-6a6a728b3708';
const calendarViewId = '019fbcf9-e020-71da-935a-6a6a728b3709';
const taskId = '019fbcf9-e020-71da-935a-6a6a728b3712';
const clonedTaskId = '019fbcf9-e020-71da-935a-6a6a728b3716';
const conceptDateId = '019fbcf9-e020-71da-935a-6a6a728b3713';
const releaseDateId = '019fbcf9-e020-71da-935a-6a6a728b3714';
const savedFilterId = '019fbcf9-e020-71da-935a-6a6a728b3715';

interface ApiCapture {
  recordQueries: Array<Record<string, unknown>>;
  recordPatches: Array<Record<string, unknown>>;
  taskCreates: Array<Record<string, unknown>>;
  taskPatches: Array<Record<string, unknown>>;
  evaluationFollowUps: string[];
  measurementCreates: Array<Record<string, unknown>>;
  milestoneRequests: string[];
  notificationRequests: string[];
  reviewRequests: string[];
  overviewRequests: string[];
  workspaceSearchRequests: string[];
  flowRequests: string[];
  expireOncePath: string | null;
  clientErrorReports: Array<Record<string, unknown>>;
}

function body(request: Request): Record<string, unknown> {
  return request.postDataJSON() as Record<string, unknown>;
}

async function mockWorkspaceApi(page: Page): Promise<ApiCapture> {
  const capture: ApiCapture = {
    recordQueries: [],
    recordPatches: [],
    taskCreates: [],
    taskPatches: [],
    evaluationFollowUps: [],
    measurementCreates: [],
    milestoneRequests: [],
    notificationRequests: [],
    reviewRequests: [],
    overviewRequests: [],
    workspaceSearchRequests: [],
    flowRequests: [],
    expireOncePath: null,
    clientErrorReports: [],
  };
  await page.route('http://localhost:3000/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    const json = async (value: unknown) => route.fulfill({ json: value });

    if (pathname === '/health/ready') {
      await json({
        service: 'api',
        status: 'ok',
        version: '0.1.0',
        timestamp: '',
        requestId: 'e2e',
      });
      return;
    }
    if (pathname === '/api/v1/setup/status') {
      await json({ available: false });
      return;
    }
    if (pathname === '/api/v1/auth/me') {
      await json({
        user: {
          id: '019fbcf9-e020-71da-935a-6a6a728b3710',
          email: 'owner@example.com',
          displayName: 'Owner',
          organizationId: '019fbcf9-e020-71da-935a-6a6a728b3711',
          role: 'owner',
        },
      });
      return;
    }
    if (pathname === '/api/v1/auth/oidc/status') {
      await json({ enabled: false });
      return;
    }
    if (pathname === '/api/v1/auth/sign-in' && request.method() === 'POST') {
      await json({
        user: {
          id: '019fbcf9-e020-71da-935a-6a6a728b3710',
          email: 'owner@example.com',
          displayName: 'Owner',
          organizationId: '019fbcf9-e020-71da-935a-6a6a728b3711',
          role: 'owner',
        },
      });
      return;
    }
    if (pathname === '/api/v1/client-errors' && request.method() === 'POST') {
      const report = body(request);
      capture.clientErrorReports.push(report);
      await json({ accepted: true, errorId: report.errorId });
      return;
    }
    if (capture.expireOncePath === pathname) {
      capture.expireOncePath = null;
      await route.fulfill({
        status: 401,
        json: {
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Authentication required.',
            details: [],
            requestId: 'expired-e2e',
          },
        },
      });
      return;
    }
    if (pathname === '/api/v1/notifications') {
      capture.notificationRequests.push(url.search);
      const continuation = url.searchParams.get('offset') === '1';
      await json({
        items: [
          {
            id: continuation
              ? '019fbcf9-e020-71da-935a-6a6a728b3721'
              : '019fbcf9-e020-71da-935a-6a6a728b3720',
            type: 'task.updated',
            actorName: 'Ada Engineer',
            workspaceId,
            projectId: backingProjectId,
            taskId,
            taskTitle: continuation ? 'Older task activity' : 'Recent task activity',
            payload: {},
            readAt: '2026-08-09T12:00:00.000Z',
            createdAt: continuation ? '2026-08-01T12:00:00.000Z' : '2026-08-09T12:00:00.000Z',
          },
        ],
        unreadCount: 0,
        pageInfo: {
          limit: 30,
          offset: continuation ? 1 : 0,
          total: 2,
          hasNext: !continuation,
        },
      });
      return;
    }
    if (pathname === '/api/v1/workspaces') {
      await json({
        items: [
          {
            id: workspaceId,
            name: 'Engineering',
            slug: 'engineering',
            description: '',
            archivedAt: null,
          },
        ],
      });
      return;
    }
    if (
      pathname === `/api/v1/workspaces/${workspaceId}/projects` ||
      pathname === `/api/v1/workspaces/${workspaceId}/project-options`
    ) {
      await json({
        items: [
          {
            id: linkedProjectId,
            workspaceId,
            name: 'Motor program',
            key: 'MOTOR',
            description: '',
            status: 'active',
            rowVersion: 1,
            archivedAt: null,
          },
          {
            id: legacyProjectId,
            workspaceId,
            name: 'Legacy evidence',
            key: 'LEGACY',
            description: '',
            status: 'active',
            rowVersion: 1,
            archivedAt: null,
          },
        ],
        ...(pathname.endsWith('/project-options')
          ? { pageInfo: { limit: 20, total: 2, hasMore: false } }
          : {}),
      });
      return;
    }
    if (pathname === `/api/v1/workspaces/${workspaceId}/projects/${backingProjectId}`) {
      await json({
        id: backingProjectId,
        workspaceId,
        name: 'Engineering data',
        key: 'DATA',
        description: '',
        status: 'active',
        rowVersion: 1,
        archivedAt: null,
      });
      return;
    }
    if (pathname === `/api/v1/workspaces/${workspaceId}/data-context`) {
      await json({ projectId: backingProjectId, legacyProjectIds: [legacyProjectId] });
      return;
    }
    if (pathname === `/api/v1/workspaces/${workspaceId}/overview`) {
      capture.overviewRequests.push(url.search);
      const searched = url.searchParams.get('projectQuery') === 'Motor';
      const overviewProject = (id: string, name: string, key: string) => ({
        id,
        publicId: id,
        name,
        key,
        status: 'active',
        archivedAt: null,
        openTaskCount: name === 'Motor program' ? 4 : 0,
        blockedTaskCount: 0,
        overdueDateCount: 0,
        nextDate: null,
      });
      const projects = searched
        ? [overviewProject(linkedProjectId, 'Motor program', 'MOTOR')]
        : [
            overviewProject(linkedProjectId, 'Motor program', 'MOTOR'),
            overviewProject(legacyProjectId, 'Legacy evidence', 'LEGACY'),
          ];
      await json({
        workspace: {
          id: workspaceId,
          publicId: workspaceId,
          name: 'Engineering',
          description: '',
        },
        summary: {
          activeProjects: 2,
          openTasks: 4,
          blockedTasks: 0,
          overdueDates: 0,
          nextUpcomingDate: null,
        },
        projects,
        projectPageInfo: {
          limit: 20,
          offset: 0,
          total: projects.length,
          hasNext: false,
        },
        dates: [],
      });
      return;
    }
    if (pathname === `/api/v1/workspaces/${workspaceId}/project-references/query`) {
      const { ids } = body(request) as { ids?: string[] };
      const projects = [
        {
          id: backingProjectId,
          name: 'Engineering data',
          key: 'DATA',
          archivedAt: null,
        },
        {
          id: linkedProjectId,
          name: 'Motor program',
          key: 'MOTOR',
          archivedAt: null,
        },
        {
          id: legacyProjectId,
          name: 'Legacy evidence',
          key: 'LEGACY',
          archivedAt: null,
        },
      ];
      await json({ items: projects.filter((project) => ids?.includes(project.id)) });
      return;
    }
    if (pathname === `/api/v1/workspaces/${workspaceId}/search`) {
      capture.workspaceSearchRequests.push(url.search);
      await json({
        items: [
          {
            type: 'milestone',
            id: releaseDateId,
            publicId: null,
            title: 'Production release',
            key: '2099-02-20',
            projectPublicId: backingProjectId,
            projectName: 'Engineering data',
            workspaceShared: false,
          },
        ],
        pageInfo: { limit: 12, total: 1, hasMore: false },
      });
      return;
    }

    const base = `/api/v1/workspaces/${workspaceId}/projects/${backingProjectId}`;
    const task = {
      id: taskId,
      task_key: 'MOTOR-1',
      title: 'Review motor evidence',
      description: 'Confirm the result before release.',
      priority: 'high',
      assignee_id: null,
      assignee_name: null,
      due_date: null,
      archived_at: null,
      links: [],
      labels: [],
      parent_task_id: null,
      parent_task_key: null,
      parent_task_title: null,
      child_count: 0,
      child_done_count: 0,
    };
    const cloneRequest = capture.taskCreates.at(-1);
    const clonedTask = {
      ...task,
      id: clonedTaskId,
      task_key: 'MOTOR-2',
      title: String(cloneRequest?.title ?? `Copy of ${task.title}`),
      description: String(cloneRequest?.description ?? task.description),
      priority: String(cloneRequest?.priority ?? task.priority),
      due_date: cloneRequest?.dueDate ? String(cloneRequest.dueDate) : null,
    };
    const savedFilter = {
      id: savedFilterId,
      owner_id: '019fbcf9-e020-71da-935a-6a6a728b3710',
      owner_name: 'Owner',
      name: 'Motor triage',
      visibility: 'personal',
      favorite: true,
      is_owner: true,
      config: {
        query: 'motor',
        assignee: 'all',
        priority: 'high',
        statuses: ['todo'],
        labels: [],
        view: 'list',
        sort: 'priority',
        direction: 'desc',
        group: 'none',
        listColumns: ['title', 'priority', 'assignee'],
      },
    };
    const conceptDate = {
      id: conceptDateId,
      title: 'Concept review',
      description: 'Confirm the concept before detailed design.',
      status: 'planned',
      target_date: '2099-01-10',
      completed_at: null,
      row_version: 1,
      archived_at: null,
      linked_tasks: [],
      task_count: 0,
      completed_task_count: 0,
    };
    const releaseDate = {
      ...conceptDate,
      id: releaseDateId,
      title: 'Production release',
      target_date: '2099-02-20',
    };
    if (pathname === `${base}/milestones/${releaseDateId}`) {
      await json(releaseDate);
      return;
    }
    if (pathname === `${base}/milestones`) {
      capture.milestoneRequests.push(url.search);
      const searched = url.searchParams.get('query') === 'Production';
      const continuation = url.searchParams.get('offset') === '1';
      const items = searched || continuation ? [releaseDate] : [conceptDate];
      await json({
        items,
        pageInfo: {
          limit: 50,
          offset: continuation ? 1 : 0,
          total: searched ? 1 : 2,
          hasNext: !searched && !continuation,
        },
        summary: {
          planned: searched ? 1 : 2,
          active: 0,
          atRisk: 0,
          completed: 0,
          archived: 0,
        },
        nextMilestoneId: items[0]?.id ?? null,
      });
      return;
    }
    if (pathname === `${base}/reviews/inbox`) {
      capture.reviewRequests.push(url.search);
      const searched = url.searchParams.get('query') === 'Older';
      const continuation = url.searchParams.get('offset') === '1';
      const older = {
        id: '019fbcf9-e020-71da-935a-6a6a728b3723',
        subject: 'Older certificate review',
        status: 'open',
        reviewStatus: 'discussion',
        reviewerId: null,
        reviewerName: null,
        recordId,
        recordName: 'Motor redesign',
        objectTypeId,
        objectTypePublicId: 't1234567890abcd',
        objectTypeName: 'Project item',
        latestMessage: 'Confirm the archived certificate revision.',
        messageCount: 3,
        updatedAt: '2026-08-01T12:00:00.000Z',
      };
      const recent = {
        ...older,
        id: '019fbcf9-e020-71da-935a-6a6a728b3722',
        subject: 'Recent release review',
        reviewStatus: 'requested',
        reviewerId: '019fbcf9-e020-71da-935a-6a6a728b3710',
        reviewerName: 'Owner',
        latestMessage: 'Please approve this release.',
        messageCount: 1,
        updatedAt: '2026-08-09T12:00:00.000Z',
      };
      await json({
        items: searched || continuation ? [older] : [recent],
        pageInfo: {
          limit: 50,
          offset: continuation ? 1 : 0,
          total: searched ? 1 : 2,
          hasNext: !searched && !continuation,
        },
        summary: { waitingForMe: 7, openInvolved: 19 },
      });
      return;
    }
    if (pathname === `${base}/task-filters/${savedFilterId}` && request.method() === 'GET') {
      await json(savedFilter);
      return;
    }
    if (pathname === `${base}/task-filters` && request.method() === 'GET') {
      await json({
        items: [],
        pageInfo: { limit: 50, offset: 0, total: 0, hasNext: false },
      });
      return;
    }
    if (pathname === `${base}/task-flow-insights` && request.method() === 'GET') {
      capture.flowRequests.push(url.search);
      await json({
        calculated_at: '2026-08-11T12:00:00.000Z',
        window_days: Number(url.searchParams.get('windowDays') ?? 30),
        stale_after_days: 7,
        summary: {
          active_count: 2,
          wip_count: 1,
          stale_count: 1,
          completed_count: 4,
          average_cycle_hours: 54,
          median_cycle_hours: 48,
          p85_cycle_hours: 72,
        },
        statuses: [
          {
            key: 'todo',
            name: 'To do',
            category: 'todo',
            color: 'slate',
            position: 0,
            current_count: 1,
            wip_limit: null,
            average_age_hours: 24,
            oldest_age_hours: 24,
            stale_count: 0,
          },
          {
            key: 'in_progress',
            name: 'In progress',
            category: 'in_progress',
            color: 'sky',
            position: 1,
            current_count: 1,
            wip_limit: 1,
            average_age_hours: 216,
            oldest_age_hours: 216,
            stale_count: 1,
          },
          {
            key: 'done',
            name: 'Done',
            category: 'done',
            color: 'emerald',
            position: 2,
            current_count: 4,
            wip_limit: null,
            average_age_hours: null,
            oldest_age_hours: null,
            stale_count: 0,
          },
        ],
        flow_statuses: [
          { key: 'todo', name: 'To do', color: 'slate', position: 0, archived: false },
          {
            key: 'in_progress',
            name: 'In progress',
            color: 'sky',
            position: 1,
            archived: false,
          },
          { key: 'done', name: 'Done', color: 'emerald', position: 2, archived: false },
        ],
        flow_series: [
          { date: '2026-08-09', counts: { todo: 2, in_progress: 0, done: 0 } },
          { date: '2026-08-10', counts: { todo: 1, in_progress: 1, done: 1 } },
          { date: '2026-08-11', counts: { todo: 1, in_progress: 1, done: 4 } },
        ],
        throughput_series: [
          { date: '2026-08-09', created_count: 2, completed_count: 1 },
          { date: '2026-08-10', created_count: 1, completed_count: 1 },
          { date: '2026-08-11', created_count: 3, completed_count: 2 },
        ],
        aging_tasks: [
          {
            id: taskId,
            task_key: 'MOTOR-1',
            title: task.title,
            status: 'in_progress',
            status_name: 'In progress',
            assignee_name: null,
            age_hours: 216,
          },
        ],
        completed_tasks: [
          {
            id: taskId,
            task_key: 'MOTOR-1',
            title: task.title,
            completed_at: '2026-08-10T12:00:00.000Z',
            cycle_time_hours: 72,
          },
        ],
      });
      return;
    }
    if (pathname === `${base}/tasks` && request.method() === 'GET') {
      if (url.searchParams.get('entityId') === recordId) {
        await json({
          items: [],
          pageInfo: { limit: 50, offset: 0, total: 0, hasNext: false },
        });
        return;
      }
      await json({
        items: [
          { ...task, status: 'todo', board_position: 1024, row_version: 1 },
          ...(capture.taskCreates.length
            ? [{ ...clonedTask, status: 'todo', board_position: 2048, row_version: 1 }]
            : []),
        ],
      });
      return;
    }
    if (
      pathname === `${base}/specification-evaluations/019fbcf9-e020-71da-935a-6a6a728b3719/task` &&
      request.method() === 'POST'
    ) {
      capture.evaluationFollowUps.push(pathname);
      await json({
        ...task,
        id: clonedTaskId,
        task_key: 'MOTOR-10',
        title: 'Investigate failed specification: Motor redesign',
        status: 'todo',
        priority: 'high',
        board_position: 2048,
        row_version: 1,
        idempotent_replay: false,
      });
      return;
    }
    if (pathname === `${base}/tasks` && request.method() === 'POST') {
      capture.taskCreates.push(body(request));
      await json({
        ...clonedTask,
        title: String(capture.taskCreates.at(-1)?.title ?? clonedTask.title),
        status: 'todo',
        board_position: 2048,
        row_version: 1,
      });
      return;
    }
    if (pathname === `${base}/task-assignees` && request.method() === 'GET') {
      await json({ items: [] });
      return;
    }
    if (pathname === `${base}/task-labels` && request.method() === 'GET') {
      await json({ items: [] });
      return;
    }
    if (pathname === `${base}/task-candidates` && request.method() === 'GET') {
      await json({
        items: [
          {
            id: taskId,
            task_key: 'MOTOR-1',
            title: task.title,
            parent_task_id: null,
            child_count: 0,
          },
        ],
      });
      return;
    }
    if (
      (pathname === `${base}/tasks/${taskId}` || pathname === `${base}/tasks/MOTOR-1`) &&
      request.method() === 'GET'
    ) {
      await json({
        ...task,
        status: 'todo',
        board_position: 1024,
        row_version: 1,
        status_history: [],
        change_history: [],
        watchers: [],
        watcher_count: 0,
        watching: false,
        comments: [],
        relationships: [],
        link_history: [],
        children: [],
      });
      return;
    }
    if (
      (pathname === `${base}/tasks/${clonedTaskId}` || pathname === `${base}/tasks/MOTOR-2`) &&
      request.method() === 'GET'
    ) {
      await json({
        ...clonedTask,
        title: String(capture.taskCreates.at(-1)?.title ?? clonedTask.title),
        status: 'todo',
        board_position: 2048,
        row_version: 1,
        status_history: [],
        change_history: [],
        watchers: [],
        watcher_count: 0,
        watching: false,
        comments: [],
        relationships: [
          {
            id: '019fbcf9-e020-71da-935a-6a6a728b3717',
            relationship_type: 'relates_to',
            related_task_id: taskId,
            related_task_key: 'MOTOR-1',
            related_task_title: task.title,
            related_task_status: 'todo',
            related_task_archived_at: null,
            direction: 'outward',
          },
        ],
        link_history: [],
        children: [],
      });
      return;
    }
    if (pathname === `${base}/tasks/${taskId}` && request.method() === 'PATCH') {
      const patch = body(request);
      capture.taskPatches.push(patch);
      await json({ ...task, status: patch.status, row_version: 2 });
      return;
    }
    if (pathname === `${base}/tasks/${taskId}/move` && request.method() === 'POST') {
      const patch = body(request);
      capture.taskPatches.push(patch);
      await json({
        ...task,
        status: patch.status,
        board_position: 2048,
        row_version: 2,
      });
      return;
    }
    if (pathname === `${base}/object-types`) {
      await json({
        items: [
          {
            id: objectTypeId,
            projectId: backingProjectId,
            name: 'Project item',
            pluralName: 'Project items',
            key: 'project-item',
            icon: 'table',
            description: '',
            system: false,
          },
        ],
      });
      return;
    }
    if (pathname === `${base}/object-types/${objectTypeId}` && request.method() === 'GET') {
      await json({
        id: objectTypeId,
        projectId: backingProjectId,
        name: 'Project item',
        pluralName: 'Project items',
        key: 'project-item',
        icon: 'table',
        description: '',
        system: false,
      });
      return;
    }
    if (pathname === `${base}/object-types/${objectTypeId}/fields`) {
      await json({
        items: [
          {
            id: stateFieldId,
            objectTypeId,
            name: 'State',
            key: 'state',
            description: '',
            fieldType: 'single_select',
            required: true,
            unique: false,
            position: 0,
            config: { options: [{ key: 'ready', label: 'Ready' }] },
            defaultValue: 'ready',
            projectionStatus: 'ready',
          },
          {
            id: dateFieldId,
            objectTypeId,
            name: 'Scheduled',
            key: 'scheduled',
            description: '',
            fieldType: 'date',
            required: true,
            unique: false,
            position: 1,
            config: {},
            projectionStatus: 'ready',
          },
          {
            id: measurementFieldId,
            objectTypeId,
            name: 'Displacement',
            key: 'displacement',
            description: '',
            fieldType: 'measurement',
            required: false,
            unique: false,
            position: 2,
            config: {
              dimension: 'length',
              canonicalUnit: 'mm',
              allowedUnits: ['mm'],
              displayPrecision: 3,
            },
            projectionStatus: 'ready',
          },
          {
            id: temperatureFieldId,
            objectTypeId,
            name: 'Temperature',
            key: 'temperature',
            description: '',
            fieldType: 'measurement',
            required: false,
            unique: false,
            position: 3,
            config: {
              dimension: 'temperature',
              canonicalUnit: 'K',
              allowedUnits: ['K', 'degC'],
              displayPrecision: 2,
            },
            projectionStatus: 'ready',
          },
        ],
      });
      return;
    }
    if (pathname === `${base}/object-types/${objectTypeId}/views`) {
      const common = {
        objectTypeId,
        fieldWidths: {},
        filters: [],
        sorts: [{ systemField: 'displayName', direction: 'asc' }],
        rowDensity: 'compact',
        pageSize: 25,
        rowVersion: 1,
        archivedAt: null,
        updatedAt: '2026-08-02T00:00:00.000Z',
      };
      await json({
        items: [
          {
            ...common,
            id: kanbanViewId,
            name: 'Workflow board',
            viewType: 'kanban',
            config: {
              visibleFieldIds: [stateFieldId, dateFieldId],
              fieldWidths: common.fieldWidths,
              filters: common.filters,
              sorts: common.sorts,
              rowDensity: common.rowDensity,
              pageSize: common.pageSize,
              viewOptions: { groupFieldId: stateFieldId },
            },
          },
          {
            ...common,
            id: calendarViewId,
            name: 'Schedule',
            viewType: 'calendar',
            config: {
              visibleFieldIds: [stateFieldId, dateFieldId],
              fieldWidths: common.fieldWidths,
              filters: common.filters,
              sorts: common.sorts,
              rowDensity: common.rowDensity,
              pageSize: common.pageSize,
              viewOptions: { dateFieldId },
            },
          },
        ],
      });
      return;
    }
    if (pathname === `${base}/object-types/${objectTypeId}/records/query`) {
      const query = body(request);
      const groupings = Array.isArray(query.groupings)
        ? (query.groupings as Array<{ fieldId: string }>)
        : [];
      const summaries = Array.isArray(query.summaries)
        ? (query.summaries as Array<Record<string, unknown>>)
        : [];
      capture.recordQueries.push(query);
      await json({
        items: [
          {
            id: recordId,
            objectTypeId,
            contextProjectId: null,
            displayName: 'Motor redesign',
            values: { state: 'ready', scheduled: '2026-08-15' },
            relations: {},
            fileReferences: {},
            datasetReferences: {},
            rowVersion: 1,
            archivedAt: null,
            createdAt: '2026-08-02T00:00:00.000Z',
            updatedAt: '2026-08-02T00:00:00.000Z',
          },
        ],
        page: 1,
        pageSize: Number(query.pageSize ?? 25),
        total: 1,
        ...(query.groupByFieldId ? { groups: [{ value: 'ready', count: 7 }] } : {}),
        ...(groupings.length
          ? {
              groupHierarchy: groupings.map((grouping, index) => ({
                level: index + 1,
                fieldId: grouping.fieldId,
                path: groupings.slice(0, index + 1).map((pathGrouping) => ({
                  fieldId: pathGrouping.fieldId,
                  value: pathGrouping.fieldId === stateFieldId ? 'ready' : '2026-08-15',
                })),
                count: 7,
                ...(summaries.length
                  ? {
                      summaries: summaries.map((summary) => ({
                        ...summary,
                        value: '2026-08-15',
                        unit: null,
                      })),
                    }
                  : {}),
              })),
            }
          : {}),
        ...(summaries.length
          ? {
              summaries: summaries.map((summary) => ({
                ...summary,
                value: '2026-08-15',
                unit: null,
              })),
            }
          : {}),
      });
      return;
    }
    if (
      pathname === `${base}/object-types/${objectTypeId}/records/${recordId}` &&
      request.method() === 'GET'
    ) {
      await json({
        id: recordId,
        objectTypeId,
        contextProjectId: null,
        displayName: 'Motor redesign',
        values: { state: 'ready', scheduled: '2026-08-15' },
        relations: {},
        fileReferences: {},
        datasetReferences: {},
        measurements: {
          [measurementFieldId]: {
            resultId: '019fbcf9-e020-71da-935a-6a6a728b3724',
            value: '24.0',
            unit: 'mm',
            status: 'fail',
          },
        },
        rowVersion: 1,
        archivedAt: null,
        createdAt: '2026-08-02T00:00:00.000Z',
        updatedAt: '2026-08-02T00:00:00.000Z',
      });
      return;
    }
    if (
      pathname === `${base}/object-types/${objectTypeId}/records/${recordId}/comments` &&
      request.method() === 'GET'
    ) {
      await json({
        items: [],
        pageInfo: { limit: 50, offset: 0, total: 0, hasNext: false },
      });
      return;
    }
    if (
      pathname === `${base}/object-types/${objectTypeId}/records/${recordId}/reviews` &&
      request.method() === 'GET'
    ) {
      await json({
        items: [],
        pageInfo: { limit: 20, offset: 0, total: 0, hasNext: false },
        summary: { open: 0, resolved: 0 },
      });
      return;
    }
    if (
      pathname === `${base}/object-types/${objectTypeId}/records/${recordId}/history` &&
      request.method() === 'GET'
    ) {
      await json({
        items: [],
        pageInfo: { limit: 50, offset: 0, total: 0, hasNext: false },
      });
      return;
    }
    if (
      pathname === `${base}/records/${recordId}/measurement-results` &&
      request.method() === 'GET'
    ) {
      await json({
        items: [
          {
            id: '019fbcf9-e020-71da-935a-6a6a728b3724',
            field_id: measurementFieldId,
            canonical_value: '24.0',
            canonical_unit: 'mm',
            original_value: '24.0',
            original_unit: 'mm',
            measured_at: '2026-08-10T12:00:00.000Z',
            supersedes_result_id: null,
            current: true,
            evaluation: {
              id: '019fbcf9-e020-71da-935a-6a6a728b3719',
              measurement_field_id: measurementFieldId,
              measurement_result_id: '019fbcf9-e020-71da-935a-6a6a728b3724',
              status: 'fail',
              reason_code: 'above_upper_limit',
              evaluated_at: '2026-08-10T12:00:01.000Z',
            },
          },
        ],
        pageInfo: { limit: 50, offset: 0, total: 1, hasNext: false },
      });
      return;
    }
    if (pathname === `${base}/measurement-results` && request.method() === 'POST') {
      const measurement = body(request);
      capture.measurementCreates.push(measurement);
      await json({
        id: '019fbcf9-e020-71da-935a-6a6a728b3726',
        field_id: measurement.fieldId,
        canonical_value: measurement.value,
        canonical_unit: measurement.unit,
        original_value: measurement.value,
        original_unit: measurement.unit,
        measured_at: measurement.measuredAt,
        supersedes_result_id: null,
        current: true,
        evaluation: null,
      });
      return;
    }
    if (
      pathname === `${base}/object-types/${objectTypeId}/records/${recordId}` &&
      request.method() === 'PATCH'
    ) {
      const patch = body(request);
      capture.recordPatches.push(patch);
      await json({
        id: recordId,
        objectTypeId,
        contextProjectId: patch.contextProjectId,
        displayName: 'Motor redesign',
        values: { state: 'ready', scheduled: '2026-08-15' },
        relations: {},
        fileReferences: {},
        datasetReferences: {},
        rowVersion: 2,
        archivedAt: null,
        createdAt: '2026-08-02T00:00:00.000Z',
        updatedAt: '2026-08-02T01:00:00.000Z',
      });
      return;
    }

    await route.fulfill({
      status: 500,
      json: { error: { code: 'UNMOCKED_REQUEST', message: `${request.method()} ${pathname}` } },
    });
  });
  return capture;
}

test('filters and edits project context while preserving legacy engineering data links', async ({
  page,
}) => {
  const capture = await mockWorkspaceApi(page);
  await page.goto(`/workspaces/${workspaceId}/data`);

  await expect(page.getByRole('heading', { name: 'Data library' })).toBeVisible();
  expect(
    await page.getByRole('button', { name: 'New record' }).evaluate((element) => {
      return getComputedStyle(element).backgroundColor;
    }),
  ).not.toBe('rgba(0, 0, 0, 0)');
  const legacyHelp = page.getByLabel('Legacy engineering tables');
  await expect(legacyHelp).toBeVisible();
  await legacyHelp.click();
  await expect(page.getByRole('link', { name: 'Legacy evidence' })).toHaveAttribute(
    'href',
    `/workspaces/${workspaceId}/projects/${legacyProjectId}/data`,
  );
  await legacyHelp.click();
  await expect(page.getByRole('columnheader', { name: 'Project' })).toBeVisible();

  const stateResizeHandle = page.getByRole('separator', { name: 'Resize State column' });
  await expect(stateResizeHandle).toHaveAttribute('aria-valuenow', '176');
  const resizeBox = await stateResizeHandle.boundingBox();
  expect(resizeBox).not.toBeNull();
  await page.mouse.move(resizeBox!.x + resizeBox!.width / 2, resizeBox!.y + resizeBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    resizeBox!.x + resizeBox!.width / 2 + 64,
    resizeBox!.y + resizeBox!.height / 2,
  );
  await page.mouse.up();
  await expect(stateResizeHandle).toHaveAttribute('aria-valuenow', '240');

  const stateOrderHandle = page.getByRole('button', { name: 'Reorder State column' });
  const scheduledHeader = page.getByRole('columnheader', { name: 'Scheduled' });
  await stateOrderHandle.dragTo(scheduledHeader);
  const stateHeaderBox = await page.getByRole('columnheader', { name: 'State' }).boundingBox();
  const scheduledHeaderBox = await scheduledHeader.boundingBox();
  expect(stateHeaderBox).not.toBeNull();
  expect(scheduledHeaderBox).not.toBeNull();
  expect(scheduledHeaderBox!.x).toBeLessThan(stateHeaderBox!.x);

  await page.getByRole('combobox', { name: 'Project filter' }).click();
  await page.getByRole('option', { name: 'Motor program' }).click();
  await expect
    .poll(() => capture.recordQueries.some((query) => query.contextProjectId === linkedProjectId))
    .toBe(true);

  await page.getByRole('combobox', { name: 'Project for Motor redesign' }).click();
  await page.getByRole('option', { name: 'Motor program' }).click();
  await expect.poll(() => capture.recordPatches.at(-1)?.contextProjectId).toBe(linkedProjectId);

  await page.getByRole('combobox', { name: 'Summary for Scheduled' }).selectOption('min');
  await expect
    .poll(() => capture.recordQueries.at(-1)?.summaries)
    .toEqual([{ fieldId: dateFieldId, operation: 'min' }]);
  await page.getByRole('button', { name: 'Group' }).click();
  await page.getByRole('button', { name: /Add group/ }).click();
  await expect
    .poll(() => capture.recordQueries.at(-1)?.groupings)
    .toEqual([{ fieldId: stateFieldId, direction: 'asc', enabled: true }]);
  const stateGroup = page.getByRole('button', { name: 'Collapse Ready' });
  await expect(stateGroup).toContainText('7');
  await expect(page.getByLabel('Scheduled Minimum: 2026-08-15')).toBeVisible();
  await stateGroup.click();
  await expect(page.getByRole('button', { name: 'Quick view Motor redesign' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Expand Ready' }).click();
  await expect(page.getByRole('button', { name: 'Quick view Motor redesign' })).toBeVisible();

  await page.getByRole('combobox', { name: 'Project filter' }).click();
  await page.getByRole('option', { name: 'All projects' }).click();
  await expect.poll(() => capture.recordQueries.at(-1)?.contextProjectId).toBeUndefined();
});

test('creates a failed-evaluation follow-up and exposes its task detail link', async ({ page }) => {
  const capture = await mockWorkspaceApi(page);
  await page.goto(
    `/workspaces/${workspaceId}/projects/${backingProjectId}/data/${objectTypeId}/records/${recordId}`,
  );

  await expect(page.getByRole('heading', { name: 'Motor redesign' })).toBeVisible();
  const createFollowUp = page.getByRole('button', { name: 'Create follow-up task' });
  await expect(createFollowUp).toBeVisible();
  await createFollowUp.hover();
  await expect(page.getByRole('tooltip', { name: 'Create follow-up task' })).toBeVisible();
  await createFollowUp.click();

  await expect.poll(() => capture.evaluationFollowUps.length).toBe(1);
  const taskLink = page.getByRole('link', { name: 'Open follow-up task MOTOR-10' });
  await expect(taskLink).toBeVisible();
  await expect(taskLink).toHaveAttribute(
    'href',
    `/workspaces/${workspaceId}/projects/${backingProjectId}/tasks?task=MOTOR-10`,
  );
  await expect(page.getByRole('button', { name: 'Create follow-up task' })).toHaveCount(0);
});

test('keeps a valid measurement field and unit pair for continuous entry', async ({ page }) => {
  const capture = await mockWorkspaceApi(page);
  await page.goto(
    `/workspaces/${workspaceId}/projects/${backingProjectId}/data/${objectTypeId}/records/${recordId}`,
  );

  const field = page.getByRole('combobox', { name: 'Measurement field' });
  const unit = page.getByRole('combobox', { name: 'Unit' });
  const measuredAt = page.locator('input[name="measuredAt"]');
  await expect(field).toHaveValue(measurementFieldId);
  await expect(unit).toHaveValue('mm');
  await expect(measuredAt).not.toHaveValue('');

  await field.selectOption(temperatureFieldId);
  await expect(unit).toHaveValue('K');
  await expect(unit.getByRole('option', { name: 'degC' })).toBeAttached();
  await unit.selectOption('degC');
  await page.getByLabel('Decimal value').fill('24.5');
  await page.getByRole('button', { name: 'Record measurement' }).click();

  await expect.poll(() => capture.measurementCreates.length).toBe(1);
  expect(capture.measurementCreates[0]).toMatchObject({
    fieldId: temperatureFieldId,
    unit: 'degC',
    value: '24.5',
  });
  await expect(field).toHaveValue(temperatureFieldId);
  await expect(unit).toHaveValue('degC');
  await expect(measuredAt).not.toHaveValue('');
});

test('lands the retired project directory on the searchable workspace overview', async ({
  page,
}) => {
  const capture = await mockWorkspaceApi(page);
  await page.goto(`/workspaces/${workspaceId}/projects`);

  const projects = page.getByRole('region', { name: 'Project pulse' });
  await expect(page).toHaveURL(`/workspaces/${workspaceId}`);
  await expect(projects).toBeVisible();
  await expect(page.getByRole('link', { name: /Legacy evidence/ })).toBeVisible();

  await page.getByRole('searchbox', { name: 'Search projects' }).fill('Motor');
  await expect
    .poll(() => capture.overviewRequests.some((request) => request.includes('projectQuery=Motor')))
    .toBe(true);
  await expect(page.getByRole('link', { name: /Motor program/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Legacy evidence/ })).toHaveCount(0);
  await expect(page.getByText('1 of 1 projects')).toBeVisible();
});

test('opens an exact key date from workspace command search', async ({ page }) => {
  const capture = await mockWorkspaceApi(page);
  await page.goto(`/workspaces/${workspaceId}`);

  await page.getByRole('button', { name: 'Open command palette' }).click();
  await page.getByRole('searchbox', { name: 'Search commands' }).fill('Production');
  const result = page.getByRole('button', {
    name: /Production release.*Key date · 2099-02-20 · Engineering data/,
  });
  await expect(result).toBeVisible();
  await result.click();

  await expect(page).toHaveURL(
    `/workspaces/${workspaceId}/projects/${backingProjectId}/milestones?milestone=${releaseDateId}`,
  );
  await expect(page.getByRole('dialog', { name: 'Production release' })).toBeVisible();
  await expect
    .poll(() =>
      capture.workspaceSearchRequests.some((request) => request.includes('query=Production')),
    )
    .toBe(true);
});

test('requests complete Kanban groups and the visible Calendar month', async ({ page }) => {
  const capture = await mockWorkspaceApi(page);
  await page.goto(`/workspaces/${workspaceId}/data?type=${objectTypeId}&view=${kanbanViewId}`);

  await expect(page.getByRole('heading', { name: 'Ready' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ready' }).locator('..')).toContainText('7');
  await expect
    .poll(() =>
      capture.recordQueries.some(
        (query) => query.groupByFieldId === stateFieldId && query.pageSize === 100,
      ),
    )
    .toBe(true);

  await page.getByRole('button', { name: 'Schedule' }).click();
  await expect(page.getByRole('heading', { name: 'August 2026' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Motor redesign' })).toBeVisible();
  await expect
    .poll(() =>
      capture.recordQueries.some((query) => {
        const filters = query.filters as Array<Record<string, unknown>> | undefined;
        return (
          query.pageSize === 100 &&
          filters?.some(
            (filter) =>
              filter.fieldId === dateFieldId &&
              filter.operator === 'gte' &&
              filter.value === '2026-08-01',
          )
        );
      }),
    )
    .toBe(true);

  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(page.getByRole('heading', { name: 'September 2026' })).toBeVisible();
  await expect
    .poll(() =>
      capture.recordQueries.some((query) => {
        const filters = query.filters as Array<Record<string, unknown>> | undefined;
        return filters?.some((filter) => filter.value === '2026-09-01') ?? false;
      }),
    )
    .toBe(true);
});

test('restores an exact key-date deep link and searches the bounded timeline', async ({ page }) => {
  const capture = await mockWorkspaceApi(page);
  await page.goto(
    `/workspaces/${workspaceId}/projects/${backingProjectId}/milestones?milestone=${releaseDateId}`,
  );

  const dialog = page.getByRole('dialog', { name: 'Production release' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close key date' }).click();
  await page.getByRole('button', { name: 'Load more key dates (1 of 2)' }).click();
  await expect(page.getByText('Production release')).toBeVisible();

  await page.getByRole('searchbox', { name: 'Search key dates' }).fill('Production');
  await expect
    .poll(() => capture.milestoneRequests.some((request) => request.includes('query=Production')))
    .toBe(true);
  await expect(page.getByText('Concept review')).toHaveCount(0);
  await expect(page.getByText('Production release')).toBeVisible();
});

test('keeps recent notifications while loading older inbox activity', async ({ page }) => {
  const capture = await mockWorkspaceApi(page);
  await page.goto(`/workspaces/${workspaceId}/projects/${backingProjectId}/tasks`);

  await page.getByRole('button', { name: 'Notifications, 0 unread' }).click();
  await expect(page.getByText('Recent task activity')).toBeVisible();
  await page.getByRole('button', { name: 'Load more notifications (1 of 2)' }).click();
  await expect(page.getByText('Older task activity')).toBeVisible();
  await expect(page.getByText('Recent task activity')).toBeVisible();
  await expect
    .poll(() => capture.notificationRequests.some((request) => request.includes('offset=1')))
    .toBe(true);
});

test('pages and searches the exact review inbox without undercounting its summary', async ({
  page,
}) => {
  const capture = await mockWorkspaceApi(page);
  await page.goto(`/workspaces/${workspaceId}/projects/${backingProjectId}/reviews`);

  await expect(page.getByText('Recent release review')).toBeVisible();
  await expect(page.getByText('Waiting for my decision').locator('..')).toContainText('7');
  await expect(page.getByText('Open discussions involving me').locator('..')).toContainText('19');
  await page.getByRole('button', { name: 'Load more reviews (1 of 2)' }).click();
  await expect(page.getByText('Older certificate review')).toBeVisible();

  await page.getByRole('searchbox', { name: 'Search reviews' }).fill('Older');
  await expect
    .poll(() => capture.reviewRequests.some((request) => request.includes('query=Older')))
    .toBe(true);
  await expect(page.getByText('Recent release review')).toHaveCount(0);
  await expect(page.getByText('Older certificate review')).toBeVisible();
});

test('opens project flow insights and changes the completion window', async ({ page }) => {
  const capture = await mockWorkspaceApi(page);
  await page.goto(`/workspaces/${workspaceId}/projects/${backingProjectId}/tasks`);

  await page.getByRole('button', { name: 'Flow insights' }).click();
  const insights = page.getByRole('region', { name: 'Flow insights' });
  await expect(insights).toBeVisible();
  await expect(insights.getByText('Median cycle time')).toBeVisible();
  await expect(insights.getByText('2d')).toBeVisible();
  await expect(
    insights.getByRole('img', { name: 'Cumulative flow for the past 30 days' }),
  ).toBeVisible();
  await expect(
    insights.getByRole('img', {
      name: 'Created versus completed over the past 30 days: 6 created and 4 completed',
    }),
  ).toBeVisible();
  await expect(insights.getByLabel('In progress: 1 tasks, average age 9d')).toBeVisible();
  await expect(insights.getByText('Review motor evidence')).toBeVisible();
  await insights.getByLabel('Flow insight window').selectOption('60');
  await expect
    .poll(() => capture.flowRequests.some((request) => request.includes('windowDays=60')))
    .toBe(true);
});

test('recovers an expired session without losing the current project route', async ({ page }) => {
  const capture = await mockWorkspaceApi(page);
  const taskPath = `/workspaces/${workspaceId}/projects/${backingProjectId}/tasks`;
  await page.goto(taskPath);
  await expect(page.getByRole('heading', { name: 'Engineering tasks' })).toBeVisible();

  capture.expireOncePath = `/api/v1${taskPath.replace('/tasks', '/task-flow-insights')}`;
  await page.getByRole('button', { name: 'Flow insights' }).click();

  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText(
    'Your session expired. Sign in again to continue from the same place.',
  );
  await page.getByRole('textbox', { name: 'Email' }).fill('owner@example.com');
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(taskPath);
  await expect(page.getByRole('heading', { name: 'Engineering tasks' })).toBeVisible();
});

test('contains a lazy-view failure and reports only bounded diagnostics', async ({ page }) => {
  const capture = await mockWorkspaceApi(page);
  await page.route('**/src/TasksPage.tsx*', (route) => route.abort('failed'));
  const taskPath = `/workspaces/${workspaceId}/projects/${backingProjectId}/tasks`;
  await page.goto(taskPath);

  const recovery = page.getByRole('alert');
  await expect(recovery.getByRole('heading')).toHaveText('This view could not be displayed');
  await expect(recovery).toContainText('A required application update could not be loaded.');
  await expect(recovery.getByRole('button', { name: 'Reload Engrove' })).toBeVisible();
  await expect(recovery.getByRole('button', { name: 'Try this view again' })).toHaveCount(0);
  await expect(page).toHaveURL(taskPath);
  await expect.poll(() => capture.clientErrorReports.length).toBe(1);
  expect(capture.clientErrorReports[0]).toMatchObject({
    kind: 'chunk_load_error',
    route: taskPath,
    errorName: 'TypeError',
  });
  expect(capture.clientErrorReports[0]).not.toHaveProperty('message');
});

test('restores a saved task filter URL and clears it after a manual edit', async ({ page }) => {
  await mockWorkspaceApi(page);
  await page.goto(
    `/workspaces/${workspaceId}/projects/${backingProjectId}/tasks?task=${taskId}&filter=${savedFilterId}`,
  );

  await expect(page.getByRole('searchbox', { name: 'Search tasks' })).toHaveValue('motor');
  await expect(page.getByRole('combobox', { name: 'Saved filters' })).toHaveValue(savedFilterId);
  await expect(page).toHaveURL(new RegExp(`task=MOTOR-1.*filter=${savedFilterId}`));

  await page.getByRole('combobox', { name: 'Filter by priority' }).selectOption('low');
  await expect(page).toHaveURL(/\?task=MOTOR-1$/);
  await expect(page.getByRole('combobox', { name: 'Saved filters' })).toHaveValue('');
});

test('moves a task card to another status column with drag and drop', async ({ page }) => {
  const capture = await mockWorkspaceApi(page);
  await page.goto(`/workspaces/${workspaceId}/projects/${backingProjectId}/tasks`);

  const card = page.getByRole('button', { name: 'Review motor evidence, To do' });
  const destination = page.getByRole('region', { name: 'In progress, tasks: 0' });
  await expect(card).toBeVisible();
  await card.dragTo(destination, {
    sourcePosition: { x: 16, y: 18 },
    targetPosition: { x: 48, y: 80 },
  });

  await expect(
    page.getByRole('button', { name: 'Review motor evidence, In progress' }),
  ).toBeVisible();
  await expect.poll(() => capture.taskPatches.at(-1)?.status).toBe('in_progress');
});

test('duplicates a task as an editable draft and opens the persisted copy', async ({ page }) => {
  const capture = await mockWorkspaceApi(page);
  await page.goto(`/workspaces/${workspaceId}/projects/${backingProjectId}/tasks`);

  const source = page.getByRole('button', { name: 'Review motor evidence, To do' });
  await expect(source).toBeVisible();
  await source.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Duplicate task' }).click();

  const creator = page.getByRole('dialog', { name: 'Duplicate task' });
  await expect(creator).toBeVisible();
  await expect(creator).toContainText('Based on MOTOR-1 · Review motor evidence');
  await expect(creator.getByRole('textbox', { name: 'Title' })).toHaveValue(
    'Copy of Review motor evidence',
  );
  await expect(creator.getByRole('textbox', { name: 'Description' })).toHaveValue(
    'Confirm the result before release.',
  );

  await creator.getByRole('textbox', { name: 'Title' }).fill('Review motor evidence follow-up');
  await creator.getByRole('button', { name: 'Create duplicate' }).click();

  await expect.poll(() => capture.taskCreates.at(-1)?.cloneSourceTaskId).toBe(taskId);
  expect(capture.taskCreates.at(-1)).toMatchObject({
    title: 'Review motor evidence follow-up',
    description: 'Confirm the result before release.',
    priority: 'high',
  });
  expect(capture.taskCreates.at(-1)).not.toHaveProperty('status');
  const cloneDetail = page.getByRole('dialog', { name: 'Review motor evidence follow-up' });
  await expect(cloneDetail).toBeVisible();
  await cloneDetail.getByRole('button', { name: 'Previous' }).click();
  await expect(page.getByRole('dialog', { name: 'Review motor evidence' })).toBeVisible();
  await expect(page).toHaveURL(/\?task=MOTOR-1$/);
});

test('keeps the primary workspace, data, and task workflows free of detectable WCAG violations', async ({
  page,
}) => {
  await mockWorkspaceApi(page);
  async function expectNoViolations(label: string) {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const violations = results.violations.map(({ id, impact, nodes }) => ({
      id,
      impact,
      nodes: nodes.map((node) => ({
        target: node.target.join(' '),
        html: node.html,
        failure: node.failureSummary,
      })),
    }));
    expect(violations, `Accessibility violations on ${label}`).toEqual([]);
  }

  const routes = [
    {
      path: `/workspaces/${workspaceId}`,
      ready: page.getByRole('heading', { name: 'Engineering' }),
    },
    {
      path: `/workspaces/${workspaceId}/data`,
      ready: page.getByRole('heading', { name: 'Data library' }),
    },
    {
      path: `/workspaces/${workspaceId}/projects/${backingProjectId}/tasks`,
      ready: page.getByRole('heading', { name: 'Engineering tasks' }),
    },
  ];

  for (const theme of ['light', 'dark'] as const) {
    await page.goto('/');
    await page.evaluate((selectedTheme) => {
      window.localStorage.setItem('engrove-theme', selectedTheme);
      window.localStorage.setItem('engrove-theme-explicit', 'true');
    }, theme);
    for (const route of routes) {
      await page.goto(route.path);
      await expect(route.ready).toBeVisible();
      await expectNoViolations(`${route.path} (${theme})`);

      if (route.path.endsWith('/data')) {
        await page.getByRole('button', { name: 'Quick view Motor redesign' }).click();
        await expect(page.getByRole('dialog', { name: 'Motor redesign' })).toBeVisible();
        await expectNoViolations(`${route.path} quick view (${theme})`);
        await page.keyboard.press('Escape');
      }
      if (route.path.endsWith('/tasks')) {
        await page.getByRole('button', { name: 'Review motor evidence, To do' }).click();
        await expect(page.getByRole('dialog', { name: 'Review motor evidence' })).toBeVisible();
        await expectNoViolations(`${route.path} detail (${theme})`);
        await page.keyboard.press('Escape');
      }
    }
  }
});
