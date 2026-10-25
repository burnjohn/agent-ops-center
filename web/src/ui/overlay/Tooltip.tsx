import { useId, cloneElement, type ReactElement } from 'react';
import styles from './Tooltip.module.css';

export interface TooltipProps {
  text: string;
  /** A single focusable element; gets aria-describedby pointing at the tooltip. */
  children: ReactElement<{ 'aria-describedby'?: string }>;
}

export function Tooltip({ text, children }: TooltipProps) {
  const id = useId();
  return (
    <span className={styles.wrap}>
      {cloneElement(children, { 'aria-describedby': id })}
      <span id={id} role="tooltip" className={styles.tooltip}>
        {text}
      </span>
    </span>
  );
}
