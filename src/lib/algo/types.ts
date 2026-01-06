// Algo Device Types
export type AlgoDeviceType = "8301" | "8180g2" | "8198" | "8128" | "8138" | "other";
export type AlgoAuthMethod = "standard" | "basic" | "none";

export interface AlgoDevice {
  id: string;
  name: string;
  type: AlgoDeviceType;
  ipAddress: string;
  authMethod: AlgoAuthMethod;
  apiPassword: string;
  zone: string;
  volume: number;
  isOnline: boolean;
  lastSeen: Date | null;
  createdAt: Date;
  updatedAt: Date;
  // For paging devices (8301): IDs of linked speakers to auto-enable/disable
  linkedSpeakerIds?: string[];
}

// Algo API Response Types
export interface AlgoAboutResponse {
  "Product Name": string;
  "Firmware Version": string;
  "MAC Address": string;
  "Hardware Info"?: string;
  "Manufacturer Certificate"?: string;
}

export interface AlgoStatusResponse {
  "Device Name": string;
  "SIP Registration": string;
  "Call Status": string;
  "Provisioning Status"?: string;
  MAC: string;
  IPv4: string;
  IPv6?: string;
  "Switch Port ID"?: string;
  "Date / Time": string;
  "Current Action": string;
  "Multicast Mode": string;
  Volume: string;
  "Relay Input Status"?: string;
  Temperature?: string;
}

export interface AlgoToneListResponse {
  tonelist: string[];
}

export interface AlgoSettingResponse {
  [key: string]: string;
}

// API Request Types
export interface AlgoToneStartRequest {
  path: string;
  loop: boolean;
  mcast?: boolean;
  playback?: boolean;
  state?: {
    mode: "sender";
    address: string;
    port: string;
    type: "rtp" | "poly";
    group?: number;
  };
}

export interface AlgoCallStartRequest {
  extension: string;
  tone?: string;
  interval?: string;
  maxdur?: string;
}

export interface AlgoDoorControlRequest {
  doorid: "netdc1" | "local";
  duration?: string;
}

export interface AlgoStrobeStartRequest {
  pattern: number;
  color1: "red" | "blue" | "green" | "amber";
  color2?: "red" | "blue" | "green" | "amber";
  ledlvl: string;
}

// Multicast Configuration
export interface AlgoMulticastConfig {
  mode: "sender" | "receiver";
  address: string;
  port: string;
  type: "rtp" | "poly";
  group?: number;
}

// Zone Type
export interface Zone {
  id: string;
  name: string;
  slug: string;
  deviceIds: string[];
  defaultVolume: number;
  createdAt: Date;
}

// Audio File Type
export interface AudioFile {
  id: string;
  name: string;
  filename: string;
  storageUrl: string;
  duration: number;
  fileSize: number;
  uploadedBy: string;
  createdAt: Date;
}

// Distribution Log Type
export interface DistributionLog {
  id: string;
  audioFileId: string;
  audioFileName: string;
  targetDevices: string[];
  targetZones: string[];
  triggeredBy: string;
  status: "success" | "partial" | "failed";
  results: Array<{
    deviceId: string;
    deviceName: string;
    success: boolean;
    error?: string;
  }>;
  createdAt: Date;
}
