import React, { useEffect, useState } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { 
  useListTeams, 
  useListTickets, 
  useGetDashboardSummary, 
  useGetEventSettings 
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  getHelpTypeColor, 
  getHelpTypeLabel, 
  getPhaseLabel, 
  formatTimeAgo,
  getTicketStatusColor,
  getTicketStatusLabel
} from "@/lib/display-utils";
import { AlertCircle, Clock, CheckCircle2 } from "lucide-react";

export default function Dashboard() {
  const { data: teams, isLoading: loadingTeams } = useListTeams({ query: { refetchInterval: 5000 } });
  const { data: summary } = useGetDashboardSummary({ query: { refetchInterval: 5000 } });
  const { data: tickets, isLoading: loadingTickets } = useListTickets({}, { query: { refetchInterval: 5000 } });
  const { data: settings } = useGetEventSettings({ query: { refetchInterval: 10000 } });

  // Filter to active queue: Draft & Filed
  const activeTickets = tickets?.filter(t => t.status === 'draft' || t.status === 'filed') || [];

  return (
    <Layout>
      <div className="p-4 md:p-6 lg:p-8 space-y-6">
        
        {/* TOP BAR / SUMMARY */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SummaryCard title="TEAMS" value={summary?.totalTeams ?? 0} icon={<UsersIcon />} />
          <SummaryCard 
            title="PAGE NOW" 
            value={summary?.pageNowCount ?? 0} 
            valueClass="text-destructive font-bold" 
            icon={<AlertCircle className="w-4 h-4 text-destructive" />} 
          />
          <SummaryCard 
            title="STUCK" 
            value={summary?.stuckCount ?? 0} 
            valueClass="text-amber-600 font-bold"
            icon={<AlertCircle className="w-4 h-4 text-amber-500" />} 
          />
          <CountdownCard endsAt={settings?.endsAt} />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* ROOM RADAR */}
          <div className="xl:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold tracking-tight">ROOM RADAR</h2>
              <Badge variant="outline" className="font-mono text-xs">{teams?.length ?? 0} ACTIVE</Badge>
            </div>
            
            {loadingTeams ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[1,2,3,4].map(i => <div key={i} className="h-32 bg-card rounded-lg animate-pulse" />)}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {teams?.map(team => (
                  <Link key={team.id} href={`/teams/${team.id}`}>
                    <Card className="hover-elevate cursor-pointer transition-all hover:border-primary/50 group h-full">
                      <CardContent className="p-4 flex flex-col h-full justify-between gap-4">
                        <div>
                          <div className="flex justify-between items-start mb-2">
                            <Badge variant="secondary" className="font-mono">{team.tableLabel}</Badge>
                            <Badge className={getHelpTypeColor(team.helpType)}>
                              {getHelpTypeLabel(team.helpType)}
                            </Badge>
                          </div>
                          <h3 className="font-bold text-lg leading-tight group-hover:text-primary transition-colors line-clamp-1">{team.name}</h3>
                          <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{team.building}</p>
                        </div>
                        
                        <div className="flex items-center justify-between mt-auto">
                          <span className="text-xs font-mono font-medium text-muted-foreground">
                            {getPhaseLabel(team.phase)}
                          </span>
                          {team.lastPingAt && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {formatTimeAgo(team.lastPingAt)}
                            </span>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
                {teams?.length === 0 && (
                  <div className="col-span-full py-12 text-center text-muted-foreground border-2 border-dashed rounded-lg border-muted">
                    No teams checked in yet.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* HELP QUEUE */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold tracking-tight">HELP QUEUE</h2>
              <Badge variant="outline" className="font-mono text-xs">{activeTickets.length} OPEN</Badge>
            </div>
            
            <div className="space-y-3">
              {loadingTickets ? (
                <div className="h-24 bg-card rounded-lg animate-pulse" />
              ) : activeTickets.length > 0 ? (
                activeTickets.map(ticket => {
                  const team = teams?.find(t => t.id === ticket.teamId);
                  return (
                    <Link key={ticket.id} href={`/teams/${ticket.teamId}`}>
                      <Card className="hover-elevate cursor-pointer transition-colors hover:border-primary/50">
                        <CardContent className="p-3">
                          <div className="flex justify-between items-start mb-2">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="font-mono text-[10px]">{team?.tableLabel || '?'}</Badge>
                              <Badge className={getTicketStatusColor(ticket.status)}>
                                {getTicketStatusLabel(ticket.status)}
                              </Badge>
                            </div>
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {formatTimeAgo(ticket.createdAt)}
                            </span>
                          </div>
                          <p className="text-sm font-medium leading-snug line-clamp-2">{ticket.summary}</p>
                          <div className="flex items-center gap-2 mt-2">
                            <span className="text-xs font-semibold">{team?.name || 'Unknown Team'}</span>
                            {ticket.blockerType && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                {ticket.blockerType.toUpperCase()}
                              </Badge>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  );
                })
              ) : (
                <div className="py-8 text-center text-muted-foreground border-2 border-dashed rounded-lg border-muted flex flex-col items-center gap-2">
                  <CheckCircle2 className="w-8 h-8 text-green-500/50" />
                  <span className="text-sm font-medium">Queue is clear</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}

function UsersIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function SummaryCard({ title, value, icon, valueClass = "" }: { title: string, value: string | number, icon: React.ReactNode, valueClass?: string }) {
  return (
    <Card className="bg-card">
      <CardContent className="p-4 flex flex-col justify-between h-full gap-2">
        <div className="flex justify-between items-center text-sm font-medium text-muted-foreground">
          {title}
          {icon}
        </div>
        <div className={`text-3xl font-mono tracking-tight ${valueClass}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

function CountdownCard({ endsAt }: { endsAt?: string | null }) {
  const [timeLeft, setTimeLeft] = useState<string>("--:--:--");

  useEffect(() => {
    if (!endsAt) {
      setTimeLeft("--:--:--");
      return;
    }

    const target = new Date(endsAt).getTime();
    
    const tick = () => {
      const now = new Date().getTime();
      const diff = target - now;
      
      if (diff <= 0) {
        setTimeLeft("00:00:00");
        return;
      }
      
      const h = Math.floor((diff / (1000 * 60 * 60)));
      const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const s = Math.floor((diff % (1000 * 60)) / 1000);
      
      setTimeLeft(
        `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
      );
    };
    
    tick();
    const int = setInterval(tick, 1000);
    return () => clearInterval(int);
  }, [endsAt]);

  return (
    <SummaryCard 
      title="TIME REMAINING" 
      value={timeLeft} 
      valueClass="font-mono text-primary font-bold"
      icon={<Clock className="w-4 h-4 text-primary" />} 
    />
  );
}
