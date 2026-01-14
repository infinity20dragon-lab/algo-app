"use client";

import { useAudioMonitoring, type AudioLogEntry } from "@/contexts/audio-monitoring-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, Trash2, Copy } from "lucide-react";
import { useState } from "react";

export function AudioLogViewer() {
  const { logs, clearLogs, exportLogs } = useAudioMonitoring();
  const [copied, setCopied] = useState(false);

  const handleExport = () => {
    const csvData = exportLogs();
    const blob = new Blob([csvData], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audio-monitoring-log-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = () => {
    const csvData = exportLogs();
    navigator.clipboard.writeText(csvData);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getTypeColor = (type: AudioLogEntry["type"]) => {
    switch (type) {
      case "audio_detected":
        return "warning";
      case "speakers_enabled":
        return "success";
      case "speakers_disabled":
        return "secondary";
      case "audio_silent":
        return "secondary";
      case "volume_change":
        return "default";
      default:
        return "default";
    }
  };

  const getTypeLabel = (type: AudioLogEntry["type"]) => {
    switch (type) {
      case "audio_detected":
        return "Audio";
      case "speakers_enabled":
        return "On";
      case "speakers_disabled":
        return "Off";
      case "audio_silent":
        return "Silent";
      case "volume_change":
        return "Volume";
      default:
        return type;
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">Activity Log</CardTitle>
            <CardDescription>
              Real-time monitoring events ({logs.length} entries)
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              disabled={logs.length === 0}
            >
              <Copy className="mr-1 h-4 w-4" />
              {copied ? "Copied!" : "Copy"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={logs.length === 0}
            >
              <Download className="mr-1 h-4 w-4" />
              Export CSV
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={clearLogs}
              disabled={logs.length === 0}
            >
              <Trash2 className="mr-1 h-4 w-4" />
              Clear
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {logs.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-500">
            No events logged yet. Start monitoring to see activity.
          </div>
        ) : (
          <div className="max-h-[400px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 border-b">
                <tr>
                  <th className="px-2 py-2 text-left font-medium text-gray-600">Time</th>
                  <th className="px-2 py-2 text-left font-medium text-gray-600">Type</th>
                  <th className="px-2 py-2 text-left font-medium text-gray-600">Audio Level</th>
                  <th className="px-2 py-2 text-left font-medium text-gray-600">Message</th>
                  <th className="px-2 py-2 text-left font-medium text-gray-600">Recording</th>
                </tr>
              </thead>
              <tbody>
                {[...logs].reverse().map((log, index) => (
                  <tr key={index} className="border-b hover:bg-gray-50">
                    <td className="px-2 py-2 text-gray-600 whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="px-2 py-2">
                      <Badge variant={getTypeColor(log.type)} className="text-xs">
                        {getTypeLabel(log.type)}
                      </Badge>
                    </td>
                    <td className="px-2 py-2 text-gray-600">
                      {log.audioLevel !== undefined ? (
                        <span className="font-mono">{log.audioLevel.toFixed(1)}%</span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-gray-900">{log.message}</td>
                    <td className="px-2 py-2">
                      {log.recordingUrl ? (
                        <audio
                          controls
                          className="h-8"
                          preload="none"
                          src={log.recordingUrl}
                        />
                      ) : (
                        <span className="text-gray-400 text-xs">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
