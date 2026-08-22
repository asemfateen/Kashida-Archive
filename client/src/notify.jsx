import { useEffect, useRef, useState } from "react";

const listeners = new Set();
let seq = 0;

export function pushError(message) {
  const id = ++seq;
  const text = String(message || "Something went wrong").trim();
  for (const fn of listeners) fn({ id, text });
}

export function useErrorToasts() {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef({});

  useEffect(() => {
    const fn = (t) => {
      setToasts((prev) => [...prev, t]);
      timersRef.current[t.id] = setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== t.id));
        delete timersRef.current[t.id];
      }, 7000);
    };
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
      Object.values(timersRef.current).forEach(clearTimeout);
    };
  }, []);

  const dismiss = (id) => {
    if (timersRef.current[id]) {
      clearTimeout(timersRef.current[id]);
      delete timersRef.current[id];
    }
    setToasts((prev) => prev.filter((x) => x.id !== id));
  };

  return [toasts, dismiss];
}

export function ErrorToaster() {
  const [toasts, dismiss] = useErrorToasts();
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-6 right-6 z-[80] flex flex-col gap-2 max-w-sm w-full pointer-events-none" role="status" aria-live="polite" aria-label="Error notifications">
      {toasts.map((t, i) => (
        <div
          key={t.id}
          role="alert"
          className="pointer-events-auto flex items-start gap-3 bg-error text-on-error dark:text-white font-body-sm text-body-sm px-4 py-3 rounded-2xl shadow-soft-lg dark:shadow-dark-soft-lg toast-enter"
          style={{ animationDelay: `${i * 40}ms` }}
        >
          <span className="material-symbols-outlined text-[18px] shrink-0">
            error
          </span>
          <span className="flex-1 break-words min-w-0">{t.text}</span>
          <button
            onClick={() => dismiss(t.id)}
            className="shrink-0 opacity-70 hover:opacity-100 transition-opacity"
            aria-label="Dismiss error"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      ))}
    </div>
  );
}
