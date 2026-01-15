"use client";

import { useAuth } from "@/contexts/auth-context";
import { LoginForm } from "@/components/auth/login-form";
import { Sidebar } from "@/components/layout/sidebar";
import { AudioMonitoringIndicator } from "@/components/audio-monitoring-indicator";
import { type ReactNode } from "react";

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const { user, loading, signOut } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--accent-blue)] border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return <LoginForm />;
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      <Sidebar onLogout={signOut} />
      <main className="lg:pl-64">
        <div className="p-4 pt-20 lg:p-8 lg:pt-8">{children}</div>
      </main>
      <AudioMonitoringIndicator />
    </div>
  );
}
