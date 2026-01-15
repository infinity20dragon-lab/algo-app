"use client";

import { useEffect, useState, useRef } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { AudioLogViewer } from "@/components/audio-log-viewer";
import { VUMeter, CircularVUMeter } from "@/components/vu-meter";
import {
  Mic,
  MicOff,
  Radio,
  Square,
  Circle,
  Download,
  Upload,
  AlertCircle,
  Volume2,
  Settings2,
  Speaker,
  Clock,
  Sun,
  Moon,
  Power,
  PowerOff,
  AlertTriangle,
} from "lucide-react";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase/config";
import { useAudioCapture } from "@/hooks/useAudioCapture";
import { useAudioMonitoring } from "@/contexts/audio-monitoring-context";
import { getDevices, getAudioFiles, addAudioFile } from "@/lib/firebase/firestore";
import { useAuth } from "@/contexts/auth-context";
import type { AudioFile } from "@/lib/algo/types";
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
    rampEnabled,
    rampDuration,
    dayNightMode,
    dayStartHour,
    dayEndHour,
    nightRampDuration,
    sustainDuration,
    disableDelay,
    selectedDevices,
    setSelectedDevices,
    startMonitoring,
    stopMonitoring,
    setInputDevice,
    setVolume,
    setTargetVolume,
    setAudioThreshold,
    setRampEnabled,
    setRampDuration,
    setDayNightMode,
    setDayStartHour,
    setDayEndHour,
    setNightRampDuration,
    setSustainDuration,
    setDisableDelay,
    loggingEnabled,
    setLoggingEnabled,
    recordingEnabled,
    setRecordingEnabled,
    devices: contextDevices,
    setDevices: setContextDevices,
    emergencyKillAll,
    emergencyEnableAll,
    controlSingleSpeaker,
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
    duration,
    error,
    startRecording,
    stopRecording,
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
    const newDevices = selectedDevices.includes(deviceId)
      ? selectedDevices.filter((id) => id !== deviceId)
      : [...selectedDevices, deviceId];
    console.log('[Live] Device selection changed:', newDevices);
    setSelectedDevices(newDevices);
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

  // Determine if currently in day or night mode
  const currentHour = new Date().getHours();
  const isDaytime = currentHour >= dayStartHour && currentHour < dayEndHour;

  if (loading) {
    return (
      <AppLayout>
        <div className="flex justify-center py-12">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-[var(--accent-blue)] border-t-transparent" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)]">Audio Input</h1>
            <p className="text-[var(--text-secondary)] text-sm">
              Monitor audio and automatically control speaker activation
            </p>
          </div>
          {isCapturing && (
            <div className="flex items-center gap-3">
              <Badge variant={speakersEnabled ? "destructive" : "success"} className="px-3 py-1">
                <div className={`w-2 h-2 rounded-full mr-2 ${speakersEnabled ? "bg-white animate-blink" : "bg-white"}`} />
                {speakersEnabled ? "Broadcasting" : "Standby"}
              </Badge>
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-[var(--accent-red)]/15 border border-[var(--accent-red)]/30 p-4 text-[var(--accent-red)]">
            <AlertCircle className="h-5 w-5" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left Column - Audio Input & VU Meter */}
          <div className="space-y-6 lg:col-span-2">
            {/* Audio Level Display */}
            <Card>
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-[var(--accent-blue)]/15">
                      <Mic className="h-5 w-5 text-[var(--accent-blue)]" />
                    </div>
                    <CardTitle>Audio Monitor</CardTitle>
                  </div>
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
                      Stop
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* VU Meter */}
                <div className="p-6 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)]">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-sm font-semibold text-[var(--text-secondary)]">Audio Level</span>
                    <span className="text-sm font-mono text-[var(--accent-blue)]">
                      {isCapturing ? `${audioLevel.toFixed(1)}%` : "-- %"}
                    </span>
                  </div>
                  <VUMeter level={isCapturing ? audioLevel : 0} barCount={24} />

                  {/* Threshold indicator */}
                  <div className="mt-4 flex items-center gap-2">
                    <div className="flex-1 h-1 bg-[var(--bg-tertiary)] rounded relative">
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-[var(--accent-orange)]"
                        style={{ left: `${audioThreshold * 2}%` }}
                      />
                    </div>
                    <span className="text-xs text-[var(--text-muted)]">
                      Threshold: {audioThreshold}%
                    </span>
                  </div>
                </div>

                {/* Status Grid */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] text-center">
                    <div className={`w-3 h-3 rounded-full mx-auto mb-2 ${isCapturing ? "bg-[var(--accent-green)]" : "bg-[var(--text-muted)]"}`} />
                    <div className="text-xs text-[var(--text-muted)]">Monitoring</div>
                    <div className="text-sm font-semibold text-[var(--text-primary)]">{isCapturing ? "Active" : "Off"}</div>
                  </div>
                  <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] text-center">
                    <div className={`w-3 h-3 rounded-full mx-auto mb-2 ${audioDetected ? "bg-[var(--accent-orange)]" : "bg-[var(--text-muted)]"}`} />
                    <div className="text-xs text-[var(--text-muted)]">Audio</div>
                    <div className="text-sm font-semibold text-[var(--text-primary)]">{audioDetected ? "Detected" : "Silent"}</div>
                  </div>
                  <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] text-center">
                    <div className={`w-3 h-3 rounded-full mx-auto mb-2 ${speakersEnabled ? "bg-[var(--accent-red)] animate-blink" : "bg-[var(--text-muted)]"}`} />
                    <div className="text-xs text-[var(--text-muted)]">Speakers</div>
                    <div className="text-sm font-semibold text-[var(--text-primary)]">{speakersEnabled ? "On" : "Off"}</div>
                  </div>
                </div>

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
                </div>
              </CardContent>
            </Card>

            {/* Emergency Controls */}
            <Card className="border-[var(--accent-red)]/30">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-[var(--accent-red)]/15">
                    <AlertTriangle className="h-5 w-5 text-[var(--accent-red)]" />
                  </div>
                  <div>
                    <CardTitle>Emergency Controls</CardTitle>
                    <span className="text-xs text-[var(--text-muted)]">Manual speaker control</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Quick Actions */}
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    variant="destructive"
                    className="h-14"
                    onClick={emergencyKillAll}
                  >
                    <PowerOff className="mr-2 h-5 w-5" />
                    KILL ALL
                  </Button>
                  <Button
                    variant="outline"
                    className="h-14 border-[var(--accent-green)] text-[var(--accent-green)] hover:bg-[var(--accent-green)]/10"
                    onClick={emergencyEnableAll}
                  >
                    <Power className="mr-2 h-5 w-5" />
                    ENABLE ALL
                  </Button>
                </div>

                {/* Individual Speaker Controls */}
                {contextDevices.filter(d => d.type !== "8301").length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-[var(--text-muted)] text-xs uppercase tracking-wider">
                      Individual Speakers
                    </Label>
                    <div className="grid gap-2 max-h-[200px] overflow-y-auto">
                      {contextDevices
                        .filter(d => d.type !== "8301")
                        .map((speaker) => (
                          <div
                            key={speaker.id}
                            className="flex items-center justify-between p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)]"
                          >
                            <div className="flex items-center gap-3">
                              <Speaker className="h-4 w-4 text-[var(--text-muted)]" />
                              <div>
                                <p className="text-sm font-medium text-[var(--text-primary)]">
                                  {speaker.name}
                                </p>
                                <p className="text-xs text-[var(--text-muted)]">
                                  Max: {speaker.maxVolume ?? 100}%
                                </p>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-[var(--accent-green)] border-[var(--accent-green)]/50 hover:bg-[var(--accent-green)]/10"
                                onClick={() => controlSingleSpeaker(speaker.id, true)}
                              >
                                <Power className="h-3 w-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-[var(--accent-red)] border-[var(--accent-red)]/50 hover:bg-[var(--accent-red)]/10"
                                onClick={() => controlSingleSpeaker(speaker.id, false)}
                              >
                                <PowerOff className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Detection Settings */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-[var(--accent-orange)]/15">
                    <Settings2 className="h-5 w-5 text-[var(--accent-orange)]" />
                  </div>
                  <div>
                    <CardTitle>Detection Settings</CardTitle>
                    {isCapturing && (
                      <span className="text-xs text-[var(--accent-green)]">Live adjustable</span>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Audio Threshold */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Audio Threshold</Label>
                    <span className="text-sm font-mono text-[var(--accent-blue)]">{audioThreshold}%</span>
                  </div>
                  <Slider
                    min={0}
                    max={50}
                    value={audioThreshold}
                    onChange={(e) => setAudioThreshold(parseInt(e.target.value))}
                  />
                  <p className="text-xs text-[var(--text-muted)]">
                    Minimum audio level to trigger speaker activation
                  </p>
                </div>

                {/* Sustain Duration */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Sustain Duration</Label>
                    <span className="text-sm font-mono text-[var(--accent-blue)]">{(sustainDuration / 1000).toFixed(1)}s</span>
                  </div>
                  <Slider
                    min={0}
                    max={3000}
                    step={100}
                    value={sustainDuration}
                    onChange={(e) => setSustainDuration(parseInt(e.target.value))}
                  />
                  <p className="text-xs text-[var(--text-muted)]">
                    Audio must stay above threshold for this duration to trigger
                  </p>
                </div>

                {/* Disable Delay */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Disable Delay</Label>
                    <span className="text-sm font-mono text-[var(--accent-blue)]">{(disableDelay / 1000).toFixed(0)}s</span>
                  </div>
                  <Slider
                    min={1000}
                    max={30000}
                    step={1000}
                    value={disableDelay}
                    onChange={(e) => setDisableDelay(parseInt(e.target.value))}
                  />
                  <p className="text-xs text-[var(--text-muted)]">
                    Wait before disabling speakers after silence
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Volume Settings */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-[var(--accent-green)]/15">
                    <Volume2 className="h-5 w-5 text-[var(--accent-green)]" />
                  </div>
                  <div>
                    <CardTitle>Volume Settings</CardTitle>
                    {isCapturing && (
                      <span className="text-xs text-[var(--accent-green)]">Live adjustable</span>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Input Gain */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Input Gain</Label>
                    <span className="text-sm font-mono text-[var(--accent-blue)]">{volume}%</span>
                  </div>
                  <Slider
                    min={0}
                    max={200}
                    value={volume}
                    onChange={(e) => setVolume(parseInt(e.target.value))}
                  />
                </div>

                {/* Target Volume */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Target Speaker Volume</Label>
                    <span className="text-sm font-mono text-[var(--accent-blue)]">{targetVolume}% (Lv. {Math.round((targetVolume / 100) * 10)}/10)</span>
                  </div>
                  <Slider
                    min={0}
                    max={100}
                    value={targetVolume}
                    onChange={(e) => setTargetVolume(parseInt(e.target.value))}
                  />
                </div>

                {/* Volume Ramp */}
                <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Clock className="h-4 w-4 text-[var(--text-muted)]" />
                      <Label className="!text-[var(--text-primary)]">Volume Ramp</Label>
                    </div>
                    <Switch checked={rampEnabled} onCheckedChange={setRampEnabled} />
                  </div>

                  {rampEnabled && (
                    <>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {isDaytime ? <Sun className="h-4 w-4 text-[var(--accent-orange)]" /> : <Moon className="h-4 w-4 text-[var(--accent-purple)]" />}
                          <Label className="!text-[var(--text-primary)]">Day/Night Mode</Label>
                        </div>
                        <Switch checked={dayNightMode} onCheckedChange={setDayNightMode} />
                      </div>

                      {dayNightMode ? (
                        <div className="space-y-4">
                          <div className="flex items-center gap-2 text-sm">
                            <span className="text-[var(--text-muted)]">Day:</span>
                            <Select
                              value={dayStartHour.toString()}
                              onChange={(e) => setDayStartHour(parseInt(e.target.value))}
                              className="w-20"
                            >
                              {Array.from({ length: 24 }, (_, i) => (
                                <option key={i} value={i}>{i.toString().padStart(2, '0')}:00</option>
                              ))}
                            </Select>
                            <span className="text-[var(--text-muted)]">to</span>
                            <Select
                              value={dayEndHour.toString()}
                              onChange={(e) => setDayEndHour(parseInt(e.target.value))}
                              className="w-20"
                            >
                              {Array.from({ length: 24 }, (_, i) => (
                                <option key={i} value={i}>{i.toString().padStart(2, '0')}:00</option>
                              ))}
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label className="text-xs">Night Ramp: {nightRampDuration}s</Label>
                              <Badge variant={isDaytime ? "secondary" : "default"} className="text-xs">
                                {isDaytime ? "Day (Instant)" : "Night (Ramp)"}
                              </Badge>
                            </div>
                            <Slider
                              min={0}
                              max={30}
                              value={nightRampDuration}
                              onChange={(e) => setNightRampDuration(parseInt(e.target.value))}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <Label className="text-xs">Ramp Duration: {rampDuration}s</Label>
                          <Slider
                            min={0}
                            max={30}
                            value={rampDuration}
                            onChange={(e) => setRampDuration(parseInt(e.target.value))}
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Logging & Recording */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-[var(--accent-purple)]/15">
                    <Radio className="h-5 w-5 text-[var(--accent-purple)]" />
                  </div>
                  <CardTitle>Logging & Recording</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)]">
                  <div>
                    <Label className="!text-[var(--text-primary)]">Activity Logging</Label>
                    <p className="text-xs text-[var(--text-muted)]">
                      Log audio events to the activity viewer
                    </p>
                  </div>
                  <Switch checked={loggingEnabled} onCheckedChange={setLoggingEnabled} />
                </div>

                <div className="flex items-center justify-between p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)]">
                  <div>
                    <Label className="!text-[var(--text-primary)]">Audio Recording</Label>
                    <p className="text-xs text-[var(--text-muted)]">
                      {recordingEnabled ? "Record and upload audio clips (MP3)" : "Disabled to save storage"}
                    </p>
                  </div>
                  <Switch checked={recordingEnabled} onCheckedChange={setRecordingEnabled} />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right Column - Devices & Broadcast */}
          <div className="space-y-6">
            {/* Device Selection */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-[var(--accent-green)]/15">
                      <Speaker className="h-5 w-5 text-[var(--accent-green)]" />
                    </div>
                    <CardTitle>Target Devices</CardTitle>
                  </div>
                  <Button variant="outline" size="sm" onClick={selectAllDevices}>
                    {selectedDevices.length === contextDevices.length ? "Deselect" : "Select All"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {contextDevices.length === 0 ? (
                  <div className="text-center py-6">
                    <Speaker className="mx-auto h-8 w-8 text-[var(--text-muted)] mb-2" />
                    <p className="text-sm text-[var(--text-muted)]">
                      No devices available.{" "}
                      <a href="/devices" className="text-[var(--accent-blue)] hover:underline">
                        Add some first
                      </a>
                      .
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    {contextDevices.map((device) => (
                      <button
                        key={device.id}
                        onClick={() => toggleDevice(device.id)}
                        className={`flex items-center gap-3 w-full rounded-xl border p-3 text-left transition-all ${
                          selectedDevices.includes(device.id)
                            ? "border-[var(--accent-blue)]/50 bg-[var(--accent-blue)]/10"
                            : "border-[var(--border-color)] hover:border-[var(--border-active)] hover:bg-[var(--bg-tertiary)]"
                        }`}
                      >
                        <div
                          className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${
                            selectedDevices.includes(device.id)
                              ? "border-[var(--accent-blue)] bg-[var(--accent-blue)]"
                              : "border-[var(--border-color)]"
                          }`}
                        >
                          {selectedDevices.includes(device.id) && (
                            <div className="h-2 w-2 rounded-full bg-white" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-[var(--text-primary)]">
                            {device.name}
                          </p>
                          <p className="truncate text-xs text-[var(--text-muted)]">
                            {device.ipAddress}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Broadcast Controls */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg gradient-fire">
                    <Radio className="h-5 w-5 text-white" />
                  </div>
                  <CardTitle>Manual Broadcast</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <Select value={preTone} onChange={(e) => setPreTone(e.target.value)}>
                  <option value="">No pre-tone</option>
                  <option value="__builtin_chime">Built-in Chime</option>
                  <option value="__builtin_alert">Built-in Alert</option>
                  {audioFiles.map((audio) => (
                    <option key={audio.id} value={audio.id}>{audio.name}</option>
                  ))}
                </Select>

                {!isCapturing ? (
                  <div className="rounded-xl bg-[var(--accent-orange)]/15 border border-[var(--accent-orange)]/30 p-3 text-sm text-[var(--accent-orange)]">
                    Start monitoring to enable broadcasting
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
                    <div className="flex items-center justify-center gap-2 rounded-xl gradient-fire p-4">
                      <Circle className="h-3 w-3 animate-pulse fill-white text-white" />
                      <span className="font-bold text-white">
                        LIVE - {formatDuration(duration)}
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      className="w-full border-[var(--accent-red)] text-[var(--accent-red)] hover:bg-[var(--accent-red)]/10"
                      size="lg"
                      onClick={handleStopBroadcast}
                    >
                      <Square className="mr-2 h-5 w-5" />
                      Stop Broadcast
                    </Button>
                  </div>
                )}

                {isRecording && (
                  <div className="flex items-center justify-between rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] p-3">
                    <div className="flex items-center gap-2">
                      <Circle className="h-3 w-3 fill-[var(--accent-red)] text-[var(--accent-red)]" />
                      <span className="text-sm font-medium">Recording</span>
                    </div>
                    <span className="text-sm text-[var(--text-muted)] font-mono">
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
                  <CardTitle className="text-base">Recording</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <audio
                    controls
                    className="w-full"
                    src={URL.createObjectURL(recordedBlob)}
                  />
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={handleDownloadRecording}>
                      <Download className="mr-1 h-4 w-4" />
                      Download
                    </Button>
                    <Button size="sm" onClick={handleSaveRecording} isLoading={saving}>
                      <Upload className="mr-1 h-4 w-4" />
                      Save
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Quick Stats */}
            <Card>
              <CardContent className="p-4">
                <div className="space-y-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--text-muted)]">Status</span>
                    <Badge variant={isCapturing ? "success" : "secondary"}>
                      {isCapturing ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--text-muted)]">Broadcast</span>
                    <Badge variant={broadcasting ? "destructive" : "secondary"}>
                      {broadcasting ? "Live" : "Off"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--text-muted)]">Devices</span>
                    <span className="font-semibold text-[var(--text-primary)]">{selectedDevices.length} selected</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Debug Info (Dev only) */}
            {isDev && (
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-xs text-[var(--text-muted)]">Debug</CardTitle>
                </CardHeader>
                <CardContent className="py-0 pb-3">
                  <div className="space-y-1 text-xs font-mono text-[var(--text-muted)]">
                    <div>Devices: {selectedDevices.length > 0 ? selectedDevices.join(', ').slice(0, 30) + '...' : 'None'}</div>
                    <div>Input: {selectedInputDevice || 'Default'}</div>
                    <div>Monitoring: {isCapturing ? 'Active' : 'Stopped'}</div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Activity Log - Full Width */}
        <AudioLogViewer />
      </div>
    </AppLayout>
  );
}
