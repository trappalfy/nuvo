"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

const ACK_KEY = "nuvo.ack.v1";

// Brief 8: first visit to the app asks for a jurisdiction and risk acknowledgement.
// Brief 12: the wording is an open question — this is placeholder copy.
export function JurisdictionModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem(ACK_KEY) !== "1");
    } catch {
      setOpen(true);
    }
  }, []);

  const accept = () => {
    try {
      window.localStorage.setItem(ACK_KEY, "1");
    } catch {
      // Accepting once per session is fine if storage is blocked.
    }
    setOpen(false);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-[rgba(10,22,16,0.45)] p-[16px] sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="ack-title"
        >
          <motion.div
            className="w-full max-w-[560px] rounded-[16px] bg-white p-[32px]"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.25 }}
          >
            <h2 id="ack-title" className="text-[26px] leading-tight tracking-[-0.03em] text-ink">
              Before you continue
            </h2>
            <div className="mt-[20px] flex flex-col gap-[14px] text-[16px] leading-[1.5] text-dim">
              <p>
                Nuvo is not available in the United States or other restricted jurisdictions. By
                continuing you confirm you are not accessing it from one of them, and that you are
                not a person Nuvo is barred from serving.
              </p>
              <p>
                Every product converts your deposit into the other asset when the Friday reference
                reaches your price. Your deposit is locked until settlement and there is no early
                exit. Read the{" "}
                <Link href="/risk" className="text-ink underline underline-offset-4">
                  risk disclosure
                </Link>{" "}
                and the{" "}
                <Link href="/terms" className="text-ink underline underline-offset-4">
                  terms
                </Link>
                .
              </p>
              <p className="t-mono-sm text-dim">Placeholder copy, pending legal review.</p>
            </div>

            <div className="mt-[28px] flex flex-col gap-[12px] sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={accept}
                className="inline-flex h-[48px] items-center justify-center rounded-[8px] bg-ink px-[24px] t-mono text-white transition-colors duration-200 hover:bg-ink-hover"
              >
                I understand
              </button>
              <Link
                href="/"
                className="inline-flex h-[48px] items-center justify-center rounded-[8px] px-[16px] t-mono text-dim hover:text-ink"
              >
                Leave
              </Link>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
