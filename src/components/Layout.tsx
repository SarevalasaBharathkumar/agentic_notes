import { Brain } from "lucide-react";
import { ReactNode } from "react";
import { Button } from "./ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";

interface LayoutProps {
  children: ReactNode;
}

export const Layout = ({ children }: LayoutProps) => {
  return (
    <div className="min-h-screen bg-gradient-subtle flex flex-col">
      <Header />
      <main className="container mx-auto px-4 py-8 flex-1">{children}</main>
      <Footer />
    </div>
  );
};

const Header = () => {
  const { toast } = useToast();

  const handleSignOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error("Sign out error:", error);
        toast({ title: "Sign out failed", description: error.message || "Could not sign you out.", variant: "destructive" });
        return;
      }
      // Clear client-side session storage (localStorage) and reload to reset app state
      try { localStorage.removeItem('supabase.auth.token'); } catch {}
      window.location.href = "/";
    } catch (e: any) {
      console.error("Unexpected sign out error:", e);
      toast({ title: "Sign out failed", description: e?.message || String(e), variant: "destructive" });
    }
  };

  return (
    <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
      <div className="container mx-auto px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-10 w-10 rounded-lg bg-gradient-primary flex items-center justify-center shadow-glow">
            <Brain className="h-6 w-6 text-primary-foreground" />
          </div>
          <Link to="/" className="text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent">
            Agentic Notepad
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={handleSignOut}>
            Sign Out
          </Button>
        </div>
      </div>
    </header>
  );
};

const Footer = () => {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t bg-card/50 backdrop-blur-sm">
      <div className="container mx-auto px-4 py-6">
        {/* Desktop / tablet layout: 4 columns */}
        <div className="hidden md:grid md:grid-cols-4 md:gap-8">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-md bg-gradient-primary flex items-center justify-center shadow-glow">
                <Brain className="h-4 w-4 text-primary-foreground" />
              </div>
              <span className="font-semibold">Agentic Notepad</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Capture ideas. Organize knowledge. Build with AI assistance.
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-2">Product</h3>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li>
                <Link to="/features" className="hover:text-foreground transition-colors">Features</Link>
              </li>
              <li>
                <Link to="/blog" className="hover:text-foreground transition-colors">Blog</Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-2">Company</h3>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li>
                <Link to="/about" className="hover:text-foreground transition-colors">About</Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-2">Legal</h3>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li>
                <Link to="/privacy-policy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Mobile layout: brand then 3 columns in a single row */}
        <div className="md:hidden">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-md bg-gradient-primary flex items-center justify-center shadow-glow">
              <Brain className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-semibold">Agentic Notepad</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Capture ideas. Organize knowledge. Build with AI assistance.
          </p>

          <div className="mt-4 grid grid-cols-3 gap-4">
            <div>
              <h3 className="text-[11px] font-semibold mb-1">Product</h3>
              <ul className="space-y-1 text-[11px] text-muted-foreground">
                <li>
                  <Link to="/features" className="hover:text-foreground transition-colors">Features</Link>
                </li>
                <li>
                  <Link to="/blog" className="hover:text-foreground transition-colors">Blog</Link>
                </li>
              </ul>
            </div>
            <div>
              <h3 className="text-[11px] font-semibold mb-1">Company</h3>
              <ul className="space-y-1 text-[11px] text-muted-foreground">
                <li>
                  <Link to="/about" className="hover:text-foreground transition-colors">About</Link>
                </li>
              </ul>
            </div>
            <div>
              <h3 className="text-[11px] font-semibold mb-1">Legal</h3>
              <ul className="space-y-1 text-[11px] text-muted-foreground">
                <li>
                  <Link to="/privacy-policy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-col md:flex-row items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">© {year} Agentic Notepad. All rights reserved.</p>
          <div className="text-xs text-muted-foreground">
            <span className="opacity-80">Built with React, Vite, and Supabase</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
