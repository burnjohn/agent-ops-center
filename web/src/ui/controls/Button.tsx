import { useId, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import styles from './Button.module.css';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled'> {
  variant?: 'default' | 'primary';
  size?: 'md' | 'sm';
  /** Leading glyph (decorative). */
  glyph?: ReactNode;
  /** When set, the button is refused: aria-disabled, focusable, reason as description + tooltip (U-9). */
  disabledReason?: string;
  /** Plain disabled without a reason. */
  disabled?: boolean;
}

export function Button({
  variant = 'default',
  size = 'md',
  glyph,
  disabledReason,
  disabled = false,
  className,
  children,
  onClick,
  type = 'button',
  ...rest
}: ButtonProps) {
  const reasonId = useId();
  const refused = disabledReason !== undefined;
  const inert = refused || disabled;
  const classes = [
    styles.button,
    styles[variant],
    size === 'sm' ? styles.sm : '',
    inert ? styles.disabled : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (inert) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };
  return (
    <span className={styles.wrap}>
      <button
        {...rest}
        type={type}
        className={classes}
        aria-disabled={inert || undefined}
        aria-describedby={refused ? reasonId : rest['aria-describedby']}
        onClick={handleClick}
      >
        {glyph !== undefined && <span aria-hidden="true">{glyph}</span>}
        {children}
      </button>
      {refused && (
        <span id={reasonId} role="tooltip" className={styles.tooltip}>
          {disabledReason}
        </span>
      )}
    </span>
  );
}
