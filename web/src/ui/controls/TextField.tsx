import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import styles from './TextField.module.css';

interface FieldChromeProps {
  label: string;
  required?: boolean;
  error?: string | undefined;
  /** Show a "n / max" counter once the value reaches maxLength. */
  value: string;
  maxLength?: number | undefined;
}

interface ChromeRenderProps {
  inputId: string;
  describedBy: string | undefined;
  invalid: boolean;
}

function FieldChrome({
  label,
  required,
  error,
  value,
  maxLength,
  id,
  render,
}: FieldChromeProps & { id: string | undefined; render: (p: ChromeRenderProps) => ReactNode }) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = `${inputId}-error`;
  const counterId = `${inputId}-counter`;
  const atLimit = maxLength !== undefined && value.length >= maxLength;
  const describedBy =
    [error ? errorId : '', atLimit ? counterId : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={styles.field}>
      <label htmlFor={inputId} className={styles.label}>
        {label}
        {required && (
          <span className={styles.required} aria-hidden="true">
            {' *'}
          </span>
        )}
      </label>
      {render({ inputId, describedBy, invalid: Boolean(error) })}
      {error && (
        <p id={errorId} role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {atLimit && (
        <p id={counterId} className={styles.counter}>
          {value.length} / {maxLength}
        </p>
      )}
    </div>
  );
}

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value'> {
  label: string;
  value: string;
  error?: string | undefined;
}

export function TextField({
  label,
  value,
  error,
  required,
  maxLength,
  id,
  className,
  ...rest
}: TextFieldProps) {
  return (
    <FieldChrome
      label={label}
      required={required}
      error={error}
      value={value}
      maxLength={maxLength}
      id={id}
      render={({ inputId, describedBy, invalid }) => (
        <input
          {...rest}
          id={inputId}
          value={value}
          required={required}
          maxLength={maxLength}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={[styles.input, className ?? ''].filter(Boolean).join(' ')}
        />
      )}
    />
  );
}

export interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value'> {
  label: string;
  value: string;
  error?: string | undefined;
}

export function TextArea({
  label,
  value,
  error,
  required,
  maxLength,
  id,
  className,
  rows = 4,
  ...rest
}: TextAreaProps) {
  return (
    <FieldChrome
      label={label}
      required={required}
      error={error}
      value={value}
      maxLength={maxLength}
      id={id}
      render={({ inputId, describedBy, invalid }) => (
        <textarea
          {...rest}
          id={inputId}
          rows={rows}
          value={value}
          required={required}
          maxLength={maxLength}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={[styles.input, styles.area, className ?? ''].filter(Boolean).join(' ')}
        />
      )}
    />
  );
}
