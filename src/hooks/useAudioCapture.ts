"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface AudioCaptureState {
  isCapturing: boolean;
  isRecording: boolean;
  isPaused: boolean;
  audioLevel: number;
  duration: number;
  error: string | null;
}

interface UseAudioCaptureOptions {
  onAudioData?: (data: Float32Array) => void;
}

export function useAudioCapture(options: UseAudioCaptureOptions = {}) {
  const [state, setState] = useState<AudioCaptureState>({
    isCapturing: false,
    isRecording: false,
    isPaused: false,
    audioLevel: 0,
    duration: 0,
    error: null,
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopCapture();
    };
  }, []);

  const updateAudioLevel = useCallback(() => {
    if (!analyserNodeRef.current || !state.isCapturing) return;

    const analyser = analyserNodeRef.current;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);

    // Calculate average level
    const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
    const level = Math.round((average / 255) * 100);

    setState((prev) => ({ ...prev, audioLevel: level }));

    animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
  }, [state.isCapturing]);

  const startCapture = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, error: null }));

      // Request microphone/line-in access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });

      mediaStreamRef.current = stream;

      // Create audio context
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      // Create nodes
      const sourceNode = audioContext.createMediaStreamSource(stream);
      sourceNodeRef.current = sourceNode;

      const gainNode = audioContext.createGain();
      gainNodeRef.current = gainNode;

      const analyserNode = audioContext.createAnalyser();
      analyserNode.fftSize = 256;
      analyserNodeRef.current = analyserNode;

      // Connect nodes: source -> gain -> analyser
      sourceNode.connect(gainNode);
      gainNode.connect(analyserNode);

      setState((prev) => ({ ...prev, isCapturing: true }));

      // Start level monitoring
      animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to access audio input";
      setState((prev) => ({ ...prev, error: errorMessage }));
      console.error("Audio capture error:", error);
    }
  }, [updateAudioLevel]);

  const stopCapture = useCallback(() => {
    // Stop animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    // Stop duration interval
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    // Stop media recorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;

    // Stop all tracks
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // Clear refs
    sourceNodeRef.current = null;
    gainNodeRef.current = null;
    analyserNodeRef.current = null;
    recordedChunksRef.current = [];

    setState({
      isCapturing: false,
      isRecording: false,
      isPaused: false,
      audioLevel: 0,
      duration: 0,
      error: null,
    });
  }, []);

  const setVolume = useCallback((volume: number) => {
    if (gainNodeRef.current) {
      // Convert 0-100 to 0-2 (allowing boost up to 2x)
      gainNodeRef.current.gain.value = volume / 50;
    }
  }, []);

  const startRecording = useCallback(() => {
    if (!mediaStreamRef.current || state.isRecording) return;

    recordedChunksRef.current = [];

    const mediaRecorder = new MediaRecorder(mediaStreamRef.current, {
      mimeType: "audio/webm;codecs=opus",
    });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunksRef.current.push(event.data);
      }
    };

    mediaRecorderRef.current = mediaRecorder;
    mediaRecorder.start(100); // Collect data every 100ms

    startTimeRef.current = Date.now();
    durationIntervalRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setState((prev) => ({ ...prev, duration: elapsed }));
    }, 1000);

    setState((prev) => ({ ...prev, isRecording: true, duration: 0 }));
  }, [state.isRecording]);

  const stopRecording = useCallback(async (): Promise<Blob | null> => {
    return new Promise((resolve) => {
      if (!mediaRecorderRef.current || !state.isRecording) {
        resolve(null);
        return;
      }

      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = null;
      }

      const mediaRecorder = mediaRecorderRef.current;

      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: "audio/webm" });
        recordedChunksRef.current = [];
        setState((prev) => ({ ...prev, isRecording: false }));
        resolve(blob);
      };

      mediaRecorder.stop();
    });
  }, [state.isRecording]);

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current && state.isRecording && !state.isPaused) {
      mediaRecorderRef.current.pause();
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
      setState((prev) => ({ ...prev, isPaused: true }));
    }
  }, [state.isRecording, state.isPaused]);

  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current && state.isRecording && state.isPaused) {
      mediaRecorderRef.current.resume();
      durationIntervalRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setState((prev) => ({ ...prev, duration: elapsed }));
      }, 1000);
      setState((prev) => ({ ...prev, isPaused: false }));
    }
  }, [state.isRecording, state.isPaused]);

  const getInputDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter((device) => device.kind === "audioinput");
    } catch (error) {
      console.error("Failed to enumerate devices:", error);
      return [];
    }
  }, []);

  return {
    ...state,
    startCapture,
    stopCapture,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    setVolume,
    getInputDevices,
  };
}
