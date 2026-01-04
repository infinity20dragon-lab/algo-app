"use client";

import { useEffect, useState, useRef } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Upload, Play, Pause, Trash2, RefreshCw, Music, X, Speaker, Radio } from "lucide-react";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { storage } from "@/lib/firebase/config";
import { getAudioFiles, addAudioFile, deleteAudioFile, getDevices } from "@/lib/firebase/firestore";
import { useAuth } from "@/contexts/auth-context";
import type { AudioFile, AlgoDevice } from "@/lib/algo/types";
import { formatBytes, formatDuration, formatDate } from "@/lib/utils";
import { Select } from "@/components/ui/select";

export default function AudioPage() {
  const { user } = useAuth();
  const [audioFiles, setAudioFiles] = useState<AudioFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadName, setUploadName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Device tones state
  const [devices, setDevices] = useState<AlgoDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>("");
  const [deviceTones, setDeviceTones] = useState<string[]>([]);
  const [loadingTones, setLoadingTones] = useState(false);
  const [playingTone, setPlayingTone] = useState<string | null>(null);

  useEffect(() => {
    loadAudioFiles();
    loadDevices();
  }, []);

  const loadAudioFiles = async () => {
    try {
      const files = await getAudioFiles();
      setAudioFiles(files);
    } catch (error) {
      console.error("Failed to load audio files:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadDevices = async () => {
    try {
      const deviceList = await getDevices();
      setDevices(deviceList);
      // Auto-select first 8301 device if available
      const pagingDevice = deviceList.find(d => d.type === "8301");
      if (pagingDevice) {
        setSelectedDevice(pagingDevice.id);
      }
    } catch (error) {
      console.error("Failed to load devices:", error);
    }
  };

  const fetchDeviceTones = async () => {
    const device = devices.find(d => d.id === selectedDevice);
    if (!device) return;

    setLoadingTones(true);
    try {
      const response = await fetch("/api/algo/tones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ipAddress: device.ipAddress,
          password: device.apiPassword,
          authMethod: device.authMethod,
        }),
      });

      const data = await response.json();
      if (data.success) {
        setDeviceTones(data.tones);
      } else {
        alert("Failed to fetch tones: " + data.error);
      }
    } catch (error) {
      console.error("Failed to fetch device tones:", error);
      alert("Failed to connect to device");
    } finally {
      setLoadingTones(false);
    }
  };

  const playDeviceTone = async (toneName: string) => {
    const device = devices.find(d => d.id === selectedDevice);
    if (!device) return;

    setPlayingTone(toneName);
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
          filename: toneName,
          loop: false,
          volume: 100,
        }),
      });

      const data = await response.json();
      if (!data.success) {
        alert("Failed to play tone: " + data.error);
      }
    } catch (error) {
      console.error("Failed to play tone:", error);
    } finally {
      setTimeout(() => setPlayingTone(null), 2000);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      if (!file.name.toLowerCase().endsWith(".wav")) {
        alert("Please select a WAV file. Algo devices require WAV format.");
        return;
      }
      setSelectedFile(file);
      setUploadName(file.name.replace(".wav", ""));
    }
  };

  const handleUpload = async () => {
    if (!selectedFile || !uploadName.trim()) return;

    setUploading(true);
    try {
      // Upload to Firebase Storage
      const filename = `${Date.now()}-${selectedFile.name}`;
      const storageRef = ref(storage, `audio/${filename}`);
      await uploadBytes(storageRef, selectedFile);
      const downloadUrl = await getDownloadURL(storageRef);

      // Get audio duration
      const duration = await getAudioDuration(selectedFile);

      // Save metadata to Firestore
      await addAudioFile({
        name: uploadName.trim(),
        filename,
        storageUrl: downloadUrl,
        duration,
        fileSize: selectedFile.size,
        uploadedBy: user?.uid || "unknown",
      });

      await loadAudioFiles();
      setShowUpload(false);
      setSelectedFile(null);
      setUploadName("");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (error) {
      console.error("Upload failed:", error);
      alert("Failed to upload file. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const getAudioDuration = (file: File): Promise<number> => {
    return new Promise((resolve) => {
      const audio = new Audio();
      audio.onloadedmetadata = () => {
        resolve(audio.duration);
      };
      audio.onerror = () => {
        resolve(0);
      };
      audio.src = URL.createObjectURL(file);
    });
  };

  const handleDelete = async (audioFile: AudioFile) => {
    if (!confirm(`Delete "${audioFile.name}"? This cannot be undone.`)) return;

    try {
      // Delete from Firebase Storage
      const storageRef = ref(storage, `audio/${audioFile.filename}`);
      await deleteObject(storageRef);

      // Delete from Firestore
      await deleteAudioFile(audioFile.id);

      await loadAudioFiles();
    } catch (error) {
      console.error("Delete failed:", error);
      alert("Failed to delete file. Please try again.");
    }
  };

  const handlePlay = (audioFile: AudioFile) => {
    if (playingId === audioFile.id) {
      // Stop playing
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setPlayingId(null);
    } else {
      // Start playing
      if (audioRef.current) {
        audioRef.current.pause();
      }
      audioRef.current = new Audio(audioFile.storageUrl);
      audioRef.current.onended = () => setPlayingId(null);
      audioRef.current.play();
      setPlayingId(audioFile.id);
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Audio Library</h1>
            <p className="text-gray-500">Manage audio files for distribution</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={loadAudioFiles}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button onClick={() => setShowUpload(true)}>
              <Upload className="mr-2 h-4 w-4" />
              Upload Audio
            </Button>
          </div>
        </div>

        {/* Upload Modal */}
        {showUpload && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <Card className="w-full max-w-md">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Upload Audio</CardTitle>
                  <button
                    onClick={() => {
                      setShowUpload(false);
                      setSelectedFile(null);
                      setUploadName("");
                    }}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <CardDescription>
                  Upload a WAV file to your audio library
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="file">Audio File (WAV only)</Label>
                  <Input
                    ref={fileInputRef}
                    id="file"
                    type="file"
                    accept=".wav"
                    onChange={handleFileSelect}
                  />
                  {selectedFile && (
                    <p className="text-sm text-gray-500">
                      {selectedFile.name} ({formatBytes(selectedFile.size)})
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="name">Display Name</Label>
                  <Input
                    id="name"
                    placeholder="Emergency Alert"
                    value={uploadName}
                    onChange={(e) => setUploadName(e.target.value)}
                  />
                </div>

                <div className="flex justify-end gap-2 pt-4">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowUpload(false);
                      setSelectedFile(null);
                      setUploadName("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleUpload}
                    disabled={!selectedFile || !uploadName.trim()}
                    isLoading={uploading}
                  >
                    Upload
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Device Tones Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Radio className="h-5 w-5" />
                  Device Tones
                </CardTitle>
                <CardDescription>
                  Built-in tones on your Algo paging device
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Select
                  value={selectedDevice}
                  onChange={(e) => setSelectedDevice(e.target.value)}
                  className="w-48"
                >
                  <option value="">Select Device</option>
                  {devices.filter(d => d.type === "8301").map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.name}
                    </option>
                  ))}
                </Select>
                <Button
                  variant="outline"
                  onClick={fetchDeviceTones}
                  disabled={!selectedDevice || loadingTones}
                  isLoading={loadingTones}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Load Tones
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {deviceTones.length === 0 ? (
              <p className="text-center text-gray-500 py-4">
                Select a device and click &quot;Load Tones&quot; to see available tones
              </p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                {deviceTones.map((tone) => (
                  <Button
                    key={tone}
                    variant={playingTone === tone ? "default" : "outline"}
                    className="justify-start"
                    onClick={() => playDeviceTone(tone)}
                    disabled={playingTone !== null}
                  >
                    <Speaker className="mr-2 h-4 w-4" />
                    {tone.replace(".wav", "")}
                  </Button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Uploaded Audio Files */}
        <div>
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Uploaded Audio</h2>
        </div>

        {/* Audio Files List */}
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          </div>
        ) : audioFiles.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <div className="mb-4 rounded-full bg-gray-100 p-4">
                <Music className="h-8 w-8 text-gray-400" />
              </div>
              <h3 className="mb-2 text-lg font-medium text-gray-900">
                No audio files yet
              </h3>
              <p className="mb-4 text-center text-gray-500">
                Upload WAV files to distribute to your Algo devices
              </p>
              <Button onClick={() => setShowUpload(true)}>
                <Upload className="mr-2 h-4 w-4" />
                Upload Audio
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {audioFiles.map((audioFile) => (
              <Card key={audioFile.id}>
                <CardContent className="flex items-center gap-4 p-4">
                  <button
                    onClick={() => handlePlay(audioFile)}
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 transition-colors hover:bg-blue-200"
                  >
                    {playingId === audioFile.id ? (
                      <Pause className="h-5 w-5" />
                    ) : (
                      <Play className="h-5 w-5 pl-0.5" />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium text-gray-900">{audioFile.name}</h3>
                    <div className="flex flex-wrap gap-2 text-sm text-gray-500">
                      <span>{formatDuration(audioFile.duration)}</span>
                      <span>•</span>
                      <span>{formatBytes(audioFile.fileSize)}</span>
                      <span>•</span>
                      <span>{formatDate(audioFile.createdAt)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">WAV</Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDelete(audioFile)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
