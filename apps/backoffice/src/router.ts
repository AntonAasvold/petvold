/** A small router on the history API: a path pattern per view. */
export interface Route {
  pattern: RegExp;
  /** The view's tag, given the match's groups as attributes. */
  render: (params: Record<string, string>) => unknown;
}

export function match(routes: Route[], path: string): { route: Route; params: Record<string, string> } | null {
  for (const route of routes) {
    const m = route.pattern.exec(path);
    if (m) return { route, params: { ...(m.groups ?? {}) } };
  }
  return null;
}

/** Navigates without a reload; views listen for 'pv-navigate'. */
export function navigate(path: string): void {
  if (path === location.pathname + location.search) return;
  history.pushState(null, '', path);
  window.dispatchEvent(new Event('pv-navigate'));
}
