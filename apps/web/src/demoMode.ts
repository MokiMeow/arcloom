// A build-time choice. The ordinary application always uses authenticated APIs.
export const PUBLIC_DEMO = import.meta.env.VITE_PUBLIC_DEMO === "true";

export function demoScenario(): "r1" | "r2" {
  return new URLSearchParams(window.location.search).get("scenario") === "r2"
    ? "r2"
    : "r1";
}
