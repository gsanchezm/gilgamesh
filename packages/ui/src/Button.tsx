import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({ variant = 'primary', className = '', type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      data-variant={variant}
      className={`gx-btn gx-btn--${variant}${className ? ` ${className}` : ''}`}
      {...rest}
    />
  );
}
