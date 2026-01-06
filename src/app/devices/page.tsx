"use client";

import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Plus, Pencil, Trash2, Play, RefreshCw, X, Volume2, Link2 } from "lucide-react";
import { getDevices, addDevice, updateDevice, deleteDevice } from "@/lib/firebase/firestore";
import type { AlgoDevice, AlgoDeviceType, AlgoAuthMethod } from "@/lib/algo/types";
import { formatDate, isValidIpAddress } from "@/lib/utils";

export default function DevicesPage() {
  const [devices, setDevices] = useState<AlgoDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingDevice, setEditingDevice] = useState<AlgoDevice | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    type: "8180g2" as AlgoDeviceType,
    ipAddress: "",
    authMethod: "standard" as AlgoAuthMethod,
    apiPassword: "algo",
    zone: "",
    volume: 50,
    linkedSpeakerIds: [] as string[],
  });
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [testingDevice, setTestingDevice] = useState<string | null>(null);

  useEffect(() => {
    loadDevices();
  }, []);

  const loadDevices = async () => {
    try {
      const data = await getDevices();
      setDevices(data);
    } catch (error) {
      console.error("Failed to load devices:", error);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      type: "8180g2",
      ipAddress: "",
      authMethod: "standard",
      apiPassword: "algo",
      zone: "",
      volume: 50,
      linkedSpeakerIds: [],
    });
    setFormError("");
    setEditingDevice(null);
  };

  const openAddForm = () => {
    resetForm();
    setShowForm(true);
  };

  const openEditForm = (device: AlgoDevice) => {
    setFormData({
      name: device.name,
      type: device.type,
      ipAddress: device.ipAddress,
      authMethod: device.authMethod,
      apiPassword: device.apiPassword,
      zone: device.zone,
      volume: device.volume,
      linkedSpeakerIds: device.linkedSpeakerIds || [],
    });
    setEditingDevice(device);
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (!formData.name.trim()) {
      setFormError("Device name is required");
      return;
    }
    if (!isValidIpAddress(formData.ipAddress)) {
      setFormError("Invalid IP address format");
      return;
    }

    setSaving(true);
    try {
      if (editingDevice) {
        await updateDevice(editingDevice.id, formData);
      } else {
        await addDevice({
          ...formData,
          isOnline: false,
          lastSeen: null,
        });
      }
      await loadDevices();
      setShowForm(false);
      resetForm();
    } catch (error) {
      setFormError("Failed to save device. Please try again.");
      console.error(error);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this device?")) return;
    try {
      await deleteDevice(id);
      await loadDevices();
    } catch (error) {
      console.error("Failed to delete device:", error);
    }
  };

  const handleTestTone = async (device: AlgoDevice) => {
    setTestingDevice(device.id);
    try {
      const response = await fetch("/api/algo/devices/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ipAddress: device.ipAddress,
          password: device.apiPassword,
          authMethod: device.authMethod,
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        alert(`Test failed: ${data.error || "Unknown error"}`);
      }
    } catch (error) {
      alert("Failed to connect to device");
      console.error(error);
    } finally {
      setTestingDevice(null);
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Devices</h1>
            <p className="text-gray-500">Manage your Algo IP endpoints</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={loadDevices}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button onClick={openAddForm}>
              <Plus className="mr-2 h-4 w-4" />
              Add Device
            </Button>
          </div>
        </div>

        {/* Add/Edit Form Modal */}
        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <Card className="w-full max-w-lg">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>
                    {editingDevice ? "Edit Device" : "Add Device"}
                  </CardTitle>
                  <button
                    onClick={() => setShowForm(false)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <CardDescription>
                  {editingDevice
                    ? "Update the device configuration"
                    : "Add a new Algo IP endpoint to your system"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  {formError && (
                    <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
                      {formError}
                    </div>
                  )}

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="name">Device Name</Label>
                      <Input
                        id="name"
                        placeholder="Dorm Speaker 1"
                        value={formData.name}
                        onChange={(e) =>
                          setFormData({ ...formData, name: e.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="type">Device Type</Label>
                      <Select
                        id="type"
                        value={formData.type}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            type: e.target.value as AlgoDeviceType,
                          })
                        }
                      >
                        <option value="8301">8301 Paging Adapter</option>
                        <option value="8180g2">8180G2 Speaker</option>
                        <option value="8198">8198 Ceiling Speaker</option>
                        <option value="8128">8128 Visual Alerter</option>
                        <option value="8138">8138 Visual Alerter</option>
                        <option value="other">Other</option>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="ipAddress">IP Address</Label>
                    <Input
                      id="ipAddress"
                      placeholder="192.168.1.100"
                      value={formData.ipAddress}
                      onChange={(e) =>
                        setFormData({ ...formData, ipAddress: e.target.value })
                      }
                    />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="authMethod">Auth Method</Label>
                      <Select
                        id="authMethod"
                        value={formData.authMethod}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            authMethod: e.target.value as AlgoAuthMethod,
                          })
                        }
                      >
                        <option value="standard">Standard (HMAC)</option>
                        <option value="basic">Basic</option>
                        <option value="none">None</option>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="apiPassword">API Password</Label>
                      <Input
                        id="apiPassword"
                        type="password"
                        placeholder="algo"
                        value={formData.apiPassword}
                        onChange={(e) =>
                          setFormData({ ...formData, apiPassword: e.target.value })
                        }
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="zone">Zone (optional)</Label>
                    <Input
                      id="zone"
                      placeholder="dorms, common, apparatus"
                      value={formData.zone}
                      onChange={(e) =>
                        setFormData({ ...formData, zone: e.target.value })
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="volume">Default Volume: {formData.volume}%</Label>
                    <Slider
                      id="volume"
                      min={0}
                      max={100}
                      value={formData.volume}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          volume: parseInt(e.target.value),
                        })
                      }
                      showValue
                    />
                  </div>

                  {/* Speaker Linking (only for 8301 paging devices) */}
                  {formData.type === "8301" && (
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2">
                        <Link2 className="h-4 w-4" />
                        Linked Speakers
                      </Label>
                      <p className="text-xs text-gray-500 mb-2">
                        Speakers will auto-enable when playing and auto-disable when done (no white noise)
                      </p>
                      <div className="max-h-40 overflow-y-auto border rounded-md p-2 space-y-2">
                        {devices.filter(d => d.type !== "8301" && d.id !== editingDevice?.id).length === 0 ? (
                          <p className="text-sm text-gray-400 py-2 text-center">
                            No speakers available. Add speakers first.
                          </p>
                        ) : (
                          devices
                            .filter(d => d.type !== "8301" && d.id !== editingDevice?.id)
                            .map(speaker => (
                              <label key={speaker.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                                <input
                                  type="checkbox"
                                  checked={formData.linkedSpeakerIds.includes(speaker.id)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setFormData({
                                        ...formData,
                                        linkedSpeakerIds: [...formData.linkedSpeakerIds, speaker.id],
                                      });
                                    } else {
                                      setFormData({
                                        ...formData,
                                        linkedSpeakerIds: formData.linkedSpeakerIds.filter(id => id !== speaker.id),
                                      });
                                    }
                                  }}
                                  className="rounded border-gray-300"
                                />
                                <span className="text-sm">{speaker.name}</span>
                                <span className="text-xs text-gray-400">({speaker.ipAddress})</span>
                              </label>
                            ))
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex justify-end gap-2 pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setShowForm(false)}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" isLoading={saving}>
                      {editingDevice ? "Update" : "Add"} Device
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Devices List */}
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          </div>
        ) : devices.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <div className="mb-4 rounded-full bg-gray-100 p-4">
                <Volume2 className="h-8 w-8 text-gray-400" />
              </div>
              <h3 className="mb-2 text-lg font-medium text-gray-900">
                No devices yet
              </h3>
              <p className="mb-4 text-center text-gray-500">
                Add your first Algo device to get started
              </p>
              <Button onClick={openAddForm}>
                <Plus className="mr-2 h-4 w-4" />
                Add Device
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {devices.map((device) => (
              <Card key={device.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg">{device.name}</CardTitle>
                      <CardDescription>{device.ipAddress}</CardDescription>
                    </div>
                    <Badge variant={device.isOnline ? "success" : "secondary"}>
                      {device.isOnline ? "Online" : "Offline"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-2 text-sm">
                    <Badge variant="outline">{device.type.toUpperCase()}</Badge>
                    {device.zone && (
                      <Badge variant="outline">{device.zone}</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Volume2 className="h-4 w-4" />
                    <span>Volume: {device.volume}%</span>
                  </div>
                  {device.type === "8301" && device.linkedSpeakerIds && device.linkedSpeakerIds.length > 0 && (
                    <div className="flex items-center gap-2 text-sm text-blue-600">
                      <Link2 className="h-4 w-4" />
                      <span>
                        {device.linkedSpeakerIds.length} linked speaker{device.linkedSpeakerIds.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                  )}
                  <p className="text-xs text-gray-400">
                    Last seen: {formatDate(device.lastSeen)}
                  </p>
                  <div className="flex gap-2 pt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleTestTone(device)}
                      isLoading={testingDevice === device.id}
                    >
                      <Play className="mr-1 h-3 w-3" />
                      Test
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openEditForm(device)}
                    >
                      <Pencil className="mr-1 h-3 w-3" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDelete(device.id)}
                    >
                      <Trash2 className="mr-1 h-3 w-3" />
                      Delete
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
