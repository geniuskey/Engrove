import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { EngroveConfig } from '@engrove/config';
import { createSession, getInstallationOrganizationId, type Pool } from '@engrove/database';
import { Controller, Get, HttpException, Inject, Query, Req, Res } from '@nestjs/common';
import { ApiFoundResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { hash } from 'argon2';
import type { Request, Response } from 'express';
import * as oidc from 'openid-client';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import { requestId, setSessionCookies } from './community.controller.js';
import { openApiSchema } from './openapi.js';
import type { Runtime } from './runtime.js';
import { RUNTIME } from './runtime.provider.js';

const OIDC_COOKIE = 'engrove_oidc_state';
interface OidcState {
  state: string;
  nonce: string;
  verifier: string;
  expiresAt: number;
  returnTo: string;
}

export interface OidcIdentityClaims {
  issuer: string;
  subject: string;
  email: string;
  displayName?: string;
}

type OidcUserConfig = Pick<EngroveConfig, 'OIDC_AUTO_PROVISION' | 'OIDC_DEFAULT_ROLE'>;
type OidcClaimConfig = Pick<
  EngroveConfig,
  'OIDC_EMAIL_CLAIM' | 'OIDC_NAME_CLAIM' | 'OIDC_ALLOWED_DOMAINS'
>;

function enabledConfig(runtime: Runtime) {
  const config = runtime.config;
  if (
    !config.OIDC_ISSUER ||
    !config.OIDC_CLIENT_ID ||
    !config.OIDC_CLIENT_SECRET ||
    !config.OIDC_REDIRECT_URI
  )
    throw new HttpException({ code: 'OIDC_NOT_CONFIGURED' }, 404);
  return config as typeof config & {
    OIDC_ISSUER: string;
    OIDC_CLIENT_ID: string;
    OIDC_CLIENT_SECRET: string;
    OIDC_REDIRECT_URI: string;
  };
}

function seal(value: OidcState, secret: string) {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function unseal(value: string | undefined, secret: string): OidcState {
  if (!value) throw new HttpException({ code: 'OIDC_STATE_MISSING' }, 400);
  const [payload, signature] = value.split('.');
  if (!payload || !signature) throw new HttpException({ code: 'OIDC_STATE_INVALID' }, 400);
  const expected = createHmac('sha256', secret).update(payload).digest();
  const supplied = Buffer.from(signature, 'base64url');
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
    throw new HttpException({ code: 'OIDC_STATE_INVALID' }, 400);
  const parsed = z
    .object({
      state: z.string().min(20),
      nonce: z.string().min(20),
      verifier: z.string().min(20),
      expiresAt: z.number(),
      returnTo: z.string().optional(),
    })
    .parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
  if (parsed.expiresAt < Date.now()) throw new HttpException({ code: 'OIDC_STATE_EXPIRED' }, 400);
  return { ...parsed, returnTo: safeOidcReturnTo(parsed.returnTo) };
}

export function safeOidcReturnTo(value: string | undefined): string {
  if (
    !value ||
    value.length > 2048 ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\')
  )
    return '/workspaces';
  try {
    const parsed = new URL(value, 'https://engrove.invalid');
    const allowed =
      parsed.pathname === '/' ||
      /^\/workspaces(?:\/|$)/.test(parsed.pathname) ||
      ['/members', '/audit', '/get-started', '/pilot'].includes(parsed.pathname);
    return allowed ? `${parsed.pathname}${parsed.search}${parsed.hash}` : '/workspaces';
  } catch {
    return '/workspaces';
  }
}

async function provider(runtime: Runtime) {
  const config = enabledConfig(runtime);
  return oidc.discovery(
    new URL(config.OIDC_ISSUER),
    config.OIDC_CLIENT_ID,
    config.OIDC_CLIENT_SECRET,
    undefined,
    config.NODE_ENV === 'production' ? undefined : { execute: [oidc.allowInsecureRequests] },
  );
}

export function parseOidcIdentityClaims(
  claims: Record<string, unknown>,
  config: OidcClaimConfig,
): OidcIdentityClaims {
  const issuer = z.string().url().max(2048).parse(claims.iss);
  const subject = z.string().min(1).max(255).parse(claims.sub);
  const email = z.string().email().max(320).parse(claims[config.OIDC_EMAIL_CLAIM]).toLowerCase();
  const displayName = z
    .string()
    .trim()
    .min(1)
    .max(120)
    .optional()
    .parse(claims[config.OIDC_NAME_CLAIM]);
  if (claims.email_verified !== true)
    throw new HttpException({ code: 'OIDC_EMAIL_NOT_VERIFIED' }, 403);
  const domain = email.split('@')[1];
  if (
    config.OIDC_ALLOWED_DOMAINS.length &&
    (!domain || !config.OIDC_ALLOWED_DOMAINS.includes(domain))
  )
    throw new HttpException({ code: 'OIDC_DOMAIN_NOT_ALLOWED' }, 403);
  return displayName ? { issuer, subject, email, displayName } : { issuer, subject, email };
}

export async function resolveOidcUser(
  pool: Pool,
  organizationId: string,
  config: OidcUserConfig,
  identity: OidcIdentityClaims,
): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
      JSON.stringify([identity.issuer, identity.subject]),
    ]);
    const linked = await client.query<{
      user_id: string;
      disabled_at: Date | null;
      has_membership: boolean;
    }>(
      `select oi.user_id, u.disabled_at,
         exists(select 1 from memberships m where m.user_id=u.id and m.organization_id=$3) as has_membership
       from oidc_identities oi join users u on u.id=oi.user_id
       where oi.issuer=$1 and oi.subject=$2 for update`,
      [identity.issuer, identity.subject, organizationId],
    );
    const linkedIdentity = linked.rows[0];
    if (linkedIdentity) {
      if (linkedIdentity.disabled_at || !linkedIdentity.has_membership)
        throw new HttpException({ code: 'OIDC_ACCOUNT_UNAVAILABLE' }, 403);
      await client.query(
        'update oidc_identities set updated_at=now() where issuer=$1 and subject=$2',
        [identity.issuer, identity.subject],
      );
      await client.query('commit');
      return linkedIdentity.user_id;
    }

    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `oidc-email:${identity.email}`,
    ]);
    const existing = await client.query<{ id: string }>(
      `select u.id from users u join memberships m on m.user_id=u.id
       where lower(u.email)=lower($1) and m.organization_id=$2 and u.disabled_at is null for update`,
      [identity.email, organizationId],
    );
    if (!existing.rows[0] && !config.OIDC_AUTO_PROVISION)
      throw new HttpException({ code: 'OIDC_PROVISIONING_DISABLED' }, 403);
    const userId = existing.rows[0]?.id ?? uuidv7();
    if (!existing.rows[0]) {
      await client.query(
        'insert into users (id,email,display_name,password_hash) values ($1,$2,$3,$4)',
        [
          userId,
          identity.email,
          identity.displayName ?? identity.email,
          await hash(randomBytes(32).toString('hex')),
        ],
      );
      await client.query(
        'insert into memberships (id,organization_id,user_id,role) values ($1,$2,$3,$4)',
        [uuidv7(), organizationId, userId, config.OIDC_DEFAULT_ROLE],
      );
    }
    await client.query(
      'insert into oidc_identities (id,issuer,subject,user_id) values ($1,$2,$3,$4)',
      [uuidv7(), identity.issuer, identity.subject, userId],
    );
    await client.query('commit');
    return userId;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

const oidcStatusResponse = z.object({ enabled: z.boolean() }).strict();
const redirectHeaders = {
  Location: {
    description: 'Authorization provider or safe Engrove return URL.',
    schema: { type: 'string', format: 'uri' },
  },
};

@ApiTags('Oidc')
@Controller('api/v1/auth/oidc')
export class OidcController {
  constructor(@Inject(RUNTIME) private readonly runtime: Runtime) {}

  @ApiOkResponse({ schema: openApiSchema(oidcStatusResponse) })
  @Get('status')
  status() {
    const config = this.runtime.config;
    return { enabled: Boolean(config.OIDC_ISSUER && config.OIDC_CLIENT_ID) };
  }

  @ApiQuery({
    name: 'returnTo',
    required: false,
    description: 'Internal Engrove path restored after OIDC sign-in. External URLs are ignored.',
  })
  @ApiFoundResponse({
    description: 'Redirects to the configured OIDC authorization endpoint.',
    headers: redirectHeaders,
  })
  @Get('start')
  async start(@Res() response: Response, @Query('returnTo') returnTo?: string) {
    const config = enabledConfig(this.runtime);
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(verifier);
    const url = oidc.buildAuthorizationUrl(await provider(this.runtime), {
      redirect_uri: config.OIDC_REDIRECT_URI,
      scope: config.OIDC_SCOPES,
      response_type: 'code',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    });
    response.cookie(
      OIDC_COOKIE,
      seal(
        {
          state,
          nonce,
          verifier,
          expiresAt: Date.now() + 10 * 60_000,
          returnTo: safeOidcReturnTo(returnTo),
        },
        config.INTERNAL_SERVICE_SECRET,
      ),
      {
        httpOnly: true,
        secure: config.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/api/v1/auth/oidc',
        maxAge: 10 * 60_000,
      },
    );
    response.redirect(url.href);
  }

  @ApiQuery({ name: 'code', required: true, type: String, description: 'OIDC authorization code.' })
  @ApiFoundResponse({
    description: 'Creates the Engrove session and redirects to the sealed internal return path.',
    headers: redirectHeaders,
  })
  @Get('callback')
  async callback(@Req() request: Request, @Res() response: Response, @Query('code') code?: string) {
    if (!code) throw new HttpException({ code: 'OIDC_CODE_MISSING' }, 400);
    const config = enabledConfig(this.runtime);
    const state = unseal(
      request.cookies?.[OIDC_COOKIE] as string | undefined,
      config.INTERNAL_SERVICE_SECRET,
    );
    const callbackUrl = new URL(request.originalUrl, config.OIDC_REDIRECT_URI);
    const tokens = await oidc.authorizationCodeGrant(await provider(this.runtime), callbackUrl, {
      pkceCodeVerifier: state.verifier,
      expectedState: state.state,
      expectedNonce: state.nonce,
    });
    const claims = z.record(z.string(), z.unknown()).parse(tokens.claims());
    const identity = parseOidcIdentityClaims(claims, config);
    const pool = this.runtime.pool;
    const organizationId = await getInstallationOrganizationId(pool);
    const userId = await resolveOidcUser(pool, organizationId, config, identity);
    const session = await createSession(pool, {
      userId,
      organizationId,
      requestId: requestId(request),
      idleMinutes: config.SESSION_IDLE_MINUTES,
      absoluteHours: config.SESSION_ABSOLUTE_HOURS,
    });
    setSessionCookies(this.runtime, response, session.token, session.csrfToken);
    response.clearCookie(OIDC_COOKIE, {
      secure: config.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/v1/auth/oidc',
    });
    response.redirect(`${config.ENGROVE_PUBLIC_URL.replace(/\/$/, '')}${state.returnTo}`);
  }
}
