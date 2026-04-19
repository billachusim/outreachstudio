import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
  /** Persist credentials so the app silently signs in on every load. */
  enableAutoLogin: (email: string, password: string) => void;
  disableAutoLogin: () => void;
  autoLoginEnabled: boolean;
};

const AUTO_LOGIN_KEY = "outreach-studio.auto-login";

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const readStoredCreds = (): { email: string; password: string } | null => {
  try {
    const raw = localStorage.getItem(AUTO_LOGIN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.email && parsed?.password) return parsed;
    return null;
  } catch {
    return null;
  }
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoLoginEnabled, setAutoLoginEnabled] = useState<boolean>(!!readStoredCreds());

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
    });

    (async () => {
      const { data: { session: existing } } = await supabase.auth.getSession();
      if (existing) {
        setSession(existing);
        setUser(existing.user);
        setLoading(false);
        return;
      }
      // No session — try silent auto-login
      const creds = readStoredCreds();
      if (creds) {
        const { data, error } = await supabase.auth.signInWithPassword(creds);
        if (!error && data.session) {
          setSession(data.session);
          setUser(data.user);
        } else if (error) {
          console.warn("Auto-login failed:", error.message);
          // Bad creds — clear so user can re-enter
          localStorage.removeItem(AUTO_LOGIN_KEY);
          setAutoLoginEnabled(false);
        }
      }
      setLoading(false);
    })();

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    localStorage.removeItem(AUTO_LOGIN_KEY);
    setAutoLoginEnabled(false);
    await supabase.auth.signOut();
  };

  const enableAutoLogin = (email: string, password: string) => {
    localStorage.setItem(AUTO_LOGIN_KEY, JSON.stringify({ email, password }));
    setAutoLoginEnabled(true);
  };

  const disableAutoLogin = () => {
    localStorage.removeItem(AUTO_LOGIN_KEY);
    setAutoLoginEnabled(false);
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signOut, enableAutoLogin, disableAutoLogin, autoLoginEnabled }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
