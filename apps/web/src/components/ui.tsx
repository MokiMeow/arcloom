import {
  AlertCircle,
  ArrowUpRight,
  Check,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";
import type { CaseState } from "../types";

export const labels: Record<CaseState, string> = {
  awaiting_approval: "Awaiting approval",
  queued: "Queued",
  running: "Running in lab",
  awaiting_review: "Awaiting review",
  confirmed: "Confirmed",
  not_reproduced: "Not reproduced",
  inconclusive: "Inconclusive",
  rejected: "Rejected",
  denied: "Denied",
};
export function StateBadge({
  state,
  stale = false,
}: {
  state: CaseState;
  stale?: boolean;
}) {
  return (
    <span className={`badge state-${state}${stale ? " stale" : ""}`}>
      {state === "confirmed" && !stale ? (
        <Check size={12} />
      ) : (
        <span className="dot" />
      )}
      {stale ? `${labels[state]} · historical` : labels[state]}
    </span>
  );
}
export function ErrorNotice({ message }: { message: string | null }) {
  return message ? (
    <div role="alert" className="notice error">
      <AlertCircle size={17} />
      <span>{message}</span>
    </div>
  ) : null;
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle size={19} className="spin" />
      Loading workspace…
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <ShieldCheck size={27} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function SectionHead({
  tag,
  title,
  children,
  action,
}: {
  tag: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="section-head">
      <div>
        <p className="eyebrow">{tag}</p>
        <h1>{title}</h1>
        {children && <p className="lead">{children}</p>}
      </div>
      {action && <div className="section-action">{action}</div>}
    </div>
  );
}
export function ShortId({ value }: { value: string }) {
  return (
    <code title={value}>
      {value.split("_")[0]}_{value.split("_")[1]?.slice(0, 7) ?? value}
    </code>
  );
}
export function OpenButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="text-button" onClick={onClick}>
      {children}
      <ArrowUpRight size={14} />
    </button>
  );
}
export function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
