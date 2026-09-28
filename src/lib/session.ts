import { useSyncExternalStore } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type SessionState = {
  session: Session | null;
  loading: boolean;
  isAdmin: boolean;
  roleReady: boolean;
};

const INITIAL: SessionState = {
  session: null,
  loading: true,
  isAdmin: false,
  roleReady: false,
};

/**
 * One auth subscription, one getSession() and one user_roles query for the whole
 * app, shared by every useSession() consumer.
 *
 * SiteHeader is rendered inside DashboardPage and both call useSession(). With
 * per-consumer state each call site opened its own onAuthStateChange listener and
 * re-ran the admin role query, so the dashboard paid for the same role round trip
 * twice while it was still holding its loading state. The store below is the
 * single owner; useSession() only subscribes to it.
 *
 * This is the same module-singleton + useSyncExternalStore shape already used for
 * the locale store in i18n.tsx, so it needs no new dependency and no new provider
 * in the tree.
 */
let state: SessionState = INITIAL;
let consumers = 0;
let authSub: { subscription: { unsubscribe: () => void } } | null = null;
let roleDeps: { userId: string | undefined; loading: boolean } | undefined;
// Bumped on every start and every stop. A response that was already in flight
// when the store was torn down (or superseded by a new session) must never be
// allowed to write into the shared state, or a late user_roles reply from the
// previous session would overwrite the current user's role.
let generation = 0;

const listeners = new Set<() => void>();

function emit(patch: Partial<SessionState>) {
  const merged = { ...state, ...patch };
  if (
    merged.session === state.session &&
    merged.loading === state.loading &&
    merged.isAdmin === state.isAdmin &&
    merged.roleReady === state.roleReady
  ) {
    return;
  }
  state = merged;
  listeners.forEach((fn) => fn());
}

/**
 * Role resolution, keyed on the same inputs the old per-consumer effect depended
 * on ([session?.user?.id, loading]) so a token refresh for the same user does not
 * re-query, and a signed-out client still reaches roleReady once loading clears.
 */
function syncRole() {
  const userId = state.session?.user?.id;
  if (roleDeps && roleDeps.userId === userId && roleDeps.loading === state.loading) return;
  roleDeps = { userId, loading: state.loading };

  if (!userId) {
    emit({ isAdmin: false, roleReady: !state.loading && !state.session });
    return;
  }
  const gen = generation;
  emit({ roleReady: false });
  void supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle()
    .then(({ data }) => {
      if (gen !== generation) return;
      emit({ isAdmin: Boolean(data), roleReady: true });
    });
}

function start() {
  const gen = ++generation;
  const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
    if (gen !== generation) return;
    emit({ session: next });
    syncRole();
  });
  authSub = sub;
  void supabase.auth.getSession().then(({ data }) => {
    if (gen !== generation) return;
    emit({ session: data.session, loading: false });
    syncRole();
  });
  // Mirrors the old mount-time effect run: with no user yet roleReady stays
  // false, and it only becomes true once loading has cleared.
  syncRole();
}

function stop() {
  generation += 1;
  authSub?.subscription.unsubscribe();
  authSub = null;
  roleDeps = undefined;
  state = INITIAL;
}

export function getSessionState(): SessionState {
  return state;
}

export function subscribeSessionState(fn: () => void): () => void {
  listeners.add(fn);
  consumers += 1;
  if (consumers === 1) start();
  return () => {
    listeners.delete(fn);
    consumers -= 1;
    if (consumers === 0) stop();
  };
}

export function useSession(): SessionState {
  return useSyncExternalStore(subscribeSessionState, getSessionState, getSessionState);
}
