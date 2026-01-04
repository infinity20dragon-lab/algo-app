import { NextRequest, NextResponse } from "next/server";
import { AlgoClient } from "@/lib/algo/client";
import type { AlgoAuthMethod } from "@/lib/algo/types";

interface StopRequest {
  device: {
    ipAddress: string;
    password: string;
    authMethod: AlgoAuthMethod;
  };
}

export async function POST(request: NextRequest) {
  try {
    const body: StopRequest = await request.json();
    const { device } = body;

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

    await client.stopTone();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Stop error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to stop audio" },
      { status: 500 }
    );
  }
}
