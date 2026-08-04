import { type DynamicModule, Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { CommunityController } from './community.controller.js';
import { ConfigurableDataController } from './configurable-data.controller.js';
import { EngineeringTypesController } from './engineering-types.controller.js';
import { FilesDatasetsController } from './files-datasets.controller.js';
import { VisualizationsController } from './visualizations.controller.js';
import { TasksController } from './tasks.controller.js';
import { OidcController } from './oidc.controller.js';
import { MetricsController } from './metrics.controller.js';
import { PilotController } from './pilot.controller.js';
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
    OidcController,
    MetricsController,
    PilotController,
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
