'use client';

import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

interface EntityDetailShellProps {
  open: boolean;
  title: string;
  children: ReactNode;
  modal?: boolean;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}

export function EntityDetailShell({
  open,
  title,
  children,
  modal = false,
  returnFocusRef,
  onClose,
}: EntityDetailShellProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const fallbackReturnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open || !modal) return;
    fallbackReturnFocus.current = document.activeElement as HTMLElement | null;
    const returnTarget = returnFocusRef?.current ?? fallbackReturnFocus.current;
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const background = Array.from(document.body.children)
      .filter((element) => element !== overlayRef.current)
      .map((element) => ({
        element: element as HTMLElement,
        inert: (element as HTMLElement).inert,
        ariaHidden: element.getAttribute('aria-hidden'),
      }));
    for (const item of background) {
      item.element.inert = true;
      item.element.setAttribute('aria-hidden', 'true');
    }
    return () => {
      document.body.style.overflow = previousOverflow;
      for (const item of background) {
        item.element.inert = item.inert;
        if (item.ariaHidden === null) item.element.removeAttribute('aria-hidden');
        else item.element.setAttribute('aria-hidden', item.ariaHidden);
      }
      window.requestAnimationFrame(() => returnTarget?.isConnected && returnTarget.focus());
    };
  }, [modal, open, returnFocusRef]);

  if (!open) return null;

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!modal) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [],
    );
    if (focusable.length === 0) {
      event.preventDefault();
      closeRef.current?.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const content = (
    <section
      ref={dialogRef}
      role={modal ? 'dialog' : 'region'}
      aria-modal={modal || undefined}
      aria-labelledby={titleId}
      onKeyDown={handleKeyDown}
      className="min-w-0 rounded-xl border border-border bg-card"
    >
      <header className="flex min-w-0 items-center justify-between gap-3 border-b border-border p-3">
        <h2 id={titleId} className="min-w-0 overflow-wrap-anywhere text-base font-semibold">
          {title}
        </h2>
        <Button ref={closeRef} type="button" variant="ghost" size="sm" onClick={onClose}>
          Закрыть
        </Button>
      </header>
      <div className="min-w-0 p-3">{children}</div>
    </section>
  );

  if (!modal) return content;

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-40 overflow-y-auto bg-black/45 p-0 sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {content}
    </div>,
    document.body,
  );
}
