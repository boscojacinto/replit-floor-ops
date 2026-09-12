import React, { useState } from "react";
import { Layout } from "@/components/layout";
import { useGetEventSettings, useUpdateEventSettings } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getGetEventSettingsQueryKey } from "@workspace/api-client-react";

export default function Settings() {
  const { data: settings, isLoading } = useGetEventSettings();
  const updateSettings = useUpdateEventSettings();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [endTime, setEndTime] = useState<string>("");

  // Sync state when data loads
  React.useEffect(() => {
    if (settings?.endsAt) {
      // Convert to local datetime-local format for input
      const date = new Date(settings.endsAt);
      const tzOffset = date.getTimezoneOffset() * 60000;
      const localISOTime = (new Date(date.getTime() - tzOffset)).toISOString().slice(0, 16);
      setEndTime(localISOTime);
    } else {
      setEndTime("");
    }
  }, [settings?.endsAt]);

  const handleSave = () => {
    const payload = endTime ? new Date(endTime).toISOString() : null;
    updateSettings.mutate({ data: { endsAt: payload } }, {
      onSuccess: (data) => {
        toast({ title: "Settings updated", description: "Event end time saved." });
        queryClient.setQueryData(getGetEventSettingsQueryKey(), data);
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to update settings.", variant: "destructive" });
      }
    });
  };

  const handleClear = () => {
    updateSettings.mutate({ data: { endsAt: null } }, {
      onSuccess: (data) => {
        setEndTime("");
        toast({ title: "Timer cleared" });
        queryClient.setQueryData(getGetEventSettingsQueryKey(), data);
      }
    });
  };

  return (
    <Layout>
      <div className="max-w-2xl mx-auto p-4 md:p-6 lg:p-8 space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">EVENT SETTINGS</h1>
        
        <Card>
          <CardHeader>
            <CardTitle>Countdown Clock</CardTitle>
            <CardDescription>
              Set the exact time the event ends. This drives the countdown clock on the dashboard.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="endTime">End Time</Label>
              <Input 
                id="endTime" 
                type="datetime-local" 
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                disabled={isLoading || updateSettings.isPending}
              />
            </div>
            
            <div className="flex gap-4 pt-2">
              <Button 
                onClick={handleSave} 
                disabled={isLoading || updateSettings.isPending}
              >
                {updateSettings.isPending ? "Saving..." : "Save Timer"}
              </Button>
              <Button 
                variant="outline" 
                onClick={handleClear}
                disabled={isLoading || updateSettings.isPending || !settings?.endsAt}
              >
                Clear
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
