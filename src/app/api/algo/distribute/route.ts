import { NextRequest, NextResponse } from "next/server";
import { AlgoClient } from "@/lib/algo/client";
import type { AlgoAuthMethod } from "@/lib/algo/types";

interface DistributeRequest {
  device: {
    ipAddress: string;
    password: string;
    authMethod: AlgoAuthMethod;
  };
  audioUrl?: string;
  filename?: string;
  loop: boolean;
  volume: number;
}

export async function POST(request: NextRequest) {
  try {
    const body: DistributeRequest = await request.json();
    const { device, filename, loop, volume } = body;

    if (!device?.ipAddress || !device?.password) {
      return NextResponse.json(
        { error: "Device information is required" },
        { status: 400 }
      );
    }

    const client = new AlgoClient({
      ipAddress: device.ipAddress,
      password: device.password,
      authMethod: device.authMethod || "standard",
    });

    // Set volume if different from default
    if (volume !== undefined) {
      const volumeDb = Math.round((volume / 100) * 42 - 42);
      try {
        await client.setSetting({ "audio.page.vol": `${volumeDb}dB` });
      } catch (e) {
        console.warn("Failed to set volume:", e);
        // Continue anyway - some devices may not support this setting
      }
    }

    // Play tone - if filename is provided from our library, use a default tone
    // In a full implementation, you'd transfer the file to the device first
    // For now, we'll use the device's built-in tones
    const tonePath = filename || "chime.wav";

    await client.playTone({
      path: tonePath,
      loop,
      mcast: true,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Distribute error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to distribute audio" },
      { status: 500 }
    );
  }
}
