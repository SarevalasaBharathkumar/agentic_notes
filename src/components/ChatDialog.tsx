import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useState, useRef, useEffect } from "react";
import { MessageSquare, Send, Sparkles, NotebookPen, RefreshCw, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { answerQuestionFromNotes, createSuggestedNote, recommendNotesFromContext, regenerateNoteContent } from "@/lib/gemini";
import { MarkdownRenderer, transformMarkdownToHtml } from "@/components/MarkdownRenderer";

interface Message {
  id: string;
  text: string;
  sender: "user" | "ai";
  isInternetSearch?: boolean;
  internetSearchUrl?: string;
  suggestedNote?: { title: string; content: string };
  recommendedNoteIds?: string[];
}

interface ChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNewNote?: (note: { title: string; content: string }) => void;
  notes?: { id: string; title: string; content: string }[];
  onOpenNote?: (noteId: string) => void;
}

const ASSISTANT_NAME = "INTA";

export const ChatDialog = ({ open, onOpenChange, onNewNote, notes = [], onOpenNote }: ChatDialogProps) => {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      text: `Hi, I'm ${ASSISTANT_NAME}. I can help you search, summarize, and reason over your notes. What would you like to know?`,
      sender: "ai",
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [regen, setRegen] = useState<Record<string, { typing: boolean; preview: string }>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const isNotAvailableAnswer = (text: string) =>
    text.trim().toLowerCase().replace(/\.+$/, "") === "notes not available for your question";

  const isGreeting = (text: string) => {
    const t = text.trim().toLowerCase();
    const simple = [
      "hi", "hello", "hey", "yo", "sup", "hola", "hii", "hiii",
      "good morning", "good afternoon", "good evening",
    ];
    if (simple.includes(t)) return true;
    // very short and no question punctuation
    return t.length <= 6 && !/[?]/.test(t);
  };

  const isSubstantiveQuery = (text: string) => {
    const t = text.trim().toLowerCase();
    if (isGreeting(t)) return false;
    if (t.length < 10 && !/[?]/.test(t)) return false;
    const keywords = ["how", "what", "why", "explain", "summar", "compare", "steps", "guide", "checklist", "table", "plan", "create note", "draft", "write"];
    return keywords.some(k => t.includes(k)) || /[?]/.test(t);
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const toPlainText = (htmlOrMd: string) =>
    /<\w+[\s\S]*>/.test(htmlOrMd)
      ? htmlOrMd.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
      : htmlOrMd;

  const handleSendMessage = async () => {
    if (!input.trim()) return;

    const userMessage: Message = { id: Date.now().toString(), text: input, sender: "user" };
    setMessages((prevMessages) => [...prevMessages, userMessage]);
    setInput("");
    setLoading(true);

    try {
      // Handle simple greetings without invoking AI
      if (isGreeting(userMessage.text)) {
        const aiGreeting: Message = {
          id: Date.now().toString() + "-ai-greet",
          text: `Hi! I'm ${ASSISTANT_NAME}. Ask me anything about your notes, or request a summary, checklist, or table.`,
          sender: "ai",
        };
        setMessages((prev) => [...prev, aiGreeting]);
        setLoading(false);
        return;
      }

      // Build a small relevant subset of notes to improve recognition
      const q = userMessage.text.toLowerCase();
      const keywords = Array.from(new Set(q.split(/[^a-z0-9]+/i).filter(Boolean))).slice(0, 12);
      const scored = notes.map(n => {
        const text = `${n.title} ${toPlainText(n.content)}`.toLowerCase();
        const score = keywords.reduce((acc, w) => acc + (text.includes(w) ? 1 : 0), 0);
        return { note: n, score };
      }).sort((a,b) => b.score - a.score);
      const top = scored.filter(s => s.score > 0).slice(0, 8).map(s => ({ title: s.note.title, content: s.note.content }));

      // Use Gemini chat to answer strictly from user's notes
      const answer = await answerQuestionFromNotes(top.length ? top : notes, userMessage.text);

      // Always show the direct answer first
      const baseResponse: Message = {
        id: Date.now().toString() + "-ai",
        text: answer,
        sender: "ai",
      };

      // If notes are not available for the question, propose a suggested note
      if (isNotAvailableAnswer(answer)) {
        // Try recommending existing notes first
        const indices = await recommendNotesFromContext(notes.map(n => ({ title: n.title, content: n.content })), userMessage.text);

        if (indices.length > 0) {
          const recMsg: Message = {
            id: Date.now().toString() + "-ai-recs",
            text: "I couldn't find an answer directly in your notes. Here are related notes:",
            sender: "ai",
            recommendedNoteIds: indices.map(i => notes[i]?.id).filter(Boolean) as string[],
          };
          setMessages((prev) => [...prev, baseResponse, recMsg]);
          // Also offer creating a draft regardless of query length when no relevant notes
          const suggestion = await createSuggestedNote(userMessage.text);
          const suggestionMsg: Message = {
            id: Date.now().toString() + "-ai-suggest",
            text: "Would you like to save a suggested note based on your question?",
            sender: "ai",
            suggestedNote: suggestion,
          };
          setMessages((prev) => [...prev, suggestionMsg]);
        } else {
          // No recommendations; still propose a draft for user to insert
          const suggestion = await createSuggestedNote(userMessage.text);
          const suggestionMsg: Message = {
            id: Date.now().toString() + "-ai-suggest",
            text: "Would you like to save a suggested note based on your question?",
            sender: "ai",
            suggestedNote: suggestion,
          };
          setMessages((prev) => [...prev, baseResponse, suggestionMsg]);
        }
      } else {
        setMessages((prevMessages) => [...prevMessages, baseResponse]);
      }
    } catch (error) {
      console.error("Error sending message:", error);
      toast({
        title: "Error",
        description: "Failed to get AI response. Please try again.",
        variant: "destructive",
      });
      setMessages((prevMessages) => [
        ...prevMessages,
        { id: Date.now().toString() + "-error", text: "Sorry, I couldn't process that. Please try again.", sender: "ai" },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleMakeNote = (text: string, url?: string) => {
    if (onNewNote) {
      const title = text.split(". ")[0] || "Internet Note";
      const content = url ? `${text}\n\nSource: ${url}` : text;
      onNewNote({ title, content });
      toast({
        title: "Note Created",
        description: "A new note has been created from the internet search result.",
      });
    }
  };

  const handleAcceptSuggestedNote = (note: { title: string; content: string }) => {
    if (onNewNote) {
      // Convert markdown suggestion to HTML so it opens richly in the editor
      const html = transformMarkdownToHtml(note.content || "");
      onNewNote({ title: note.title, content: html });
      toast({ title: "Note Created", description: `Saved: ${note.title}` });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md h-[600px] flex flex-col p-0">
        <DialogHeader className="p-4 border-b">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary" />
            <DialogTitle>{ASSISTANT_NAME}</DialogTitle>
            <Sparkles className="h-4 w-4 text-accent" />
          </div>
          <DialogDescription>
            INTA = Intelligent Note Taking Agent. Ask me anything about your notes.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 p-4">
          <div className="space-y-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.sender === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[70%] rounded-lg p-3 text-sm ${message.sender === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/50"
                  }`}
                >
                  {message.text}
                  {message.recommendedNoteIds && message.recommendedNoteIds.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {message.recommendedNoteIds.map((nid) => {
                        const n = notes.find(nn => nn.id === nid);
                        if (!n) return null;
                        return (
                          <Button key={nid} variant="secondary" size="sm" onClick={() => onOpenNote?.(nid)}>
                            {n.title}
                          </Button>
                        );
                      })}
                    </div>
                  )}
                  {message.suggestedNote && (
                    <div className="mt-3 w-full border rounded-md bg-background text-foreground">
                      <div className="px-3 py-2 border-b font-medium flex items-center gap-2">
                        <NotebookPen className="h-4 w-4 text-primary" />
                        <span>{message.suggestedNote.title}</span>
                      </div>
                      <div className="p-3 w-full prose prose-sm max-w-none whitespace-pre-wrap">
                        {/* When regenerating, hide previous content and show typing area only */}
                        {regen[message.id]?.typing ? (
                          <div className="p-3 rounded-md bg-muted/50 text-sm">
                            <div className="mb-2 flex items-center gap-2 text-muted-foreground">
                              <RefreshCw className="h-4 w-4 animate-spin" /> Regenerating...
                            </div>
                            <div className="whitespace-pre-wrap">
                              {regen[message.id]?.preview}
                              <span className="animate-pulse">▍</span>
                            </div>
                          </div>
                        ) : (
                          <MarkdownRenderer markdown={message.suggestedNote.content} />
                        )}
                      </div>
                      <div className="p-3 pt-0">
                        <div className="grid grid-cols-3 gap-2 w-full">
                          <div className="flex justify-center">
                            <Button
                              variant="default"
                              size="sm"
                              className="gap-2 h-8 px-3"
                              onClick={() => handleAcceptSuggestedNote(message.suggestedNote!)}
                            >
                              <NotebookPen className="h-4 w-4" />
                              Accept
                            </Button>
                          </div>
                          <div className="flex justify-center">
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-8 w-8"
                              aria-label="Regenerate"
                              onClick={async () => {
                              try {
                                // Immediately hide old content and start typing preview
                                setRegen(prev => ({ ...prev, [message.id]: { typing: true, preview: "" } }));
                                setMessages(prev => prev.map(m => (
                                  m.id === message.id
                                    ? { ...m, suggestedNote: { ...m.suggestedNote!, content: "" } }
                                    : m
                                )));
                                // Regenerate content ONLY; keep the same title
                                const newMd = await regenerateNoteContent(message.suggestedNote!.content, message.suggestedNote!.title);
                                // Typewriter effect
                                let i = 0;
                                const step = () => {
                                  i += Math.max(1, Math.floor(newMd.length / 60));
                                  const slice = newMd.slice(0, Math.min(i, newMd.length));
                                  setRegen(prev => ({ ...prev, [message.id]: { typing: true, preview: slice } }));
                                  if (i < newMd.length) {
                                    setTimeout(step, 20);
                                  } else {
                                    setMessages(prev => prev.map(m => (
                                      m.id === message.id
                                        ? { ...m, suggestedNote: { title: m.suggestedNote!.title, content: newMd } }
                                        : m
                                    )));
                                    setRegen(prev => ({ ...prev, [message.id]: { typing: false, preview: "" } }));
                                  }
                                };
                                step();
                              } catch (e) {
                                console.error("Error regenerating suggested note:", e);
                                setRegen(prev => ({ ...prev, [message.id]: { typing: false, preview: "" } }));
                              }
                            }}
                          >
                              <RefreshCw className="h-4 w-4" />
                            </Button>
                          </div>
                          <div className="flex justify-center">
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-8 w-8"
                              aria-label="Reject"
                              onClick={() => {
                                // Remove the suggested note from this message
                                setMessages(prev => prev.map(m => (
                                  m.id === message.id ? { ...m, suggestedNote: undefined } : m
                                )));
                              }}
                            >
                              <XCircle className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  {message.isInternetSearch && message.internetSearchUrl && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      <a
                        href={message.internetSearchUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        Source
                      </a>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-2 h-auto px-2 py-1"
                        onClick={() => handleMakeNote(message.text, message.internetSearchUrl)}
                      >
                        <NotebookPen className="h-3 w-3 mr-1" /> Make Note
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-muted/50 rounded-lg p-3 text-sm animate-pulse">
                  AI is thinking...
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        <div className="border-t p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="flex items-center gap-2"
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your message..."
              className="flex-1"
            />
            <Button type="submit" size="icon">
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
};
