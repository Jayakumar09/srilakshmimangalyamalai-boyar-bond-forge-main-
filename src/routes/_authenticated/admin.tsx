import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Compatibility route. The admin workspace now lives at /en/admin and /tn/admin;
 * the stored language decides which one an old /admin link opens.
 */
export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: () => {
    const stored =
      typeof window !== "undefined" ? window.localStorage.getItem("slmm-lang") : "en";
    throw redirect({ to: stored === "ta" ? "/tn/admin" : "/en/admin", replace: true });
  },
  component: () => null,
});
