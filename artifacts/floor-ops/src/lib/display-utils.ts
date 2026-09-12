import { HelpType, Phase, TicketStatus, AccessState } from "@workspace/api-client-react/src/generated/api.schemas";

export const getHelpTypeColor = (type: HelpType | null) => {
  switch (type) {
    case 'page_now': return 'bg-destructive/10 text-destructive border-destructive/20';
    case 'stuck': return 'bg-amber-500/10 text-amber-600 border-amber-500/20';
    case 'do_not_disturb': return 'bg-purple-500/10 text-purple-600 border-purple-500/20';
    case 'fine': return 'bg-green-500/10 text-green-600 border-green-500/20';
    default: return 'bg-muted text-muted-foreground border-border';
  }
};

export const getHelpTypeLabel = (type: HelpType | null) => {
  switch (type) {
    case 'page_now': return 'PAGE NOW';
    case 'stuck': return 'STUCK';
    case 'do_not_disturb': return 'DND';
    case 'fine': return 'FINE';
    default: return 'UNKNOWN';
  }
};

export const getPhaseLabel = (phase: Phase | null) => {
  if (!phase) return 'UNKNOWN';
  return phase.toUpperCase().replace('_', ' ');
};

export const getTicketStatusLabel = (status: TicketStatus) => {
  return status.toUpperCase();
};

export const getTicketStatusColor = (status: TicketStatus) => {
  switch (status) {
    case 'draft': return 'bg-muted text-muted-foreground border-border';
    case 'filed': return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
    case 'resolved': return 'bg-green-500/10 text-green-600 border-green-500/20';
    case 'discarded': return 'bg-red-500/10 text-red-600 border-red-500/20';
    default: return 'bg-muted text-muted-foreground border-border';
  }
}

export function formatTimeAgo(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  
  return date.toLocaleDateString();
}
