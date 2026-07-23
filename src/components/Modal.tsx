import { X } from 'lucide-react';
import type { ReactNode } from 'react';

export function Modal({ title, subtitle, children, onClose, wide = false }: {
  title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean;
}) {
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label={title}>
      <button className="modal-scrim" onClick={onClose} aria-label="Close" />
      <section className={`modal-sheet ${wide ? 'modal-wide' : ''}`}>
        <div className="modal-handle" />
        <header className="modal-header">
          <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
          <button className="icon-btn ghost" onClick={onClose} aria-label="Close"><X size={20}/></button>
        </header>
        <div className="modal-content">{children}</div>
      </section>
    </div>
  );
}
