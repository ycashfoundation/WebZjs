import React from 'react';
import cn from 'classnames';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  onClick: () => void;
  label: string;
  classNames?: string;
  variant?: ButtonVariant;
  icon?: React.ReactNode;
}

function Button({
  onClick,
  label,
  classNames = '',
  variant = 'primary',
  icon,
  ...rest
}: ButtonProps) {
  const buttonClasses = cn(
    'inline-flex items-center justify-center gap-2 px-6 py-3 rounded-md text-sm font-semibold tracking-tight',
    'transition-colors duration-150',
    'focus-visible:outline-2 focus-visible:outline-offset-2',
    {
      'cursor-not-allowed opacity-40': rest.disabled,
      'cursor-pointer': !rest.disabled,
    },
    {
      'bg-ycash text-bg hover:bg-ycash-hover focus-visible:outline-ycash':
        variant === 'primary',
      'bg-transparent text-text border border-border-strong hover:border-text-muted hover:bg-card focus-visible:outline-text-muted':
        variant === 'secondary',
      'bg-transparent text-text-muted hover:text-text focus-visible:outline-text-muted':
        variant === 'ghost',
      'bg-transparent text-danger border border-danger/40 hover:bg-danger-soft focus-visible:outline-danger':
        variant === 'danger',
    },
    classNames,
  );

  return (
    <button onClick={onClick} className={buttonClasses} {...rest}>
      {icon && <span className="flex items-center">{icon}</span>}
      <span>{label}</span>
    </button>
  );
}

export default Button;
