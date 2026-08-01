export type HealthStatus = 'ok' | 'not_ready';

export interface DependencyHealth {
  status: HealthStatus;
  code?: string;
}

export interface HealthResponse {
  service: string;
  status: HealthStatus;
  version: string;
  timestamp: string;
  requestId: string;
  dependencies?: Record<string, DependencyHealth>;
}

export const REQUEST_ID_HEADER = 'x-request-id';
export const INTERNAL_AUTH_HEADER = 'x-engrove-internal-secret';
