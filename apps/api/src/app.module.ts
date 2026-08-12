import { type DynamicModule, Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { CommunityController } from './community.controller.js';
import { ConfigurableDataController } from './configurable-data.controller.js';
import { EngineeringTypesController } from './engineering-types.controller.js';
import { FilesDatasetsController } from './files-datasets.controller.js';
import { VisualizationsController } from './visualizations.controller.js';
import { TasksController } from './tasks.controller.js';
import { MilestonesController } from './milestones.controller.js';
import { SourcesController } from './sources.controller.js';
import { RecordReviewsController } from './record-reviews.controller.js';
import { OidcController } from './oidc.controller.js';
import { MetricsController } from './metrics.controller.js';
import { PilotController } from './pilot.controller.js';
import { ApiTokensController } from './api-tokens.controller.js';
import { WebhooksController } from './webhooks.controller.js';
import { NotificationsController } from './notifications.controller.js';
import { TaskAutomationsController } from './task-automations.controller.js';
import { TaskWorkflowsController } from './task-workflows.controller.js';
import { WorkspaceSearchController } from './workspace-search.controller.js';
import { WorkspaceOverviewController } from './workspace-overview.controller.js';
import { WorkspaceMyWorkController } from './workspace-my-work.controller.js';
import { ClientErrorsController } from './client-errors.controller.js';
import {
  PublicRecordViewShareController,
  RecordViewShareManagementController,
} from './record-view-shares.controller.js';
import type { Runtime } from './runtime.js';
import { RUNTIME } from './runtime.provider.js';

@Module({
  controllers: [
    HealthController,
    CommunityController,
    ConfigurableDataController,
    EngineeringTypesController,
    FilesDatasetsController,
    VisualizationsController,
    TasksController,
    MilestonesController,
    SourcesController,
    RecordReviewsController,
    OidcController,
    MetricsController,
    PilotController,
    ApiTokensController,
    WebhooksController,
    NotificationsController,
    TaskAutomationsController,
    TaskWorkflowsController,
    WorkspaceSearchController,
    WorkspaceOverviewController,
    WorkspaceMyWorkController,
    ClientErrorsController,
    RecordViewShareManagementController,
    PublicRecordViewShareController,
  ],
})
export class AppModule {
  static register(runtime: Runtime): DynamicModule {
    return {
      module: AppModule,
      providers: [{ provide: RUNTIME, useValue: runtime }],
    };
  }
}
