// Brief 5: there is no logo yet. The mark is an outlined circle crossed by a
// horizontal line just below centre — the level a product settles at. Everything
// goes through this file so the final logo is a one-file change.
export function Mark({ size = 26, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
      className={className}
    >
      <circle cx="16" cy="16" r="12" />
      <line x1="2" y1="18.5" x2="30" y2="18.5" strokeLinecap="round" />
    </svg>
  );
}

/** Mark 26px + 10px gap + the word, as specified in brief 5. */
export function Lockup({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center ${className ?? ""}`}>
      <Mark size={26} />
      <span className="ml-[10px] text-[26px] leading-none tracking-[-0.03em]">Nuvo</span>
    </span>
  );
}
