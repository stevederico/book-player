import { useEffect, useState } from 'react';

const listeners = new Set();
let nextId = 1;

/**
 * Push a transient toast notification. Returns the toast id so the caller
 * can dismiss it early via dismissToast(id).
 *
 * @param {string} message - Plain-text message shown in the toast body.
 * @param {{variant?: 'default'|'error'|'success', duration?: number}} [options]
 * @returns {number} toast id
 */
export function toast(message, options = {}) {
  const id = nextId++;
  const item = {
    id,
    message,
    variant: options.variant || 'default',
    duration: options.duration ?? 5000,
  };
  listeners.forEach(fn => fn({ type: 'add', item }));
  if (item.duration > 0) {
    setTimeout(() => listeners.forEach(fn => fn({ type: 'remove', id })), item.duration);
  }
  return id;
}

toast.error = (message, options = {}) => toast(message, { ...options, variant: 'error' });
toast.success = (message, options = {}) => toast(message, { ...options, variant: 'success' });

/**
 * Dismiss a toast immediately by id (returned from toast()).
 * @param {number} id
 */
export function dismissToast(id) {
  listeners.forEach(fn => fn({ type: 'remove', id }));
}

/**
 * Mount once near the app root. Subscribes to the toast queue and renders
 * a stack of toasts in the bottom-right corner.
 */
export function Toaster() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    const fn = (event) => {
      if (event.type === 'add') {
        setItems(xs => [...xs, event.item]);
      } else {
        setItems(xs => xs.filter(x => x.id !== event.id));
      }
    };
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);

  if (items.length === 0) return null;

  return (
    <div
      aria-label="Notifications"
      className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none"
    >
      {items.map(item => (
        <div
          key={item.id}
          role={item.variant === 'error' ? 'alert' : 'status'}
          aria-live={item.variant === 'error' ? 'assertive' : 'polite'}
          className={
            'pointer-events-auto min-w-[260px] max-w-[420px] rounded-lg border px-4 py-3 text-sm shadow-lg motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 ' +
            (item.variant === 'error'
              ? 'bg-destructive text-destructive-foreground border-destructive'
              : 'bg-card text-foreground border-border')
          }
        >
          {item.message}
        </div>
      ))}
    </div>
  );
}
