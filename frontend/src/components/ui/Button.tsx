import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'default' | 'primary' | 'success' | 'purple' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  icon?: ReactNode;
  children?: ReactNode;
}

const VARIANT_CLASS: Record<Variant, string> = {
  default: '',
  primary: 'btn-primary',
  success: 'btn-success',
  purple: 'btn-purple',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
};

export function Button({ variant = 'default', size = 'md', icon, children, className = '', ...rest }: ButtonProps) {
  const sizeClass = size === 'sm' ? 'btn-sm' : '';
  const isIconOnly = Boolean(icon && !children);
  // icon-only Buttons brauchen einen zugänglichen Namen — aus title übernehmen.
  const ariaLabel = rest['aria-label'] ?? (isIconOnly ? (typeof rest.title === 'string' ? rest.title : undefined) : undefined);
  return (
    <button
      className={`btn ${VARIANT_CLASS[variant]} ${sizeClass} ${isIconOnly ? 'btn-icon' : ''} ${className}`}
      aria-label={ariaLabel}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
