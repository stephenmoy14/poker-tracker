import type { SyncBackend } from "./types";
import { LocalBackend } from "./localBackend";

// Which server shared games use. With VITE_SUPABASE_URL and
// VITE_SUPABASE_ANON_KEY set (see .env.example), it's Supabase; otherwise
// rooms are shared between tabs of this browser only, which is handy for
// trying things out before Supabase is set up.

let backend: Promise<SyncBackend> | null = null;

export function getBackend(): Promise<SyncBackend> {
  backend ??= (async () => {
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
    if (url && key) {
      const { SupabaseBackend } = await import("./supabaseBackend"); // loaded only when configured
      return new SupabaseBackend(url, key);
    }
    return new LocalBackend();
  })();
  return backend;
}

export function supabaseConfigured(): boolean {
  return !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}
