"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
  XCircle,
} from "lucide-react";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

export type ToastVariant = "success" | "warning" | "danger" | "info";

export interface ToastInput {
  variant: ToastVariant;
  title: string;
  message: string;
  duration?: number;
}

export interface Toast extends ToastInput {
  id: string;
  duration: number;
}

const defaultDuration = 5000;
const exitDuration = 140;

function createToast(input: ToastInput): Toast {
  return {
    ...input,
    id: crypto.randomUUID(),
    duration: input.duration ?? defaultDuration,
  };
}

export function useToasts(initialToasts: ToastInput[] = []) {
  const [toasts, setToasts] = useState<Toast[]>(() =>
    initialToasts.map(createToast),
  );

  const addToast = useCallback((toast: ToastInput) => {
    setToasts((current) => [createToast(toast), ...current]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  return { toasts, addToast, dismissToast };
}

export function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-[min(420px,calc(100vw-2rem))] flex-col gap-3">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: string) => void;
}) {
  const [isPaused, setIsPaused] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const remainingMs = useRef(toast.duration);
  const startedAt = useRef<number>(0);
  const timeoutId = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimeoutId = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (isClosing) {
      return;
    }

    if (timeoutId.current) {
      clearTimeout(timeoutId.current);
    }

    setIsClosing(true);
    exitTimeoutId.current = setTimeout(() => onDismiss(toast.id), exitDuration);
  }, [isClosing, onDismiss, toast.id]);

  useEffect(() => {
    if (isPaused || isClosing) {
      return;
    }

    startedAt.current = Date.now();
    timeoutId.current = setTimeout(dismiss, remainingMs.current);

    return () => {
      if (timeoutId.current) {
        clearTimeout(timeoutId.current);
      }
      remainingMs.current = Math.max(
        0,
        remainingMs.current - (Date.now() - startedAt.current),
      );
    };
  }, [dismiss, isClosing, isPaused]);

  useEffect(() => {
    return () => {
      if (exitTimeoutId.current) {
        clearTimeout(exitTimeoutId.current);
      }
    };
  }, []);

  const isAlert = toast.variant === "warning" || toast.variant === "danger";
  const tone = toastTone(toast.variant);

  return (
    <div
      role={isAlert ? "alert" : "status"}
      onClick={dismiss}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      className={`pointer-events-auto relative cursor-pointer overflow-hidden rounded-lg border bg-white p-4 pr-11 shadow-lg ${
        isClosing ? "toast-exit" : "toast-enter"
      } ${tone.border}`}
      style={{ "--toast-duration": `${toast.duration}ms` } as CSSProperties}
    >
      <div className="flex gap-3">
        <ToastIcon variant={toast.variant} className={tone.icon} />
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[#141515]">
            {toast.title}
          </div>
          <div className="mt-1 text-sm text-[#526176]">{toast.message}</div>
        </div>
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={(event) => {
          event.stopPropagation();
          dismiss();
        }}
        className="interactive absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md text-[#64748b] hover:bg-[#edf4ff]"
      >
        <X size={16} aria-hidden />
      </button>
      <div className={`toast-progress ${tone.progress}`} />
    </div>
  );
}

function ToastIcon({
  variant,
  className,
}: {
  variant: ToastVariant;
  className: string;
}) {
  const iconClassName = `mt-0.5 shrink-0 ${className}`;

  if (variant === "success") {
    return <CheckCircle2 className={iconClassName} size={20} aria-hidden />;
  }

  if (variant === "warning") {
    return <AlertTriangle className={iconClassName} size={20} aria-hidden />;
  }

  if (variant === "danger") {
    return <XCircle className={iconClassName} size={20} aria-hidden />;
  }

  return <Info className={iconClassName} size={20} aria-hidden />;
}

function toastTone(variant: ToastVariant) {
  if (variant === "success") {
    return {
      border: "border-[#bbf7d0]",
      icon: "text-[#15803d]",
      progress: "bg-[#22c55e]",
    };
  }

  if (variant === "warning") {
    return {
      border: "border-[#fde68a]",
      icon: "text-[#b45309]",
      progress: "bg-[#f59e0b]",
    };
  }

  if (variant === "danger") {
    return {
      border: "border-[#fecaca]",
      icon: "text-[#dc2626]",
      progress: "bg-[#ef4444]",
    };
  }

  return {
    border: "border-[#bfdbfe]",
    icon: "text-[#0b3d91]",
    progress: "bg-[#2563eb]",
  };
}
