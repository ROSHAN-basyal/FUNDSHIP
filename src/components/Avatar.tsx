import { initials } from '../lib/format';

export function Avatar({ name, color, size = 'md', className = '' }: { name: string; color: string; size?: 'sm'|'md'|'lg'|'xl'; className?: string }) {
  return (
    <span className={`avatar avatar-${size} ${className}`} style={{ '--avatar-color': color } as React.CSSProperties} aria-label={name}>
      {initials(name)}
    </span>
  );
}
