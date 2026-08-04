import { z } from 'zod';

export const observabilityConfigShape = {
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
};
