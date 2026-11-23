import { clearOAuthCookie, finishGoogleSignIn, startGoogleSignIn } from './auth';
import { shoppingApi, thanksApi } from './data';
import { errorResponse, HttpError, json, rejectMethod, secureApiResponse } from './http';
import {
  appOrigin,
  clearSessionCookie,
  recordActivity,
  revokeSession,
  sessionCookie,
  sessionDto,
  sessionFromRequest,
  verifyCsrf,
  type SessionContext,
} from './session';

async function apiRequest(request: Request, env: Cloudflare.Env): Promise<Response> {
  const path = new URL(request.url).pathname;
  let session: SessionContext | undefined;
  let response: Response;
  try {
    if (new URL(request.url).origin !== appOrigin(env)) {
      throw new HttpError(403, 'ORIGIN_REJECTED', 'This origin is not allowed.');
    }
    if (path === '/api/auth/google/start') {
      if (request.method !== 'GET') return rejectMethod();
      return secureApiResponse(await startGoogleSignIn(request, env));
    }
    if (path === '/api/auth/google/callback') {
      if (request.method !== 'GET') return rejectMethod();
      try {
        return secureApiResponse(await finishGoogleSignIn(request, env));
      } catch {
        const failed = new Response(null, {
          status: 303,
          headers: { Location: `${appOrigin(env)}/login?error=authentication_failed` },
        });
        failed.headers.append('Set-Cookie', clearOAuthCookie());
        return secureApiResponse(failed);
      }
    }
    const shopping = /^\/api\/shopping-items(?:\/([^/]+))?$/.exec(path);
    const thanks = /^\/api\/thanks-posts(?:\/([^/]+)(?:\/reactions\/([^/]+))?)?$/.exec(path);
    if (!shopping && !thanks && path !== '/api/auth/session' && path !== '/api/auth/logout') {
      throw new HttpError(404, 'NOT_FOUND', 'The API endpoint was not found.');
    }
    session = await sessionFromRequest(request, env);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method))
      await verifyCsrf(request, env, session);
    // Only requests explicitly associated with user activity renew the session.
    await recordActivity(request, env, session);
    if (path === '/api/auth/session') {
      if (request.method !== 'GET') return rejectMethod();
      response = json(sessionDto(session));
    } else if (path === '/api/auth/logout') {
      if (request.method !== 'POST') return rejectMethod();
      await revokeSession(env, session);
      response = new Response(null, { status: 204 });
      response.headers.append('Set-Cookie', clearSessionCookie());
      session.renewed = false;
    } else if (shopping) {
      response = await shoppingApi(request, env, session, shopping[1]);
    } else if (thanks) {
      response = await thanksApi(request, env, session, thanks[1], thanks[2]);
    } else {
      throw new HttpError(404, 'NOT_FOUND', 'The API endpoint was not found.');
    }
  } catch (error) {
    response = errorResponse(error);
    if (error instanceof HttpError && error.status === 401)
      response.headers.append('Set-Cookie', clearSessionCookie());
  }
  if (session) {
    response.headers.set('X-Family-Hub-Session', session.csrfToken);
    if (session.renewed) response.headers.append('Set-Cookie', sessionCookie(session));
  }
  return secureApiResponse(response);
}

export default {
  async fetch(request: Request, env: Cloudflare.Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/api' || path.startsWith('/api/')) return apiRequest(request, env);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Cloudflare.Env>;
