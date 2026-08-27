import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isDeactivated: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  session: null,
  loading: true,
  isDeactivated: false,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDeactivated, setIsDeactivated] = useState(false);

  const ensureProfile = useCallback(async () => {
    try {
      await supabase.rpc("ensure_user_profile");
    } catch (e) {
      console.warn("ensure_user_profile failed:", e);
    }
  }, []);

  const checkActiveStatus = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("is_active")
      .eq("id", userId)
      .maybeSingle();
    if (data && data.is_active === false) {
      setIsDeactivated(true);
    } else {
      setIsDeactivated(false);
    }
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setLoading(false);
      if (s?.user) {
        void ensureProfile();
        void checkActiveStatus(s.user.id);
      } else {
        setIsDeactivated(false);
      }
    });

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setLoading(false);
      if (s?.user) {
        void checkActiveStatus(s.user.id);
      } else {
        setIsDeactivated(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [checkActiveStatus]);

  const sessionUserId = session?.user?.id;

  useEffect(() => {
    if (!sessionUserId) return;
    const interval = setInterval(() => {
      void checkActiveStatus(sessionUserId);
    }, 30_000);
    return () => clearInterval(interval);
  }, [sessionUserId, checkActiveStatus]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user: session?.user ?? null, session, loading, isDeactivated, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
