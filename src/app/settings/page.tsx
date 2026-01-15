"use client";

import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/auth-context";

export default function SettingsPage() {
  const { user } = useAuth();

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-[var(--text-primary)]">Settings</h1>
          <p className="text-[var(--text-secondary)]">Configure your AlgoSound system</p>
        </div>

        {/* Account Info */}
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>Your account information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={user?.email || ""} disabled />
            </div>
            <div className="space-y-2">
              <Label>User ID</Label>
              <Input value={user?.uid || ""} disabled />
            </div>
          </CardContent>
        </Card>

        {/* Default Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Default Settings</CardTitle>
            <CardDescription>
              Default values for new devices and distributions
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="defaultPassword">Default API Password</Label>
              <Input
                id="defaultPassword"
                type="password"
                defaultValue="algo"
                placeholder="algo"
              />
              <p className="text-sm text-[var(--text-muted)]">
                Used as the default password when adding new devices
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="defaultVolume">Default Volume</Label>
              <Input
                id="defaultVolume"
                type="number"
                min={0}
                max={100}
                defaultValue={50}
              />
              <p className="text-sm text-[var(--text-muted)]">
                Default volume level for new distributions (0-100)
              </p>
            </div>
            <Button>Save Settings</Button>
          </CardContent>
        </Card>

        {/* About */}
        <Card>
          <CardHeader>
            <CardTitle>About AlgoSound</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-[var(--text-secondary)]">
            <p>
              <strong>Version:</strong> 1.0.0
            </p>
            <p>
              <strong>Purpose:</strong> Sound distribution system for Algo IP
              endpoints
            </p>
            <p>
              <strong>Supported Devices:</strong> 8301 Paging Adapter, 8180G2
              Speaker, 8198 Ceiling Speaker, and more
            </p>
            <p className="pt-4">
              Built for fire station alerting systems to ensure every call
              reaches all areas of the station.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
