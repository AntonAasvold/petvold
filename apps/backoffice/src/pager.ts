/**
 * A list read a page at a time with the API's cursors (ADR 0002): there are
 * no page numbers, only "the next page". Pure state; the views fetch.
 */
export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export interface Pager<T> {
  items: T[];
  /** The cursor for the next page; undefined when everything is loaded. */
  next?: string;
  /** Whether at least one page has been loaded. */
  loaded: boolean;
}

export const emptyPager = <T>(): Pager<T> => ({ items: [], loaded: false });

/** The pager after a page arrived. */
export function append<T>(p: Pager<T>, page: Page<T>): Pager<T> {
  return { items: [...p.items, ...page.items], ...(page.nextCursor ? { next: page.nextCursor } : {}), loaded: true };
}

/** Whether there is more to load. */
export const hasMore = (p: Pager<unknown>): boolean => !p.loaded || p.next !== undefined;
