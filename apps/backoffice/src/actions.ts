/** An action against the API, and the notice the view shows for it. */
import { msg } from '@lit/localize';

export interface Notice {
  variant: 'success' | 'warning' | 'danger';
  text: string;
  /** A conflict: offer to reload. */
  reload?: boolean;
}

/** Sends an action and turns the answer into a notice: success, a 409 conflict to reload, or the API's problem. */
export async function act(call: () => Promise<{ response: Response; error?: unknown }>, success: (status: number) => Notice): Promise<{ ok: boolean; notice: Notice }> {
  try {
    const { response, error } = await call();
    if (response.ok) return { ok: true, notice: success(response.status) };
    const p = (error ?? {}) as { title?: string; detail?: string };
    return {
      ok: false,
      notice:
        response.status === 409
          ? { variant: 'warning', text: `${msg('This has changed since you opened it.', { id: 'common.changed' })} ${p.detail ?? p.title ?? ''}`, reload: true }
          : { variant: 'danger', text: p.detail ?? p.title ?? response.statusText },
    };
  } catch {
    return { ok: false, notice: { variant: 'danger', text: msg('Something went wrong.', { id: 'common.error' }) } };
  }
}
