import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

/** Preserve the complete identifier; never shorten the value used for copy. */
export function FullIdentifier({
  value,
  label = "identifier",
}: {
  value: string;
  label?: string;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "manual">("idle");
  const manual = useRef<HTMLTextAreaElement>(null);
  const currentValue = useRef(value);
  currentValue.current = value;
  useEffect(() => {
    setStatus("idle");
  }, [value]);
  useEffect(() => {
    if (status === "manual") {
      manual.current?.focus();
      manual.current?.select();
    }
  }, [status]);
  async function copy() {
    const requestedValue = value;
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(requestedValue);
      if (currentValue.current === requestedValue) setStatus("copied");
    } catch {
      if (currentValue.current === requestedValue) setStatus("manual");
    }
  }
  return (
    <span className="full-identifier">
      <code className="full-identifier-value">{value}</code>
      <button
        type="button"
        className="text-button identifier-copy"
        aria-label={`Copy ${label}`}
        onClick={() => void copy()}
      >
        {status === "copied" ? (
          <Check size={13} aria-hidden="true" />
        ) : (
          <Copy size={13} aria-hidden="true" />
        )}
        {status === "copied" ? "Copied" : "Copy"}
      </button>
      <span
        className={`identifier-copy-status${status === "manual" ? "" : " sr-only"}`}
        role="status"
        aria-live="polite"
      >
        {status === "copied"
          ? `${label} copied in full.`
          : status === "manual"
            ? "Clipboard unavailable. Copy the full value from the selected field."
            : ""}
      </span>
      {status === "manual" && (
        <textarea
          ref={manual}
          className="identifier-manual-copy"
          aria-label={`${label} for manual copy`}
          readOnly
          rows={2}
          value={value}
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
    </span>
  );
}
