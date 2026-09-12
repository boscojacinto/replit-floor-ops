import React, { useState, useRef, useEffect } from "react";
import { useParams } from "wouter";
import { Layout } from "@/components/layout";
import { 
  useGetTeam, 
  useUpdateTeam, 
  useCreateTeamPing, 
  useDraftTicket, 
  useUpdateTicket, 
  useFileTicket, 
  useDiscardTicket, 
  useResolveTicket,
  getGetTeamQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  getHelpTypeColor, 
  getHelpTypeLabel, 
  getPhaseLabel, 
  formatTimeAgo,
  getTicketStatusColor,
  getTicketStatusLabel
} from "@/lib/display-utils";
import { Github, Globe, TerminalSquare, MessagesSquare, CheckCircle, Trash2, Edit3, Send, Play, Clock } from "lucide-react";
import type { Ping, Ticket, HelpType, Phase } from "@workspace/api-client-react/src/generated/api.schemas";

export default function TeamDossier() {
  const { teamId } = useParams();
  const id = parseInt(teamId || "0", 10);
  
  const { data, isLoading, error } = useGetTeam(id, { query: { refetchInterval: 5000 } });
  
  if (isLoading) return <Layout showBack><div className="p-8 text-center text-muted-foreground">Loading team...</div></Layout>;
  if (error || !data) return <Layout showBack><div className="p-8 text-center text-destructive">Error loading team.</div></Layout>;
  
  const { team, pings, tickets } = data;

  return (
    <Layout showBack>
      <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
        
        {/* TEAM HEADER */}
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 bg-card p-6 rounded-lg border border-border shadow-sm">
          <div className="space-y-2 flex-1">
            <div className="flex items-center gap-3">
              <Badge variant="secondary" className="font-mono text-sm px-2 py-0.5">{team.tableLabel}</Badge>
              <h1 className="text-3xl font-bold tracking-tight">{team.name}</h1>
              <Badge className={getHelpTypeColor(team.helpType)}>
                {getHelpTypeLabel(team.helpType)}
              </Badge>
            </div>
            <p className="text-lg text-muted-foreground">{team.building}</p>
            <div className="flex flex-wrap gap-4 pt-2">
              {team.workspaceUrl && (
                <a href={team.workspaceUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-sm text-primary hover:underline">
                  <TerminalSquare className="w-4 h-4" /> Workspace
                </a>
              )}
              {team.previewUrl && (
                <a href={team.previewUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-sm text-primary hover:underline">
                  <Play className="w-4 h-4" /> Preview
                </a>
              )}
              {team.githubUrl && (
                <a href={team.githubUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-sm text-primary hover:underline">
                  <Github className="w-4 h-4" /> GitHub
                </a>
              )}
              {team.publishUrl && (
                <a href={team.publishUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-sm text-primary hover:underline">
                  <Globe className="w-4 h-4" /> Published
                </a>
              )}
            </div>
          </div>
          
          <div className="flex flex-col gap-2 min-w-[200px]">
            <TeamPhaseSelect teamId={team.id} currentPhase={team.phase} />
            <EnRouteToggle teamId={team.id} isEnRoute={team.moderatorEnRoute} />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* TIMELINE (LEFT) */}
          <div className="lg:col-span-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold tracking-tight">TIMELINE</h2>
              <AddPingDialog teamId={team.id} />
            </div>
            
            <div className="space-y-4 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:ml-[2.25rem] md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-border before:to-transparent">
              {pings.map((ping) => (
                <PingItem key={ping.id} ping={ping} />
              ))}
              {pings.length === 0 && (
                <div className="pl-14 text-sm text-muted-foreground italic">No events yet.</div>
              )}
            </div>
          </div>

          {/* TICKETS (RIGHT) */}
          <div className="lg:col-span-7 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold tracking-tight">TICKETS</h2>
              <DraftTicketButton teamId={team.id} />
            </div>
            
            <div className="grid gap-4">
              {tickets.map((ticket) => (
                <TicketCard key={ticket.id} ticket={ticket} teamId={team.id} />
              ))}
              {tickets.length === 0 && (
                <div className="py-12 border-2 border-dashed border-muted rounded-lg flex items-center justify-center text-muted-foreground">
                  No tickets for this team.
                </div>
              )}
            </div>
          </div>
        </div>
        
      </div>
    </Layout>
  );
}

// Sub-components

function TeamPhaseSelect({ teamId, currentPhase }: { teamId: number, currentPhase: Phase }) {
  const updateTeam = useUpdateTeam();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handlePhaseChange = (val: string) => {
    updateTeam.mutate({ teamId, data: { phase: val as Phase } }, {
      onSuccess: (data) => {
        toast({ title: "Phase updated", description: `Team is now in ${getPhaseLabel(data.phase)}` });
        queryClient.setQueryData(getGetTeamQueryKey(teamId), (old: any) => 
          old ? { ...old, team: data } : old
        );
      }
    });
  };

  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">CURRENT PHASE</Label>
      <Select value={currentPhase} onValueChange={handlePhaseChange} disabled={updateTeam.isPending}>
        <SelectTrigger className="font-mono text-xs h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="idea">IDEA</SelectItem>
          <SelectItem value="ui">UI</SelectItem>
          <SelectItem value="logic">LOGIC</SelectItem>
          <SelectItem value="hardware">HARDWARE</SelectItem>
          <SelectItem value="stuck">STUCK</SelectItem>
          <SelectItem value="demo_ready">DEMO READY</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function EnRouteToggle({ teamId, isEnRoute }: { teamId: number, isEnRoute: boolean }) {
  const updateTeam = useUpdateTeam();
  const queryClient = useQueryClient();

  const toggle = () => {
    updateTeam.mutate({ teamId, data: { moderatorEnRoute: !isEnRoute } }, {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetTeamQueryKey(teamId), (old: any) => 
          old ? { ...old, team: data } : old
        );
      }
    });
  };

  return (
    <Button 
      variant={isEnRoute ? "default" : "outline"} 
      onClick={toggle}
      className={`h-8 mt-2 w-full font-bold ${isEnRoute ? "bg-amber-500 hover:bg-amber-600 text-white" : ""}`}
      disabled={updateTeam.isPending}
    >
      {isEnRoute ? "MODERATOR EN ROUTE" : "MARK EN ROUTE"}
    </Button>
  );
}

function AddPingDialog({ teamId }: { teamId: number }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [helpType, setHelpType] = useState<HelpType>("fine");
  const createPing = useCreateTeamPing();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleSubmit = () => {
    if (!note) return;
    createPing.mutate({ teamId, data: { source: "moderator_note", note, helpType } }, {
      onSuccess: (newPing) => {
        toast({ title: "Note added" });
        setOpen(false);
        setNote("");
        setHelpType("fine");
        queryClient.invalidateQueries({ queryKey: getGetTeamQueryKey(teamId) });
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-2">
        <MessagesSquare className="w-4 h-4" /> Add Note
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Moderator Note</DialogTitle>
          <DialogDescription>Record a quick observation or update for this team.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Note content</Label>
            <Textarea value={note} onChange={e => setNote(e.target.value)} placeholder="E.g. They are struggling with the API..." rows={3} autoFocus />
          </div>
          <div className="space-y-2">
            <Label>Update Status (Optional)</Label>
            <Select value={helpType} onValueChange={(v) => setHelpType(v as HelpType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fine">Fine</SelectItem>
                <SelectItem value="stuck">Stuck</SelectItem>
                <SelectItem value="page_now">Page Now</SelectItem>
                <SelectItem value="do_not_disturb">Do Not Disturb</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!note || createPing.isPending}>
            {createPing.isPending ? "Saving..." : "Save Note"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DraftTicketButton({ teamId }: { teamId: number }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const draftTicket = useDraftTicket();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleDraft = () => {
    draftTicket.mutate({ teamId, data: { moderatorNote: note || undefined } }, {
      onSuccess: () => {
        toast({ title: "Ticket Drafted", description: "AI has structured the recent signals." });
        setOpen(false);
        setNote("");
        queryClient.invalidateQueries({ queryKey: getGetTeamQueryKey(teamId) });
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to draft ticket.", variant: "destructive" });
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)} size="sm" className="gap-2">
        <Send className="w-4 h-4" /> Auto-Draft Ticket
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Draft Ticket with AI</DialogTitle>
          <DialogDescription>
            The model will read the team's recent timeline and structure it into a GitHub issue draft.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Additional Context (Optional)</Label>
            <Textarea 
              value={note} 
              onChange={e => setNote(e.target.value)} 
              placeholder="Any extra context for the model before it writes the ticket?" 
              rows={2} 
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleDraft} disabled={draftTicket.isPending}>
            {draftTicket.isPending ? "Drafting..." : "Draft Ticket"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PingItem({ ping }: { ping: Ping }) {
  return (
    <div className="relative flex items-start gap-4 mb-4 group">
      <div className="absolute left-0 md:left-4 w-10 h-10 rounded-full bg-card border-2 border-border flex items-center justify-center z-10">
        {ping.source === 'moderator_note' ? (
          <MessagesSquare className="w-4 h-4 text-primary" />
        ) : ping.source === 'system' ? (
          <TerminalSquare className="w-4 h-4 text-muted-foreground" />
        ) : (
          <Clock className="w-4 h-4 text-secondary-foreground" />
        )}
      </div>
      <div className="pl-14 md:pl-20 w-full pt-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <div className="font-semibold text-sm">
            {ping.source.replace('_', ' ').toUpperCase()}
            {ping.helpType && <Badge variant="outline" className="ml-2 text-[10px] scale-90 origin-left">{getHelpTypeLabel(ping.helpType)}</Badge>}
          </div>
          <div className="text-xs text-muted-foreground whitespace-nowrap">{formatTimeAgo(ping.createdAt)}</div>
        </div>
        <div className="text-sm mt-1 bg-muted/50 p-3 rounded-md border border-border/50 text-foreground">
          {ping.note}
        </div>
      </div>
    </div>
  );
}

function TicketCard({ ticket, teamId }: { ticket: Ticket, teamId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const fileTicket = useFileTicket();
  const resolveTicket = useResolveTicket();
  const discardTicket = useDiscardTicket();
  
  const [isEditing, setIsEditing] = useState(false);
  
  const handleAction = (action: 'file' | 'resolve' | 'discard') => {
    const mut = action === 'file' ? fileTicket : action === 'resolve' ? resolveTicket : discardTicket;
    
    mut.mutate({ ticketId: ticket.id }, {
      onSuccess: () => {
        toast({ title: `Ticket ${action}d` });
        queryClient.invalidateQueries({ queryKey: getGetTeamQueryKey(teamId) });
      }
    });
  };

  return (
    <Card className={`border-l-4 ${
      ticket.status === 'draft' ? 'border-l-muted' : 
      ticket.status === 'filed' ? 'border-l-primary' : 
      ticket.status === 'resolved' ? 'border-l-green-500' : 'border-l-destructive'
    }`}>
      <CardContent className="p-4 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Badge className={getTicketStatusColor(ticket.status)}>
                {getTicketStatusLabel(ticket.status)}
              </Badge>
              {ticket.blockerType && (
                <Badge variant="outline" className="text-[10px]">{ticket.blockerType.toUpperCase()}</Badge>
              )}
              {ticket.skill && (
                <Badge variant="secondary" className="text-[10px]">{ticket.skill}</Badge>
              )}
              <span className="text-xs text-muted-foreground ml-auto">{formatTimeAgo(ticket.createdAt)}</span>
            </div>
            <h3 className="font-bold text-base leading-tight">{ticket.issueTitle || ticket.summary}</h3>
            {ticket.status === 'draft' && (
              <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{ticket.issueBody}</p>
            )}
            
            {ticket.issueUrl && (
              <a href={ticket.issueUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline mt-2">
                <Github className="w-3 h-3" /> 
                {ticket.issueNumber ? `Issue #${ticket.issueNumber}` : 'View Issue'}
              </a>
            )}
          </div>
        </div>

        {ticket.status === 'draft' && (
          <div className="flex items-center gap-2 pt-2 border-t border-border mt-1">
            <Button size="sm" onClick={() => handleAction('file')} disabled={fileTicket.isPending} className="flex-1">
              {fileTicket.isPending ? "Filing..." : "File Ticket"}
            </Button>
            <EditTicketDialog ticket={ticket} teamId={teamId} />
            <Button size="sm" variant="destructive" onClick={() => handleAction('discard')} disabled={discardTicket.isPending}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        )}
        
        {ticket.status === 'filed' && (
          <div className="flex items-center gap-2 pt-2 border-t border-border mt-1">
            <Button size="sm" variant="outline" className="flex-1 text-green-600 border-green-600 hover:bg-green-50" onClick={() => handleAction('resolve')} disabled={resolveTicket.isPending}>
              <CheckCircle className="w-4 h-4 mr-2" />
              {resolveTicket.isPending ? "Resolving..." : "Mark Resolved"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EditTicketDialog({ ticket, teamId }: { ticket: Ticket, teamId: number }) {
  const [open, setOpen] = useState(false);
  const updateTicket = useUpdateTicket();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  // State for form
  const [title, setTitle] = useState(ticket.issueTitle || "");
  const [body, setBody] = useState(ticket.issueBody || "");
  const [summary, setSummary] = useState(ticket.summary || "");
  
  // Sync state if ticket changes
  useEffect(() => {
    setTitle(ticket.issueTitle || "");
    setBody(ticket.issueBody || "");
    setSummary(ticket.summary || "");
  }, [ticket]);

  const handleSave = () => {
    updateTicket.mutate({ 
      ticketId: ticket.id, 
      data: { 
        issueTitle: title, 
        issueBody: body, 
        summary 
      } 
    }, {
      onSuccess: () => {
        toast({ title: "Draft updated" });
        setOpen(false);
        queryClient.invalidateQueries({ queryKey: getGetTeamQueryKey(teamId) });
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Edit3 className="w-4 h-4" />
      </Button>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Draft Ticket</DialogTitle>
          <DialogDescription>Make manual adjustments before filing.</DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Summary (Internal)</Label>
            <Input value={summary} onChange={e => setSummary(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Issue Title</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Issue Body (Markdown)</Label>
            <Textarea 
              value={body} 
              onChange={e => setBody(e.target.value)} 
              rows={12} 
              className="font-mono text-xs"
            />
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={updateTicket.isPending || !title || !summary}>
            {updateTicket.isPending ? "Saving..." : "Save Draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
