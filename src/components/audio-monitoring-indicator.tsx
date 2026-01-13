"use client";

import { useAudioMonitoring } from "@/contexts/audio-monitoring-context";
import { Mic, Radio } from "lucide-react";
import Link from "next/link";

export function AudioMonitoringIndicator() {
  const { isCapturing, audioDetected, speakersEnabled } = useAudioMonitoring();

  if (!isCapturing) return null;

  return (
    <Link href="/live">
      <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 shadow-lg transition-all hover:shadow-xl">
        <div className="flex items-center gap-2">
          <Radio className="h-5 w-5 text-green-600 animate-pulse" />
          <div className="text-sm">
            <div className="font-medium text-green-900">Monitoring Active</div>
            <div className="flex items-center gap-2 text-xs text-green-700">
              <span>Audio: {audioDetected ? "Detected" : "Silent"}</span>
              <span>•</span>
              <span>Speakers: {speakersEnabled ? "On" : "Off"}</span>
            </div>
          </div>
        </div>
        <div className="text-xs text-green-600">Click to view</div>
      </div>
    </Link>
  );
}
