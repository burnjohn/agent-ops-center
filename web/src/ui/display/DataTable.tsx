import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { Button } from '../controls';
import styles from './DataTable.module.css';

export interface DataColumn<Row> {
  key: string;
  header: string;
  render: (row: Row) => ReactNode;
  align?: 'left' | 'right';
  /** Header becomes a button with `aria-sort`. */
  sortable?: boolean;
}

export interface DataTableProps<Row> {
  caption: string;
  columns: readonly DataColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  /** Whole-row click; the first cell should hold a link for keyboard users. */
  onRowClick?: (row: Row) => void;
  /** Active descending sort column, or null for the default order. */
  sortKey?: string | null;
  onSort?: (key: string) => void;
  /** Pager: `Show N more` when `more > 0`. */
  more?: number;
  moreLabel?: string;
  onShowMore?: () => void;
  emptyText?: string;
}

const INTERACTIVE = 'a, button, input, select, textarea, label';

export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  onRowClick,
  sortKey = null,
  onSort,
  more = 0,
  moreLabel = 'Show more',
  onShowMore,
  emptyText,
}: DataTableProps<Row>) {
  const click = (row: Row) => (event: MouseEvent<HTMLTableRowElement>) => {
    if ((event.target as HTMLElement).closest(INTERACTIVE)) return;
    onRowClick?.(row);
  };
  const key = (row: Row) => (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.target === event.currentTarget && event.key === 'Enter') onRowClick?.(row);
  };
  return (
    <div>
      <table className={styles.table}>
        <caption className={styles.caption}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={c.align === 'right' ? styles.right : undefined}
                aria-sort={c.sortable ? (sortKey === c.key ? 'descending' : 'none') : undefined}
              >
                {c.sortable ? (
                  <button type="button" className={styles.sortBtn} onClick={() => onSort?.(c.key)}>
                    {c.header}
                    {sortKey === c.key && <span aria-hidden="true"> ↓</span>}
                  </button>
                ) : (
                  c.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={onRowClick ? styles.clickable : undefined}
              onClick={onRowClick ? click(row) : undefined}
              onKeyDown={onRowClick ? key(row) : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} className={c.align === 'right' ? styles.right : undefined}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && emptyText && <p className={styles.empty}>{emptyText}</p>}
      {more > 0 && (
        <div className={styles.pager}>
          <Button size="sm" onClick={onShowMore}>
            {moreLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
