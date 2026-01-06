import { NextRequest, NextResponse } from "next/server";
import { AlgoClient } from "@/lib/algo/client";
import type { AlgoAuthMethod } from "@/lib/algo/types";

interface SpeakerMcastRequest {
  speakers: Array<{
    ipAddress: string;
    password: string;
    authMethod: AlgoAuthMethod;
  }>;
  enable: boolean; // true = receiver mode (2), false = none (0)
}

export async function POST(request: NextRequest) {
  try {
    const body: SpeakerMcastRequest = await request.json();
    const { speakers, enable } = body;

    if (!speakers || speakers.length === 0) {
      return NextResponse.json(
        { error: "At least one speaker is required" },
        { status: 400 }
      );
    }

    const mcastMode = enable ? "2" : "0"; // 2 = receiver, 0 = none
    const results: Array<{ ip: string; success: boolean; error?: string }> = [];

    // Control all speakers in parallel for speed
    await Promise.all(
      speakers.map(async (speaker) => {
        try {
          const client = new AlgoClient({
            ipAddress: speaker.ipAddress,
            password: speaker.password,
            authMethod: speaker.authMethod || "basic",
          });

          await client.setSetting({ "mcast.mode": mcastMode });
          results.push({ ip: speaker.ipAddress, success: true });
        } catch (error) {
          results.push({
            ip: speaker.ipAddress,
            success: false,
            error: error instanceof Error ? error.message : "Failed",
          });
        }
      })
    );

    const allSuccess = results.every((r) => r.success);
    return NextResponse.json({
      success: allSuccess,
      enabled: enable,
      results,
    });
  } catch (error) {
    console.error("Speaker mcast control error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to control speakers" },
      { status: 500 }
    );
  }
}
