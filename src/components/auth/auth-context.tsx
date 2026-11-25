"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export type AuthModalMode = "login" | "signup" | "verify" | "forgot" | "reset";

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  /** true until the persisted session has been read once (prevents flicker) */
  initializing: boolean;
  signOut: () => Promise<void>;
  authOpen: boolean;
  authMode: AuthModalMode;
  openAuth: (mode?: AuthModalMode) => void;
  closeAuth: () => void;
  /** email remembered between the "enter form" and "enter code" steps */
  pendingEmail: string | null;
  setPendingEmail: (email: string | null) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthModalMode>("login");
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      setInitializing(false);
    });

    // covers: initial session, link confirmations, token refresh, sign-out
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setInitializing(false);
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const openAuth = useCallback((mode: AuthModalMode = "login") => {
    setAuthMode(mode);
    setAuthOpen(true);
  }, []);

  const closeAuth = useCallback(() => setAuthOpen(false), []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      session,
      initializing,
      signOut,
      authOpen,
      authMode,
      openAuth,
      closeAuth,
      pendingEmail,
      setPendingEmail,
    }),
    [session, initializing, signOut, authOpen, authMode, openAuth, closeAuth, pendingEmail],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
