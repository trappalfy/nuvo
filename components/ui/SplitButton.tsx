"use client";

import Link from "next/link";
import { ArrowRight } from "./Arrow";

// Brief 6.2: a dark label part and a lime arrow square, 2px apart, with the
// joint bevelled like a slash. Hover lightens the dark part and nudges the
// arrow 3px right.
const DARK_CLIP = "polygon(0 0, 100% 0, calc(100% - 8px) 100%, 0 100%)";
const LIME_CLIP = "polygon(8px 0, 100% 0, 100% 100%, 0 100%)";

type Props = {
  label?: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  /** true = always full width, "mobile" = full width under lg. */
  full?: boolean | "mobile";
  tone?: "dark" | "light";
  className?: string;
  type?: "button" | "submit";
};

export function SplitButton({
  label = "Launch app",
  href,
  onClick,
  disabled = false,
  full = false,
  tone = "dark",
  className,
  type = "button",
}: Props) {
  const body = (
    <>
      <span
        className={[
          "flex h-12 items-center justify-center rounded-[8px] px-[24px] t-mono transition-colors duration-200",
          full === true ? "flex-1" : full === "mobile" ? "flex-1 lg:w-[211px] lg:flex-none" : "w-[211px]",
          tone === "dark"
            ? "bg-ink text-white group-hover:bg-ink-hover"
            : "bg-white text-ink group-hover:bg-nav",
          disabled ? "opacity-50" : "",
        ].join(" ")}
        style={{ clipPath: DARK_CLIP }}
      >
        {label}
      </span>
      <span
        className={[
          "flex h-12 w-[50px] shrink-0 items-center justify-center rounded-[8px] bg-lime text-lime-ink",
          disabled ? "opacity-50" : "",
        ].join(" ")}
        style={{ clipPath: LIME_CLIP }}
      >
        <ArrowRight className="transition-transform duration-200 group-hover:translate-x-[3px]" />
      </span>
    </>
  );

  const shell = [
    "group inline-flex items-stretch gap-[2px] rounded-[8px] select-none",
    full === true ? "w-full" : full === "mobile" ? "w-full lg:w-auto" : "",
    disabled ? "pointer-events-none" : "",
    className ?? "",
  ].join(" ");

  if (href && !disabled) {
    return (
      <Link href={href} className={shell} aria-label={label}>
        {body}
      </Link>
    );
  }

  return (
    <button type={type} className={shell} onClick={onClick} disabled={disabled}>
      {body}
    </button>
  );
}
