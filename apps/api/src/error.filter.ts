import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { RepositoryError } from '@engrove/database';
import { PermissionDeniedError } from '@engrove/permissions';
import { ZodError } from 'zod';
import { observeError } from './metrics.controller.js';

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    const requestId = String(request.headers['x-request-id'] ?? 'unknown');

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      if (typeof body === 'object' && body && 'service' in body && 'status' in body) {
        response.status(exception.getStatus()).json(body);
        return;
      }
      const code =
        typeof body === 'object' && body && 'code' in body ? String(body.code) : 'HTTP_ERROR';
      observeError(code);
      response.status(exception.getStatus()).json({
        error: { code, message: exception.message, details: [], requestId },
      });
      return;
    }

    if (exception instanceof RepositoryError) {
      observeError(exception.code);
      response.status(exception.status).json({
        error: { code: exception.code, message: exception.message, details: [], requestId },
      });
      return;
    }

    if (exception instanceof PermissionDeniedError) {
      observeError(exception.code);
      response.status(403).json({
        error: {
          code: exception.code,
          message: 'You do not have permission to perform this action.',
          details: [],
          requestId,
        },
      });
      return;
    }

    if (exception instanceof ZodError) {
      observeError('VALIDATION_FAILED');
      response.status(400).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'The supplied value is invalid.',
          details: exception.issues.map((issue) => ({
            field: issue.path.join('.'),
            reason: issue.message,
          })),
          requestId,
        },
      });
      return;
    }

    const databaseCode =
      typeof exception === 'object' && exception && 'code' in exception
        ? String(exception.code)
        : undefined;
    if (databaseCode === '23505') {
      observeError('UNIQUE_CONFLICT');
      response.status(409).json({
        error: {
          code: 'UNIQUE_CONFLICT',
          message: 'A value that must be unique is already in use.',
          details: [],
          requestId,
        },
      });
      return;
    }

    this.logger.error(
      `Unhandled API exception requestId=${requestId}`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    observeError('INTERNAL_ERROR');

    response.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
        details: [],
        requestId,
      },
    });
  }
}
