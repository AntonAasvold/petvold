/**
 * The API client, typed from openapi.yaml (ADR 0035). A path or field the
 * contract lacks is a type error.
 */
import createClient from 'openapi-fetch';
import type { paths } from './schema';
import type { Session } from '../auth.ts';
import { getLocale } from '../i18n.ts';

export type Api = ReturnType<typeof createClient<paths>>;

export function apiClient(baseUrl: string, session: Session): Api {
  const client = createClient<paths>({ baseUrl });
  client.use({
    async onRequest({ request }) {
      const token = await session.token();
      if (token) request.headers.set('authorization', `Bearer ${token}`);
      request.headers.set('accept-language', getLocale());
      return request;
    },
  });
  return client;
}

/** A problem from the API (RFC 9457), as the views show it. */
export interface Problem {
  status: number;
  title: string;
  detail?: string;
}

/** The data of a response, or the problem. */
export async function unwrap<T>(p: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const { data, error, response } = await p;
  if (data !== undefined && response.ok) return data;
  const e = (error ?? {}) as Partial<Problem>;
  throw { status: response.status, title: e.title ?? response.statusText, ...(e.detail ? { detail: e.detail } : {}) } satisfies Problem;
}
