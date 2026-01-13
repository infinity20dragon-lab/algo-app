"use client";

import { useEffect, useState, useRef } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Mic,
  MicOff,
  Radio,
  Square,
  Circle,
  Download,
  Upload,
  AlertCircle,
} from "lucide-react";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase/config";
import { useAudioCapture } from "@/hooks/useAudioCapture";
import { useAudioMonitoring } from "@/contexts/audio-monitoring-context";
import { getDevices, getAudioFiles, addAudioFile } from "@/lib/firebase/firestore";
import { useAuth } from "@/contexts/auth-context";
import type { AlgoDevice, AudioFile } from "@/lib/algo/types";
import { formatDuration } from "@/lib/utils";

export default function LiveBroadcastPage() {
  const { user } = useAuth();
  const isDev = process.env.NODE_ENV === 'development';

  // Get monitoring state from global context
  const {
    isCapturing,
    audioLevel,
    selectedInputDevice,
    volume,
    targetVolume,
    audioThreshold,
    audioDetected,
    speakersEnabled,
    selectedDevices,
    setSelectedDevices,
    startMonitoring,
    stopMonitoring,
    setInputDevice,
    setVolume,
    setTargetVolume,
    setAudioThreshold,
    devices: contextDevices,
    setDevices: setContextDevices,
  } = useAudioMonitoring();

  const [audioFiles, setAudioFiles] = useState<AudioFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [broadcasting, setBroadcasting] = useState(false);
  const [preTone, setPreTone] = useState("");
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [saving, setSaving] = useState(false);

  const preToneAudioRef = useRef<HTMLAudioElement | null>(null);

  const {
    isRecording,
    isPaused,
    duration,
    error,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    getInputDevices,
  } = useAudioCapture();

  useEffect(() => {
    loadData();
    loadInputDevices();
  }, []);

  const loadData = async () => {
    try {
      const [devicesData, audioData] = await Promise.all([
        getDevices(),
        getAudioFiles(),
      ]);

      // Update context with devices
      setContextDevices(devicesData);
      setAudioFiles(audioData);
    } catch (error) {
      console.error("Failed to load data:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadInputDevices = async () => {
    const devices = await getInputDevices();
    setInputDevices(devices);
  };

  const toggleDevice = (deviceId: string) => {
    setSelectedDevices((prev: string[]) => {
      const newDevices = prev.includes(deviceId)
        ? prev.filter((id) => id !== deviceId)
        : [...prev, deviceId];
      console.log('[Live] Device selection changed:', newDevices);
      return newDevices;
    });
  };

  const selectAllDevices = () => {
    if (selectedDevices.length === contextDevices.length) {
      setSelectedDevices([]);
    } else {
      setSelectedDevices(contextDevices.map((d) => d.id));
    }
  };

  const handleStartBroadcast = async () => {
    if (selectedDevices.length === 0) {
      alert("Please select at least one device");
      return;
    }

    setBroadcasting(true);

    // Play pre-tone on selected devices first
    if (preTone) {
      const audioFile = audioFiles.find((a) => a.id === preTone);
      if (audioFile) {
        for (const deviceId of selectedDevices) {
          const device = contextDevices.find((d) => d.id === deviceId);
          if (!device) continue;

          const linkedSpeakers = device.type === "8301" && device.linkedSpeakerIds
            ? contextDevices.filter(d => device.linkedSpeakerIds?.includes(d.id))
            : [];

          try {
            await fetch("/api/algo/distribute", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                device: {
                  ipAddress: device.ipAddress,
                  password: device.apiPassword,
                  authMethod: device.authMethod,
                  type: device.type,
                },
                speakers: linkedSpeakers.map(s => ({
                  ipAddress: s.ipAddress,
                  password: s.apiPassword,
                  authMethod: s.authMethod,
                })),
                filename: "chime.wav",
                loop: false,
                volume,
              }),
            });
          } catch (error) {
            console.error("Pre-tone error:", error);
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    startRecording();
  };

  const handleStopBroadcast = async () => {
    const blob = await stopRecording();
    setRecordedBlob(blob);
    setBroadcasting(false);

    for (const deviceId of selectedDevices) {
      const device = contextDevices.find((d) => d.id === deviceId);
      if (!device) continue;

      const linkedSpeakers = device.type === "8301" && device.linkedSpeakerIds
        ? contextDevices.filter(d => device.linkedSpeakerIds?.includes(d.id))
        : [];

      try {
        await fetch("/api/algo/distribute/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            device: {
              ipAddress: device.ipAddress,
              password: device.apiPassword,
              authMethod: device.authMethod,
              type: device.type,
            },
            speakers: linkedSpeakers.map(s => ({
              ipAddress: s.ipAddress,
              password: s.apiPassword,
              authMethod: s.authMethod,
            })),
          }),
        });
      } catch (error) {
        console.error("Stop error:", error);
      }
    }
  };

  const handleSaveRecording = async () => {
    if (!recordedBlob) return;

    const name = prompt("Enter a name for this recording:");
    if (!name) return;

    setSaving(true);
    try {
      const filename = `recording-${Date.now()}.webm`;
      const storageRef = ref(storage, `audio/${filename}`);
      await uploadBytes(storageRef, recordedBlob);
      const downloadUrl = await getDownloadURL(storageRef);

      await addAudioFile({
        name,
        filename,
        storageUrl: downloadUrl,
        duration,
        fileSize: recordedBlob.size,
        uploadedBy: user?.uid || "unknown",
      });

      setRecordedBlob(null);
      await loadData();
      alert("Recording saved!");
    } catch (error) {
      console.error("Save error:", error);
      alert("Failed to save recording");
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadRecording = () => {
    if (!recordedBlob) return;

    const url = URL.createObjectURL(recordedBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `recording-${Date.now()}.webm`;
    a.click();
    URL.revokeObjectURL(url);
  };

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
          <h1 className="text-3xl font-bold text-gray-900">Live Audio Monitoring</h1>
          <p className="text-gray-500">
            Automatically enable speakers when audio is detected, disable when silent
          </p>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-md bg-red-50 p-4 text-red-700">
            <AlertCircle className="h-5 w-5" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left Column - Audio Input */}
          <div className="space-y-6 lg:col-span-2">
            {/* Audio Capture */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Audio Input</CardTitle>
                <CardDescription>
                  Capture audio from your microphone or line-in
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Input Device Selection */}
                <div className="space-y-2">
                  <Label>Input Device</Label>
                  <Select
                    value={selectedInputDevice}
                    onChange={(e) => setInputDevice(e.target.value)}
                    disabled={isCapturing}
                  >
                    <option value="">Default Input</option>
                    {inputDevices.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || `Input ${device.deviceId.slice(0, 8)}`}
                      </option>
                    ))}
                  </Select>
                  <p className="text-xs text-gray-500">
                    Select microphone, line-in, or aux input
                  </p>
                </div>

                {/* Audio Level Meter */}
                <div className="space-y-2">
                  <Label>Audio Level</Label>
                  <div className="h-4 w-full overflow-hidden rounded-full bg-gray-200">
                    <div
                      className={`h-full transition-all duration-75 ${
                        audioLevel > 80
                          ? "bg-red-500"
                          : audioLevel > 50
                          ? "bg-yellow-500"
                          : "bg-green-500"
                      }`}
                      style={{ width: `${audioLevel}%` }}
                    />
                  </div>
                  <p className="text-sm text-gray-500">
                    {isCapturing ? `Level: ${audioLevel}%` : "Not capturing"}
                  </p>
                </div>

                {/* Input Gain Control */}
                <div className="space-y-2">
                  <Label>Input Gain: {volume}%</Label>
                  <Slider
                    min={0}
                    max={200}
                    value={volume}
                    onChange={(e) => setVolume(parseInt(e.target.value))}
                    showValue
                  />
                  <p className="text-sm text-gray-500">
                    Adjust input volume (100% = normal, 200% = 2x boost)
                  </p>
                </div>

                {/* Target Volume Control */}
                <div className="space-y-2">
                  <Label>Target Speaker Volume: {targetVolume}% (Level {Math.round((targetVolume / 100) * 10)}/10)</Label>
                  <Slider
                    min={0}
                    max={100}
                    value={targetVolume}
                    onChange={(e) => setTargetVolume(parseInt(e.target.value))}
                    showValue
                  />
                  <p className="text-sm text-gray-500">
                    Ramps from 0 to level {Math.round((targetVolume / 100) * 10)} over 15 seconds
                  </p>
                </div>

                {/* Audio Threshold Control */}
                <div className="space-y-2">
                  <Label>Audio Threshold: {audioThreshold}%</Label>
                  <Slider
                    min={0}
                    max={50}
                    value={audioThreshold}
                    onChange={(e) => setAudioThreshold(parseInt(e.target.value))}
                    showValue
                  />
                  <p className="text-sm text-gray-500">
                    Minimum audio level to trigger speaker activation (default: 5%)
                  </p>
                </div>

                {/* Capture Controls */}
                <div className="space-y-3">
                  <div className="flex gap-3">
                    {!isCapturing ? (
                      <Button
                        onClick={() => {
                          console.log('[Live] User clicked Start Monitoring');
                          startMonitoring(selectedInputDevice || undefined);
                        }}
                      >
                        <Mic className="mr-2 h-4 w-4" />
                        Start Monitoring
                      </Button>
                    ) : (
                      <Button
                        variant="destructive"
                        onClick={() => {
                          console.log('[Live] User clicked Stop Monitoring');
                          stopMonitoring();
                        }}
                      >
                        <MicOff className="mr-2 h-4 w-4" />
                        Stop Monitoring
                      </Button>
                    )}
                  </div>

                  {/* Audio Detection Status */}
                  {isCapturing && (
                    <div className="space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600">Audio Activity:</span>
                        <Badge variant={audioDetected ? "success" : "secondary"}>
                          {audioDetected ? "Detected" : "Silent"}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600">Speakers:</span>
                        <Badge variant={speakersEnabled ? "success" : "secondary"}>
                          {speakersEnabled ? "Enabled" : "Disabled"}
                        </Badge>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Device Selection */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">Target Devices</CardTitle>
                    <CardDescription>
                      Select devices to broadcast to
                    </CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={selectAllDevices}>
                    {selectedDevices.length === contextDevices.length
                      ? "Deselect All"
                      : "Select All"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {contextDevices.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    No devices available.{" "}
                    <a href="/devices" className="text-blue-600 hover:underline">
                      Add some first
                    </a>
                    .
                  </p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {contextDevices.map((device) => (
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
                          className={`flex h-5 w-5 items-center justify-center rounded-full border ${
                            selectedDevices.includes(device.id)
                              ? "border-blue-500 bg-blue-500"
                              : "border-gray-300"
                          }`}
                        >
                          {selectedDevices.includes(device.id) && (
                            <div className="h-2 w-2 rounded-full bg-white" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-gray-900">
                            {device.name}
                          </p>
                          <p className="truncate text-sm text-gray-500">
                            {device.ipAddress}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right Column - Broadcast Controls */}
          <div className="space-y-6">
            {/* Pre-Tone Selection */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Pre-Tone</CardTitle>
                <CardDescription>
                  Play a tone before broadcasting
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Select
                  value={preTone}
                  onChange={(e) => setPreTone(e.target.value)}
                >
                  <option value="">No pre-tone</option>
                  <option value="__builtin_chime">Built-in Chime</option>
                  <option value="__builtin_alert">Built-in Alert</option>
                  {audioFiles.map((audio) => (
                    <option key={audio.id} value={audio.id}>
                      {audio.name}
                    </option>
                  ))}
                </Select>
                <p className="text-sm text-gray-500">
                  Plays on devices before your voice/audio
                </p>
              </CardContent>
            </Card>

            {/* Broadcast Controls */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Broadcast</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {!isCapturing ? (
                  <div className="rounded-md bg-yellow-50 p-3 text-sm text-yellow-700">
                    Start audio capture first to enable broadcasting
                  </div>
                ) : !broadcasting ? (
                  <Button
                    className="w-full"
                    size="lg"
                    onClick={handleStartBroadcast}
                    disabled={selectedDevices.length === 0}
                  >
                    <Radio className="mr-2 h-5 w-5" />
                    Start Broadcast
                  </Button>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-center gap-2 rounded-md bg-red-50 p-4">
                      <Circle className="h-3 w-3 animate-pulse fill-red-500 text-red-500" />
                      <span className="font-medium text-red-700">
                        LIVE - {formatDuration(duration)}
                      </span>
                    </div>
                    <Button
                      variant="destructive"
                      className="w-full"
                      size="lg"
                      onClick={handleStopBroadcast}
                    >
                      <Square className="mr-2 h-5 w-5" />
                      Stop Broadcast
                    </Button>
                  </div>
                )}

                {/* Recording Status */}
                {isRecording && (
                  <div className="flex items-center justify-between rounded-md bg-gray-100 p-3">
                    <div className="flex items-center gap-2">
                      <Circle className="h-3 w-3 fill-red-500 text-red-500" />
                      <span className="text-sm font-medium">Recording</span>
                    </div>
                    <span className="text-sm text-gray-500">
                      {formatDuration(duration)}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recorded Audio */}
            {recordedBlob && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Recording</CardTitle>
                  <CardDescription>
                    {formatDuration(duration)} recorded
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <audio
                    controls
                    className="w-full"
                    src={URL.createObjectURL(recordedBlob)}
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDownloadRecording}
                    >
                      <Download className="mr-1 h-4 w-4" />
                      Download
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSaveRecording}
                      isLoading={saving}
                    >
                      <Upload className="mr-1 h-4 w-4" />
                      Save to Library
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Status */}
            <Card>
              <CardContent className="p-4">
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Capture</span>
                    <Badge variant={isCapturing ? "success" : "secondary"}>
                      {isCapturing ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Broadcast</span>
                    <Badge variant={broadcasting ? "destructive" : "secondary"}>
                      {broadcasting ? "Live" : "Off"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Devices</span>
                    <span className="font-medium">{selectedDevices.length} selected</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Debug Info */}
            {isDev && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Debug Info</CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                  <div className="space-y-1 text-xs font-mono">
                    <div className="text-gray-600">Selected Devices (State):</div>
                    <div className="text-gray-900 break-all">
                      {selectedDevices.length > 0 ? selectedDevices.join(', ') : 'None'}
                    </div>
                    <div className="text-gray-600 mt-2">Input Device:</div>
                    <div className="text-gray-900 break-all">
                      {selectedInputDevice || 'Default'}
                    </div>
                    <div className="text-gray-600 mt-2">Monitoring:</div>
                    <div className="text-gray-900">
                      {isCapturing ? 'Active' : 'Stopped'}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
