"use client";

import * as React from "react";
import { CheckCircle2, Info, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";

export type ToastType = "success" | "error" | "info";

export type Toast = {
  id: string;
  type: ToastType;
  title: string;
  detail?: string;
};

type ToastContextValue = {
  toasts: Toast[];
  pushToast: (type: ToastType, title: string, detail?: string) => void;
  dismissToast: (id: string) => void;
};

const ToastContext = React.createContext<ToastContextValue>({
  toasts: [],
  pushToast: () => {},
  dismissToast: () => {},
});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const counter = React.useRef(0);

  const dismissToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = React.useCallback(
    (type: ToastType, title: string, detail?: string) => {
      counter.current += 1;
      const id = `to${counter.current}`;
      setToasts((prev) => [...prev.slice(-2), { id, type, title, detail }]);
      if (type !== "error") {
        setTimeout(() => dismissToast(id), 5000);
      }
    },
    [dismissToast]
  );

  const value = React.useMemo(
    () => ({ toasts, pushToast, dismissToast }),
    [toasts, pushToast, dismissToast]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toaster />
    </ToastContext.Provider>
  );
}

export function useToast() {
  return React.useContext(ToastContext);
}

const icons: Record<ToastType, React.ElementType> = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
};

const accent: Record<ToastType, string> = {
  success: "border-l-(--color-success)",
  error: "border-l-(--color-danger)",
  info: "border-l-(--color-primary)",
};

const iconColor: Record<ToastType, string> = {
  success: "text-(--badge-success-text)",
  error: "text-(--color-danger-text)",
  info: "text-(--color-primary-bright)",
};

function Toaster() {
  const { toasts, dismissToast } = React.useContext(ToastContext);
  return (
    <div
      aria-live="polite"
      className="fixed top-6 right-6 z-200 flex w-90 max-w-[calc(100vw-48px)] flex-col gap-2"
    >
      {toasts.map((toast) => {
        const Icon = icons[toast.type];
        return (
          <div
            key={toast.id}
            role="status"
            className={cn(
              "flex animate-toast-in items-start gap-3 rounded-icon border-l-3 px-4 py-3 glass-card",
              accent[toast.type]
            )}
          >
            <Icon
              className={cn("mt-px size-4.5 flex-none", iconColor[toast.type])}
              strokeWidth={2}
            />
            <div className="min-w-0 flex-1">
              <b className="block text-sm leading-snug font-semibold">
                {toast.title}
              </b>
              {toast.detail ? (
                <span className="mt-0.5 block text-xs leading-normal text-(--text-secondary)">
                  {toast.detail}
                </span>
              ) : null}
            </div>
            <button
              aria-label="Tutup"
              onClick={() => dismissToast(toast.id)}
              className="flex-none rounded p-0.5 text-sm leading-none text-(--text-tertiary) hover:bg-(--fill-hover-strong) hover:text-(--text-primary)"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
