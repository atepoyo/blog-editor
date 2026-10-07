import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

export function Modal({ title, closeLabel, onClose, children }: { title: string; closeLabel: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog ref={dialog} onCancel={onClose} aria-label={title}>
      <div className="modal-heading"><h2>{title}</h2><button type="button" className="quiet" onClick={onClose}>{closeLabel}</button></div>
      {children}
    </dialog>
  );
}
