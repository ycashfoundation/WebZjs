import React from 'react';
import cn from 'classnames';
import ErrorMessage from '../ErrorMessage/ErrorMessage';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  containerClassName?: string;
  labelClassName?: string;
  inputClassName?: string;
  suffix?: string;
  mono?: boolean;
  id: string;
}

const Input: React.FC<InputProps> = ({
  label,
  error,
  containerClassName = '',
  labelClassName = '',
  inputClassName = '',
  suffix = '',
  mono = false,
  id,
  ...props
}) => {
  return (
    <div className={cn('flex flex-col gap-2 w-full', containerClassName)}>
      {label && (
        <label
          htmlFor={id}
          className={cn(
            'font-mono text-[10px] uppercase tracking-[0.2em] text-text-dim',
            labelClassName,
          )}
        >
          {label}
        </label>
      )}
      <div
        className={cn(
          'flex items-center bg-card border rounded-md px-4 py-3 transition-colors',
          'border-border focus-within:border-accent',
          error && 'border-danger/60',
        )}
      >
        <input
          {...props}
          id={id}
          className={cn(
            'grow bg-transparent text-text placeholder:text-text-dim text-sm focus:outline-none',
            mono && 'font-mono tabular-nums',
            inputClassName,
          )}
          aria-describedby={`${id}-suffix`}
        />
        {suffix && (
          <span
            id={`${id}-suffix`}
            className="ml-2 font-mono text-xs uppercase tracking-[0.15em] text-text-muted"
          >
            {suffix}
          </span>
        )}
      </div>
      <ErrorMessage text={error} />
    </div>
  );
};

export default Input;
