import { NestFactory } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { AppModule } from './app.module.js';
import { RUNTIME } from './runtime.provider.js';

describe('AppModule runtime provider', () => {
  it('injects the bootstrap runtime without module-global state', async () => {
    const runtime = { config: { ENGROVE_VERSION: 'test-version' } } as never;
    const application = await NestFactory.createApplicationContext(AppModule.register(runtime), {
      logger: false,
    });
    try {
      expect(application.get(RUNTIME)).toBe(runtime);
    } finally {
      await application.close();
    }
  });
});
