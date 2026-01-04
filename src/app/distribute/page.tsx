"use client";

import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Play, Square, Volume2, Radio, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { getDevices, getAudioFiles, addDistributionLog } from "@/lib/firebase/firestore";
import { useAuth } from "@/contexts/auth-context";
import type { AlgoDevice, AudioFile } from "@/lib/algo/types";

interface DistributionResult {
  deviceId: string;
  deviceName: string;
  success: boolean;
  error?: string;
}

export default function DistributePage() {
  const { user } = useAuth();
  const [devices, setDevices] = useState<AlgoDevice[]>([]);
  const [audioFiles, setAudioFiles] = useState<AudioFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [distributing, setDistributing] = useState(false);
  const [stopping, setStopping] = useState(false);

  // Distribution settings
  const [selectedAudio, setSelectedAudio] = useState("");
  const [selectedDevices, setSelectedDevices] = useState<string[]>([]);
  const [volume, setVolume] = useState(50);
  const [loop, setLoop] = useState(false);

  // Results
  const [results, setResults] = useState<DistributionResult[]>([]);
  const [showResults, setShowResults] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [devicesData, audioData] = await Promise.all([
        getDevices(),
        getAudioFiles(),
      ]);
      setDevices(devicesData);
      setAudioFiles(audioData);
    } catch (error) {
      console.error("Failed to load data:", error);
    } finally {
      setLoading(false);
    }
  };

  const toggleDevice = (deviceId: string) => {
    setSelectedDevices((prev) =>
      prev.includes(deviceId)
        ? prev.filter((id) => id !== deviceId)
        : [...prev, deviceId]
    );
  };

  const selectAllDevices = () => {
    if (selectedDevices.length === devices.length) {
      setSelectedDevices([]);
    } else {
      setSelectedDevices(devices.map((d) => d.id));
    }
  };

  const selectByZone = (zone: string) => {
    const zoneDevices = devices.filter((d) => d.zone === zone).map((d) => d.id);
    const allSelected = zoneDevices.every((id) => selectedDevices.includes(id));
    if (allSelected) {
      setSelectedDevices((prev) => prev.filter((id) => !zoneDevices.includes(id)));
    } else {
      setSelectedDevices((prev) => [...new Set([...prev, ...zoneDevices])]);
    }
  };

  const handleDistribute = async () => {
    if (!selectedAudio || selectedDevices.length === 0) {
      alert("Please select an audio file and at least one device");
      return;
    }

    setDistributing(true);
    setResults([]);
    setShowResults(true);

    const audioFile = audioFiles.find((a) => a.id === selectedAudio);
    const distributionResults: DistributionResult[] = [];

    for (const deviceId of selectedDevices) {
      const device = devices.find((d) => d.id === deviceId);
      if (!device) continue;

      try {
        const response = await fetch("/api/algo/distribute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            device: {
              ipAddress: device.ipAddress,
              password: device.apiPassword,
              authMethod: device.authMethod,
            },
            audioUrl: audioFile?.storageUrl,
            filename: audioFile?.filename,
            loop,
            volume,
          }),
        });

        const data = await response.json();
        distributionResults.push({
          deviceId,
          deviceName: device.name,
          success: response.ok,
          error: response.ok ? undefined : data.error,
        });
      } catch (error) {
        distributionResults.push({
          deviceId,
          deviceName: device.name,
          success: false,
          error: error instanceof Error ? error.message : "Network error",
        });
      }

      // Update results in real-time
      setResults([...distributionResults]);
    }

    // Log the distribution
    if (audioFile) {
      const successCount = distributionResults.filter((r) => r.success).length;
      await addDistributionLog({
        audioFileId: selectedAudio,
        audioFileName: audioFile.name,
        targetDevices: selectedDevices,
        targetZones: [...new Set(devices.filter((d) => selectedDevices.includes(d.id)).map((d) => d.zone).filter(Boolean))],
        triggeredBy: user?.uid || "unknown",
        status: successCount === selectedDevices.length ? "success" : successCount > 0 ? "partial" : "failed",
        results: distributionResults,
      });
    }

    setDistributing(false);
  };

  const handleStop = async () => {
    setStopping(true);

    for (const deviceId of selectedDevices) {
      const device = devices.find((d) => d.id === deviceId);
      if (!device) continue;

      try {
        await fetch("/api/algo/distribute/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            device: {
              ipAddress: device.ipAddress,
              password: device.apiPassword,
              authMethod: device.authMethod,
            },
          }),
        });
      } catch (error) {
        console.error(`Failed to stop device ${device.name}:`, error);
      }
    }

    setStopping(false);
  };

  // Get unique zones
  const zones = [...new Set(devices.map((d) => d.zone).filter(Boolean))];

  if (loading) {
    return (
      <AppLayout>
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Distribute Sound</h1>
          <p className="text-gray-500">
            Play audio files across your Algo devices
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left Column - Controls */}
          <div className="space-y-6 lg:col-span-2">
            {/* Audio Selection */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Select Audio</CardTitle>
                <CardDescription>
                  Choose an audio file from your library
                </CardDescription>
              </CardHeader>
              <CardContent>
                {audioFiles.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    No audio files available.{" "}
                    <a href="/audio" className="text-blue-600 hover:underline">
                      Upload some first
                    </a>
                    .
                  </p>
                ) : (
                  <Select
                    value={selectedAudio}
                    onChange={(e) => setSelectedAudio(e.target.value)}
                  >
                    <option value="">Select an audio file...</option>
                    {audioFiles.map((audio) => (
                      <option key={audio.id} value={audio.id}>
                        {audio.name}
                      </option>
                    ))}
                  </Select>
                )}
              </CardContent>
            </Card>

            {/* Device Selection */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">Select Devices</CardTitle>
                    <CardDescription>
                      Choose which devices to play the audio on
                    </CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={selectAllDevices}>
                    {selectedDevices.length === devices.length
                      ? "Deselect All"
                      : "Select All"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Zone Quick Select */}
                {zones.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    <span className="text-sm text-gray-500">Quick select:</span>
                    {zones.map((zone) => (
                      <Button
                        key={zone}
                        variant="outline"
                        size="sm"
                        onClick={() => selectByZone(zone)}
                      >
                        {zone}
                      </Button>
                    ))}
                  </div>
                )}

                {/* Device List */}
                {devices.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    No devices available.{" "}
                    <a href="/devices" className="text-blue-600 hover:underline">
                      Add some first
                    </a>
                    .
                  </p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {devices.map((device) => (
                      <button
                        key={device.id}
                        onClick={() => toggleDevice(device.id)}
                        className={`flex items-center gap-3 rounded-md border p-3 text-left transition-colors ${
                          selectedDevices.includes(device.id)
                            ? "border-blue-500 bg-blue-50"
                            : "border-gray-200 hover:border-gray-300"
                        }`}
                      >
                        <div
                          className={`flex h-5 w-5 items-center justify-center rounded border ${
                            selectedDevices.includes(device.id)
                              ? "border-blue-500 bg-blue-500"
                              : "border-gray-300"
                          }`}
                        >
                          {selectedDevices.includes(device.id) && (
                            <CheckCircle className="h-4 w-4 text-white" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-gray-900">
                            {device.name}
                          </p>
                          <p className="truncate text-sm text-gray-500">
                            {device.ipAddress}
                            {device.zone && ` • ${device.zone}`}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right Column - Settings & Actions */}
          <div className="space-y-6">
            {/* Playback Settings */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Volume: {volume}%</Label>
                  <Slider
                    min={0}
                    max={100}
                    value={volume}
                    onChange={(e) => setVolume(parseInt(e.target.value))}
                    showValue
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="loop"
                    checked={loop}
                    onChange={(e) => setLoop(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <Label htmlFor="loop">Loop audio</Label>
                </div>
              </CardContent>
            </Card>

            {/* Actions */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  className="w-full"
                  onClick={handleDistribute}
                  disabled={!selectedAudio || selectedDevices.length === 0 || distributing}
                  isLoading={distributing}
                >
                  <Play className="mr-2 h-4 w-4" />
                  Play on {selectedDevices.length} Device
                  {selectedDevices.length !== 1 ? "s" : ""}
                </Button>
                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={handleStop}
                  disabled={selectedDevices.length === 0 || stopping}
                  isLoading={stopping}
                >
                  <Square className="mr-2 h-4 w-4" />
                  Stop All
                </Button>
              </CardContent>
            </Card>

            {/* Results */}
            {showResults && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Results</CardTitle>
                </CardHeader>
                <CardContent>
                  {results.length === 0 && distributing ? (
                    <div className="flex items-center gap-2 text-gray-500">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Distributing...</span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {results.map((result) => (
                        <div
                          key={result.deviceId}
                          className="flex items-center gap-2 text-sm"
                        >
                          {result.success ? (
                            <CheckCircle className="h-4 w-4 text-green-500" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-500" />
                          )}
                          <span
                            className={
                              result.success ? "text-gray-700" : "text-red-700"
                            }
                          >
                            {result.deviceName}
                            {result.error && `: ${result.error}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Summary */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <Radio className="h-5 w-5 text-gray-400" />
                  <div className="text-sm">
                    <p className="font-medium text-gray-900">
                      {selectedDevices.length} device
                      {selectedDevices.length !== 1 ? "s" : ""} selected
                    </p>
                    <p className="text-gray-500">
                      {selectedAudio
                        ? audioFiles.find((a) => a.id === selectedAudio)?.name
                        : "No audio selected"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
