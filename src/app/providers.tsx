"use client";

import { AuthProvider } from "@/contexts/auth-context";
import { AudioMonitoringProvider } from "@/contexts/audio-monitoring-context";
import { type ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <AudioMonitoringProvider>
        {children}
      </AudioMonitoringProvider>
    </AuthProvider>
  );
}
