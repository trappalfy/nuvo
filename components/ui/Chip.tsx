// Brief 6.3 / 6.4: a label chip. Dark on the video, light inside the page
// section. Radius 6, 8px square dot, Geist Mono 13 caps.
export function Chip({
  label,
  tone = "dark",
  className,
}: {
  label: string;
  tone?: "dark" | "light";
  className?: string;
}) {
  const dark = tone === "dark";
  return (
    <span
      className={[
        "inline-flex h-[30px] items-center gap-[8px] rounded-[6px] px-[10px] t-mono-sm",
        dark ? "bg-chip text-white" : "bg-nav text-ink",
        className ?? "",
      ].join(" ")}
    >
      <span className={`block size-[8px] ${dark ? "bg-dot" : "bg-lime-ink"}`} aria-hidden="true" />
      {label}
    </span>
  );
}
