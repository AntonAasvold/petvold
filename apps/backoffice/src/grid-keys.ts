/**
 * Keyboard movement in a data grid, as the WAI-ARIA grid pattern describes:
 * arrows move between cells, Home/End to the row's ends, Ctrl+Home/End to the
 * grid's corners, PageUp/PageDown by a page of rows, Enter activates the row.
 * Pure; the grid component applies the result.
 */
export interface Cell {
  row: number;
  col: number;
}

export type Move = { to: Cell } | { activate: number } | null;

export function move(at: Cell, key: string, size: { rows: number; cols: number }, o: { ctrl?: boolean; page?: number } = {}): Move {
  if (size.rows === 0 || size.cols === 0) return null;
  const clamp = (c: Cell): Cell => ({ row: Math.min(Math.max(c.row, 0), size.rows - 1), col: Math.min(Math.max(c.col, 0), size.cols - 1) });
  const page = o.page ?? 10;
  switch (key) {
    case 'ArrowDown':
      return { to: clamp({ ...at, row: at.row + 1 }) };
    case 'ArrowUp':
      return { to: clamp({ ...at, row: at.row - 1 }) };
    case 'ArrowRight':
      return { to: clamp({ ...at, col: at.col + 1 }) };
    case 'ArrowLeft':
      return { to: clamp({ ...at, col: at.col - 1 }) };
    case 'Home':
      return { to: clamp(o.ctrl ? { row: 0, col: 0 } : { ...at, col: 0 }) };
    case 'End':
      return { to: clamp(o.ctrl ? { row: size.rows - 1, col: size.cols - 1 } : { ...at, col: size.cols - 1 }) };
    case 'PageDown':
      return { to: clamp({ ...at, row: at.row + page }) };
    case 'PageUp':
      return { to: clamp({ ...at, row: at.row - page }) };
    case 'Enter':
      return { activate: at.row };
    default:
      return null;
  }
}
