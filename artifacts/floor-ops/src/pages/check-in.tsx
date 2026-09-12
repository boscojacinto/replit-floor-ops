import React from "react";
import { Link, useLocation } from "wouter";
import { useCreateTeam } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Radar } from "lucide-react";

export default function CheckIn() {
  const createTeam = useCreateTeam();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    
    createTeam.mutate({
      data: {
        name: fd.get("name") as string,
        tableLabel: fd.get("tableLabel") as string,
        building: fd.get("building") as string,
        ownerUsername: (fd.get("ownerUsername") as string) || undefined,
        workspaceUrl: (fd.get("workspaceUrl") as string) || undefined,
        previewUrl: (fd.get("previewUrl") as string) || undefined,
        githubUrl: (fd.get("githubUrl") as string) || undefined,
      }
    }, {
      onSuccess: () => {
        toast({ title: "Checked In!", description: "You're on the radar." });
        // After checkin, typically the user just sees a success message, 
        // but we'll redirect back to the home radar (or a success screen)
        setLocation("/");
      },
      onError: () => {
        toast({ title: "Error", description: "Could not check in.", variant: "destructive" });
      }
    });
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="h-14 border-b border-border bg-card/80 backdrop-blur flex items-center justify-center px-4">
        <div className="flex items-center gap-2 text-primary font-bold tracking-tight">
          <Radar className="w-5 h-5" />
          <span>HACKATHON CHECK-IN</span>
        </div>
      </header>
      
      <main className="flex-1 overflow-auto p-4 md:p-8 flex items-center justify-center">
        <Card className="w-full max-w-lg border-2 shadow-xl border-primary/20">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-2xl font-bold">Register Your Team</CardTitle>
            <CardDescription className="text-base">
              Get on the floor map so mentors can find you.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Team Name <span className="text-destructive">*</span></Label>
                  <Input id="name" name="name" required placeholder="e.g. ByteMe" autoFocus className="font-medium text-lg" />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="tableLabel">Table Label <span className="text-destructive">*</span></Label>
                    <Input id="tableLabel" name="tableLabel" required placeholder="e.g. A12" className="font-mono uppercase" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ownerUsername">Primary Username</Label>
                    <Input id="ownerUsername" name="ownerUsername" placeholder="@handle" />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="building">What are you building? <span className="text-destructive">*</span></Label>
                  <Textarea 
                    id="building" 
                    name="building" 
                    required 
                    placeholder="One sentence description of your project..." 
                    rows={2}
                  />
                </div>
              </div>

              <div className="space-y-4 pt-4 border-t border-border">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Links (Optional)</h3>
                
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="workspaceUrl" className="text-xs">Workspace URL</Label>
                    <Input id="workspaceUrl" name="workspaceUrl" type="url" placeholder="https://replit.com/..." className="text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="githubUrl" className="text-xs">GitHub Repo</Label>
                    <Input id="githubUrl" name="githubUrl" type="url" placeholder="https://github.com/..." className="text-xs" />
                  </div>
                </div>
              </div>
              
              <Button type="submit" className="w-full h-12 text-lg font-bold" disabled={createTeam.isPending}>
                {createTeam.isPending ? "CONNECTING..." : "ACTIVATE"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
