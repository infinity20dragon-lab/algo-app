import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  Timestamp,
  type DocumentData,
} from "firebase/firestore";
import { db } from "./config";
import type { AlgoDevice, Zone, AudioFile, DistributionLog } from "@/lib/algo/types";

// ============ Devices ============

const devicesCollection = collection(db, "devices");

export async function getDevices(): Promise<AlgoDevice[]> {
  const q = query(devicesCollection, orderBy("createdAt", "desc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...convertTimestamps(doc.data()),
  })) as AlgoDevice[];
}

export async function getDevice(id: string): Promise<AlgoDevice | null> {
  const docRef = doc(db, "devices", id);
  const snapshot = await getDoc(docRef);
  if (!snapshot.exists()) return null;
  return { id: snapshot.id, ...convertTimestamps(snapshot.data()) } as AlgoDevice;
}

export async function addDevice(device: Omit<AlgoDevice, "id" | "createdAt" | "updatedAt">): Promise<string> {
  const now = Timestamp.now();
  const docRef = await addDoc(devicesCollection, {
    ...device,
    createdAt: now,
    updatedAt: now,
  });
  return docRef.id;
}

export async function updateDevice(id: string, data: Partial<AlgoDevice>): Promise<void> {
  const docRef = doc(db, "devices", id);
  // Firebase doesn't allow undefined values - filter them out
  const cleanData: Record<string, unknown> = { updatedAt: Timestamp.now() };
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      cleanData[key] = value;
    }
  }
  await updateDoc(docRef, cleanData);
}

export async function deleteDevice(id: string): Promise<void> {
  const docRef = doc(db, "devices", id);
  await deleteDoc(docRef);
}

// ============ Zones ============

const zonesCollection = collection(db, "zones");

export async function getZones(): Promise<Zone[]> {
  const q = query(zonesCollection, orderBy("createdAt", "desc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...convertTimestamps(doc.data()),
  })) as Zone[];
}

export async function getZone(id: string): Promise<Zone | null> {
  const docRef = doc(db, "zones", id);
  const snapshot = await getDoc(docRef);
  if (!snapshot.exists()) return null;
  return { id: snapshot.id, ...convertTimestamps(snapshot.data()) } as Zone;
}

export async function addZone(zone: Omit<Zone, "id" | "createdAt">): Promise<string> {
  const docRef = await addDoc(zonesCollection, {
    ...zone,
    createdAt: Timestamp.now(),
  });
  return docRef.id;
}

export async function updateZone(id: string, data: Partial<Zone>): Promise<void> {
  const docRef = doc(db, "zones", id);
  await updateDoc(docRef, data);
}

export async function deleteZone(id: string): Promise<void> {
  const docRef = doc(db, "zones", id);
  await deleteDoc(docRef);
}

// ============ Audio Files ============

const audioFilesCollection = collection(db, "audioFiles");

export async function getAudioFiles(): Promise<AudioFile[]> {
  const q = query(audioFilesCollection, orderBy("createdAt", "desc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...convertTimestamps(doc.data()),
  })) as AudioFile[];
}

export async function getAudioFile(id: string): Promise<AudioFile | null> {
  const docRef = doc(db, "audioFiles", id);
  const snapshot = await getDoc(docRef);
  if (!snapshot.exists()) return null;
  return { id: snapshot.id, ...convertTimestamps(snapshot.data()) } as AudioFile;
}

export async function addAudioFile(audioFile: Omit<AudioFile, "id" | "createdAt">): Promise<string> {
  const docRef = await addDoc(audioFilesCollection, {
    ...audioFile,
    createdAt: Timestamp.now(),
  });
  return docRef.id;
}

export async function deleteAudioFile(id: string): Promise<void> {
  const docRef = doc(db, "audioFiles", id);
  await deleteDoc(docRef);
}

// ============ Distribution Logs ============

const distributionLogsCollection = collection(db, "distributionLogs");

export async function getDistributionLogs(limit = 50): Promise<DistributionLog[]> {
  const q = query(distributionLogsCollection, orderBy("createdAt", "desc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.slice(0, limit).map((doc) => ({
    id: doc.id,
    ...convertTimestamps(doc.data()),
  })) as DistributionLog[];
}

export async function addDistributionLog(log: Omit<DistributionLog, "id" | "createdAt">): Promise<string> {
  const docRef = await addDoc(distributionLogsCollection, {
    ...log,
    createdAt: Timestamp.now(),
  });
  return docRef.id;
}

// ============ Helpers ============

function convertTimestamps(data: DocumentData): DocumentData {
  const result = { ...data };
  for (const key in result) {
    if (result[key] instanceof Timestamp) {
      result[key] = result[key].toDate();
    }
  }
  return result;
}
