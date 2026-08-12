import { NestFactory } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { AppModule } from './app.module.js';
import { createOpenApiDocument } from './openapi.js';

describe('OpenAPI contract', () => {
  it('documents authentication, errors, quotas, and executable core request schemas', async () => {
    const application = await NestFactory.create(AppModule.register({} as never), {
      logger: false,
    });
    try {
      await application.init();
      const document = createOpenApiDocument(application, 'test-version');
      const tasks = document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks']!;
      const clientErrors = document.paths['/api/v1/client-errors']!;
      const workspaceSearch = document.paths['/api/v1/workspaces/{workspaceId}/search']!;
      const auditEvents = document.paths['/api/v1/audit-events']!;
      const workspaceOverview = document.paths['/api/v1/workspaces/{workspaceId}/overview']!;
      const workspaces = document.paths['/api/v1/workspaces']!;
      const members = document.paths['/api/v1/members']!;
      const memberGroups = document.paths['/api/v1/member-groups']!;
      const workspace = document.paths['/api/v1/workspaces/{workspaceId}']!;
      const workspaceAccess = document.paths['/api/v1/workspaces/{workspaceId}/access']!;
      const projects = document.paths['/api/v1/workspaces/{workspaceId}/projects']!;
      const project = document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}']!;
      const projectAccess =
        document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/access']!;
      const projectOptions = document.paths['/api/v1/workspaces/{workspaceId}/project-options']!;
      const projectReferences =
        document.paths['/api/v1/workspaces/{workspaceId}/project-references/query']!;
      const dashboardMetrics =
        document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/dashboard-metrics']!;
      const charts =
        document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/charts']!;
      const dashboards =
        document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/dashboards']!;
      const chartArchive =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/charts/{chartId}/archive'
        ]!;
      const chartRestore =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/charts/{chartId}/restore'
        ]!;
      const dashboardArchive =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/dashboards/{dashboardId}/archive'
        ]!;
      const dashboardRestore =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/dashboards/{dashboardId}/restore'
        ]!;
      const datasets =
        document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/datasets']!;
      const files = document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/files']!;
      const backgroundJobs =
        document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/background-jobs']!;
      const measurements =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/records/{recordId}/measurement-results'
        ]!;
      const specifications =
        document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/specifications']!;
      const specificationEvaluations =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/specification-evaluations'
        ]!;
      const evaluationFollowUp =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/specification-evaluations/{evaluationId}/task'
        ]!;
      const myWork = document.paths['/api/v1/workspaces/{workspaceId}/my-work']!;
      const taskDetail =
        document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks/{taskId}']!;
      const taskVisibility =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks/{taskId}/visibility'
        ]!;
      const taskComments =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks/{taskId}/comments'
        ]!;
      const taskActivity =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks/{taskId}/activity'
        ]!;
      const taskWorklogs =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks/{taskId}/worklogs'
        ]!;
      const taskWorklog =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks/{taskId}/worklogs/{worklogId}'
        ]!;
      const taskLabels =
        document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/task-labels']!;
      const taskAssignees =
        document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/task-assignees']!;
      const taskCandidates =
        document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/task-candidates']!;
      const milestones =
        document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/milestones']!;
      const milestoneDetail =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/milestones/{milestoneId}'
        ]!;
      const taskComment =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks/{taskId}/comments/{commentId}'
        ]!;
      const taskCommentRevisions =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks/{taskId}/comments/{commentId}/revisions'
        ]!;
      const taskExternalLinks =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks/{taskId}/external-links'
        ]!;
      const taskLinks =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks/{taskId}/links/{linkId}'
        ]!;
      const taskFilters =
        document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/task-filters']!;
      const taskFilterDetail =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/task-filters/{filterId}'
        ]!;
      const taskMove =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks/{taskId}/move'
        ]!;
      const taskArchive =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks/{taskId}/archive'
        ]!;
      const taskRestore =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks/{taskId}/restore'
        ]!;
      const taskFilterFavorite =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/task-filters/{filterId}/favorite'
        ]!;
      const sources =
        document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/sources']!;
      const reviewInbox =
        document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/reviews/inbox']!;
      const reviewParticipants =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/review-participants'
        ]!;
      const recordReviews =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/object-types/{objectTypeId}/records/{recordId}/reviews'
        ]!;
      const reviewMessages =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/reviews/{threadId}/messages'
        ]!;
      const taskWorkflow =
        document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/task-workflow']!;
      const taskFlowInsights =
        document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/task-flow-insights']!;
      const automationExecutions =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/task-automations/executions'
        ]!;
      const automationRules =
        document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/task-automations']!;
      const webhooks =
        document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/webhooks']!;
      const webhookDetail =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/webhooks/{endpointId}'
        ]!;
      const webhookDeliveries =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/webhooks/{endpointId}/deliveries'
        ]!;
      const webhookTest =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/webhooks/{endpointId}/test'
        ]!;
      const webhookRetry =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/webhooks/{endpointId}/deliveries/{deliveryId}/retry'
        ]!;
      const workflowStatuses =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/task-workflow/statuses'
        ]!;
      const schemaCatalog =
        document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/schema']!;
      const objectTypes =
        document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/object-types']!;
      const objectTypePermissions =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/object-types/{objectTypeId}/permissions'
        ]!;
      const fields =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/object-types/{objectTypeId}/fields'
        ]!;
      const views =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/object-types/{objectTypeId}/views'
        ]!;
      const viewDetail =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/object-types/{objectTypeId}/views/{viewId}'
        ]!;
      const viewShare =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/object-types/{objectTypeId}/views/{viewId}/share'
        ]!;
      const publicSharedView = document.paths['/api/v1/shared-views/{shareToken}']!;
      const publicSharedViewQuery = document.paths['/api/v1/shared-views/{shareToken}/query']!;
      const publicSharedViewUnlock = document.paths['/api/v1/shared-views/{shareToken}/unlock']!;
      const publicSharedViewSubmit = document.paths['/api/v1/shared-views/{shareToken}/submit']!;
      const recordHistory =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/object-types/{objectTypeId}/records/{recordId}/history'
        ]!;
      const recordComments =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/object-types/{objectTypeId}/records/{recordId}/comments'
        ]!;
      const recordComment =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/object-types/{objectTypeId}/records/{recordId}/comments/{commentId}'
        ]!;
      const csvImport =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/object-types/{objectTypeId}/records/import-csv'
        ]!;
      const csvImportPreview =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/object-types/{objectTypeId}/records/import-csv/preview'
        ]!;
      const recordQuery =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/object-types/{objectTypeId}/records/query'
        ]!;
      const recordExport =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/object-types/{objectTypeId}/records/export.csv'
        ]!;
      const recordExportJobs =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/object-types/{objectTypeId}/records/exports'
        ]!;
      const recordExportJob =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/object-types/{objectTypeId}/records/exports/{exportId}'
        ]!;
      const recordExportDownload =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/object-types/{objectTypeId}/records/exports/{exportId}/download'
        ]!;
      const recordReferences =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/object-types/{objectTypeId}/record-references'
        ]!;
      const recordBulk =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/object-types/{objectTypeId}/records/bulk'
        ]!;
      const recordBulkFields =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/object-types/{objectTypeId}/records/bulk/fields'
        ]!;
      const recordBulkArchive =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/object-types/{objectTypeId}/records/bulk/archive'
        ]!;
      const recordBulkRestore =
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/object-types/{objectTypeId}/records/bulk/restore'
        ]!;
      const notifications = document.paths['/api/v1/notifications']!;
      const apiTokens = document.paths['/api/v1/api-tokens']!;
      const signIn = document.paths['/api/v1/auth/sign-in']!;
      const readiness = document.paths['/health/ready']!;
      const liveness = document.paths['/health/live']!;
      const metrics = document.paths['/metrics']!;
      const oidcStatus = document.paths['/api/v1/auth/oidc/status']!;
      const oidcStart = document.paths['/api/v1/auth/oidc/start']!;
      const oidcCallback = document.paths['/api/v1/auth/oidc/callback']!;
      const taskIdentifierOperations = Object.entries(document.paths)
        .filter(([path]) => path.includes('/tasks/{taskId}'))
        .flatMap(([, path]) => [path.get, path.post, path.patch, path.delete])
        .filter((operation) => operation !== undefined);
      const corePlatformSuccessContracts = [
        [document.paths['/api/v1/setup/status']?.get, '200'],
        [document.paths['/api/v1/setup']?.post, '201'],
        [document.paths['/api/v1/auth/sign-in']?.post, '201'],
        [document.paths['/api/v1/auth/me']?.get, '200'],
        [document.paths['/api/v1/me/member-groups']?.get, '200'],
        [document.paths['/api/v1/auth/sign-out']?.post, '201'],
        [document.paths['/api/v1/invitations']?.post, '201'],
        [document.paths['/api/v1/invitations/accept']?.post, '201'],
        [document.paths['/api/v1/auth/password-reset-tokens']?.post, '201'],
        [document.paths['/api/v1/security-tokens/{tokenId}/revoke']?.post, '201'],
        [document.paths['/api/v1/auth/password-reset']?.post, '201'],
        [document.paths['/api/v1/workspaces']?.post, '201'],
        [document.paths['/api/v1/workspaces/{workspaceId}']?.patch, '200'],
        [document.paths['/api/v1/workspaces/{workspaceId}/access']?.patch, '200'],
        [document.paths['/api/v1/workspaces/{workspaceId}/data-context']?.post, '201'],
        [document.paths['/api/v1/workspaces/{workspaceId}/projects']?.post, '201'],
        [document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}']?.patch, '200'],
        [
          document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/access']?.patch,
          '200',
        ],
        [
          document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/archive']?.post,
          '201',
        ],
        [
          document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/restore']?.post,
          '201',
        ],
        [document.paths['/api/v1/members/{userId}/role']?.patch, '200'],
        [document.paths['/api/v1/members/roles']?.patch, '200'],
        [document.paths['/api/v1/member-groups']?.post, '201'],
        [document.paths['/api/v1/member-groups/{groupId}']?.patch, '200'],
        [document.paths['/api/v1/member-groups/{groupId}/members']?.patch, '200'],
        [document.paths['/api/v1/member-groups/{groupId}/archive']?.post, '201'],
        [document.paths['/api/v1/members/{userId}/revoke-sessions']?.post, '201'],
      ] as const;
      const corePlatformRequestContracts = [
        document.paths['/api/v1/setup']?.post,
        document.paths['/api/v1/auth/sign-in']?.post,
        document.paths['/api/v1/invitations']?.post,
        document.paths['/api/v1/invitations/accept']?.post,
        document.paths['/api/v1/auth/password-reset-tokens']?.post,
        document.paths['/api/v1/security-tokens/{tokenId}/revoke']?.post,
        document.paths['/api/v1/auth/password-reset']?.post,
        document.paths['/api/v1/workspaces']?.post,
        document.paths['/api/v1/workspaces/{workspaceId}']?.patch,
        document.paths['/api/v1/workspaces/{workspaceId}/access']?.patch,
        document.paths['/api/v1/workspaces/{workspaceId}/projects']?.post,
        document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}']?.patch,
        document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/access']?.patch,
        document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/archive']?.post,
        document.paths['/api/v1/members/{userId}/role']?.patch,
        document.paths['/api/v1/members/roles']?.patch,
        document.paths['/api/v1/member-groups']?.post,
        document.paths['/api/v1/member-groups/{groupId}']?.patch,
        document.paths['/api/v1/member-groups/{groupId}/members']?.patch,
        document.paths['/api/v1/members/{userId}/revoke-sessions']?.post,
      ] as const;
      const engineeringSuccessContracts = [
        [document.paths['/api/v1/units']?.get, '200'],
        [
          document.paths[
            '/api/v1/workspaces/{workspaceId}/projects/{projectId}/measurement-results'
          ]?.post,
          '201',
        ],
        [
          document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/specifications']
            ?.post,
          '201',
        ],
        [
          document.paths[
            '/api/v1/workspaces/{workspaceId}/projects/{projectId}/specifications/{specificationId}/revisions'
          ]?.post,
          '201',
        ],
        [
          document.paths[
            '/api/v1/workspaces/{workspaceId}/projects/{projectId}/specifications/{specificationId}/archive'
          ]?.patch,
          '200',
        ],
        [
          document.paths[
            '/api/v1/workspaces/{workspaceId}/projects/{projectId}/specifications/{specificationId}/restore'
          ]?.post,
          '201',
        ],
        [
          document.paths[
            '/api/v1/workspaces/{workspaceId}/projects/{projectId}/specification-evaluations/retry'
          ]?.post,
          '201',
        ],
      ] as const;
      const fileDatasetSuccessContracts = [
        [
          document.paths[
            '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-upload-sessions'
          ]?.post,
          '201',
        ],
        [
          document.paths[
            '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-upload-sessions/{uploadId}/complete'
          ]?.post,
          '201',
        ],
        [
          document.paths[
            '/api/v1/workspaces/{workspaceId}/projects/{projectId}/files/{fileId}/download'
          ]?.get,
          '200',
        ],
        [
          document.paths[
            '/api/v1/workspaces/{workspaceId}/projects/{projectId}/files/{fileId}/preview'
          ]?.get,
          '200',
        ],
        [
          document.paths[
            '/api/v1/workspaces/{workspaceId}/projects/{projectId}/files/{fileId}/archive'
          ]?.patch,
          '200',
        ],
        [
          document.paths[
            '/api/v1/workspaces/{workspaceId}/projects/{projectId}/files/{fileId}/restore'
          ]?.post,
          '201',
        ],
        [
          document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/datasets']?.post,
          '201',
        ],
        [
          document.paths[
            '/api/v1/workspaces/{workspaceId}/projects/{projectId}/datasets/{datasetId}'
          ]?.get,
          '200',
        ],
        [
          document.paths[
            '/api/v1/workspaces/{workspaceId}/projects/{projectId}/datasets/{datasetId}/preview'
          ]?.get,
          '200',
        ],
        [
          document.paths[
            '/api/v1/workspaces/{workspaceId}/projects/{projectId}/datasets/{datasetId}/archive'
          ]?.patch,
          '200',
        ],
        [
          document.paths[
            '/api/v1/workspaces/{workspaceId}/projects/{projectId}/datasets/{datasetId}/restore'
          ]?.post,
          '201',
        ],
        [
          document.paths[
            '/api/v1/workspaces/{workspaceId}/projects/{projectId}/datasets/{datasetId}/retry'
          ]?.post,
          '201',
        ],
        [
          document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/storage-cleanup']
            ?.get,
          '200',
        ],
        [
          document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/storage-cleanup']
            ?.post,
          '201',
        ],
      ] as const;
      const engineeringRequestContracts = [
        document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/measurement-results']
          ?.post,
        document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/specifications']
          ?.post,
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/specifications/{specificationId}/revisions'
        ]?.post,
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/specifications/{specificationId}/archive'
        ]?.patch,
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/specification-evaluations/retry'
        ]?.post,
        document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-upload-sessions']
          ?.post,
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/files/{fileId}/archive'
        ]?.patch,
        document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/datasets']?.post,
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/datasets/{datasetId}/archive'
        ]?.patch,
        document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/storage-cleanup']
          ?.post,
      ] as const;
      const collaborationSuccessContracts = [
        [
          document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/charts']?.post,
          '201',
        ],
        [
          document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/charts/{chartId}']
            ?.get,
          '200',
        ],
        [
          document.paths[
            '/api/v1/workspaces/{workspaceId}/projects/{projectId}/chart-revisions/{revisionId}'
          ]?.get,
          '200',
        ],
        [
          document.paths[
            '/api/v1/workspaces/{workspaceId}/projects/{projectId}/charts/{chartId}/revisions'
          ]?.post,
          '201',
        ],
        [
          document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/dashboards']?.post,
          '201',
        ],
        [
          document.paths[
            '/api/v1/workspaces/{workspaceId}/projects/{projectId}/dashboards/{dashboardId}'
          ]?.get,
          '200',
        ],
        [
          document.paths[
            '/api/v1/workspaces/{workspaceId}/projects/{projectId}/dashboards/{dashboardId}/revisions'
          ]?.post,
          '201',
        ],
        [
          document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/sources']?.post,
          '201',
        ],
        [
          document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/sources/{sourceId}']
            ?.get,
          '200',
        ],
        [
          document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/sources/{sourceId}']
            ?.patch,
          '200',
        ],
        [
          document.paths[
            '/api/v1/workspaces/{workspaceId}/projects/{projectId}/sources/{sourceId}/archive'
          ]?.patch,
          '200',
        ],
        [
          document.paths[
            '/api/v1/workspaces/{workspaceId}/projects/{projectId}/sources/{sourceId}/restore'
          ]?.post,
          '200',
        ],
        [recordReviews.post, '201'],
        [
          document.paths[
            '/api/v1/workspaces/{workspaceId}/projects/{projectId}/reviews/{threadId}/replies'
          ]?.post,
          '201',
        ],
        [
          document.paths[
            '/api/v1/workspaces/{workspaceId}/projects/{projectId}/reviews/{threadId}/decision'
          ]?.post,
          '201',
        ],
        [
          document.paths[
            '/api/v1/workspaces/{workspaceId}/projects/{projectId}/reviews/{threadId}/resolve'
          ]?.patch,
          '200',
        ],
      ] as const;
      const collaborationRequestContracts = [
        charts.post,
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/charts/{chartId}/revisions'
        ]?.post,
        dashboards.post,
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/dashboards/{dashboardId}/revisions'
        ]?.post,
        sources.post,
        document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/sources/{sourceId}']
          ?.patch,
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/sources/{sourceId}/archive'
        ]?.patch,
        recordReviews.post,
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/reviews/{threadId}/replies'
        ]?.post,
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/reviews/{threadId}/decision'
        ]?.post,
      ] as const;
      const operationsSuccessContracts = [
        [document.paths['/api/v1/notifications/preferences']?.get, '200'],
        [document.paths['/api/v1/notifications/preferences']?.patch, '200'],
        [document.paths['/api/v1/notifications/read-all']?.post, '200'],
        [document.paths['/api/v1/notifications/{notificationId}/read']?.post, '200'],
        [automationRules.post, '201'],
        [
          document.paths[
            '/api/v1/workspaces/{workspaceId}/projects/{projectId}/task-automations/{ruleId}'
          ]?.patch,
          '200',
        ],
        [
          document.paths[
            '/api/v1/workspaces/{workspaceId}/projects/{projectId}/task-automations/{ruleId}/archive'
          ]?.post,
          '200',
        ],
        [
          document.paths[
            '/api/v1/workspaces/{workspaceId}/projects/{projectId}/task-workflow/statuses/{statusId}/archive'
          ]?.post,
          '200',
        ],
        [
          document.paths[
            '/api/v1/workspaces/{workspaceId}/projects/{projectId}/task-workflow/transitions/{transitionId}'
          ]?.delete,
          '200',
        ],
        [
          document.paths[
            '/api/v1/workspaces/{workspaceId}/projects/{projectId}/milestones/{milestoneId}/archive'
          ]?.patch,
          '200',
        ],
        [
          document.paths[
            '/api/v1/workspaces/{workspaceId}/projects/{projectId}/milestones/{milestoneId}/restore'
          ]?.post,
          '200',
        ],
        [taskFilterDetail.delete, '200'],
      ] as const;
      const operationsRequestContracts = [
        document.paths['/api/v1/notifications/preferences']?.patch,
        automationRules.post,
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/task-automations/{ruleId}'
        ]?.patch,
        milestones.post,
        milestoneDetail.patch,
        document.paths[
          '/api/v1/workspaces/{workspaceId}/projects/{projectId}/milestones/{milestoneId}/archive'
        ]?.patch,
      ] as const;
      const pilotSuccessContracts = [
        [document.paths['/api/v1/onboarding']?.get, '200'],
        [document.paths['/api/v1/onboarding']?.patch, '200'],
        [document.paths['/api/v1/pilot-feedback']?.post, '201'],
        [document.paths['/api/v1/pilot/summary']?.get, '200'],
        [document.paths['/api/v1/pilot/feedback']?.get, '200'],
        [document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/demo']?.get, '200'],
        [
          document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/demo/install']
            ?.post,
          '201',
        ],
      ] as const;
      const pilotRequestContracts = [
        document.paths['/api/v1/onboarding']?.patch,
        document.paths['/api/v1/pilot-feedback']?.post,
      ] as const;

      expect(document.info.version).toBe('test-version');
      for (const [path, pathItem] of Object.entries(document.paths)) {
        for (const [method, operation] of Object.entries(pathItem ?? {})) {
          if (!['get', 'post', 'put', 'patch', 'delete'].includes(method) || !operation) continue;
          for (const [status, response] of Object.entries(operation.responses ?? {})) {
            if (!/^2\d\d$/.test(status)) continue;
            expect(
              typeof response === 'object' && response !== null && 'content' in response
                ? response.content
                : undefined,
              `${method.toUpperCase()} ${path} ${status} must declare its response media type`,
            ).toBeDefined();
          }
        }
      }
      expect(liveness.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.status.enum',
        ['ok', 'not_ready'],
      );
      expect(readiness.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.dependencies.additionalProperties.properties.code.type',
        'string',
      );
      expect(readiness.get?.responses['503']).toHaveProperty('content.application/json.schema');
      expect(metrics.get?.responses['200']).toHaveProperty(
        'content.text/plain.schema.type',
        'string',
      );
      expect(oidcStatus.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.enabled.type',
        'boolean',
      );
      for (const redirect of [oidcStart.get, oidcCallback.get]) {
        expect(redirect?.responses).not.toHaveProperty('200');
        expect(redirect?.responses).not.toHaveProperty('304');
        expect(redirect?.responses['302']).toHaveProperty('headers.Location.schema.format', 'uri');
        expect(redirect?.responses['302']).toHaveProperty(
          'headers.Cache-Control.$ref',
          '#/components/headers/CacheControlNoStore',
        );
      }
      for (const [operation, status] of corePlatformSuccessContracts) {
        expect(operation?.responses[status]).toHaveProperty('content.application/json.schema');
      }
      for (const operation of corePlatformRequestContracts) {
        expect(operation?.requestBody).toHaveProperty('content.application/json.schema');
        expect(operation?.requestBody).toHaveProperty(
          'content.application/json.schema.additionalProperties',
          false,
        );
      }
      for (const [operation, status] of [
        ...engineeringSuccessContracts,
        ...fileDatasetSuccessContracts,
        ...collaborationSuccessContracts,
        ...operationsSuccessContracts,
        ...pilotSuccessContracts,
      ]) {
        expect(operation?.responses[status]).toHaveProperty('content.application/json.schema');
      }
      for (const operation of engineeringRequestContracts) {
        expect(operation?.requestBody).toHaveProperty('content.application/json.schema');
        expect(operation?.requestBody).toHaveProperty(
          'content.application/json.schema.additionalProperties',
          false,
        );
      }
      for (const operation of collaborationRequestContracts) {
        expect(operation?.requestBody).toHaveProperty('content.application/json.schema');
        expect(operation?.requestBody).toHaveProperty('content.application/json.schema.example');
      }
      for (const operation of operationsRequestContracts) {
        expect(operation?.requestBody).toHaveProperty('content.application/json.schema');
        expect(operation?.requestBody).toHaveProperty(
          'content.application/json.schema.additionalProperties',
          false,
        );
        expect(operation?.requestBody).toHaveProperty('content.application/json.schema.example');
      }
      for (const operation of pilotRequestContracts) {
        expect(operation?.requestBody).toHaveProperty('content.application/json.schema');
        expect(operation?.requestBody).toHaveProperty(
          'content.application/json.schema.additionalProperties',
          false,
        );
        expect(operation?.requestBody).toHaveProperty('content.application/json.schema.example');
      }
      expect(document.paths['/api/v1/onboarding']?.patch?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.completedSteps.items.enum',
        ['create-project', 'install-template', 'load-demo', 'trace-results', 'create-task'],
      );
      expect(document.paths['/api/v1/pilot-feedback']?.post?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.message.maxLength',
        4000,
      );
      expect(
        document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/demo/install']?.post
          ?.responses['201'],
      ).toHaveProperty('content.application/json.schema.properties.idempotent.type', 'boolean');
      expect(
        document.paths['/api/v1/notifications/preferences']?.patch?.requestBody,
      ).toHaveProperty('content.application/json.schema.properties.dueReminderDays.anyOf');
      expect(automationRules.post?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.triggerType.enum',
        expect.arrayContaining(['task.created', 'task.status_changed']),
      );
      expect(taskFilterDetail.delete?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.deleted.const',
        true,
      );
      expect(charts.post?.requestBody).toHaveProperty(
        'content.application/json.schema.oneOf.0.additionalProperties',
        false,
      );
      expect(dashboards.post?.requestBody).toHaveProperty(
        'content.application/json.schema.additionalProperties',
        false,
      );
      expect(sources.post?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.url.format',
        'uri',
      );
      expect(recordReviews.post?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.reviewerId.anyOf',
      );
      expect(document.paths['/api/v1/units']?.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.units.items.properties.dimension.type',
        'string',
      );
      expect(
        document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/measurement-results']
          ?.post?.requestBody,
      ).toHaveProperty('content.application/json.schema.example.value', '12.45');
      expect(
        document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-upload-sessions']
          ?.post?.requestBody,
      ).toHaveProperty('content.application/json.schema.properties.sizeBytes.maximum', 104857600);
      expect(
        document.paths['/api/v1/workspaces/{workspaceId}/projects/{projectId}/datasets']?.post
          ?.responses['201'],
      ).toHaveProperty(
        'content.application/json.schema.properties.dataset.properties.dataset_type.enum',
        ['tabular', 'xy'],
      );
      expect(workspaces.post?.requestBody).toHaveProperty(
        'content.application/json.schema.required',
        expect.arrayContaining(['name', 'slug']),
      );
      expect(workspaces.post?.requestBody).toHaveProperty(
        'content.application/json.schema.example.slug',
        'motor-validation',
      );
      expect(projects.post?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.key.pattern',
        '^[A-Za-z][A-Za-z0-9_-]{1,15}$',
      );
      expect(projects.post?.requestBody).toHaveProperty(
        'content.application/json.schema.example.key',
        'THERMAL',
      );
      expect(signIn.post?.responses['201']).toHaveProperty(
        'content.application/json.schema.properties.user.properties.role.enum',
        ['owner', 'admin', 'engineer', 'contributor', 'reviewer', 'viewer'],
      );
      expect(workspaces.post?.responses['201']).toHaveProperty(
        'content.application/json.schema.properties.publicId.type',
        'string',
      );
      expect(projects.post?.responses['201']).toHaveProperty(
        'content.application/json.schema.properties.rowVersion.type',
        'integer',
      );
      expect(workspaces.post?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.visibility.enum',
        ['organization', 'restricted'],
      );
      expect(projects.post?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.visibility.enum',
        ['workspace', 'restricted'],
      );
      expect(workspaceAccess.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.visibility.enum',
        ['organization', 'restricted'],
      );
      expect(projectAccess.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.visibility.enum',
        ['workspace', 'restricted'],
      );
      for (const accessOperation of [workspaceAccess.patch, projectAccess.patch]) {
        expect(accessOperation?.requestBody).toHaveProperty(
          'content.application/json.schema.required',
          expect.arrayContaining(['visibility', 'userIds', 'groupIds', 'accessVersion']),
        );
        expect(accessOperation?.requestBody).toHaveProperty(
          'content.application/json.schema.additionalProperties',
          false,
        );
      }
      expect(taskIdentifierOperations).toHaveLength(22);
      for (const operation of taskIdentifierOperations) {
        expect(operation.parameters).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name: 'taskId',
              in: 'path',
              required: true,
              description: expect.stringContaining('project task key'),
              schema: expect.objectContaining({
                type: 'string',
                maxLength: 64,
                example: 'FORCE-6',
              }),
            }),
          ]),
        );
      }
      expect(taskVisibility.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.visibility.enum',
        ['project', 'restricted'],
      );
      expect(taskVisibility.patch?.requestBody).toHaveProperty(
        'content.application/json.schema.required',
        expect.arrayContaining(['visibility', 'rowVersion']),
      );
      expect(taskVisibility.patch?.requestBody).toHaveProperty(
        'content.application/json.schema.additionalProperties',
        false,
      );
      expect(document.components?.schemas).toHaveProperty('ApiErrorEnvelope');
      expect(apiTokens.post?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.scopes.items.enum',
        ['workspace', 'project', 'data', 'tasks', 'schedule', 'reviews'],
      );
      expect(apiTokens.post?.responses['201']).toHaveProperty(
        'content.application/json.schema.properties.scopes.items.enum',
      );
      expect(viewShare.get?.security).toEqual([{ engrove_session: [] }]);
      expect(viewShare.post?.security).toEqual([{ engrove_session: [] }]);
      expect(publicSharedView.get?.security).toEqual([]);
      expect(publicSharedView.get?.responses).not.toHaveProperty('304');
      expect(publicSharedView.get?.responses['200']).toHaveProperty(
        'headers.Cache-Control.$ref',
        '#/components/headers/CacheControlNoStore',
      );
      expect(publicSharedViewQuery.post?.security).toEqual([]);
      expect(publicSharedViewUnlock.post?.security).toEqual([]);
      expect(publicSharedViewSubmit.post?.security).toEqual([]);
      expect(publicSharedViewSubmit.post?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'idempotency-key', in: 'header', required: true }),
          expect.objectContaining({ name: 'x-engrove-share-access', in: 'header' }),
        ]),
      );
      expect(publicSharedViewSubmit.post?.requestBody).toHaveProperty(
        'content.application/json.schema.required',
        expect.arrayContaining(['displayName', 'values']),
      );
      expect(publicSharedViewQuery.post?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'x-engrove-share-access', required: false }),
        ]),
      );
      expect(workspaceSearch.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'query', required: true, in: 'query' }),
          expect.objectContaining({ name: 'limit', required: false, in: 'query' }),
        ]),
      );
      expect(workspaceSearch.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.items.items.properties.type.enum',
        ['project', 'task', 'milestone', 'table'],
      );
      expect(workspaceSearch.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.pageInfo.properties.hasMore.type',
        'boolean',
      );
      expect(auditEvents.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'query', required: false, in: 'query' }),
          expect.objectContaining({ name: 'limit', required: false, in: 'query' }),
          expect.objectContaining({ name: 'offset', required: false, in: 'query' }),
        ]),
      );
      expect(auditEvents.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.pageInfo.properties.total.type',
        'integer',
      );
      expect(workspaces.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'query', required: false, in: 'query' }),
          expect.objectContaining({ name: 'limit', required: false, in: 'query' }),
          expect.objectContaining({ name: 'offset', required: false, in: 'query' }),
        ]),
      );
      expect(workspaces.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.items.maxItems',
        100,
      );
      expect(workspaces.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.pageInfo.properties.overallTotal.type',
        'integer',
      );
      expect(workspaces.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.pageInfo.properties.hasNext.type',
        'boolean',
      );
      expect(workspace.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.publicId.type',
        'string',
      );
      expect(dashboardMetrics.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.chart_count.type',
        'integer',
      );
      expect(dashboardMetrics.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.dashboard_count.type',
        'integer',
      );
      expect(dashboardMetrics.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.object_type_count.type',
        'integer',
      );
      expect(dashboardMetrics.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.recent_datasets.maxItems',
        5,
      );
      for (const catalog of [charts, dashboards]) {
        expect(catalog.get?.parameters).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: 'query', in: 'query' }),
            expect.objectContaining({ name: 'archiveState', in: 'query' }),
            expect.objectContaining({ name: 'limit', in: 'query' }),
            expect.objectContaining({ name: 'offset', in: 'query' }),
          ]),
        );
        expect(catalog.get?.responses['200']).toHaveProperty(
          'content.application/json.schema.properties.items.maxItems',
          100,
        );
        expect(catalog.get?.responses['200']).toHaveProperty(
          'content.application/json.schema.properties.pageInfo.properties.hasNext.type',
          'boolean',
        );
      }
      for (const lifecycle of [chartArchive.patch, dashboardArchive.patch]) {
        expect(lifecycle?.requestBody).toHaveProperty(
          'content.application/json.schema.properties.reason.maxLength',
          2_000,
        );
        expect(lifecycle?.requestBody).toHaveProperty(
          'content.application/json.schema.required',
          expect.arrayContaining(['reason']),
        );
        expect(lifecycle?.responses['200']).toHaveProperty(
          'content.application/json.schema.properties.archived_at',
        );
      }
      for (const lifecycle of [chartRestore.post, dashboardRestore.post]) {
        expect(lifecycle?.responses['200']).toHaveProperty(
          'content.application/json.schema.properties.id.format',
          'uuid',
        );
        expect(lifecycle?.responses['200']).toHaveProperty(
          'content.application/json.schema.properties.archived_at',
        );
      }
      expect(datasets.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'query', in: 'query' }),
          expect.objectContaining({ name: 'includeArchived', in: 'query' }),
          expect.objectContaining({ name: 'limit', in: 'query' }),
          expect.objectContaining({ name: 'offset', in: 'query' }),
        ]),
      );
      expect(datasets.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.items.maxItems',
        100,
      );
      expect(datasets.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.pageInfo.properties.hasNext.type',
        'boolean',
      );
      expect(files.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'archiveState', in: 'query' }),
          expect.objectContaining({ name: 'status', in: 'query' }),
          expect.objectContaining({ name: 'query', in: 'query' }),
          expect.objectContaining({ name: 'limit', in: 'query' }),
          expect.objectContaining({ name: 'offset', in: 'query' }),
        ]),
      );
      expect(backgroundJobs.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'status', in: 'query' }),
          expect.objectContaining({ name: 'query', in: 'query' }),
          expect.objectContaining({ name: 'limit', in: 'query' }),
          expect.objectContaining({ name: 'offset', in: 'query' }),
        ]),
      );
      for (const catalog of [files, backgroundJobs]) {
        expect(catalog.get?.responses['200']).toHaveProperty(
          'content.application/json.schema.properties.items.maxItems',
          100,
        );
        expect(catalog.get?.responses['200']).toHaveProperty(
          'content.application/json.schema.properties.pageInfo.properties.total.type',
          'integer',
        );
        expect(catalog.get?.responses['200']).toHaveProperty(
          'content.application/json.schema.properties.pageInfo.properties.hasNext.type',
          'boolean',
        );
      }
      expect(measurements.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'fieldId', in: 'query' }),
          expect.objectContaining({ name: 'currentState', in: 'query' }),
          expect.objectContaining({ name: 'query', in: 'query' }),
          expect.objectContaining({ name: 'limit', in: 'query' }),
          expect.objectContaining({ name: 'offset', in: 'query' }),
        ]),
      );
      expect(measurements.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.items.items.properties.evaluation.anyOf',
      );
      expect(specifications.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'archiveState', in: 'query' }),
          expect.objectContaining({ name: 'query', in: 'query' }),
          expect.objectContaining({ name: 'limit', in: 'query' }),
          expect.objectContaining({ name: 'offset', in: 'query' }),
        ]),
      );
      expect(specificationEvaluations.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'recordId', in: 'query' }),
          expect.objectContaining({ name: 'status', in: 'query' }),
          expect.objectContaining({ name: 'query', in: 'query' }),
          expect.objectContaining({ name: 'limit', in: 'query' }),
          expect.objectContaining({ name: 'offset', in: 'query' }),
        ]),
      );
      for (const catalog of [measurements, specifications, specificationEvaluations]) {
        expect(catalog.get?.responses['200']).toHaveProperty(
          'content.application/json.schema.properties.items.maxItems',
          100,
        );
        expect(catalog.get?.responses['200']).toHaveProperty(
          'content.application/json.schema.properties.pageInfo.properties.total.type',
          'integer',
        );
        expect(catalog.get?.responses['200']).toHaveProperty(
          'content.application/json.schema.properties.pageInfo.properties.hasNext.type',
          'boolean',
        );
      }
      expect(workspaceOverview.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'today', required: false, in: 'query' }),
          expect.objectContaining({ name: 'dateLimit', required: false, in: 'query' }),
          expect.objectContaining({ name: 'projectQuery', required: false, in: 'query' }),
          expect.objectContaining({ name: 'projectLimit', required: false, in: 'query' }),
          expect.objectContaining({ name: 'projectOffset', required: false, in: 'query' }),
        ]),
      );
      expect(workspaceOverview.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.summary.properties.openTasks.type',
        'integer',
      );
      expect(workspaceOverview.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.projects.items.properties.nextDate.anyOf',
      );
      expect(workspaceOverview.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.projects.maxItems',
        50,
      );
      expect(workspaceOverview.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.projectPageInfo.properties.hasNext.type',
        'boolean',
      );
      expect(workspaceOverview.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.dates.maxItems',
        50,
      );
      expect(tasks.post?.requestBody).toBeDefined();
      expect(tasks.post?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.parentTaskId.format',
        'uuid',
      );
      expect(tasks.post?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.cloneSourceTaskId.format',
        'uuid',
      );
      expect(tasks.post?.responses['201']).toHaveProperty('content.application/json.schema');
      expect(tasks.post?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'idempotency-key', in: 'header', required: true }),
        ]),
      );
      expect(tasks.post?.responses['201']).toHaveProperty(
        'content.application/json.schema.properties.idempotent_replay.type',
        'boolean',
      );
      expect(evaluationFollowUp.post?.responses['201']).toHaveProperty(
        'content.application/json.schema.properties.idempotent_replay.type',
        'boolean',
      );
      expect(taskDetail.patch?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.parentTaskId.anyOf',
      );
      expect(taskMove.post?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.beforeTaskId.anyOf',
      );
      expect(taskMove.post?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.placement.enum',
        ['top', 'bottom'],
      );
      expect(taskMove.post?.requestBody).toHaveProperty(
        'content.application/json.schema.required',
        expect.arrayContaining(['status', 'rowVersion']),
      );
      expect(taskMove.post?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.board_position',
      );
      expect(taskArchive.patch?.requestBody).toHaveProperty(
        'content.application/json.schema.required',
        expect.arrayContaining(['reason', 'rowVersion']),
      );
      expect(taskRestore.post?.requestBody).toHaveProperty(
        'content.application/json.schema.required',
        expect.arrayContaining(['rowVersion']),
      );
      expect(taskRestore.post?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.row_version.type',
        'integer',
      );
      expect(taskDetail.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.change_history.items.properties.changes.items.properties.field.enum',
        [
          'title',
          'description',
          'priority',
          'assigneeId',
          'dueDate',
          'labels',
          'parentTaskId',
          'originalEstimateMinutes',
          'remainingEstimateMinutes',
        ],
      );
      expect(taskDetail.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.worklogs.maxItems',
        20,
      );
      expect(taskDetail.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.time_spent_minutes.type',
        'integer',
      );
      expect(taskWorklogs.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'limit', required: false, in: 'query' }),
          expect.objectContaining({ name: 'offset', required: false, in: 'query' }),
        ]),
      );
      expect(taskWorklogs.post?.requestBody).toHaveProperty(
        'content.application/json.schema.required',
        expect.arrayContaining(['durationMinutes', 'startedAt', 'taskRowVersion']),
      );
      expect(taskWorklogs.post?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.remainingEstimateMode.enum',
        ['auto', 'set', 'unchanged'],
      );
      expect(taskWorklogs.post?.responses['201']).toHaveProperty(
        'content.application/json.schema.properties.worklogs',
      );
      expect(taskWorklog.patch?.requestBody).toHaveProperty(
        'content.application/json.schema.required',
        expect.arrayContaining(['taskRowVersion', 'worklogRowVersion']),
      );
      expect(taskWorklog.delete?.requestBody).toHaveProperty(
        'content.application/json.schema.required',
        expect.arrayContaining(['taskRowVersion', 'worklogRowVersion']),
      );
      expect(taskDetail.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.created_by_name.type',
        'string',
      );
      expect(taskDetail.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.created_by.format',
        'uuid',
      );
      expect(taskAssignees.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'query', required: false, in: 'query' }),
          expect.objectContaining({ name: 'limit', required: false, in: 'query' }),
          expect.objectContaining({ name: 'offset', required: false, in: 'query' }),
        ]),
      );
      expect(taskAssignees.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.items.maxItems',
        100,
      );
      expect(taskAssignees.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.pageInfo.properties.total.type',
        'integer',
      );
      expect(taskAssignees.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.overallTotal.type',
        'integer',
      );
      expect(reviewParticipants.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'query', required: false, in: 'query' }),
          expect.objectContaining({ name: 'reviewerOnly', required: false, in: 'query' }),
          expect.objectContaining({ name: 'limit', required: false, in: 'query' }),
          expect.objectContaining({ name: 'offset', required: false, in: 'query' }),
        ]),
      );
      expect(reviewParticipants.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.items.maxItems',
        100,
      );
      expect(reviewParticipants.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.pageInfo.properties.total.type',
        'integer',
      );
      expect(reviewParticipants.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.overallTotal.type',
        'integer',
      );
      expect(recordReviews.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'includeResolved', required: false, in: 'query' }),
          expect.objectContaining({ name: 'limit', required: false, in: 'query' }),
          expect.objectContaining({ name: 'offset', required: false, in: 'query' }),
        ]),
      );
      expect(recordReviews.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.items.maxItems',
        50,
      );
      expect(recordReviews.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.items.items.properties.messages.maxItems',
        20,
      );
      expect(recordReviews.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.summary.properties.resolved.type',
        'integer',
      );
      expect(reviewMessages.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'limit', required: false, in: 'query' }),
          expect.objectContaining({ name: 'offset', required: false, in: 'query' }),
        ]),
      );
      expect(reviewMessages.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.items.maxItems',
        100,
      );
      expect(project.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.publicId.type',
        'string',
      );
      expect(project.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.rowVersion.type',
        'integer',
      );
      expect(projects.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'query', required: false, in: 'query' }),
          expect.objectContaining({ name: 'archiveState', required: false, in: 'query' }),
          expect.objectContaining({ name: 'limit', required: false, in: 'query' }),
          expect.objectContaining({ name: 'offset', required: false, in: 'query' }),
        ]),
      );
      expect(projects.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.items.maxItems',
        100,
      );
      expect(projects.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.pageInfo.properties.total.type',
        'integer',
      );
      expect(projects.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.overallTotal.type',
        'integer',
      );
      expect(projectOptions.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'query', required: false, in: 'query' }),
          expect.objectContaining({ name: 'limit', required: false, in: 'query' }),
        ]),
      );
      expect(projectOptions.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.items.maxItems',
        50,
      );
      for (const directory of [members, memberGroups]) {
        expect(directory.get?.parameters).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: 'query', required: false }),
            expect.objectContaining({
              name: 'limit',
              schema: expect.objectContaining({ maximum: 100, default: 50 }),
            }),
            expect.objectContaining({ name: 'offset', required: false }),
          ]),
        );
        expect(directory.get?.responses['200']).toHaveProperty(
          'content.application/json.schema.properties.items.maxItems',
          100,
        );
        expect(directory.get?.responses['200']).toHaveProperty(
          'content.application/json.schema.properties.pageInfo.properties.total.type',
          'integer',
        );
        expect(directory.get?.responses['200']).toHaveProperty(
          'content.application/json.schema.properties.overallTotal.type',
          'integer',
        );
      }
      expect(projectOptions.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.pageInfo.properties.hasMore.type',
        'boolean',
      );
      expect(projectReferences.post?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.ids.maxItems',
        500,
      );
      expect(projectReferences.post?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.items.maxItems',
        500,
      );
      expect(taskDetail.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.activity_page_info.properties.hasNext.type',
        'boolean',
      );
      expect(taskActivity.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'limit', required: false, in: 'query' }),
          expect.objectContaining({ name: 'offset', required: false, in: 'query' }),
        ]),
      );
      expect(taskActivity.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.pageInfo.properties.total.type',
        'integer',
      );
      expect(taskDetail.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.children.items.properties.task_key.type',
        'string',
      );
      expect(taskDetail.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.child_done_count.type',
        'integer',
      );
      expect(taskDetail.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.linked_key_dates.items.properties.target_date.format',
        'date',
      );
      expect(tasks.get?.parameters).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'label', required: false })]),
      );
      expect(tasks.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'limit',
            schema: expect.objectContaining({ maximum: 100, default: 100 }),
          }),
        ]),
      );
      expect(tasks.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.items.maxItems',
        100,
      );
      expect(taskLabels.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.items.items.properties.count.type',
        'integer',
      );
      expect(taskCandidates.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.items.items.properties.parent_task_id.anyOf',
      );
      expect(taskCandidates.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.items.items.properties.child_count.type',
        'integer',
      );
      expect(taskCandidates.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.pageInfo.properties.hasNext.type',
        'boolean',
      );
      expect(taskCandidates.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'query', required: false, in: 'query' }),
          expect.objectContaining({ name: 'topLevelOnly', required: false, in: 'query' }),
          expect.objectContaining({ name: 'limit', required: false, in: 'query' }),
        ]),
      );
      expect(milestones.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.items.items.properties.linked_tasks.items.properties.status_category.enum',
        ['todo', 'in_progress', 'done'],
      );
      expect(milestones.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.pageInfo.properties.hasNext.type',
        'boolean',
      );
      expect(milestones.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.summary.properties.archived.type',
        'integer',
      );
      expect(milestones.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.nextMilestoneId.anyOf',
      );
      expect(milestones.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'query', in: 'query' }),
          expect.objectContaining({ name: 'archiveState', in: 'query' }),
          expect.objectContaining({ name: 'limit', in: 'query' }),
          expect.objectContaining({ name: 'offset', in: 'query' }),
        ]),
      );
      expect(milestones.post?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.taskIds.items.format',
        'uuid',
      );
      expect(milestones.post?.responses['201']).toHaveProperty(
        'content.application/json.schema.properties.completed_task_count.type',
        'integer',
      );
      expect(milestones.post?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'idempotency-key', in: 'header', required: true }),
        ]),
      );
      expect(milestones.post?.responses['201']).toHaveProperty(
        'content.application/json.schema.properties.idempotent_replay.type',
        'boolean',
      );
      expect(milestoneDetail.patch?.requestBody).toHaveProperty(
        'content.application/json.schema.required',
        expect.arrayContaining(['rowVersion']),
      );
      expect(taskDetail.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.links.items.properties.url.anyOf',
      );
      expect(taskDetail.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.link_history.items.properties.action.enum',
        ['task.link_added', 'task.link_removed'],
      );
      expect(taskComments.post?.responses['201']).toHaveProperty(
        'content.application/json.schema.properties.row_version.type',
        'integer',
      );
      expect(taskComments.post?.responses['201']).toHaveProperty(
        'content.application/json.schema.properties.revision_count.type',
        'integer',
      );
      expect(taskCommentRevisions.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.items.items.properties.revision.type',
        'integer',
      );
      expect(taskComment.patch?.requestBody).toHaveProperty(
        'content.application/json.schema.required',
        expect.arrayContaining(['body', 'rowVersion']),
      );
      expect(taskComment.patch?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.revisions.items.properties.revision.type',
        'integer',
      );
      expect(taskExternalLinks.post?.requestBody).toHaveProperty(
        'content.application/json.schema.required',
        ['title', 'url'],
      );
      expect(taskExternalLinks.post?.responses['201']).toHaveProperty(
        'content.application/json.schema.properties.links',
      );
      expect(taskLinks.delete?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.link_history',
      );
      expect(taskWorkflow.get?.responses['200']).toHaveProperty('content.application/json.schema');
      expect(taskFlowInsights.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'windowDays', in: 'query', required: false }),
          expect.objectContaining({ name: 'staleAfterDays', in: 'query', required: false }),
        ]),
      );
      expect(taskFlowInsights.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.summary.properties.median_cycle_hours',
      );
      expect(taskFlowInsights.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.completed_tasks.items.properties.cycle_time_hours.type',
        'number',
      );
      expect(taskFlowInsights.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.flow_series.maxItems',
        365,
      );
      expect(taskFlowInsights.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.flow_statuses.items.properties.archived.type',
        'boolean',
      );
      expect(taskFlowInsights.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.throughput_series.maxItems',
        365,
      );
      expect(taskFlowInsights.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.throughput_series.items.properties.completed_count.type',
        'integer',
      );
      expect(workflowStatuses.post?.requestBody).toBeDefined();
      expect(workflowStatuses.post?.responses['201']).toHaveProperty(
        'content.application/json.schema',
      );
      expect(webhooks.post?.security).toEqual([{ engrove_session: [] }]);
      expect(webhooks.post?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.eventTypes.items.enum',
        [
          'record.created',
          'record.updated',
          'record.archived',
          'record.restored',
          'task.created',
          'task.updated',
          'task.archived',
          'task.restored',
        ],
      );
      expect(webhooks.post?.responses['201']).toHaveProperty(
        'content.application/json.schema.properties.signingSecret.type',
        'string',
      );
      expect(webhooks.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'limit', required: false, in: 'query' }),
          expect.objectContaining({ name: 'offset', required: false, in: 'query' }),
        ]),
      );
      expect(webhooks.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.items.maxItems',
        100,
      );
      expect(webhooks.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.pageInfo.properties.hasNext.type',
        'boolean',
      );
      expect(webhookDetail.patch?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.active.type',
        'boolean',
      );
      expect(webhookDeliveries.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.items.items.properties.status.enum',
        ['queued', 'sending', 'succeeded', 'failed'],
      );
      expect(webhookDeliveries.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.items.items.properties.responseSnippet.anyOf',
      );
      expect(webhookDeliveries.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.pageInfo.properties.hasNext.type',
        'boolean',
      );
      expect(webhookDeliveries.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.summary.properties.failed.type',
        'integer',
      );
      expect(webhookDeliveries.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'status', required: false, in: 'query' }),
          expect.objectContaining({ name: 'limit', required: false, in: 'query' }),
          expect.objectContaining({ name: 'offset', required: false, in: 'query' }),
        ]),
      );
      expect(webhookTest.post?.responses['202']).toHaveProperty(
        'content.application/json.schema.properties.eventType.anyOf',
      );
      expect(webhookRetry.post?.responses['202']).toHaveProperty(
        'content.application/json.schema.properties.nextAttemptAt.format',
        'date-time',
      );
      expect(automationExecutions.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'outcome', required: false, in: 'query' }),
          expect.objectContaining({ name: 'ruleId', required: false, in: 'query' }),
          expect.objectContaining({ name: 'limit', required: false, in: 'query' }),
          expect.objectContaining({ name: 'offset', required: false, in: 'query' }),
        ]),
      );
      expect(automationExecutions.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.pageInfo.properties.hasNext.type',
        'boolean',
      );
      expect(automationExecutions.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.summary.properties.failed.type',
        'integer',
      );
      expect(automationExecutions.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.items.items.properties.durationMs.type',
        'integer',
      );
      expect(automationExecutions.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.items.items.properties.triggerEvent.type',
        'object',
      );
      expect(automationRules.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'limit', required: false, in: 'query' }),
          expect.objectContaining({ name: 'offset', required: false, in: 'query' }),
        ]),
      );
      expect(automationRules.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.items.maxItems',
        100,
      );
      expect(automationRules.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.pageInfo.properties.total.type',
        'integer',
      );
      expect(automationRules.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.items.items.properties.failedCount.type',
        'integer',
      );
      expect(recordQuery.post?.requestBody).toBeDefined();
      expect(recordQuery.post?.requestBody).toHaveProperty(
        'content.application/json.schema.example.pageSize',
        50,
      );
      expect(recordQuery.post?.requestBody).toHaveProperty(
        'content.application/json.schema.example.fields',
        ['serial-number', 'status'],
      );
      expect(recordQuery.post?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.fields.maxItems',
        200,
      );
      expect(recordQuery.post?.responses['200']).toHaveProperty('content.application/json.schema');
      expect(recordQuery.post?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.archiveState.enum',
        ['active', 'archived', 'all'],
      );
      expect(recordExport.post?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.fieldKeys.maxItems',
        200,
      );
      expect(recordExport.post?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.archiveState.enum',
        ['active', 'archived', 'all'],
      );
      expect(recordExport.post?.responses['200']).toHaveProperty('content.text/csv.schema', {
        type: 'string',
        format: 'binary',
      });
      expect(recordExportJobs.post?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'idempotency-key', required: true }),
        ]),
      );
      expect(recordExportJobs.post?.responses['202']).toHaveProperty(
        'content.application/json.schema.properties.downloadReady.type',
        'boolean',
      );
      expect(recordExportJobs.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.pageInfo.properties.hasNext.type',
        'boolean',
      );
      expect(recordExportJob.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.status.enum',
        ['queued', 'running', 'succeeded', 'failed', 'expired'],
      );
      expect(recordExportDownload.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.url.format',
        'uri',
      );
      expect(recordBulk.post?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.items.maxItems',
        100,
      );
      expect(recordBulk.post?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'idempotency-key', required: true }),
        ]),
      );
      expect(recordBulk.post?.responses['201']).toHaveProperty(
        'content.application/json.schema.properties.idempotentReplay',
      );
      expect(recordBulk.patch?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.items.maxItems',
        100,
      );
      expect(recordBulk.patch?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.updated',
      );
      expect(recordBulkFields.patch?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.records.maxItems',
        100,
      );
      expect(recordBulkFields.patch?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.changes.maxItems',
        20,
      );
      expect(recordBulkFields.patch?.requestBody).toHaveProperty(
        'content.application/json.schema.example.changes.0',
        { fieldKey: 'status', operation: 'set', value: 'approved' },
      );
      expect(recordBulkFields.patch?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.updated',
      );
      expect(recordBulkArchive.post?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.ids.maxItems',
        100,
      );
      expect(recordBulkArchive.post?.requestBody).toHaveProperty(
        'content.application/json.schema.required',
        expect.arrayContaining(['ids', 'reason']),
      );
      expect(recordBulkArchive.post?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.archived',
      );
      expect(recordBulkRestore.post?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.ids.maxItems',
        100,
      );
      expect(recordBulkRestore.post?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.updated',
      );
      expect(recordQuery.post?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'objectTypeId',
            description: expect.stringContaining('table API panel'),
            schema: expect.objectContaining({ example: 't1234567890abcd' }),
          }),
        ]),
      );
      expect(schemaCatalog.get?.security).toEqual([
        { engrove_session: [] },
        { engrove_api_token: [] },
      ]);
      expect(schemaCatalog.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.tables.items.properties.fields.items.properties.fieldType.enum',
      );
      expect(schemaCatalog.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.tables.items.properties.publicId',
      );
      expect(schemaCatalog.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.pageInfo.properties.hasNext.type',
        'boolean',
      );
      expect(schemaCatalog.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'query', required: false, in: 'query' }),
          expect.objectContaining({ name: 'limit', required: false, in: 'query' }),
          expect.objectContaining({ name: 'offset', required: false, in: 'query' }),
        ]),
      );
      expect(objectTypes.post?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.key.pattern',
      );
      expect(objectTypes.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'query', required: false, in: 'query' }),
          expect.objectContaining({ name: 'limit', required: false, in: 'query' }),
          expect.objectContaining({ name: 'offset', required: false, in: 'query' }),
        ]),
      );
      expect(objectTypes.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.items.maxItems',
        100,
      );
      expect(objectTypes.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.pageInfo.properties.hasNext.type',
        'boolean',
      );
      expect(objectTypes.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.items.items.properties.recordPermissions.properties.canCreate.type',
        'boolean',
      );
      expect(objectTypes.post?.responses['201']).toHaveProperty(
        'content.application/json.schema.properties.publicId',
      );
      expect(objectTypePermissions.get?.security).toEqual([
        { engrove_session: [] },
        { engrove_api_token: [] },
      ]);
      expect(objectTypePermissions.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.modes.properties.visibility.enum',
        ['everyone', 'editors', 'engineers', 'administrators', 'specific', 'nobody'],
      );
      expect(objectTypePermissions.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.subjectDirectory.properties.groups.items.properties.name.type',
        'string',
      );
      expect(objectTypePermissions.patch?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.rowVersion.type',
        'integer',
      );
      expect(objectTypePermissions.patch?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.rowVersion.type',
        'integer',
      );
      expect(fields.post?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.fieldType.enum',
      );
      expect(fields.post?.responses['201']).toHaveProperty(
        'content.application/json.schema.properties.projectionStatus.enum',
      );
      expect(views.post?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.config.properties.rowDensity.enum',
      );
      expect(views.post?.responses['201']).toHaveProperty(
        'content.application/json.schema.properties.rowVersion',
      );
      expect(views.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'query', required: false, in: 'query' }),
          expect.objectContaining({ name: 'limit', required: false, in: 'query' }),
          expect.objectContaining({ name: 'offset', required: false, in: 'query' }),
        ]),
      );
      expect(views.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.items.maxItems',
        100,
      );
      expect(views.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.pageInfo.properties.total.type',
        'integer',
      );
      expect(viewDetail.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.publicId.type',
        'string',
      );
      expect(recordHistory.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.items.items.properties.undoable',
      );
      expect(recordHistory.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.pageInfo.properties.hasNext.type',
        'boolean',
      );
      expect(recordHistory.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ in: 'query', name: 'limit' }),
          expect.objectContaining({ in: 'query', name: 'offset' }),
        ]),
      );
      expect(recordComments.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.pageInfo.properties.total.type',
        'integer',
      );
      expect(recordComments.post?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.body.maxLength',
        10_000,
      );
      expect(recordComments.post?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.mentionedUserIds.maxItems',
        50,
      );
      expect(recordComment.patch?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.rowVersion.type',
        'integer',
      );
      expect(recordComment.patch?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.editedAt',
      );
      expect(recordComment.patch?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.mentionedUsers.maxItems',
        50,
      );
      expect(csvImport.post?.responses['201']).toHaveProperty(
        'content.application/json.schema.properties.idempotentReplay',
      );
      expect(csvImport.post?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.duplicateStrategy.enum',
        ['allow', 'skip', 'update'],
      );
      expect(csvImport.post?.responses['201']).toHaveProperty(
        'content.application/json.schema.properties.updatedIds',
      );
      expect(csvImportPreview.post?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.suggestedMappings',
      );
      expect(recordQuery.post?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.items.items.properties.measurements',
      );
      expect(recordQuery.post?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.items.items.properties.relationLabels',
      );
      expect(recordReferences.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.items.items.properties.displayName.type',
        'string',
      );
      expect(recordReferences.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ in: 'query', name: 'query' }),
          expect.objectContaining({ in: 'query', name: 'ids' }),
          expect.objectContaining({ in: 'query', name: 'limit' }),
        ]),
      );

      const programmable = document as unknown as {
        paths: Record<
          string,
          Record<
            string,
            {
              tags?: string[];
              requestBody?: unknown;
              responses: Record<string, { content?: Record<string, { schema?: unknown }> }>;
            }
          >
        >;
      };
      const bodylessPosts = new Set([
        '/api/v1/workspaces/{workspaceId}/projects/{projectId}/templates/test-characterization/install',
        '/api/v1/workspaces/{workspaceId}/projects/{projectId}/object-types/{objectTypeId}/records/{recordId}/restore',
      ]);
      for (const [path, pathItem] of Object.entries(programmable.paths)) {
        for (const [method, operation] of Object.entries(pathItem)) {
          if (!['get', 'post', 'patch', 'put', 'delete'].includes(method)) continue;
          if (!operation.tags?.includes('Programmable data')) continue;
          const successResponses = Object.entries(operation.responses).filter(([status]) =>
            /^2\d\d$/.test(status),
          );
          expect(
            successResponses.length,
            `${method.toUpperCase()} ${path} needs a success response`,
          ).toBeGreaterThan(0);
          for (const [status, response] of successResponses) {
            expect(
              Object.values(response.content ?? {}).some((media) => Boolean(media.schema)),
              `${method.toUpperCase()} ${path} ${status} needs a typed response body`,
            ).toBe(true);
          }
          if (method === 'patch' || (method === 'post' && !bodylessPosts.has(path))) {
            expect(
              operation.requestBody,
              `${method.toUpperCase()} ${path} needs a typed request body`,
            ).toBeDefined();
          }
        }
      }
      expect(tasks.get?.security).toEqual([{ engrove_session: [] }, { engrove_api_token: [] }]);
      expect(myWork.get?.security).toEqual([{ engrove_session: [] }, { engrove_api_token: [] }]);
      expect(myWork.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'urgency', required: false, in: 'query' }),
          expect.objectContaining({ name: 'sort', required: false, in: 'query' }),
          expect.objectContaining({ name: 'offset', required: false, in: 'query' }),
        ]),
      );
      expect(myWork.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.items.items.properties.project.properties.publicId.type',
        'string',
      );
      expect(notifications.get?.security).toEqual([{ engrove_session: [] }]);
      expect(notifications.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'unreadOnly', in: 'query' }),
          expect.objectContaining({ name: 'limit', in: 'query' }),
          expect.objectContaining({ name: 'offset', in: 'query' }),
        ]),
      );
      expect(notifications.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.pageInfo.properties.hasNext.type',
        'boolean',
      );
      expect(notifications.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.unreadCount.type',
        'integer',
      );
      expect(notifications.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.items.items.properties.type.enum',
        expect.arrayContaining(['task.mentioned', 'record.mentioned']),
      );
      expect(notifications.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.items.items.properties.taskKey.anyOf',
      );
      expect(signIn.post?.security).toEqual([]);
      expect(tasks.get?.summary).toBe('Tasks');
      expect(tasks.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'status', required: false, in: 'query' }),
        ]),
      );
      expect(taskFilters.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.items.items.properties.visibility.enum',
        ['personal', 'project'],
      );
      expect(taskFilters.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'query', required: false, in: 'query' }),
          expect.objectContaining({ name: 'limit', required: false, in: 'query' }),
          expect.objectContaining({ name: 'offset', required: false, in: 'query' }),
        ]),
      );
      expect(taskFilters.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.pageInfo.properties.total.type',
        'integer',
      );
      expect(taskFilterDetail.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.id.format',
        'uuid',
      );
      expect(taskFilters.post?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.visibility.enum',
        ['personal', 'project'],
      );
      expect(taskFilters.post?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.config.properties.view.enum',
        ['board', 'list', 'calendar'],
      );
      expect(taskFilters.post?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.config.properties.sort.enum',
        ['rank', 'title', 'status', 'priority', 'assignee', 'dueDate'],
      );
      expect(taskFilters.post?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.config.properties.direction.enum',
        ['asc', 'desc'],
      );
      expect(taskFilters.post?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.config.properties.group.enum',
        ['none', 'status', 'priority', 'assignee'],
      );
      expect(taskFilters.post?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.config.properties.listColumns.items.enum',
        ['title', 'status', 'priority', 'assignee', 'dueDate'],
      );
      expect(taskFilters.post?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.config.properties.statuses.items.pattern',
        '^[a-z][a-z0-9_]{0,39}$',
      );
      expect(taskFilters.post?.responses['201']).toHaveProperty(
        'content.application/json.schema.properties.favorite',
      );
      expect(taskFilterFavorite.post?.requestBody).toHaveProperty(
        'content.application/json.schema.properties.favorite.type',
        'boolean',
      );
      expect(tasks.get?.responses).toHaveProperty('429');
      expect(clientErrors.post?.security).toEqual([{ engrove_session: [] }]);
      expect(clientErrors.post?.requestBody).toHaveProperty(
        'content.application/json.schema.additionalProperties',
        false,
      );
      expect(clientErrors.post?.requestBody).not.toHaveProperty(
        'content.application/json.schema.properties.message',
      );
      expect(clientErrors.post?.responses['202']).toHaveProperty(
        'content.application/json.schema.properties.errorId.format',
        'uuid',
      );
      expect(tasks.get?.responses['200']).toHaveProperty('headers.RateLimit-Remaining');
      expect(tasks.get?.responses['200']).toHaveProperty('headers.ETag');
      expect(tasks.get?.responses['200']).toHaveProperty('headers.Cache-Control');
      expect(tasks.get?.responses['304']).toHaveProperty('headers.ETag');
      expect(tasks.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.pageInfo.properties.total',
      );
      expect(tasks.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'limit' }),
          expect.objectContaining({ name: 'offset' }),
          expect.objectContaining({ name: 'query' }),
          expect.objectContaining({ name: 'assignee' }),
          expect.objectContaining({ name: 'priority' }),
          expect.objectContaining({
            name: 'sort',
            schema: expect.objectContaining({
              enum: ['rank', 'title', 'status', 'priority', 'assignee', 'dueDate'],
            }),
          }),
          expect.objectContaining({ name: 'direction' }),
          expect.objectContaining({ name: 'hasDueDate' }),
          expect.objectContaining({ name: 'archiveState' }),
        ]),
      );
      expect(sources.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.pageInfo.properties.hasNext',
      );
      expect(sources.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.summary.properties.providerCount',
      );
      expect(sources.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'limit' }),
          expect.objectContaining({ name: 'offset' }),
          expect.objectContaining({ name: 'query' }),
          expect.objectContaining({ name: 'provider' }),
          expect.objectContaining({ name: 'archiveState' }),
        ]),
      );
      expect(reviewInbox.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.pageInfo.properties.hasNext.type',
        'boolean',
      );
      expect(reviewInbox.get?.responses['200']).toHaveProperty(
        'content.application/json.schema.properties.summary.properties.waitingForMe.type',
        'integer',
      );
      expect(reviewInbox.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'includeResolved' }),
          expect.objectContaining({ name: 'query' }),
          expect.objectContaining({ name: 'limit' }),
          expect.objectContaining({ name: 'offset' }),
        ]),
      );
      expect(readiness.get?.responses).not.toHaveProperty('429');
      expect(readiness.get?.responses['200']).not.toHaveProperty('headers.RateLimit-Remaining');
      expect(readiness.get?.responses).not.toHaveProperty('304');
    } finally {
      await application.close();
    }
  });
});
