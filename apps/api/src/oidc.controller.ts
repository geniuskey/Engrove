import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createSession, getInstallationOrganizationId } from '@engrove/database';
import { Controller, Get, HttpException, Query, Req, Res } from '@nestjs/common';
import { hash } from 'argon2';
import type { Request, Response } from 'express';
import * as oidc from 'openid-client';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import { appRuntime, requestId, setSessionCookies } from './community.controller.js';

const OIDC_COOKIE = 'engrove_oidc_state';
interface OidcState {
  state: string;
  nonce: string;
  verifier: string;
  expiresAt: number;
}

function enabledConfig() {
  const config = appRuntime().config;
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
    })
    .parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
  if (parsed.expiresAt < Date.now()) throw new HttpException({ code: 'OIDC_STATE_EXPIRED' }, 400);
  return parsed;
}

async function provider() {
  const config = enabledConfig();
  return oidc.discovery(
    new URL(config.OIDC_ISSUER),
    config.OIDC_CLIENT_ID,
    config.OIDC_CLIENT_SECRET,
    undefined,
    config.NODE_ENV === 'production' ? undefined : { execute: [oidc.allowInsecureRequests] },
  );
}

@Controller('api/v1/auth/oidc')
export class OidcController {
  @Get('status') status() {
    const config = appRuntime().config;
    return { enabled: Boolean(config.OIDC_ISSUER && config.OIDC_CLIENT_ID) };
  }

  @Get('start') async start(@Res() response: Response) {
    const config = enabledConfig();
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(verifier);
    const url = oidc.buildAuthorizationUrl(await provider(), {
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
        { state, nonce, verifier, expiresAt: Date.now() + 10 * 60_000 },
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

  @Get('callback') async callback(
    @Req() request: Request,
    @Res() response: Response,
    @Query('code') code?: string,
  ) {
    if (!code) throw new HttpException({ code: 'OIDC_CODE_MISSING' }, 400);
    const config = enabledConfig();
    const state = unseal(
      request.cookies?.[OIDC_COOKIE] as string | undefined,
      config.INTERNAL_SERVICE_SECRET,
    );
    const callbackUrl = new URL(request.originalUrl, config.OIDC_REDIRECT_URI);
    const tokens = await oidc.authorizationCodeGrant(await provider(), callbackUrl, {
      pkceCodeVerifier: state.verifier,
      expectedState: state.state,
      expectedNonce: state.nonce,
    });
    const claims = z.record(z.string(), z.unknown()).parse(tokens.claims());
    z.string().min(1).parse(claims.sub);
    const claimedEmail = z.string().email().parse(claims[config.OIDC_EMAIL_CLAIM]).toLowerCase();
    const claimedName = z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .parse(claims[config.OIDC_NAME_CLAIM]);
    if (claims.email_verified === false)
      throw new HttpException({ code: 'OIDC_EMAIL_NOT_VERIFIED' }, 403);
    const domain = claimedEmail.split('@')[1];
    if (
      config.OIDC_ALLOWED_DOMAINS.length &&
      (!domain || !config.OIDC_ALLOWED_DOMAINS.includes(domain))
    )
      throw new HttpException({ code: 'OIDC_DOMAIN_NOT_ALLOWED' }, 403);
    const pool = appRuntime().pool;
    const organizationId = await getInstallationOrganizationId(pool);
    const client = await pool.connect();
    let userId: string;
    try {
      await client.query('begin');
      const existing = await client.query<{ id: string }>(
        `select u.id from users u join memberships m on m.user_id=u.id
         where lower(u.email)=lower($1) and m.organization_id=$2 and u.disabled_at is null for update`,
        [claimedEmail, organizationId],
      );
      if (!existing.rows[0] && !config.OIDC_AUTO_PROVISION)
        throw new HttpException({ code: 'OIDC_PROVISIONING_DISABLED' }, 403);
      userId = existing.rows[0]?.id ?? uuidv7();
      if (!existing.rows[0]) {
        await client.query(
          'insert into users (id,email,display_name,password_hash) values ($1,$2,$3,$4)',
          [
            userId,
            claimedEmail,
            claimedName ?? claimedEmail,
            await hash(randomBytes(32).toString('hex')),
          ],
        );
        await client.query(
          'insert into memberships (id,organization_id,user_id,role) values ($1,$2,$3,$4)',
          [uuidv7(), organizationId, userId, config.OIDC_DEFAULT_ROLE],
        );
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    const session = await createSession(pool, {
      userId,
      organizationId,
      requestId: requestId(request),
      idleMinutes: config.SESSION_IDLE_MINUTES,
      absoluteHours: config.SESSION_ABSOLUTE_HOURS,
    });
    setSessionCookies(response, session.token, session.csrfToken);
    response.clearCookie(OIDC_COOKIE, {
      secure: config.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/v1/auth/oidc',
    });
    response.redirect(`${config.ENGROVE_PUBLIC_URL.replace(/\/$/, '')}/workspaces`);
  }
}
