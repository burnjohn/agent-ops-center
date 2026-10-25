import { useId, type ReactNode, type SelectHTMLAttributes } from 'react';
import styles from './Select.module.css';

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  label: string;
  children: ReactNode;
}

export function Select({ label, children, id, className, ...rest }: SelectProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <div className={styles.field}>
      <label htmlFor={selectId} className={styles.label}>
        {label}
      </label>
      <select
        {...rest}
        id={selectId}
        className={[styles.select, className ?? ''].filter(Boolean).join(' ')}
      >
        {children}
      </select>
    </div>
  );
}
