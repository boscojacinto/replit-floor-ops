import { Link, useLocation } from "wouter";
import { Radar, Users, Clock, Settings, ArrowLeft } from "lucide-react";
import { useGetEventSettings } from "@workspace/api-client-react";

export function Layout({ children, showBack = false }: { children: React.ReactNode, showBack?: boolean }) {
  const [location] = useLocation();
  const { data: settings } = useGetEventSettings();

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-card/80 backdrop-blur-md">
        <div className="flex items-center h-14 px-4 md:px-6 gap-6">
          {showBack ? (
            <Link href="/" className="flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-4 h-4" />
              BACK TO RADAR
            </Link>
          ) : (
            <div className="flex items-center gap-2 text-primary font-bold tracking-tight">
              <Radar className="w-5 h-5" />
              <span>FLOOR OPS</span>
            </div>
          )}

          <div className="flex-1" />
          
          <nav className="flex items-center gap-6 text-sm font-medium">
            <Link 
              href="/" 
              className={`flex items-center gap-2 transition-colors ${location === '/' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Users className="w-4 h-4" />
              <span className="hidden md:inline">RADAR</span>
            </Link>
            <Link 
              href="/settings" 
              className={`flex items-center gap-2 transition-colors ${location === '/settings' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Settings className="w-4 h-4" />
              <span className="hidden md:inline">SETTINGS</span>
            </Link>
          </nav>
        </div>
      </header>
      
      <main className="flex-1 overflow-x-hidden">
        {children}
      </main>
    </div>
  );
}
