"use client";

import { createContext, useContext, useState, useRef, useCallback, useEffect } from "react";
import { useAudioCapture } from "@/hooks/useAudioCapture";
import type { AlgoDevice } from "@/lib/algo/types";

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
  setRampEnabled: (enabled: boolean) => void;
  setRampDuration: (duration: number) => void;
  setDayNightMode: (enabled: boolean) => void;
  setDayStartHour: (hour: number) => void;
  setDayEndHour: (hour: number) => void;
  setNightRampDuration: (duration: number) => void;

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
}

const AudioMonitoringContext = createContext<AudioMonitoringContextType | null>(null);

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
};

export function AudioMonitoringProvider({ children }: { children: React.ReactNode }) {
  const [selectedInputDevice, setSelectedInputDeviceState] = useState<string>("");
  const [volume, setVolumeState] = useState(50);
  const [targetVolume, setTargetVolumeState] = useState(100);
  const [audioThreshold, setAudioThresholdState] = useState(5); // 5% default
  const [selectedDevices, setSelectedDevicesState] = useState<string[]>([]);
  const [devices, setDevices] = useState<AlgoDevice[]>([]);
  const [audioDetected, setAudioDetected] = useState(false);
  const [speakersEnabled, setSpeakersEnabled] = useState(false);

  // Ramp settings
  const [rampEnabled, setRampEnabledState] = useState(true);
  const [rampDuration, setRampDurationState] = useState(15); // 15 seconds default
  const [dayNightMode, setDayNightModeState] = useState(false);
  const [dayStartHour, setDayStartHourState] = useState(6); // 6 AM
  const [dayEndHour, setDayEndHourState] = useState(18); // 6 PM
  const [nightRampDuration, setNightRampDurationState] = useState(10); // 10 seconds for night

  const audioDetectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const controllingSpakersRef = useRef<boolean>(false);
  const volumeRampIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentVolumeRef = useRef<number>(0);
  const hasRestoredStateRef = useRef<boolean>(false);
  const isInitializedRef = useRef<boolean>(false);

  const {
    isCapturing,
    audioLevel,
    startCapture,
    stopCapture,
    setVolume: setGainVolume,
  } = useAudioCapture();

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

  // Audio activity detection
  useEffect(() => {
    if (!isCapturing) return;

    const DISABLE_DELAY = 10000; // 10 seconds of silence before disabling

    if (audioLevel > audioThreshold) {
      if (!audioDetected) {
        setAudioDetected(true);
      }

      if (audioDetectionTimeoutRef.current) {
        clearTimeout(audioDetectionTimeoutRef.current);
        audioDetectionTimeoutRef.current = null;
      }

      if (!speakersEnabled && !controllingSpakersRef.current) {
        controllingSpakersRef.current = true;
        setSpeakersEnabled(true);

        (async () => {
          await setDevicesVolume(0);
          await controlSpeakers(true);
          startVolumeRamp();
          controllingSpakersRef.current = false;
        })();
      }
    } else {
      if (audioDetected && speakersEnabled) {
        if (!audioDetectionTimeoutRef.current) {
          audioDetectionTimeoutRef.current = setTimeout(() => {
            if (!controllingSpakersRef.current) {
              controllingSpakersRef.current = true;
              setSpeakersEnabled(false);
              setAudioDetected(false);

              (async () => {
                stopVolumeRamp();
                await setDevicesVolume(0);
                await controlSpeakers(false);
                controllingSpakersRef.current = false;
              })();
            }
            audioDetectionTimeoutRef.current = null;
          }, DISABLE_DELAY);
        }
      }
    }
  }, [audioLevel, isCapturing, audioDetected, speakersEnabled, audioThreshold, controlSpeakers, setDevicesVolume, startVolumeRamp, stopVolumeRamp]);

  const startMonitoring = useCallback((inputDevice?: string) => {
    console.log('[AudioMonitoring] Starting monitoring', inputDevice);
    startCapture(inputDevice);
  }, [startCapture]);

  const stopMonitoring = useCallback(async () => {
    console.log('[AudioMonitoring] Stopping monitoring');
    stopCapture();
    stopVolumeRamp();

    if (speakersEnabled && !controllingSpakersRef.current) {
      controllingSpakersRef.current = true;
      setSpeakersEnabled(false);
      await controlSpeakers(false);
      controllingSpakersRef.current = false;
    }
  }, [stopCapture, stopVolumeRamp, speakersEnabled, controlSpeakers]);

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
        setRampEnabled,
        setRampDuration,
        setDayNightMode,
        setDayStartHour,
        setDayEndHour,
        setNightRampDuration,
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
