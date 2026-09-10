"use client";

import { AnimatePresence, motion } from "motion/react";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

// Brief 8: transactions report through toasts, with a link into the explorer
// when there is one.

type Toast = {
  id: number;
  title: string;
  tone: "info" | "success" | "error";
  href?: string;
  linkLabel?: string;
};

type ToastInput = Omit<Toast, "id">;

const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);

export function useToast() {
  const push = useContext(ToastContext);
  if (!push) throw new Error("useToast outside Toaster");
  return push;
}

export function Toaster({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((toast: ToastInput) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { ...toast, id }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 6000);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-[8px] p-[16px] sm:items-end">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              className={[
                "pointer-events-auto flex max-w-[420px] items-center gap-[16px] rounded-[10px] px-[16px] py-[12px] text-[15px] shadow-[0_8px_30px_rgba(34,47,48,0.14)]",
                toast.tone === "error" ? "bg-[#3A2422] text-white" : "bg-ink text-white",
              ].join(" ")}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.25 }}
            >
              <span className="flex items-center gap-[10px]">
                {toast.tone === "success" && (
                  <span className="block size-[8px] rounded-[2px] bg-lime" aria-hidden="true" />
                )}
                {toast.title}
              </span>
              {toast.href && (
                <a
                  href={toast.href}
                  target="_blank"
                  rel="noreferrer"
                  className="t-mono-sm shrink-0 text-lime underline-offset-4 hover:underline"
                >
                  {toast.linkLabel ?? "View"}
                </a>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
