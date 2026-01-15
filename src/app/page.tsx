"use client";

import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Speaker, Music, Radio, Activity } from "lucide-react";

export default function DashboardPage() {
  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-[var(--text-primary)]">Dashboard</h1>
          <p className="text-[var(--text-secondary)]">
            Monitor and control your Algo sound distribution system
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-[var(--text-secondary)]">
                Total Devices
              </CardTitle>
              <Speaker className="h-4 w-4 text-[var(--text-muted)]" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-[var(--text-primary)]">0</div>
              <p className="text-xs text-[var(--text-secondary)]">
                <span className="text-[var(--accent-green)]">0 online</span> / 0 offline
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-[var(--text-secondary)]">
                Audio Files
              </CardTitle>
              <Music className="h-4 w-4 text-[var(--text-muted)]" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-[var(--text-primary)]">0</div>
              <p className="text-xs text-[var(--text-secondary)]">Ready to distribute</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-[var(--text-secondary)]">
                Active Zones
              </CardTitle>
              <Radio className="h-4 w-4 text-[var(--text-muted)]" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-[var(--text-primary)]">0</div>
              <p className="text-xs text-[var(--text-secondary)]">Configured zones</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-[var(--text-secondary)]">
                System Status
              </CardTitle>
              <Activity className="h-4 w-4 text-[var(--text-muted)]" />
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Badge variant="success">Operational</Badge>
              </div>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">All systems normal</p>
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions & Recent Activity */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
              <CardDescription>Common tasks and shortcuts</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <a
                href="/devices"
                className="flex items-center gap-3 rounded-md border border-[var(--border-color)] p-3 transition-colors hover:bg-[var(--bg-tertiary)]"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--accent-blue)]/20">
                  <Speaker className="h-5 w-5 text-[var(--accent-blue)]" />
                </div>
                <div>
                  <p className="font-medium text-[var(--text-primary)]">Add Device</p>
                  <p className="text-sm text-[var(--text-secondary)]">
                    Register a new Algo endpoint
                  </p>
                </div>
              </a>
              <a
                href="/audio"
                className="flex items-center gap-3 rounded-md border border-[var(--border-color)] p-3 transition-colors hover:bg-[var(--bg-tertiary)]"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--accent-green)]/20">
                  <Music className="h-5 w-5 text-[var(--accent-green)]" />
                </div>
                <div>
                  <p className="font-medium text-[var(--text-primary)]">Upload Audio</p>
                  <p className="text-sm text-[var(--text-secondary)]">
                    Add audio files to the library
                  </p>
                </div>
              </a>
              <a
                href="/distribute"
                className="flex items-center gap-3 rounded-md border border-[var(--border-color)] p-3 transition-colors hover:bg-[var(--bg-tertiary)]"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--accent-purple)]/20">
                  <Radio className="h-5 w-5 text-[var(--accent-purple)]" />
                </div>
                <div>
                  <p className="font-medium text-[var(--text-primary)]">Distribute Sound</p>
                  <p className="text-sm text-[var(--text-secondary)]">
                    Play audio across devices or zones
                  </p>
                </div>
              </a>
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription>Latest sound distribution events</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex h-40 items-center justify-center text-[var(--text-muted)]">
                <p className="text-center">
                  No recent activity
                  <br />
                  <span className="text-sm">
                    Distribution events will appear here
                  </span>
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Getting Started */}
        <Card>
          <CardHeader>
            <CardTitle>Getting Started</CardTitle>
            <CardDescription>
              Set up your Algo sound distribution system
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-4">
              <li className="flex items-start gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent-blue)]/20 text-sm font-medium text-[var(--accent-blue)]">
                  1
                </span>
                <div>
                  <p className="font-medium text-[var(--text-primary)]">Add your Algo devices</p>
                  <p className="text-sm text-[var(--text-secondary)]">
                    Register your 8301 paging adapter and 8180G2 speakers with their
                    IP addresses and API credentials.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent-blue)]/20 text-sm font-medium text-[var(--accent-blue)]">
                  2
                </span>
                <div>
                  <p className="font-medium text-[var(--text-primary)]">Upload audio files</p>
                  <p className="text-sm text-[var(--text-secondary)]">
                    Add WAV audio files to your library for distribution to devices.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent-blue)]/20 text-sm font-medium text-[var(--accent-blue)]">
                  3
                </span>
                <div>
                  <p className="font-medium text-[var(--text-primary)]">Create zones (optional)</p>
                  <p className="text-sm text-[var(--text-secondary)]">
                    Group devices into zones like &quot;Dorms&quot;, &quot;Common Areas&quot;, or
                    &quot;Apparatus Bay&quot; for easier distribution.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent-blue)]/20 text-sm font-medium text-[var(--accent-blue)]">
                  4
                </span>
                <div>
                  <p className="font-medium text-[var(--text-primary)]">Distribute sounds</p>
                  <p className="text-sm text-[var(--text-secondary)]">
                    Play audio files to individual devices or entire zones with
                    volume control.
                  </p>
                </div>
              </li>
            </ol>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
