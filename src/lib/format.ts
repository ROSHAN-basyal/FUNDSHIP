export function displayName(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]}_(${parts.at(-1)?.[0]})` : parts[0];
}

export function initials(name: string) {
  return name.split(/\s+/).map(part => part[0]).slice(0,2).join('').toUpperCase();
}

export const money = (amount: number) => new Intl.NumberFormat('en-NP', {
  style: 'currency', currency: 'NPR', maximumFractionDigits: 0,
}).format(amount).replace('NPR', 'रु');

export function relativeDate(dateString: string) {
  const value = new Date(dateString);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days > 1 && days <= 7) return `Coming ${value.toLocaleDateString('en-US', { weekday: 'long' })}`;
  return value.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function timeOnly(dateString: string) {
  return new Date(dateString).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function relativeTime(dateString: string) {
  const delta = Date.now() - new Date(dateString).getTime();
  const mins = Math.max(1, Math.floor(delta / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
