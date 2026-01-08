import { NextRequest, NextResponse } from "next/server";
import { AlgoClient } from "@/lib/algo/client";
import type { AlgoAuthMethod } from "@/lib/algo/types";

interface SettingsRequest {
  ipAddress: string;
  password: string;
  authMethod: AlgoAuthMethod;
  settings: Record<string, string>;
}

export async function POST(request: NextRequest) {
  try {
    const body: SettingsRequest = await request.json();
    const { ipAddress, password, authMethod, settings } = body;

    if (!ipAddress || !password || !settings) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const client = new AlgoClient({
      ipAddress,
      password,
      authMethod: authMethod || "standard",
    });

    await client.setSetting(settings);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Settings error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update settings" },
      { status: 500 }
    );
  }
}
