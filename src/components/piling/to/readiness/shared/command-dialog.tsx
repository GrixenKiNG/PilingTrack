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

interface CommandDialogProps {
  open: boolean;
  title: string;
  description?: string;
  pending?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}

export function CommandDialog({
  open,
  title,
  description,
  pending = false,
  children,
  footer,
  returnFocusRef,
  onClose,
}: CommandDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const fallbackReturnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    fallbackReturnFocus.current = document.activeElement as HTMLElement | null;
    const returnTarget = returnFocusRef?.current ?? fallbackReturnFocus.current;
    titleRef.current?.focus();
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
  }, [open, returnFocusRef]);

  if (!open) return null;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !pending) {
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
      titleRef.current?.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === titleRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 grid items-end bg-black/45 sm:place-items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        data-testid="command-dialog"
        onKeyDown={handleKeyDown}
        className="flex max-h-dvh w-full min-w-0 flex-col overflow-hidden bg-card shadow-2xl sm:max-h-[calc(100dvh-32px)] sm:max-w-[min(640px,calc(100vw-32px))] sm:rounded-xl sm:border sm:border-border"
      >
        <div className="min-w-0 border-b border-border p-4">
          <h2
            ref={titleRef}
            id={titleId}
            tabIndex={-1}
            className="text-lg font-semibold outline-none"
          >
            {title}
          </h2>
          {description && (
            <p id={descriptionId} className="mt-1 text-sm text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        <div data-dialog-region="body" className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4">
          {children}
        </div>
        <div
          data-dialog-region="footer"
          className="z-10 flex flex-col-reverse gap-2 border-t border-border bg-card p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:flex-row sm:justify-end"
        >
          {footer}
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
            Закрыть
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
