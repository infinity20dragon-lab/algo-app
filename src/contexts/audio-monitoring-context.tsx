"use client";

import { createContext, useContext, useState, useRef, useCallback, useEffect } from "react";
import { useAudioCapture } from "@/hooks/useAudioCapture";
import type { AlgoDevice } from "@/lib/algo/types";
import { storage } from "@/lib/firebase/config";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { useAuth } from "@/contexts/auth-context";
// @ts-expect-error - lamejs doesn't have types
import lamejs from "lamejs";

export interface AudioLogEntry {
  timestamp: string;
  type: "audio_detected" | "audio_silent" | "speakers_enabled" | "speakers_disabled" | "volume_change";
  audioLevel?: number;
  audioThreshold?: number;
  speakersEnabled?: boolean;
  volume?: number;
  message: string;
  recordingUrl?: string; // URL to recorded audio clip
}

interface AudioMonitoringContextType {
  // Audio capture state
  isCapturing: boolean;
  audioLevel: number;
  selectedInputDevice: string;
  volume: number;
  targetVolume: number;
  audioThreshold: number;

  // Speaker state
  audioDetected: boolean;
  speakersEnabled: boolean;

  // Ramp settings
  rampEnabled: boolean;
  rampDuration: number;
  dayNightMode: boolean;
  dayStartHour: number;
  dayEndHour: number;
  nightRampDuration: number;
  sustainDuration: number;
  disableDelay: number;
  setRampEnabled: (enabled: boolean) => void;
  setRampDuration: (duration: number) => void;
  setDayNightMode: (enabled: boolean) => void;
  setDayStartHour: (hour: number) => void;
  setDayEndHour: (hour: number) => void;
  setNightRampDuration: (duration: number) => void;
  setSustainDuration: (duration: number) => void;
  setDisableDelay: (delay: number) => void;

  // Device selection
  selectedDevices: string[];
  setSelectedDevices: (devices: string[]) => void;

  // Actions
  startMonitoring: (inputDevice?: string) => void;
  stopMonitoring: () => void;
  setInputDevice: (deviceId: string) => void;
  setVolume: (volume: number) => void;
  setTargetVolume: (volume: number) => void;
  setAudioThreshold: (threshold: number) => void;

  // For controlling speakers
  devices: AlgoDevice[];
  setDevices: (devices: AlgoDevice[]) => void;

  // Logging
  logs: AudioLogEntry[];
  clearLogs: () => void;
  exportLogs: () => string;
  loggingEnabled: boolean;
  setLoggingEnabled: (enabled: boolean) => void;

  // Recording
  recordingEnabled: boolean;
  setRecordingEnabled: (enabled: boolean) => void;
}

const AudioMonitoringContext = createContext<AudioMonitoringContextType | null>(null);

// Helper function to convert audio blob to MP3
async function convertToMp3(audioBlob: Blob): Promise<Blob> {
  // Decode the audio blob to an AudioBuffer
  const arrayBuffer = await audioBlob.arrayBuffer();
  const audioContext = new AudioContext();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  // Get audio data
  const numberOfChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const samples = audioBuffer.length;

  // Convert to mono if stereo (simpler encoding)
  let leftChannel: Float32Array;
  let rightChannel: Float32Array | null = null;

  if (numberOfChannels === 1) {
    leftChannel = audioBuffer.getChannelData(0);
  } else {
    leftChannel = audioBuffer.getChannelData(0);
    rightChannel = audioBuffer.getChannelData(1);
  }

  // Convert Float32Array to Int16Array (required by lamejs)
  const convertToInt16 = (float32Array: Float32Array): Int16Array => {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16Array;
  };

  const leftInt16 = convertToInt16(leftChannel);
  const rightInt16 = rightChannel ? convertToInt16(rightChannel) : null;

  // Create MP3 encoder
  const mp3Encoder = new lamejs.Mp3Encoder(numberOfChannels, sampleRate, 128);
  const mp3Data: ArrayBuffer[] = [];

  // Encode in chunks
  const chunkSize = 1152;
  for (let i = 0; i < samples; i += chunkSize) {
    const leftChunk = leftInt16.subarray(i, i + chunkSize);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mp3buf: any;

    if (numberOfChannels === 1) {
      mp3buf = mp3Encoder.encodeBuffer(leftChunk);
    } else {
      const rightChunk = rightInt16!.subarray(i, i + chunkSize);
      mp3buf = mp3Encoder.encodeBuffer(leftChunk, rightChunk);
    }

    if (mp3buf.length > 0) {
      // Convert to regular array buffer
      mp3Data.push(new Uint8Array(mp3buf).buffer);
    }
  }

  // Flush the encoder
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mp3End: any = mp3Encoder.flush();
  if (mp3End.length > 0) {
    mp3Data.push(new Uint8Array(mp3End).buffer);
  }

  // Close the audio context
  await audioContext.close();

  // Create MP3 blob from array buffers
  return new Blob(mp3Data, { type: 'audio/mp3' });
}

// LocalStorage keys
const STORAGE_KEYS = {
  IS_MONITORING: 'algo_live_is_monitoring',
  SELECTED_DEVICES: 'algo_live_selected_devices',
  SELECTED_INPUT: 'algo_live_selected_input',
  TARGET_VOLUME: 'algo_live_target_volume',
  INPUT_GAIN: 'algo_live_input_gain',
  AUDIO_THRESHOLD: 'algo_live_audio_threshold',
  RAMP_ENABLED: 'algo_live_ramp_enabled',
  RAMP_DURATION: 'algo_live_ramp_duration',
  DAY_NIGHT_MODE: 'algo_live_day_night_mode',
  DAY_START_HOUR: 'algo_live_day_start_hour',
  DAY_END_HOUR: 'algo_live_day_end_hour',
  NIGHT_RAMP_DURATION: 'algo_live_night_ramp_duration',
  SUSTAIN_DURATION: 'algo_live_sustain_duration',
  DISABLE_DELAY: 'algo_live_disable_delay',
  LOGGING_ENABLED: 'algo_live_logging_enabled',
  RECORDING_ENABLED: 'algo_live_recording_enabled',
};

export function AudioMonitoringProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  const [selectedInputDevice, setSelectedInputDeviceState] = useState<string>("");
  const [volume, setVolumeState] = useState(50);
  const [targetVolume, setTargetVolumeState] = useState(100);
  const [audioThreshold, setAudioThresholdState] = useState(5); // 5% default
  const [selectedDevices, setSelectedDevicesState] = useState<string[]>([]);
  const [devices, setDevices] = useState<AlgoDevice[]>([]);
  const [audioDetected, setAudioDetected] = useState(false);
  const [speakersEnabled, setSpeakersEnabled] = useState(false);

  // Logging
  const [logs, setLogs] = useState<AudioLogEntry[]>([]);
  const [loggingEnabled, setLoggingEnabledState] = useState(true); // enabled by default
  const [recordingEnabled, setRecordingEnabledState] = useState(false); // disabled by default to save storage

  // Ramp settings
  const [rampEnabled, setRampEnabledState] = useState(true);
  const [rampDuration, setRampDurationState] = useState(15); // 15 seconds default
  const [dayNightMode, setDayNightModeState] = useState(false);
  const [dayStartHour, setDayStartHourState] = useState(6); // 6 AM
  const [dayEndHour, setDayEndHourState] = useState(18); // 6 PM
  const [nightRampDuration, setNightRampDurationState] = useState(10); // 10 seconds for night
  const [sustainDuration, setSustainDurationState] = useState(1000); // 1 second default (in ms)
  const [disableDelay, setDisableDelayState] = useState(3000); // 3 seconds default (in ms)

  const audioDetectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const controllingSpakersRef = useRef<boolean>(false);
  const volumeRampIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentVolumeRef = useRef<number>(0);
  const hasRestoredStateRef = useRef<boolean>(false);
  const isInitializedRef = useRef<boolean>(false);

  // Sustained audio tracking
  const sustainedAudioStartRef = useRef<number | null>(null);
  const sustainCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const speakersEnabledTimeRef = useRef<number | null>(null);

  // Recording
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingStartTimeRef = useRef<string | null>(null);

  const {
    isCapturing,
    audioLevel,
    startCapture,
    stopCapture,
    setVolume: setGainVolume,
  } = useAudioCapture();

  // Helper to add log entry
  const addLog = useCallback((entry: Omit<AudioLogEntry, "timestamp">) => {
    // Always log to console for debugging
    const logEntry: AudioLogEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
    };
    console.log(`[AudioLog] ${logEntry.message}`, logEntry);

    // Only add to UI logs if logging is enabled
    if (!loggingEnabled) return;

    setLogs(prev => {
      const newLogs = [...prev, logEntry];
      // Keep only last 500 entries to prevent memory issues
      if (newLogs.length > 500) {
        return newLogs.slice(-500);
      }
      return newLogs;
    });
  }, [loggingEnabled]);

  // Start recording audio
  const startRecording = useCallback(async () => {
    try {
      if (!recordingEnabled) {
        console.log('[Recording] Recording is disabled, skipping');
        return;
      }

      if (!user) {
        console.warn('[Recording] No user authenticated, skipping recording');
        return;
      }

      // Get the audio stream from the microphone
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: selectedInputDevice || undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        }
      });

      // Create media recorder
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm',
      });

      recordedChunksRef.current = [];
      recordingStartTimeRef.current = new Date().toISOString();

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start(100); // Collect data every 100ms
      mediaRecorderRef.current = mediaRecorder;

      console.log('[Recording] Started recording audio');
    } catch (error) {
      console.error('[Recording] Failed to start recording:', error);
    }
  }, [recordingEnabled, user, selectedInputDevice]);

  // Stop recording and upload to Firebase
  const stopRecordingAndUpload = useCallback(async (): Promise<string | null> => {
    return new Promise((resolve) => {
      try {
        const mediaRecorder = mediaRecorderRef.current;
        if (!mediaRecorder || !user || !recordingStartTimeRef.current) {
          resolve(null);
          return;
        }

        mediaRecorder.onstop = async () => {
          try {
            // Create blob from recorded chunks (WebM format)
            const webmBlob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });

            if (webmBlob.size === 0) {
              console.warn('[Recording] No audio data recorded');
              resolve(null);
              return;
            }

            // Convert WebM to MP3 for better phone compatibility
            console.log(`[Recording] Converting ${webmBlob.size} bytes from WebM to MP3...`);
            const mp3Blob = await convertToMp3(webmBlob);
            console.log(`[Recording] Converted to MP3: ${mp3Blob.size} bytes`);

            // Generate filename with timestamp
            const timestamp = recordingStartTimeRef.current!.replace(/[:.]/g, '-');
            const filename = `recording-${timestamp}.mp3`;
            const filePath = `audio-recordings/${user.uid}/${filename}`;

            // Upload to Firebase Storage
            console.log(`[Recording] Uploading MP3 to ${filePath}`);
            const fileRef = storageRef(storage, filePath);
            await uploadBytes(fileRef, mp3Blob);

            // Get download URL
            const downloadUrl = await getDownloadURL(fileRef);
            console.log('[Recording] Upload successful:', downloadUrl);

            // Clean up
            recordedChunksRef.current = [];
            recordingStartTimeRef.current = null;
            mediaRecorderRef.current = null;

            // Stop all tracks
            mediaRecorder.stream.getTracks().forEach(track => track.stop());

            resolve(downloadUrl);
          } catch (error) {
            console.error('[Recording] Upload failed:', error);
            resolve(null);
          }
        };

        mediaRecorder.stop();
      } catch (error) {
        console.error('[Recording] Stop failed:', error);
        resolve(null);
      }
    });
  }, [user]);

  // Update gain when volume changes
  useEffect(() => {
    setGainVolume(volume);
  }, [volume, setGainVolume]);

  // Initialize and restore state from localStorage on mount
  useEffect(() => {
    if (isInitializedRef.current) return;
    isInitializedRef.current = true;

    console.log('[AudioMonitoring] Initializing and restoring state...');

    try {
      const savedDevices = localStorage.getItem(STORAGE_KEYS.SELECTED_DEVICES);
      const savedInput = localStorage.getItem(STORAGE_KEYS.SELECTED_INPUT);
      const savedTargetVolume = localStorage.getItem(STORAGE_KEYS.TARGET_VOLUME);
      const savedInputGain = localStorage.getItem(STORAGE_KEYS.INPUT_GAIN);
      const savedAudioThreshold = localStorage.getItem(STORAGE_KEYS.AUDIO_THRESHOLD);
      const savedRampEnabled = localStorage.getItem(STORAGE_KEYS.RAMP_ENABLED);
      const savedRampDuration = localStorage.getItem(STORAGE_KEYS.RAMP_DURATION);
      const savedDayNightMode = localStorage.getItem(STORAGE_KEYS.DAY_NIGHT_MODE);
      const savedDayStartHour = localStorage.getItem(STORAGE_KEYS.DAY_START_HOUR);
      const savedDayEndHour = localStorage.getItem(STORAGE_KEYS.DAY_END_HOUR);
      const savedNightRampDuration = localStorage.getItem(STORAGE_KEYS.NIGHT_RAMP_DURATION);
      const savedSustainDuration = localStorage.getItem(STORAGE_KEYS.SUSTAIN_DURATION);
      const savedDisableDelay = localStorage.getItem(STORAGE_KEYS.DISABLE_DELAY);
      const savedLoggingEnabled = localStorage.getItem(STORAGE_KEYS.LOGGING_ENABLED);
      const savedRecordingEnabled = localStorage.getItem(STORAGE_KEYS.RECORDING_ENABLED);
      const wasMonitoring = localStorage.getItem(STORAGE_KEYS.IS_MONITORING) === 'true';

      console.log('[AudioMonitoring] Saved state:', {
        devices: savedDevices,
        input: savedInput,
        targetVolume: savedTargetVolume,
        inputGain: savedInputGain,
        audioThreshold: savedAudioThreshold,
        rampEnabled: savedRampEnabled,
        rampDuration: savedRampDuration,
        dayNightMode: savedDayNightMode,
        dayStartHour: savedDayStartHour,
        dayEndHour: savedDayEndHour,
        nightRampDuration: savedNightRampDuration,
        wasMonitoring,
      });

      if (savedDevices) {
        const deviceIds = JSON.parse(savedDevices);
        console.log('[AudioMonitoring] Restoring selected devices:', deviceIds);
        setSelectedDevicesState(deviceIds);
      }
      if (savedInput) {
        console.log('[AudioMonitoring] Restoring input device:', savedInput);
        setSelectedInputDeviceState(savedInput);
      }
      if (savedTargetVolume) {
        setTargetVolumeState(parseInt(savedTargetVolume));
      }
      if (savedInputGain) {
        setVolumeState(parseInt(savedInputGain));
      }
      if (savedAudioThreshold) {
        setAudioThresholdState(parseInt(savedAudioThreshold));
      }
      if (savedRampEnabled !== null) {
        setRampEnabledState(savedRampEnabled === 'true');
      }
      if (savedRampDuration) {
        setRampDurationState(parseInt(savedRampDuration));
      }
      if (savedDayNightMode !== null) {
        setDayNightModeState(savedDayNightMode === 'true');
      }
      if (savedDayStartHour) {
        setDayStartHourState(parseInt(savedDayStartHour));
      }
      if (savedDayEndHour) {
        setDayEndHourState(parseInt(savedDayEndHour));
      }
      if (savedNightRampDuration) {
        setNightRampDurationState(parseInt(savedNightRampDuration));
      }
      if (savedSustainDuration) {
        setSustainDurationState(parseInt(savedSustainDuration));
      }
      if (savedDisableDelay) {
        setDisableDelayState(parseInt(savedDisableDelay));
      }
      if (savedLoggingEnabled !== null) {
        setLoggingEnabledState(savedLoggingEnabled === 'true');
      }
      if (savedRecordingEnabled !== null) {
        setRecordingEnabledState(savedRecordingEnabled === 'true');
      }

      // Mark as restored
      setTimeout(() => {
        hasRestoredStateRef.current = true;
        console.log('[AudioMonitoring] State restoration complete');
      }, 100);

      // Auto-start monitoring if it was active before
      if (wasMonitoring) {
        console.log('[AudioMonitoring] Auto-resuming monitoring from previous session');
        setTimeout(() => {
          startCapture(savedInput || undefined);
        }, 500);
      }
    } catch (error) {
      console.error('[AudioMonitoring] Failed to restore state:', error);
      hasRestoredStateRef.current = true;
    }
  }, [startCapture]);

  // Persist state changes to localStorage
  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    console.log('[AudioMonitoring] Saving selected devices:', selectedDevices);
    localStorage.setItem(STORAGE_KEYS.SELECTED_DEVICES, JSON.stringify(selectedDevices));
  }, [selectedDevices]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    console.log('[AudioMonitoring] Saving input device:', selectedInputDevice);
    localStorage.setItem(STORAGE_KEYS.SELECTED_INPUT, selectedInputDevice);
  }, [selectedInputDevice]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    console.log('[AudioMonitoring] Saving target volume:', targetVolume);
    localStorage.setItem(STORAGE_KEYS.TARGET_VOLUME, targetVolume.toString());
  }, [targetVolume]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    console.log('[AudioMonitoring] Saving input gain:', volume);
    localStorage.setItem(STORAGE_KEYS.INPUT_GAIN, volume.toString());
  }, [volume]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    console.log('[AudioMonitoring] Saving monitoring state:', isCapturing);
    localStorage.setItem(STORAGE_KEYS.IS_MONITORING, isCapturing.toString());
  }, [isCapturing]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    console.log('[AudioMonitoring] Saving audio threshold:', audioThreshold);
    localStorage.setItem(STORAGE_KEYS.AUDIO_THRESHOLD, audioThreshold.toString());
  }, [audioThreshold]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    console.log('[AudioMonitoring] Saving ramp enabled:', rampEnabled);
    localStorage.setItem(STORAGE_KEYS.RAMP_ENABLED, rampEnabled.toString());
  }, [rampEnabled]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    console.log('[AudioMonitoring] Saving ramp duration:', rampDuration);
    localStorage.setItem(STORAGE_KEYS.RAMP_DURATION, rampDuration.toString());
  }, [rampDuration]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    console.log('[AudioMonitoring] Saving day/night mode:', dayNightMode);
    localStorage.setItem(STORAGE_KEYS.DAY_NIGHT_MODE, dayNightMode.toString());
  }, [dayNightMode]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    console.log('[AudioMonitoring] Saving day start hour:', dayStartHour);
    localStorage.setItem(STORAGE_KEYS.DAY_START_HOUR, dayStartHour.toString());
  }, [dayStartHour]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    console.log('[AudioMonitoring] Saving day end hour:', dayEndHour);
    localStorage.setItem(STORAGE_KEYS.DAY_END_HOUR, dayEndHour.toString());
  }, [dayEndHour]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    console.log('[AudioMonitoring] Saving night ramp duration:', nightRampDuration);
    localStorage.setItem(STORAGE_KEYS.NIGHT_RAMP_DURATION, nightRampDuration.toString());
  }, [nightRampDuration]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    console.log('[AudioMonitoring] Saving sustain duration:', sustainDuration);
    localStorage.setItem(STORAGE_KEYS.SUSTAIN_DURATION, sustainDuration.toString());
  }, [sustainDuration]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    console.log('[AudioMonitoring] Saving disable delay:', disableDelay);
    localStorage.setItem(STORAGE_KEYS.DISABLE_DELAY, disableDelay.toString());
  }, [disableDelay]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    console.log('[AudioMonitoring] Saving logging enabled:', loggingEnabled);
    localStorage.setItem(STORAGE_KEYS.LOGGING_ENABLED, loggingEnabled.toString());
  }, [loggingEnabled]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    console.log('[AudioMonitoring] Saving recording enabled:', recordingEnabled);
    localStorage.setItem(STORAGE_KEYS.RECORDING_ENABLED, recordingEnabled.toString());
  }, [recordingEnabled]);

  // Watch for target volume changes - restart ramp if speakers are enabled
  useEffect(() => {
    if (!hasRestoredStateRef.current) return;

    // Only restart ramp if speakers are currently enabled
    if (speakersEnabled && !controllingSpakersRef.current) {
      const currentVolume = currentVolumeRef.current;
      console.log(`[AudioMonitoring] Target volume changed, restarting ramp from ${currentVolume}% to ${targetVolume}%`);

      // Restart ramp from current volume to new target
      startVolumeRamp(currentVolume);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetVolume, speakersEnabled]);

  // Set volume on all linked speakers (8180s)
  const setDevicesVolume = useCallback(async (volumePercent: number) => {
    const linkedSpeakerIds = new Set<string>();

    for (const deviceId of selectedDevices) {
      const device = devices.find(d => d.id === deviceId);
      if (!device) continue;

      if (device.type === "8301" && device.linkedSpeakerIds) {
        device.linkedSpeakerIds.forEach(id => linkedSpeakerIds.add(id));
      }
    }

    // Convert 0-100% to 0-10 scale, then to dB
    // Algo expects: 0=-30dB, 1=-27dB, 2=-24dB, ... 10=0dB
    // Formula: dB = (level - 10) * 3
    const volumeScale = Math.round((volumePercent / 100) * 10);
    const volumeDb = (volumeScale - 10) * 3;
    const volumeDbString = volumeDb === 0 ? "0dB" : `${volumeDb}dB`;

    console.log(`[AudioMonitoring] Setting volume: ${volumePercent}% → level ${volumeScale} → ${volumeDbString}`);

    const volumePromises = Array.from(linkedSpeakerIds).map(async (speakerId) => {
      const speaker = devices.find(d => d.id === speakerId);
      if (!speaker) return;

      try {
        await fetch("/api/algo/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ipAddress: speaker.ipAddress,
            password: speaker.apiPassword,
            authMethod: speaker.authMethod,
            settings: {
              "audio.page.vol": volumeDbString,
            },
          }),
        });
      } catch (error) {
        console.error(`Failed to set volume for ${speaker.name}:`, error);
      }
    });

    await Promise.all(volumePromises);
  }, [selectedDevices, devices]);

  // Helper function to determine if it's currently daytime
  const isDaytime = useCallback(() => {
    const now = new Date();
    const currentHour = now.getHours();
    return currentHour >= dayStartHour && currentHour < dayEndHour;
  }, [dayStartHour, dayEndHour]);

  // Get the effective ramp duration based on settings
  const getEffectiveRampDuration = useCallback(() => {
    // If ramp is disabled, return 0 (instant)
    if (!rampEnabled) {
      console.log('[AudioMonitoring] Ramp disabled - instant volume');
      return 0;
    }

    // If day/night mode is enabled, check time of day
    if (dayNightMode) {
      if (isDaytime()) {
        console.log('[AudioMonitoring] Daytime detected - instant volume');
        return 0; // Instant during day
      } else {
        console.log(`[AudioMonitoring] Nighttime detected - ${nightRampDuration}s ramp`);
        return nightRampDuration * 1000; // Night ramp duration in ms
      }
    }

    // Otherwise use the manual ramp duration setting
    console.log(`[AudioMonitoring] Manual mode - ${rampDuration}s ramp`);
    return rampDuration * 1000;
  }, [rampEnabled, dayNightMode, isDaytime, rampDuration, nightRampDuration]);

  // Ramp volume from startFrom to target
  const startVolumeRamp = useCallback((startFrom: number = 0) => {
    if (volumeRampIntervalRef.current) {
      clearInterval(volumeRampIntervalRef.current);
    }

    const effectiveRampDuration = getEffectiveRampDuration();
    currentVolumeRef.current = startFrom;

    // If ramp duration is 0 (instant), set target volume immediately
    if (effectiveRampDuration === 0) {
      console.log(`[AudioMonitoring] Instant volume: ${targetVolume}%`);
      currentVolumeRef.current = targetVolume;
      setDevicesVolume(targetVolume);
      return;
    }

    const stepInterval = 500;
    const steps = effectiveRampDuration / stepInterval;
    const volumeDiff = targetVolume - startFrom;
    const volumeIncrement = volumeDiff / steps;

    console.log(`[AudioMonitoring] Starting volume ramp: ${startFrom}% → ${targetVolume}% over ${effectiveRampDuration/1000}s`);

    // Set initial volume
    setDevicesVolume(startFrom);

    volumeRampIntervalRef.current = setInterval(() => {
      currentVolumeRef.current += volumeIncrement;

      if (volumeIncrement > 0 && currentVolumeRef.current >= targetVolume) {
        // Ramping up
        currentVolumeRef.current = targetVolume;
        setDevicesVolume(targetVolume);
        if (volumeRampIntervalRef.current) {
          clearInterval(volumeRampIntervalRef.current);
          volumeRampIntervalRef.current = null;
        }
        console.log(`[AudioMonitoring] Volume ramp complete at ${targetVolume}%`);
      } else if (volumeIncrement < 0 && currentVolumeRef.current <= targetVolume) {
        // Ramping down
        currentVolumeRef.current = targetVolume;
        setDevicesVolume(targetVolume);
        if (volumeRampIntervalRef.current) {
          clearInterval(volumeRampIntervalRef.current);
          volumeRampIntervalRef.current = null;
        }
        console.log(`[AudioMonitoring] Volume ramp complete at ${targetVolume}%`);
      } else {
        setDevicesVolume(currentVolumeRef.current);
      }
    }, stepInterval);
  }, [targetVolume, setDevicesVolume, getEffectiveRampDuration]);

  const stopVolumeRamp = useCallback(() => {
    if (volumeRampIntervalRef.current) {
      clearInterval(volumeRampIntervalRef.current);
      volumeRampIntervalRef.current = null;
    }
    currentVolumeRef.current = 0;
    setDevicesVolume(0);
  }, [setDevicesVolume]);

  // Enable/disable speakers
  const controlSpeakers = useCallback(async (enable: boolean) => {
    for (const deviceId of selectedDevices) {
      const device = devices.find(d => d.id === deviceId);
      if (!device) continue;

      if (device.type === "8301" && device.linkedSpeakerIds && device.linkedSpeakerIds.length > 0) {
        const linkedSpeakers = devices.filter(d => device.linkedSpeakerIds?.includes(d.id));

        try {
          console.log(`[AudioMonitoring] ${enable ? 'Enabling' : 'Disabling'} speakers for ${device.name}`);

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
            console.error(`Failed to ${enable ? 'enable' : 'disable'} speakers`);
          }
        } catch (error) {
          console.error(`Failed to control speakers for ${device.name}:`, error);
        }
      }
    }
  }, [selectedDevices, devices]);

  // Audio activity detection with sustained audio requirement
  useEffect(() => {
    if (!isCapturing) {
      // Clean up sustained audio tracking when not capturing
      if (sustainedAudioStartRef.current) {
        sustainedAudioStartRef.current = null;
      }
      return;
    }

    // Use configurable disable delay (default 3 seconds)

    if (audioLevel > audioThreshold) {
      // Audio is above threshold

      // Start tracking sustained audio if not already tracking
      if (!sustainedAudioStartRef.current && !speakersEnabled) {
        sustainedAudioStartRef.current = Date.now();
        console.log(`[AudioMonitoring] Audio above threshold (${audioLevel.toFixed(1)}%), starting ${sustainDuration}ms sustain timer`);
      }

      // Check if audio has been sustained long enough
      if (sustainedAudioStartRef.current && !speakersEnabled && !controllingSpakersRef.current) {
        const sustainedFor = Date.now() - sustainedAudioStartRef.current;

        if (sustainedFor >= sustainDuration) {
          // Audio has been sustained - enable speakers!
          sustainedAudioStartRef.current = null;
          setAudioDetected(true);
          controllingSpakersRef.current = true;
          setSpeakersEnabled(true);
          speakersEnabledTimeRef.current = Date.now(); // Track when speakers were enabled

          addLog({
            type: "audio_detected",
            audioLevel,
            audioThreshold,
            message: `Audio sustained ${sustainDuration}ms at ${audioLevel.toFixed(1)}% - enabling speakers`,
          });

          addLog({
            type: "speakers_enabled",
            audioLevel,
            speakersEnabled: true,
            volume: targetVolume,
            message: `Speakers enabled - ramping to ${targetVolume}%`,
          });

          (async () => {
            // Start recording the audio
            await startRecording();

            await setDevicesVolume(0);
            await controlSpeakers(true);
            startVolumeRamp();
            controllingSpakersRef.current = false;
          })();
        }
      }

      // Clear disable timeout if audio is detected again
      if (audioDetectionTimeoutRef.current) {
        clearTimeout(audioDetectionTimeoutRef.current);
        audioDetectionTimeoutRef.current = null;
      }

    } else {
      // Audio is below threshold

      // Reset sustained audio timer if it was tracking
      if (sustainedAudioStartRef.current) {
        console.log(`[AudioMonitoring] Audio dropped below threshold before sustain duration`);
        sustainedAudioStartRef.current = null;
      }

      // Start disable countdown if speakers are on
      if (audioDetected && speakersEnabled) {
        if (!audioDetectionTimeoutRef.current) {
          addLog({
            type: "audio_silent",
            audioLevel,
            audioThreshold,
            message: `Audio below threshold: ${audioLevel.toFixed(1)}% - starting ${disableDelay/1000}s countdown`,
          });

          audioDetectionTimeoutRef.current = setTimeout(() => {
            if (!controllingSpakersRef.current) {
              controllingSpakersRef.current = true;
              setSpeakersEnabled(false);
              setAudioDetected(false);

              // Calculate how long speakers were active
              const duration = speakersEnabledTimeRef.current
                ? ((Date.now() - speakersEnabledTimeRef.current) / 1000).toFixed(1)
                : '?';
              speakersEnabledTimeRef.current = null;

              (async () => {
                // Stop recording and upload
                const recordingUrl = await stopRecordingAndUpload();

                // Log with recording URL if available
                addLog({
                  type: "speakers_disabled",
                  speakersEnabled: false,
                  message: `Speakers disabled after ${disableDelay/1000}s of silence (total audio: ${duration}s)${recordingUrl ? ' 🎙️ Recording saved' : ''}`,
                  recordingUrl: recordingUrl || undefined,
                });

                stopVolumeRamp();
                await setDevicesVolume(0);
                await controlSpeakers(false);
                controllingSpakersRef.current = false;
              })();
            }
            audioDetectionTimeoutRef.current = null;
          }, disableDelay);
        }
      }
    }
  }, [audioLevel, isCapturing, audioDetected, speakersEnabled, audioThreshold, sustainDuration, disableDelay, controlSpeakers, setDevicesVolume, startVolumeRamp, stopVolumeRamp, targetVolume, addLog, startRecording, stopRecordingAndUpload]);

  const startMonitoring = useCallback((inputDevice?: string) => {
    console.log('[AudioMonitoring] Starting monitoring', inputDevice);
    addLog({
      type: "audio_detected",
      audioThreshold,
      message: `Monitoring started with threshold: ${audioThreshold}%`,
    });
    startCapture(inputDevice);
  }, [startCapture, audioThreshold, addLog]);

  const stopMonitoring = useCallback(async () => {
    console.log('[AudioMonitoring] Stopping monitoring');

    // Calculate duration if speakers were on
    const duration = speakersEnabledTimeRef.current
      ? ((Date.now() - speakersEnabledTimeRef.current) / 1000).toFixed(1)
      : null;
    speakersEnabledTimeRef.current = null;

    addLog({
      type: "speakers_disabled",
      message: duration
        ? `Monitoring stopped (speakers were active for ${duration}s)`
        : 'Monitoring stopped',
    });

    stopCapture();
    stopVolumeRamp();

    if (speakersEnabled && !controllingSpakersRef.current) {
      controllingSpakersRef.current = true;
      setSpeakersEnabled(false);
      await controlSpeakers(false);
      controllingSpakersRef.current = false;
    }
  }, [stopCapture, stopVolumeRamp, speakersEnabled, controlSpeakers, addLog]);

  const setVolume = useCallback((vol: number) => {
    setVolumeState(vol);
  }, []);

  const setInputDevice = useCallback((deviceId: string) => {
    setSelectedInputDeviceState(deviceId);
  }, []);

  const setSelectedDevices = useCallback((devs: string[]) => {
    setSelectedDevicesState(devs);
  }, []);

  const setTargetVolume = useCallback((vol: number) => {
    setTargetVolumeState(vol);
  }, []);

  const setAudioThreshold = useCallback((threshold: number) => {
    setAudioThresholdState(threshold);
  }, []);

  const setRampEnabled = useCallback((enabled: boolean) => {
    setRampEnabledState(enabled);
  }, []);

  const setRampDuration = useCallback((duration: number) => {
    setRampDurationState(duration);
  }, []);

  const setDayNightMode = useCallback((enabled: boolean) => {
    setDayNightModeState(enabled);
  }, []);

  const setDayStartHour = useCallback((hour: number) => {
    setDayStartHourState(hour);
  }, []);

  const setDayEndHour = useCallback((hour: number) => {
    setDayEndHourState(hour);
  }, []);

  const setNightRampDuration = useCallback((duration: number) => {
    setNightRampDurationState(duration);
  }, []);

  const setSustainDuration = useCallback((duration: number) => {
    setSustainDurationState(duration);
  }, []);

  const setDisableDelay = useCallback((delay: number) => {
    setDisableDelayState(delay);
  }, []);

  const setLoggingEnabled = useCallback((enabled: boolean) => {
    setLoggingEnabledState(enabled);
  }, []);

  const setRecordingEnabled = useCallback((enabled: boolean) => {
    setRecordingEnabledState(enabled);
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
    console.log('[AudioLog] Logs cleared');
  }, []);

  const exportLogs = useCallback(() => {
    const header = "Timestamp,Type,Audio Level,Threshold,Speakers,Volume,Message\n";
    const rows = logs.map(log => {
      const timestamp = new Date(log.timestamp).toLocaleString();
      return `"${timestamp}","${log.type}","${log.audioLevel ?? ''}","${log.audioThreshold ?? ''}","${log.speakersEnabled ?? ''}","${log.volume ?? ''}","${log.message}"`;
    }).join("\n");

    return header + rows;
  }, [logs]);

  return (
    <AudioMonitoringContext.Provider
      value={{
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
        setRampEnabled,
        setRampDuration,
        setDayNightMode,
        setDayStartHour,
        setDayEndHour,
        setNightRampDuration,
        setSustainDuration,
        setDisableDelay,
        selectedDevices,
        setSelectedDevices,
        startMonitoring,
        stopMonitoring,
        setInputDevice,
        setVolume,
        setTargetVolume,
        setAudioThreshold,
        devices,
        setDevices,
        logs,
        clearLogs,
        exportLogs,
        loggingEnabled,
        setLoggingEnabled,
        recordingEnabled,
        setRecordingEnabled,
      }}
    >
      {children}
    </AudioMonitoringContext.Provider>
  );
}

export function useAudioMonitoring() {
  const context = useContext(AudioMonitoringContext);
  if (!context) {
    throw new Error("useAudioMonitoring must be used within AudioMonitoringProvider");
  }
  return context;
}
