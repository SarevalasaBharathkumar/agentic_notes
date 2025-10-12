import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Sparkles, Trash2, Pin, PinOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";

// Safely format relative time to avoid crashes on invalid dates
function safeRelativeTime(input?: string) {
  try {
    if (!input) return null;
    const d = new Date(input);
    if (isNaN(d.getTime())) return null;
    return formatDistanceToNow(d, { addSuffix: true });
  } catch {
    return null;
  }
}

interface NoteCardProps {
  title: string;
  content: string;
  updatedAt: string;
  onClick?: () => void;
  onDelete?: () => void;
  onSuggestTitle?: () => void;
  pinned?: boolean;
  onTogglePin?: () => void;
}

function stripHtml(input: string) {
  return input.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function stripMarkdown(md: string) {
  return md
    .replace(/`[^`]+`/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/^- \[.\]\s+/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toSnippet(content: string, max = 160) {
  const isHtml = /^\s*</.test(content);
  const text = isHtml ? stripHtml(content) : stripMarkdown(content);
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

export const NoteCard = ({ title, content, updatedAt, onClick, onDelete, onSuggestTitle, pinned, onTogglePin }: NoteCardProps) => {
  const [openOptions, setOpenOptions] = useState(false);
  const timerRef = useRef<number | null>(null);

  const startPressTimer = () => {
    if (timerRef.current) return;
    // Only enable long-press sheet on mobile (below sm)
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(min-width: 640px)').matches) {
      return;
    }
    timerRef.current = window.setTimeout(() => setOpenOptions(true), 500);
  };
  const clearPressTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => () => clearPressTimer(), []);

  return (
    <Card className="transition-all hover:shadow-lg group relative select-none">
      <div
        onClick={onClick}
        onTouchStart={startPressTimer}
        onTouchEnd={clearPressTimer}
        onTouchCancel={clearPressTimer}
        onMouseDown={startPressTimer}
        onMouseUp={clearPressTimer}
        onMouseLeave={clearPressTimer}
        className="cursor-pointer"
      >
        {/* Fixed aspect on mobile; on desktop, let height shrink and remove reserved space */}
        <div className="aspect-[4/3] flex flex-col relative overflow-hidden pb-9 sm:pb-0 sm:aspect-auto">
          <CardHeader className="p-3 pb-1 space-y-1">
          <div className="flex flex-col gap-1">
            <div className="flex items-start gap-2 min-w-0">
              <div className="flex-1">
                <CardTitle className="text-xs sm:text-sm group-hover:text-primary transition-colors truncate">
                  {title}
                </CardTitle>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-primary inline-flex sm:opacity-0 sm:group-hover:opacity-100 sm:pointer-events-none sm:group-hover:pointer-events-auto transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSuggestTitle?.();
                  }}
                  aria-label="Suggest title"
                >
                  <Sparkles className="h-3 w-3" />
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon"
                  className={`h-6 w-6 text-muted-foreground hover:text-primary transition-opacity ${pinned ? 'inline-flex opacity-100 pointer-events-none sm:pointer-events-auto' : 'hidden sm:inline-flex opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto'}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTogglePin?.();
                  }}
                  aria-label={pinned ? "Unpin" : "Pin"}
                >
                  {pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            {/* Time moved to footer (bottom-left) */}
          </div>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <p className="text-[11px] sm:text-xs text-muted-foreground line-clamp-2">{toSnippet(content)}</p>
          </CardContent>
          {/* Footer: absolute on mobile for consistent card heights; static on desktop to remove gap */}
          <div className="absolute inset-x-0 bottom-0 px-3 pb-3 pt-1 w-full flex items-center justify-between sm:static sm:p-3 sm:pt-1 sm:pb-3 sm:px-3">
            <span className="text-[11px] text-muted-foreground">
              {safeRelativeTime(updatedAt) || ""}
            </span>
            <Button 
              variant="ghost" 
              size="icon"
              onClick={(e) => { e.stopPropagation(); onDelete?.(); }}
              className="h-7 w-7 text-destructive hover:text-destructive hidden sm:inline-flex opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity"
              aria-label="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile long-press options (hidden on desktop) */}
      <Drawer open={openOptions} onOpenChange={setOpenOptions}>
        <DrawerContent className="sm:hidden">
          <DrawerHeader>
            <DrawerTitle>Note options</DrawerTitle>
          </DrawerHeader>
          <DrawerFooter>
            <Button onClick={() => { setOpenOptions(false); onClick?.(); }}>Open</Button>
            <Button variant="secondary" onClick={() => { setOpenOptions(false); onTogglePin?.(); }}>
              {pinned ? "Unpin" : "Pin"}
            </Button>
            <Button variant="destructive" onClick={() => { setOpenOptions(false); onDelete?.(); }}>Delete</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </Card>
  );
};
