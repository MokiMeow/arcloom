export type View =
  "overview" | "investigations" | "memory" | "activity" | "settings";
export interface WorkspaceLocation {
  view: View;
  caseId: string | null;
}
export function readLocation(hash = window.location.hash): WorkspaceLocation {
  const match =
    /^#\/(overview|investigations|memory|activity|settings)(?:\/([^/]+))?$/.exec(
      hash,
    );
  if (match) {
    const view = match[1] as View;
    if (!match[2]) return { view, caseId: null };
    if (view === "investigations") {
      try {
        return { view, caseId: decodeURIComponent(match[2]) };
      } catch {
        // A malformed shared URL should never prevent the workspace from opening.
      }
    }
  }
  return { view: "overview", caseId: null };
}
export function locationFor(view: View, caseId?: string | null): string {
  return view === "investigations" && caseId
    ? `#/investigations/${encodeURIComponent(caseId)}`
    : `#/${view}`;
}
