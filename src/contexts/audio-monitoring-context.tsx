"use client";

import { createContext, useContext, useState, useRef, useCallback, useEffect } from "react";
import { useAudioCapture } from "@/hooks/useAudioCapture";
import type { AlgoDevice } from "@/lib/algo/types";
import { storage } from "@/lib/firebase/config";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { useAuth } from "@/contexts/auth-context";

// Debug mode - set to false for production to reduce console noise
const DEBUG_MODE = process.env.NODE_ENV === 'development';

// Debug logging helper - only logs in development
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const debugLog = (...args: any[]) => {
  if (DEBUG_MODE) {
    console.log(...args);
  }
};

// Web Worker for MP3 encoding
let mp3Worker: Worker | null = null;

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

  // Volume mode
  useGlobalVolume: boolean;
  setUseGlobalVolume: (useGlobal: boolean) => void;

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

  // Emergency Controls
  emergencyKillAll: () => Promise<void>;
  emergencyEnableAll: () => Promise<void>;
  controlSingleSpeaker: (speakerId: string, enable: boolean) => Promise<void>;
}

const AudioMonitoringContext = createContext<AudioMonitoringContextType | null>(null);

// Helper function to convert audio blob to MP3 using Web Worker
async function convertToMp3(audioBlob: Blob): Promise<Blob> {
  console.log('[MP3 Convert] Starting conversion, blob size:', audioBlob.size, 'type:', audioBlob.type);

  // Decode the audio blob to an AudioBuffer
  const arrayBuffer = await audioBlob.arrayBuffer();
  console.log('[MP3 Convert] ArrayBuffer size:', arrayBuffer.byteLength);

  const audioContext = new AudioContext();
  console.log('[MP3 Convert] AudioContext created, decoding...');

  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  console.log('[MP3 Convert] Decoded - channels:', audioBuffer.numberOfChannels, 'sampleRate:', audioBuffer.sampleRate, 'duration:', audioBuffer.duration);

  // Get audio data as Float32Arrays
  const numberOfChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;

  const audioData: Float32Array[] = [];
  for (let i = 0; i < numberOfChannels; i++) {
    audioData.push(audioBuffer.getChannelData(i));
  }

  // Close the audio context
  await audioContext.close();

  // Initialize Web Worker if not already done
  if (!mp3Worker) {
    console.log('[MP3 Convert] Creating Web Worker...');
    mp3Worker = new Worker('/mp3-encoder-worker.js');
  }

  // Encode using Web Worker
  return new Promise((resolve, reject) => {
    if (!mp3Worker) {
      reject(new Error('Web Worker not available'));
      return;
    }

    const timeoutId = setTimeout(() => {
      reject(new Error('MP3 encoding timeout'));
    }, 30000); // 30 second timeout

    mp3Worker.onmessage = (e) => {
      clearTimeout(timeoutId);

      if (e.data.error) {
        console.error('[MP3 Convert] Worker error:', e.data.error);
        reject(new Error(e.data.error));
        return;
      }

      if (e.data.progress !== undefined) {
        // Progress update - ignore for now
        return;
      }

      if (e.data.success && e.data.mp3Data) {
        console.log('[MP3 Convert] Worker success, output size:', e.data.mp3Data.byteLength);
        const mp3Blob = new Blob([e.data.mp3Data], { type: 'audio/mp3' });
        resolve(mp3Blob);
      }
    };

    mp3Worker.onerror = (error) => {
      clearTimeout(timeoutId);
      console.error('[MP3 Convert] Worker error:', error);
      reject(new Error('MP3 Worker error: ' + error.message));
    };

    // Send audio data to worker
    console.log('[MP3 Convert] Sending to worker...');
    mp3Worker.postMessage({
      cmd: 'encode',
      audioData: audioData,
      sampleRate: sampleRate,
      bitRate: 128
    });
  });
}

// LocalStorage keys
const STORAGE_KEYS = {
  IS_MONITORING: 'algo_live_is_monitoring',
  SELECTED_DEVICES: 'algo_live_selected_devices',
  SELECTED_INPUT: 'algo_live_selected_input',
  TARGET_VOLUME: 'algo_live_target_volume',
  INPUT_GAIN: 'algo_live_input_gain',
  AUDIO_THRESHOLD: 'algo_live_audio_threshold',
  USE_GLOBAL_VOLUME: 'algo_use_global_volume',
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

  // Volume mode
  const [useGlobalVolume, setUseGlobalVolumeState] = useState(false);

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
    debugLog(`[AudioLog] ${logEntry.message}`, logEntry);

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
        debugLog('[Recording] Recording is disabled, skipping');
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

      debugLog('[Recording] Started recording audio');
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

            // Try to convert WebM to MP3 for better phone compatibility
            let finalBlob: Blob;
            let fileExtension: string;

            try {
              console.log(`[Recording] Converting ${webmBlob.size} bytes from WebM to MP3...`);
              finalBlob = await convertToMp3(webmBlob);
              fileExtension = 'mp3';
              console.log(`[Recording] Converted to MP3: ${finalBlob.size} bytes`);
            } catch (conversionError) {
              // Fallback to WebM if MP3 conversion fails
              console.error('[Recording] MP3 conversion failed, falling back to WebM:', conversionError);
              finalBlob = webmBlob;
              fileExtension = 'webm';
            }

            // Generate filename with timestamp
            const timestamp = recordingStartTimeRef.current!.replace(/[:.]/g, '-');
            const filename = `recording-${timestamp}.${fileExtension}`;
            const filePath = `audio-recordings/${user.uid}/${filename}`;

            // Upload to Firebase Storage
            debugLog(`[Recording] Uploading ${fileExtension.toUpperCase()} to ${filePath}`);
            const fileRef = storageRef(storage, filePath);
            await uploadBytes(fileRef, finalBlob);

            // Get download URL
            const downloadUrl = await getDownloadURL(fileRef);
            debugLog('[Recording] Upload successful:', downloadUrl);

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

    debugLog('[AudioMonitoring] Initializing and restoring state...');

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
      const savedUseGlobalVolume = localStorage.getItem(STORAGE_KEYS.USE_GLOBAL_VOLUME);
      const wasMonitoring = localStorage.getItem(STORAGE_KEYS.IS_MONITORING) === 'true';

      debugLog('[AudioMonitoring] Saved state:', {
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
        debugLog('[AudioMonitoring] Restoring selected devices:', deviceIds);
        setSelectedDevicesState(deviceIds);
      }
      if (savedInput) {
        debugLog('[AudioMonitoring] Restoring input device:', savedInput);
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
      if (savedUseGlobalVolume !== null) {
        setUseGlobalVolumeState(savedUseGlobalVolume === 'true');
      }

      // Mark as restored
      setTimeout(() => {
        hasRestoredStateRef.current = true;
        debugLog('[AudioMonitoring] State restoration complete');
      }, 100);

      // Auto-start monitoring if it was active before
      if (wasMonitoring) {
        debugLog('[AudioMonitoring] Auto-resuming monitoring from previous session');
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
    debugLog('[AudioMonitoring] Saving selected devices:', selectedDevices);
    localStorage.setItem(STORAGE_KEYS.SELECTED_DEVICES, JSON.stringify(selectedDevices));
  }, [selectedDevices]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving input device:', selectedInputDevice);
    localStorage.setItem(STORAGE_KEYS.SELECTED_INPUT, selectedInputDevice);
  }, [selectedInputDevice]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving target volume:', targetVolume);
    localStorage.setItem(STORAGE_KEYS.TARGET_VOLUME, targetVolume.toString());
  }, [targetVolume]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving input gain:', volume);
    localStorage.setItem(STORAGE_KEYS.INPUT_GAIN, volume.toString());
  }, [volume]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving monitoring state:', isCapturing);
    localStorage.setItem(STORAGE_KEYS.IS_MONITORING, isCapturing.toString());
  }, [isCapturing]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving audio threshold:', audioThreshold);
    localStorage.setItem(STORAGE_KEYS.AUDIO_THRESHOLD, audioThreshold.toString());
  }, [audioThreshold]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving ramp enabled:', rampEnabled);
    localStorage.setItem(STORAGE_KEYS.RAMP_ENABLED, rampEnabled.toString());
  }, [rampEnabled]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving ramp duration:', rampDuration);
    localStorage.setItem(STORAGE_KEYS.RAMP_DURATION, rampDuration.toString());
  }, [rampDuration]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving day/night mode:', dayNightMode);
    localStorage.setItem(STORAGE_KEYS.DAY_NIGHT_MODE, dayNightMode.toString());
  }, [dayNightMode]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving day start hour:', dayStartHour);
    localStorage.setItem(STORAGE_KEYS.DAY_START_HOUR, dayStartHour.toString());
  }, [dayStartHour]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving day end hour:', dayEndHour);
    localStorage.setItem(STORAGE_KEYS.DAY_END_HOUR, dayEndHour.toString());
  }, [dayEndHour]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving night ramp duration:', nightRampDuration);
    localStorage.setItem(STORAGE_KEYS.NIGHT_RAMP_DURATION, nightRampDuration.toString());
  }, [nightRampDuration]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving sustain duration:', sustainDuration);
    localStorage.setItem(STORAGE_KEYS.SUSTAIN_DURATION, sustainDuration.toString());
  }, [sustainDuration]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving disable delay:', disableDelay);
    localStorage.setItem(STORAGE_KEYS.DISABLE_DELAY, disableDelay.toString());
  }, [disableDelay]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving logging enabled:', loggingEnabled);
    localStorage.setItem(STORAGE_KEYS.LOGGING_ENABLED, loggingEnabled.toString());
  }, [loggingEnabled]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving recording enabled:', recordingEnabled);
    localStorage.setItem(STORAGE_KEYS.RECORDING_ENABLED, recordingEnabled.toString());
  }, [recordingEnabled]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving global volume mode:', useGlobalVolume);
    localStorage.setItem(STORAGE_KEYS.USE_GLOBAL_VOLUME, useGlobalVolume.toString());
  }, [useGlobalVolume]);

  // Watch for target volume changes - restart ramp if speakers are enabled
  useEffect(() => {
    if (!hasRestoredStateRef.current) return;

    // Only restart ramp if speakers are currently enabled
    if (speakersEnabled && !controllingSpakersRef.current) {
      const currentVolume = currentVolumeRef.current;
      debugLog(`[AudioMonitoring] Target volume changed, restarting ramp from ${currentVolume}% to ${targetVolume}%`);

      // Restart ramp from current volume to new target
      startVolumeRamp(currentVolume);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetVolume, speakersEnabled]);

  // Set volume on all linked speakers (8180s)
  // volumePercent is the "ramp percentage" (0-100)
  // If useGlobalVolume=true: all speakers use volumePercent directly
  // If useGlobalVolume=false: volumePercent is scaled by each speaker's maxVolume
  const setDevicesVolume = useCallback(async (volumePercent: number) => {
    const linkedSpeakerIds = new Set<string>();

    for (const deviceId of selectedDevices) {
      const device = devices.find(d => d.id === deviceId);
      if (!device) continue;

      if (device.type === "8301" && device.linkedSpeakerIds) {
        device.linkedSpeakerIds.forEach(id => linkedSpeakerIds.add(id));
      }
    }

    const volumePromises = Array.from(linkedSpeakerIds).map(async (speakerId) => {
      const speaker = devices.find(d => d.id === speakerId);
      if (!speaker) return;

      // Skip speakers without proper credentials
      if (!speaker.ipAddress || !speaker.apiPassword) {
        console.warn(`[AudioMonitoring] Skipping ${speaker.name || speakerId}: missing IP or password`);
        return;
      }

      // Calculate actual volume based on mode
      let actualVolume: number;
      if (useGlobalVolume) {
        // Global mode: all speakers use same volume, ignore individual max
        actualVolume = volumePercent;
        debugLog(`[AudioMonitoring] GLOBAL MODE - Setting ${speaker.name} to ${actualVolume.toFixed(0)}%`);
      } else {
        // Individual mode: scale by speaker's maxVolume
        // If volumePercent is 80% and speaker.maxVolume is 70%, actual = 80% of 70% = 56%
        const speakerMaxVolume = speaker.maxVolume ?? 100;
        actualVolume = (volumePercent / 100) * speakerMaxVolume;
        debugLog(`[AudioMonitoring] INDIVIDUAL MODE - Setting ${speaker.name} volume: ${volumePercent}% of max ${speakerMaxVolume}% = ${actualVolume.toFixed(0)}%`);
      }

      // Convert 0-100% to 0-10 scale, then to dB
      // Algo expects: 0=-30dB, 1=-27dB, 2=-24dB, ... 10=0dB
      // Formula: dB = (level - 10) * 3
      const volumeScale = Math.round((actualVolume / 100) * 10);
      const volumeDb = (volumeScale - 10) * 3;
      const volumeDbString = volumeDb === 0 ? "0dB" : `${volumeDb}dB`;

      debugLog(`[AudioMonitoring] ${speaker.name} final: ${actualVolume.toFixed(0)}% → ${volumeDbString}`);

      try {
        const response = await fetch("/api/algo/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ipAddress: speaker.ipAddress,
            password: speaker.apiPassword,
            authMethod: speaker.authMethod || "standard",
            settings: {
              "audio.page.vol": volumeDbString,
            },
          }),
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error');
          console.error(`[AudioMonitoring] Failed to set volume for ${speaker.name}: HTTP ${response.status} - ${errorText}`);
        }
      } catch (error) {
        // Network error - speaker might be offline
        console.error(`[AudioMonitoring] Network error setting volume for ${speaker.name}:`, error);
      }
    });

    // Use allSettled to continue even if some speakers fail
    await Promise.allSettled(volumePromises);
  }, [selectedDevices, devices, useGlobalVolume]);

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
      debugLog('[AudioMonitoring] Ramp disabled - instant volume');
      return 0;
    }

    // If day/night mode is enabled, check time of day
    if (dayNightMode) {
      if (isDaytime()) {
        debugLog('[AudioMonitoring] Daytime detected - instant volume');
        return 0; // Instant during day
      } else {
        debugLog(`[AudioMonitoring] Nighttime detected - ${nightRampDuration}s ramp`);
        return nightRampDuration * 1000; // Night ramp duration in ms
      }
    }

    // Otherwise use the manual ramp duration setting
    debugLog(`[AudioMonitoring] Manual mode - ${rampDuration}s ramp`);
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
      debugLog(`[AudioMonitoring] Instant volume: ${targetVolume}%`);
      currentVolumeRef.current = targetVolume;
      setDevicesVolume(targetVolume);
      return;
    }

    const stepInterval = 500;
    const steps = effectiveRampDuration / stepInterval;
    const volumeDiff = targetVolume - startFrom;
    const volumeIncrement = volumeDiff / steps;

    debugLog(`[AudioMonitoring] Starting volume ramp: ${startFrom}% → ${targetVolume}% over ${effectiveRampDuration/1000}s`);

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
        debugLog(`[AudioMonitoring] Volume ramp complete at ${targetVolume}%`);
      } else if (volumeIncrement < 0 && currentVolumeRef.current <= targetVolume) {
        // Ramping down
        currentVolumeRef.current = targetVolume;
        setDevicesVolume(targetVolume);
        if (volumeRampIntervalRef.current) {
          clearInterval(volumeRampIntervalRef.current);
          volumeRampIntervalRef.current = null;
        }
        debugLog(`[AudioMonitoring] Volume ramp complete at ${targetVolume}%`);
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
    const allSpeakerPromises: Promise<void>[] = [];

    for (const deviceId of selectedDevices) {
      const device = devices.find(d => d.id === deviceId);
      if (!device) continue;

      if (device.type === "8301" && device.linkedSpeakerIds && device.linkedSpeakerIds.length > 0) {
        const linkedSpeakers = devices.filter(d => device.linkedSpeakerIds?.includes(d.id));

        debugLog(`[AudioMonitoring] ${enable ? 'Enabling' : 'Disabling'} ${linkedSpeakers.length} speakers for ${device.name}`);

        // Control each speaker individually for better error resilience
        linkedSpeakers.forEach(speaker => {
          const promise = (async () => {
            try {
              const response = await fetch("/api/algo/speakers/mcast", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  speakers: [{
                    ipAddress: speaker.ipAddress,
                    password: speaker.apiPassword,
                    authMethod: speaker.authMethod,
                  }],
                  enable,
                }),
              });

              if (!response.ok) {
                console.error(`Failed to ${enable ? 'enable' : 'disable'} speaker ${speaker.name}: HTTP ${response.status}`);
              } else {
                debugLog(`[AudioMonitoring] Successfully ${enable ? 'enabled' : 'disabled'} ${speaker.name}`);
              }
            } catch (error) {
              console.error(`Failed to control speaker ${speaker.name}:`, error);
              // Continue with other speakers - don't throw
            }
          })();
          allSpeakerPromises.push(promise);
        });
      }
    }

    // Wait for all speakers to complete (parallel execution)
    // Individual failures won't crash the system
    await Promise.allSettled(allSpeakerPromises);
  }, [selectedDevices, devices]);

  // Emergency Controls
  const emergencyKillAll = useCallback(async () => {
    debugLog('[AudioMonitoring] EMERGENCY: Killing all speakers');
    addLog({
      type: "speakers_disabled",
      message: "EMERGENCY KILL: Disabling all speakers immediately",
    });

    // Get all linked speakers
    const linkedSpeakerIds = new Set<string>();
    for (const deviceId of selectedDevices) {
      const device = devices.find(d => d.id === deviceId);
      if (!device) continue;
      if (device.type === "8301" && device.linkedSpeakerIds) {
        device.linkedSpeakerIds.forEach(id => linkedSpeakerIds.add(id));
      }
    }

    // Set all speakers to volume 0 and disable multicast
    const speakers = Array.from(linkedSpeakerIds).map(id => devices.find(d => d.id === id)).filter(Boolean);

    // First mute all
    await Promise.all(speakers.map(async (speaker) => {
      if (!speaker) return;
      try {
        await fetch("/api/algo/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ipAddress: speaker.ipAddress,
            password: speaker.apiPassword,
            authMethod: speaker.authMethod,
            settings: { "audio.page.vol": "-30dB" },
          }),
        });
      } catch (error) {
        console.error(`Failed to mute ${speaker.name}:`, error);
      }
    }));

    // Then disable multicast
    await controlSpeakers(false);

    // Reset state
    setSpeakersEnabled(false);
    setAudioDetected(false);
    currentVolumeRef.current = 0;
    if (volumeRampIntervalRef.current) {
      clearInterval(volumeRampIntervalRef.current);
      volumeRampIntervalRef.current = null;
    }
  }, [selectedDevices, devices, controlSpeakers, addLog]);

  const emergencyEnableAll = useCallback(async () => {
    debugLog('[AudioMonitoring] EMERGENCY: Enabling all speakers');
    addLog({
      type: "speakers_enabled",
      message: "EMERGENCY ENABLE: Enabling all speakers at target volume",
    });

    // Enable multicast on all speakers
    await controlSpeakers(true);
    setSpeakersEnabled(true);

    // Set to target volume
    await setDevicesVolume(targetVolume);
    currentVolumeRef.current = targetVolume;
  }, [controlSpeakers, setDevicesVolume, targetVolume, addLog]);

  const controlSingleSpeaker = useCallback(async (speakerId: string, enable: boolean) => {
    const speaker = devices.find(d => d.id === speakerId);
    if (!speaker) {
      console.error(`Speaker ${speakerId} not found`);
      return;
    }

    debugLog(`[AudioMonitoring] ${enable ? 'Enabling' : 'Disabling'} single speaker: ${speaker.name}`);
    addLog({
      type: enable ? "speakers_enabled" : "speakers_disabled",
      message: `${enable ? 'Enabled' : 'Disabled'} speaker: ${speaker.name}`,
    });

    try {
      // Control multicast
      await fetch("/api/algo/speakers/mcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          speakers: [{
            ipAddress: speaker.ipAddress,
            password: speaker.apiPassword,
            authMethod: speaker.authMethod,
          }],
          enable,
        }),
      });

      // If disabling, also mute
      if (!enable) {
        await fetch("/api/algo/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ipAddress: speaker.ipAddress,
            password: speaker.apiPassword,
            authMethod: speaker.authMethod,
            settings: { "audio.page.vol": "-30dB" },
          }),
        });
      }
    } catch (error) {
      console.error(`Failed to control speaker ${speaker.name}:`, error);
    }
  }, [devices, addLog]);

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
      // Note: speakersEnabled is always true during monitoring, use audioDetected instead
      if (!sustainedAudioStartRef.current && !audioDetected) {
        sustainedAudioStartRef.current = Date.now();
        debugLog(`[AudioMonitoring] Audio above threshold (${audioLevel.toFixed(1)}%), starting ${sustainDuration}ms sustain timer`);
      }

      // Check if audio has been sustained long enough
      // Note: speakersEnabled is always true during monitoring (always-on mode)
      // We use audioDetected to track if we're actively playing audio
      if (sustainedAudioStartRef.current && !audioDetected && !controllingSpakersRef.current) {
        const sustainedFor = Date.now() - sustainedAudioStartRef.current;

        if (sustainedFor >= sustainDuration) {
          // Audio has been sustained - ramp volume up!
          // CRITICAL: Speakers are already listening (multicast enabled at start)
          // We only need to ramp up volume - this is INSTANT compared to enabling multicast
          sustainedAudioStartRef.current = null;
          setAudioDetected(true);
          controllingSpakersRef.current = true;
          speakersEnabledTimeRef.current = Date.now(); // Track when audio started playing

          addLog({
            type: "audio_detected",
            audioLevel,
            audioThreshold,
            message: `Audio sustained ${sustainDuration}ms at ${audioLevel.toFixed(1)}% - ramping volume (speakers already listening)`,
          });

          addLog({
            type: "volume_change",
            audioLevel,
            speakersEnabled: true,
            volume: targetVolume,
            message: `Volume ramping to ${targetVolume}% (instant - no multicast enable delay)`,
          });

          (async () => {
            // Start recording the audio
            await startRecording();

            // NO controlSpeakers(true) needed - speakers already listening!
            // Just ramp the volume - this is much faster
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
        debugLog(`[AudioMonitoring] Audio dropped below threshold before sustain duration`);
        sustainedAudioStartRef.current = null;
      }

      // Start mute countdown if audio was playing
      // Note: We DON'T disable multicast - speakers stay listening (always-on mode)
      // We only mute the volume so speakers are ready for the next audio burst
      if (audioDetected) {
        if (!audioDetectionTimeoutRef.current) {
          addLog({
            type: "audio_silent",
            audioLevel,
            audioThreshold,
            message: `Audio below threshold: ${audioLevel.toFixed(1)}% - starting ${disableDelay/1000}s mute countdown`,
          });

          audioDetectionTimeoutRef.current = setTimeout(() => {
            if (!controllingSpakersRef.current) {
              controllingSpakersRef.current = true;
              // DON'T disable speakers - keep them listening!
              // setSpeakersEnabled(false); // REMOVED - speakers stay on
              setAudioDetected(false); // Just mark audio as not active

              // Calculate how long audio was playing
              const duration = speakersEnabledTimeRef.current
                ? ((Date.now() - speakersEnabledTimeRef.current) / 1000).toFixed(1)
                : '?';
              speakersEnabledTimeRef.current = null;

              (async () => {
                // Stop recording and upload
                const recordingUrl = await stopRecordingAndUpload();

                // Log with recording URL if available
                addLog({
                  type: "volume_change",
                  speakersEnabled: true, // Speakers STAY enabled
                  volume: 0,
                  message: `Volume muted after ${disableDelay/1000}s of silence (audio duration: ${duration}s) - speakers still listening${recordingUrl ? ' 🎙️ Recording saved' : ''}`,
                  recordingUrl: recordingUrl || undefined,
                });

                stopVolumeRamp();
                await setDevicesVolume(0);
                // NO controlSpeakers(false) - keep listening for next audio!
                controllingSpakersRef.current = false;
              })();
            }
            audioDetectionTimeoutRef.current = null;
          }, disableDelay);
        }
      }
    }
  }, [audioLevel, isCapturing, audioDetected, speakersEnabled, audioThreshold, sustainDuration, disableDelay, controlSpeakers, setDevicesVolume, startVolumeRamp, stopVolumeRamp, targetVolume, addLog, startRecording, stopRecordingAndUpload]);

  const startMonitoring = useCallback(async (inputDevice?: string) => {
    debugLog('[AudioMonitoring] Starting monitoring', inputDevice);
    addLog({
      type: "audio_detected",
      audioThreshold,
      message: `Monitoring started with threshold: ${audioThreshold}%`,
    });

    // Start audio capture IMMEDIATELY - don't wait for speaker setup
    // This ensures the UI responds instantly and audio is being captured
    startCapture(inputDevice);

    // Enable multicast on speakers in parallel (don't block audio capture)
    // This keeps speakers always listening, so short audio bursts aren't missed
    debugLog('[AudioMonitoring] Enabling multicast on all speakers (always-on mode)');

    // Run speaker setup in background - offline speakers shouldn't block monitoring
    (async () => {
      try {
        await setDevicesVolume(0); // Muted initially
        await controlSpeakers(true); // Enable multicast
        setSpeakersEnabled(true); // Mark speakers as enabled

        addLog({
          type: "speakers_enabled",
          speakersEnabled: true,
          volume: 0,
          message: `Speakers enabled in always-on mode (muted) - ready for instant response`,
        });
      } catch (error) {
        console.error('[AudioMonitoring] Error during speaker setup:', error);
        // Continue anyway - audio capture is already running
        setSpeakersEnabled(true);
      }
    })();
  }, [startCapture, audioThreshold, addLog, setDevicesVolume, controlSpeakers]);

  const stopMonitoring = useCallback(async () => {
    debugLog('[AudioMonitoring] Stopping monitoring');

    // Calculate duration if audio was playing
    const duration = speakersEnabledTimeRef.current
      ? ((Date.now() - speakersEnabledTimeRef.current) / 1000).toFixed(1)
      : null;
    speakersEnabledTimeRef.current = null;

    addLog({
      type: "speakers_disabled",
      message: duration
        ? `Monitoring stopped (audio was playing for ${duration}s)`
        : 'Monitoring stopped - disabling speakers',
    });

    stopCapture();
    stopVolumeRamp();

    // Clear any pending audio detection timeout
    if (audioDetectionTimeoutRef.current) {
      clearTimeout(audioDetectionTimeoutRef.current);
      audioDetectionTimeoutRef.current = null;
    }

    // Always disable multicast when monitoring stops (cleanup always-on mode)
    if (!controllingSpakersRef.current) {
      controllingSpakersRef.current = true;
      setSpeakersEnabled(false);
      setAudioDetected(false);
      await setDevicesVolume(0);
      await controlSpeakers(false);
      controllingSpakersRef.current = false;
      debugLog('[AudioMonitoring] Multicast disabled - speakers no longer listening');
    }
  }, [stopCapture, stopVolumeRamp, controlSpeakers, setDevicesVolume, addLog]);

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
    debugLog('[AudioLog] Logs cleared');
  }, []);

  const exportLogs = useCallback(() => {
    const header = "Timestamp,Type,Audio Level,Threshold,Speakers,Volume,Message\n";
    const rows = logs.map(log => {
      const timestamp = new Date(log.timestamp).toLocaleString();
      return `"${timestamp}","${log.type}","${log.audioLevel ?? ''}","${log.audioThreshold ?? ''}","${log.speakersEnabled ?? ''}","${log.volume ?? ''}","${log.message}"`;
    }).join("\n");

    return header + rows;
  }, [logs]);

  const setUseGlobalVolume = useCallback((useGlobal: boolean) => {
    setUseGlobalVolumeState(useGlobal);
    debugLog(`[AudioMonitoring] Volume mode changed to: ${useGlobal ? 'GLOBAL' : 'INDIVIDUAL'}`);
  }, []);

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
        useGlobalVolume,
        setUseGlobalVolume,
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
        emergencyKillAll,
        emergencyEnableAll,
        controlSingleSpeaker,
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
