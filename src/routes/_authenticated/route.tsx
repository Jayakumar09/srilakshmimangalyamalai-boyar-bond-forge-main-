import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppSyncProvider } from "@/lib/app-sync";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    // reloadDocument hands the redirect to the browser as a real document
    // navigation. Protected routes are ssr:false, so the server ships an empty
    // client-only shell; letting the router swap the route tree while React is
    // still hydrating that shell makes the server and client HTML disagree.
    if (error || !data.user) throw redirect({ to: "/auth", reloadDocument: true });
    return { user: data.user };
  },
  component: () => (
    <AppSyncProvider>
      <Outlet />
    </AppSyncProvider>
  ),
});
