"use client";

import { useEffect, useState, useRef, useCallback } from "react";
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
  Pause,
  Play,
  Volume2,
  Download,
  Upload,
  Music,
  AlertCircle,
} from "lucide-react";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase/config";
import { useAudioCapture } from "@/hooks/useAudioCapture";
import { getDevices, getAudioFiles, addAudioFile } from "@/lib/firebase/firestore";
import { useAuth } from "@/contexts/auth-context";
import type { AlgoDevice, AudioFile } from "@/lib/algo/types";
import { formatDuration } from "@/lib/utils";

export default function LiveBroadcastPage() {
  const { user } = useAuth();
  const [devices, setDevices] = useState<AlgoDevice[]>([]);
  const [audioFiles, setAudioFiles] = useState<AudioFile[]>([]);
  const [selectedDevices, setSelectedDevices] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [broadcasting, setBroadcasting] = useState(false);
  const [preTone, setPreTone] = useState("");
  const [volume, setVolume] = useState(50);
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [saving, setSaving] = useState(false);
  const [playingPreTone, setPlayingPreTone] = useState(false);
  const [selectedInputDevice, setSelectedInputDevice] = useState<string>("");
  const [audioDetected, setAudioDetected] = useState(false);
  const [speakersEnabled, setSpeakersEnabled] = useState(false);
  const [targetVolume, setTargetVolume] = useState(100); // Target volume for ramp (0-100)

  const preToneAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioDetectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const controllingSpakersRef = useRef<boolean>(false);
  const volumeRampIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentVolumeRef = useRef<number>(0);

  const {
    isCapturing,
    isRecording,
    isPaused,
    audioLevel,
    duration,
    error,
    startCapture,
    stopCapture,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    setVolume: setGainVolume,
    getInputDevices,
  } = useAudioCapture();

  const [enablingDisablingSpeakers, setEnablingDisablingSpeakers] = useState(false);

  useEffect(() => {
    loadData();
    loadInputDevices();
  }, []);

  useEffect(() => {
    setGainVolume(volume);
  }, [volume, setGainVolume]);

  // Audio activity detection - automatically enable/disable speakers
  useEffect(() => {
    if (!isCapturing) return;

    const AUDIO_THRESHOLD = 5; // 5% minimum level to consider "audio detected"
    const DISABLE_DELAY = 20000; // Disable speakers after 20 seconds of silence

    if (audioLevel > AUDIO_THRESHOLD) {
      // Audio detected
      if (!audioDetected) {
        setAudioDetected(true);
      }

      // Clear any pending disable timeout
      if (audioDetectionTimeoutRef.current) {
        clearTimeout(audioDetectionTimeoutRef.current);
        audioDetectionTimeoutRef.current = null;
      }

      // Enable speakers if not already enabled and not currently controlling
      if (!speakersEnabled && !controllingSpakersRef.current) {
        controllingSpakersRef.current = true;
        setSpeakersEnabled(true); // Set state immediately (optimistic)

        // Enable speakers
        (async () => {
          await controlSpeakers(true);
          // Start volume ramp after speakers are enabled
          startVolumeRamp();
          controllingSpakersRef.current = false;
        })();
      }
    } else {
      // No audio / silence
      if (audioDetected && speakersEnabled) {
        // Start countdown to disable speakers
        if (!audioDetectionTimeoutRef.current) {
          audioDetectionTimeoutRef.current = setTimeout(() => {
            if (!controllingSpakersRef.current) {
              controllingSpakersRef.current = true;
              setSpeakersEnabled(false); // Set state immediately (optimistic)
              setAudioDetected(false);

              // Stop and disable
              (async () => {
                stopVolumeRamp();
                await controlSpeakers(false);
                controllingSpakersRef.current = false;
              })();
            }
            audioDetectionTimeoutRef.current = null;
          }, DISABLE_DELAY);
        }
      }
    }
  }, [audioLevel, isCapturing, audioDetected, speakersEnabled]);

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

  const loadInputDevices = async () => {
    const devices = await getInputDevices();
    setInputDevices(devices);
  };

  // Set volume on all paging devices
  const setDevicesVolume = async (volumePercent: number) => {
    for (const deviceId of selectedDevices) {
      const device = devices.find(d => d.id === deviceId);
      if (!device) continue;

      if (device.type === "8301") {
        try {
          // Convert 0-100 to -42dB to 0dB
          const volumeDb = Math.round((volumePercent / 100) * 42 - 42);

          await fetch("/api/algo/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ipAddress: device.ipAddress,
              password: device.apiPassword,
              authMethod: device.authMethod,
              settings: {
                "audio.page.vol": `${volumeDb}dB`,
              },
            }),
          });
        } catch (error) {
          console.error(`Failed to set volume for ${device.name}:`, error);
        }
      }
    }
  };

  // Ramp volume from 0 to target over 10 seconds
  const startVolumeRamp = useCallback(() => {
    // Clear any existing ramp
    if (volumeRampIntervalRef.current) {
      clearInterval(volumeRampIntervalRef.current);
    }

    currentVolumeRef.current = 0;
    const rampDuration = 10000; // 10 seconds
    const stepInterval = 500; // Update every 500ms
    const steps = rampDuration / stepInterval;
    const volumeIncrement = targetVolume / steps;

    // Set initial volume to 0
    setDevicesVolume(0);

    volumeRampIntervalRef.current = setInterval(() => {
      currentVolumeRef.current += volumeIncrement;

      if (currentVolumeRef.current >= targetVolume) {
        currentVolumeRef.current = targetVolume;
        setDevicesVolume(targetVolume);
        if (volumeRampIntervalRef.current) {
          clearInterval(volumeRampIntervalRef.current);
          volumeRampIntervalRef.current = null;
        }
      } else {
        setDevicesVolume(currentVolumeRef.current);
      }
    }, stepInterval);
  }, [targetVolume, selectedDevices, devices]);

  // Stop volume ramp and reset to 0
  const stopVolumeRamp = useCallback(() => {
    if (volumeRampIntervalRef.current) {
      clearInterval(volumeRampIntervalRef.current);
      volumeRampIntervalRef.current = null;
    }
    currentVolumeRef.current = 0;
    setDevicesVolume(0);
  }, [selectedDevices, devices]);

  // Enable/disable speakers for paging devices
  const controlSpeakers = useCallback(async (enable: boolean) => {
    setEnablingDisablingSpeakers(true);

    for (const deviceId of selectedDevices) {
      const device = devices.find(d => d.id === deviceId);
      if (!device) continue;

      // Only control speakers for paging devices with linked speakers
      if (device.type === "8301" && device.linkedSpeakerIds && device.linkedSpeakerIds.length > 0) {
        const linkedSpeakers = devices.filter(d => device.linkedSpeakerIds?.includes(d.id));

        try {
          console.log(`${enable ? 'Enabling' : 'Disabling'} speakers for ${device.name}:`, linkedSpeakers.map(s => s.ipAddress));

          const response = await fetch("/api/algo/speakers/mcast", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              speakers: linkedSpeakers.map(s => ({
                ipAddress: s.ipAddress,
                password: s.apiPassword,
                authMethod: s.authMethod,
              })),
              enable,
            }),
          });

          if (!response.ok) {
            const errorData = await response.json();
            console.error(`Failed to ${enable ? 'enable' : 'disable'} speakers for ${device.name}:`, errorData);
          } else {
            console.log(`Successfully ${enable ? 'enabled' : 'disabled'} speakers for ${device.name}`);
          }
        } catch (error) {
          console.error(`Failed to control speakers for ${device.name}:`, error);
        }
      }
    }

    setEnablingDisablingSpeakers(false);
  }, [selectedDevices, devices]);

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

  const playPreToneAudio = async (): Promise<void> => {
    if (!preTone) return Promise.resolve();

    const audioFile = audioFiles.find((a) => a.id === preTone);
    if (!audioFile) return Promise.resolve();

    return new Promise((resolve) => {
      setPlayingPreTone(true);
      const audio = new Audio(audioFile.storageUrl);
      preToneAudioRef.current = audio;

      audio.onended = () => {
        setPlayingPreTone(false);
        resolve();
      };

      audio.onerror = () => {
        setPlayingPreTone(false);
        resolve();
      };

      audio.play();
    });
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
          const device = devices.find((d) => d.id === deviceId);
          if (!device) continue;

          // Get linked speakers if this is a paging device
          const linkedSpeakers = device.type === "8301" && device.linkedSpeakerIds
            ? devices.filter(d => device.linkedSpeakerIds?.includes(d.id))
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
                filename: "chime.wav", // Use built-in tone for pre-tone
                loop: false,
                volume,
              }),
            });
          } catch (error) {
            console.error("Pre-tone error:", error);
          }
        }
        // Wait for pre-tone to finish (approximate)
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    // Start recording
    startRecording();
  };

  const handleStopBroadcast = async () => {
    const blob = await stopRecording();
    setRecordedBlob(blob);
    setBroadcasting(false);

    // Stop any playing audio on devices
    for (const deviceId of selectedDevices) {
      const device = devices.find((d) => d.id === deviceId);
      if (!device) continue;

      // Get linked speakers if this is a paging device
      const linkedSpeakers = device.type === "8301" && device.linkedSpeakerIds
        ? devices.filter(d => device.linkedSpeakerIds?.includes(d.id))
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
      // Convert webm to wav would require additional processing
      // For now, save as webm
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
                    onChange={(e) => setSelectedInputDevice(e.target.value)}
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
                  <Label>Target Speaker Volume: {targetVolume}%</Label>
                  <Slider
                    min={0}
                    max={100}
                    value={targetVolume}
                    onChange={(e) => setTargetVolume(parseInt(e.target.value))}
                    showValue
                  />
                  <p className="text-sm text-gray-500">
                    Maximum volume after 10-second ramp (lower for testing)
                  </p>
                </div>

                {/* Capture Controls */}
                <div className="space-y-3">
                  <div className="flex gap-3">
                    {!isCapturing ? (
                      <Button
                        onClick={() => startCapture(selectedInputDevice || undefined)}
                      >
                        <Mic className="mr-2 h-4 w-4" />
                        Start Monitoring
                      </Button>
                    ) : (
                      <Button
                        variant="destructive"
                        onClick={() => {
                          stopCapture();
                          // Stop volume ramp
                          stopVolumeRamp();
                          // Ensure speakers are disabled when stopping
                          if (speakersEnabled && !controllingSpakersRef.current) {
                            controllingSpakersRef.current = true;
                            setSpeakersEnabled(false);
                            controlSpeakers(false).finally(() => {
                              controllingSpakersRef.current = false;
                            });
                          }
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
                    {selectedDevices.length === devices.length
                      ? "Deselect All"
                      : "Select All"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
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
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
