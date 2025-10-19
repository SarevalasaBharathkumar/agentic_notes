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
import { useEffect, useRef, useState } from "react";
import { MessageSquare, Send, Sparkles, NotebookPen, XCircle, RotateCcw, Brain } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { embeddingNoteRetrieval, answerQuestionFromNotes, createSuggestedNote, NoteLike } from "@/lib/gemini";
import { MarkdownRenderer, transformMarkdownToHtml } from "@/components/MarkdownRenderer";

interface Message {
  id: string;
  text: string;
  sender: "user" | "ai";
  suggestedNote?: { title: string; content: string };
  suggestForQuery?: string;
  isTyping?: boolean;
  isThinking?: boolean;
  awaitingSuggestion?: boolean; // Track if we're waiting for suggestion confirmation
}

interface ChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNewNote?: (note: { title: string; content: string }) => void;
  notes?: { id: string; title: string; content: string }[];
  onOpenNote?: (noteId: string) => void;
}

const ASSISTANT_NAME = "INTA";
const GREETING_MESSAGE = "Hi! I'm INTA (Intelligent Note Taking Agent). I can answer questions from your notes, open specific notes, or suggest new ones. What would you like to know?";

// Intent detection functions
const isGreetingIntent = (text: string): boolean => {
  const t = text.trim().toLowerCase();
  return /^(hi|hello|hey|greetings|howdy|hola|what's up|good morning|good afternoon|good evening)\b/.test(t);
};

const isOpenIntent = (text: string): boolean => {
  const t = text.trim().toLowerCase();
  // More precise pattern matching for opening notes
  return (/^(open|show|view|display|go to|find)\s+(my\s+)?(note|notes?)(\s+about|\s+on|\s+for|\s+related\s+to)?/.test(t) ||
         /^(open|show|view|display|go to|find)\s+.{1,30}(\s+(note|notes?))?/.test(t) ||
         // Match any content after open command
         /^(open|show|view|display|find)\s+\w+/.test(t));
};

const isSuggestIntent = (text: string): boolean => {
  const t = text.trim().toLowerCase();
  return /^(suggest|create|make|write|draft|generate)\b.*\b(note|notes)\b/.test(t) ||
         /\b(help me|can you|please)\b.*\b(write|create|make|suggest)\b/.test(t) ||
         /^(suggest)\b/.test(t) ||
         /^(ok|yes|sure)\b/.test(t); // Handle simple confirmations
};

const isQuestionIntent = (text: string): boolean => {
  const t = text.trim().toLowerCase();
  return /\?/.test(t) || 
         /^(what|how|why|when|where|who|which|can|could|would|should|is|are|do|does|did)\b/.test(t) ||
         /\b(rakul|preeth|singh|postal|code|groceries|shopping)\b/.test(t); // Handle names and other queries
};

export const ChatDialog = ({ open, onOpenChange, onNewNote, notes = [], onOpenNote }: ChatDialogProps) => {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    { id: "1", text: GREETING_MESSAGE, sender: "ai" },
  ]);
  const [loading, setLoading] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const [regeneratingMsgId, setRegeneratingMsgId] = useState<string | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Online/Offline detection
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Check offline status when dialog is opened
  useEffect(() => {
    if (open && isOffline) {
      toast({
        title: "Offline Mode",
        description: "Can't use the assistant in offline mode. Please check your internet connection.",
        variant: "destructive"
      });
      onOpenChange(false); // Close the dialog
    }
  }, [open, isOffline, onOpenChange, toast]);

  // Typing animation for AI messages with markdown support
  const typeOutAiMessage = (fullText: string, messageId?: string) => {
    // Process Markdown to ensure formatting is maintained during typing
    // Check if text contains markdown formatting
    const containsMarkdown = /[\*\_\`\#\-\>]/.test(fullText);
    
    const id = messageId || Date.now().toString() + "-ai-type";
    const placeholder: Message = { id, text: "", sender: "ai", isTyping: true };
    
    if (messageId) {
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, text: "", isTyping: true } : m));
    } else {
      setMessages(prev => [...prev, placeholder]);
    }
    
    // For messages with complex markdown, use faster typing to avoid weird rendering
    const speed = containsMarkdown ? 8 : 15;
    
    // Special handling for AI tools mentions
    const aiToolsRegex = /\*\*(gemini|chat\s+gpt|runcraft\s+ai)\*\*/gi;
    const hasAiTools = aiToolsRegex.test(fullText);
    
    // If there's bold/italic/code, we should type faster to avoid broken markdown
    let i = 0;
    const timer = setInterval(() => {
      i++;
      const partial = fullText.slice(0, i);
      setMessages(prev => prev.map(m => 
        m.id === id ? { ...m, text: partial, isTyping: i < fullText.length } : m
      ));
      if (i >= fullText.length) {
        clearInterval(timer);
      }
    }, hasAiTools ? 5 : speed); // Even faster typing for AI tools mentions
  };

  // Thinking indicator
  const showThinking = () => {
    setThinking(true);
    const thinkingMsg: Message = { 
      id: Date.now().toString() + "-thinking", 
      text: "Thinking...", 
      sender: "ai", 
      isThinking: true 
    };
    setMessages(prev => [...prev, thinkingMsg]);
  };

  const hideThinking = () => {
    setThinking(false);
    setMessages(prev => prev.filter(m => !m.isThinking));
  };

    // Find notes using semantic search with embeddings
  const findMatchingNotes = async (query: string): Promise<NoteLike[]> => {
    const noteObjects: NoteLike[] = notes.map(n => ({
      id: n.id,
      title: n.title || "Untitled",
      content: n.content || ""
    }));

    // Use embedding-based search as the primary method
    const searchResults = await embeddingNoteRetrieval(noteObjects, query);
    
    // Filter matches by similarity thresholds
    const directMatches = searchResults.matches
      .filter(m => m.similarity > 0.75) // High confidence matches
      .map(m => m.note);

    if (directMatches.length > 0) {
      return directMatches;
    }

    // Use a lower threshold for related matches
    const relatedMatches = searchResults.matches
      .filter(m => m.similarity > 0.5) // Related matches
      .map(m => m.note);
      
    if (relatedMatches.length > 0) {
      return relatedMatches;
    }

    // For special cases like "shopping list", check title-based matches
    const lowercaseQuery = query.toLowerCase().trim();
    const titleMatches = noteObjects.filter(note => {
      const title = note.title.toLowerCase();
      return title.includes(lowercaseQuery) || lowercaseQuery.includes(title);
    });

    if (titleMatches.length > 0) {
      return titleMatches;
    }

    // Return any matches above minimal threshold as last resort
    return searchResults.matches
      .filter(m => m.similarity > 0.3)
      .map(m => m.note);
  };

  // Helper to immediately open a note and notify the user
  const openNoteDirectly = (note: NoteLike) => {
    onOpenNote?.(note.id!);
    return true;
  };

  // Enhanced note opening with embedding-based search
  const handleOpenNotes = async (query: string) => {
    try {
      // Extract the actual search term from the open command
      let searchTerm = query.trim().toLowerCase();
      // Remove leading open/show/find words and note-related words
      searchTerm = searchTerm
        .replace(/^(open|show|view|display|go to|find)\s+/i, "")
        .replace(/\b(note|notes)\b\s*(about|on|for|related\s+to)?\s*/i, "")
        .trim();
      
      // Find notes using semantic search
      const matchingNotes = await findMatchingNotes(searchTerm);
      
      if (matchingNotes.length === 1) {
        // If we have exactly one high-confidence match, open it directly
        return openNoteDirectly(matchingNotes[0]);
      }
      
      if (matchingNotes.length > 0) {
        // Show list of matches with previews
        const listText = `I found these notes that might be relevant:\n\n${
          matchingNotes.map((note, i) => {
            const preview = note.content ? 
              note.content.replace(/<[^>]*>/g, '').slice(0, 100) + "..." : "";
            return `${i + 1}. **${note.title}**\n   ${preview}`;
          }).join('\n\n')
        }\n\nWhich one would you like to open? You can:\n- Type a number\n- Type part of the title\n- Or ask a different question`;
        
        const listMessage: Message = {
          id: Date.now().toString() + "-note-list",
          text: listText,
          sender: "ai",
          suggestForQuery: JSON.stringify(matchingNotes.map(n => ({ 
            id: n.id, 
            title: n.title,
            preview: n.content?.replace(/<[^>]*>/g, '').slice(0, 100)
          })))
        };
        setMessages(prev => [...prev, listMessage]);
        return;
      }
      
      // If no matches found, suggest creating a new note
      const noMatchMsg = "I couldn't find any notes matching your request. Would you like me to suggest a note about this topic?";
      const suggestionPrompt: Message = {
        id: Date.now().toString() + "-suggestion-prompt",
        text: noMatchMsg,
        sender: "ai",
        awaitingSuggestion: true,
        suggestForQuery: query
      };
      setMessages(prev => [...prev, suggestionPrompt]);
    } catch (error) {
      console.error("Error in handleOpenNotes:", error);
      const errorMsg = "Sorry, I couldn't process your request right now. Please try again.";
      typeOutAiMessage(errorMsg);
    }
  };

  // Handle note selection from list
  const handleNoteSelection = (selection: string, noteList: any[]) => {
    const trimmed = selection.trim().toLowerCase();
    
    // First check if the user is asking a new question
    if (isQuestionIntent(trimmed) || 
        (isOpenIntent(trimmed) && !trimmed.match(/^\d+$/))) {
      return false; // Signal that this should be treated as a new query
    }
    
    // Handle number selections (including variations like "first", "second", etc.)
    const numberWords = {
      first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
      one: 1, two: 2, three: 3, four: 4, five: 5,
      "1st": 1, "2nd": 2, "3rd": 3, "4th": 4, "5th": 5
    };
    
    // Check for numeric or word-based selection
    const numMatch = selection.match(/\b(\d+)\b/);
    const wordMatch = Object.entries(numberWords).find(([word]) => 
      trimmed.includes(word) || trimmed.startsWith(word)
    );
    
    if (numMatch || wordMatch) {
      const num = numMatch ? 
        parseInt(numMatch[1], 10) : 
        wordMatch ? numberWords[wordMatch[0] as keyof typeof numberWords] : 0;
        
      if (num >= 1 && num <= noteList.length) {
        const selectedNote = noteList[num - 1];
        const openMsg = `Opening: ${selectedNote.title}\n\nFeel free to ask me any other questions about your notes!`;
        typeOutAiMessage(openMsg);
        onOpenNote?.(selectedNote.id);
        return true;
      }
    }

    // Check for title match (more flexible)
    const matchingNote = noteList.find(note => {
      const title = note.title.toLowerCase();
      return title.includes(trimmed) || trimmed.includes(title) || 
             title.split(' ').some(word => word.includes(trimmed)) ||
             trimmed.split(' ').some(word => title.includes(word));
    });
    
    if (matchingNote) {
      const openMsg = `Opening: ${matchingNote.title}\n\nFeel free to ask me any other questions about your notes!`;
      typeOutAiMessage(openMsg);
      onOpenNote?.(matchingNote.id);
      return true;
    }

    // No match found, but might be a new question
    if (isQuestionIntent(trimmed) || isOpenIntent(trimmed)) {
      return false; // Signal that this should be treated as a new query
    }

    // Truly no match found
    const retryMsg = "I couldn't match that selection. Please type a number (1-" + noteList.length + ") or part of the title. You can also ask me a different question.";
    typeOutAiMessage(retryMsg);
    return true;
  };

  // Handle note suggestions
  const handleSuggestNote = async (query: string) => {
    try {
      const suggestion = await createSuggestedNote(query);
      const suggestionMsg: Message = {
        id: Date.now().toString() + "-suggestion",
        text: "Here's a suggested note for you:",
        sender: "ai",
        suggestedNote: suggestion,
        suggestForQuery: query,
      };
      setMessages(prev => [...prev, suggestionMsg]);
    } catch (error) {
      console.error("Error creating suggestion:", error);
      const errorMsg = "Sorry, I couldn't create a suggestion right now. Please try again.";
      typeOutAiMessage(errorMsg);
    }
  };

  // Format response text with proper markdown and strip HTML tags
  const formatResponseWithMarkdown = (text: string): string => {
    // First, strip any HTML tags
    let formattedText = text.replace(/<[^>]*>/g, '');
    
    // Make AI tool names bold
    const aiToolNames = ["gemini", "gfp gan", "chat gpt", "chatgpt", "gpt", "gfpgan", "dall-e", "stable diffusion", "midjourney", "ai"];
    
    // Replace AI tool mentions with bold versions
    // Using case-insensitive regex with word boundaries
    aiToolNames.forEach(tool => {
      const escapedTool = tool.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(`\\b${escapedTool}\\b`, 'gi');
      formattedText = formattedText.replace(regex, `**${tool}**`);
    });
    
    return formattedText;
  };
  
  // Handle question answering with enhanced context from matching notes
  const handleAnswerQuestion = async (question: string) => {
    const noteObjects: NoteLike[] = notes.map(n => ({
      id: n.id,
      title: n.title || "Untitled",
      content: n.content || ""
    }));

    try {
      // First find potentially relevant notes to provide context to Gemini
      const relevantNotes = await findMatchingNotes(question);
      console.log(`Found ${relevantNotes.length} potentially relevant notes for the question`);
      
      // If we found matching notes, provide them as context along with the question
      let answer;
      if (relevantNotes.length > 0) {
        // Send only the most relevant notes (max 3) to keep context focused
        const contextNotes = relevantNotes.slice(0, 3);
        
        // Create enhanced question with context
        const contextString = `Context from matching notes:\n${contextNotes.map(note => 
          `Note Title: ${note.title}\nContent: ${note.content}\n---\n`
        ).join('')}`;
        
        console.log("Sending question with enhanced context to Gemini");
        answer = await answerQuestionFromNotes(
          noteObjects, 
          question,
          { relevantNotesContext: contextString }
        );
      } else {
        // No matching notes found, proceed with regular question answering
        answer = await answerQuestionFromNotes(noteObjects, question);
      }
      
      if (answer.toLowerCase().includes("notes not available")) {
        const noAnswerMsg = "I couldn't find relevant information in your notes for this question. Would you like me to suggest a note about this topic?";
        const suggestionPrompt: Message = {
          id: Date.now().toString() + "-suggestion-prompt",
          text: noAnswerMsg,
          sender: "ai",
          awaitingSuggestion: true,
          suggestForQuery: question // Store the original question for context
        };
        setMessages(prev => [...prev, suggestionPrompt]);
        return;
      }

      // Format the answer with proper markdown
      const formattedAnswer = formatResponseWithMarkdown(answer);
      typeOutAiMessage(formattedAnswer);
    } catch (error) {
      console.error("Error answering question:", error);
      const errorMsg = "Sorry, I couldn't process your question right now. Please try again.";
      typeOutAiMessage(errorMsg);
    }
  };

  // Regenerate suggestion
  const handleRegenerateSuggestion = async (messageId: string, query?: string) => {
    if (!query) return;
    
    setRegeneratingMsgId(messageId);
    setMessages(prev => prev.map(m => 
      m.id === messageId ? { ...m, suggestedNote: undefined } : m
    ));

    try {
      const suggestion = await createSuggestedNote(query);
      setMessages(prev => prev.map(m => 
        m.id === messageId ? { ...m, suggestedNote: suggestion } : m
      ));
    } catch (error) {
      console.error("Error regenerating suggestion:", error);
      toast({ 
        title: "Error", 
        description: "Failed to regenerate suggestion. Please try again.", 
        variant: "destructive" 
      });
    } finally {
      setRegeneratingMsgId(null);
    }
  };

  // Accept suggested note
  const handleAcceptSuggestedNote = (note: { title: string; content: string }) => {
    if (onNewNote) {
      const html = transformMarkdownToHtml(note.content || "");
      onNewNote({ title: note.title, content: html });
      toast({ 
        title: "Note Created", 
        description: `Saved: ${note.title}` 
      });
    }
  };

  // Main message handler
  const handleSendMessage = async () => {
    if (!input.trim()) return;
    
    // Check offline status first
    if (isOffline) {
      const offlineMessage: Message = {
        id: Date.now().toString(),
        text: "Please turn on your internet connection to use the chat assistant.",
        sender: "ai"
      };
      setMessages(prev => [
        ...prev,
        { id: Date.now().toString(), text: input.trim(), sender: "user" },
        offlineMessage
      ]);
      setInput("");
      return;
    }
    
    const userMessage: Message = { 
      id: Date.now().toString(), 
      text: input.trim(), 
      sender: "user" 
    };
    setMessages(prev => [...prev, userMessage]);
    
    const query = input.trim();
    console.log("Processing query:", query);
    setInput("");
    setLoading(true);
    showThinking();

    try {
      // Direct suggestion handling when message starts with 'suggest'
      if (query.trim().toLowerCase().startsWith('suggest')) {
        console.log("Detected direct suggestion request");
        await handleSuggestNote(query);
        return;
      }

      // Check if user sent a greeting
      if (isGreetingIntent(query)) {
        console.log("Detected greeting intent");
        typeOutAiMessage("Hello! How can I help you today? I can answer questions about your notes, open specific notes, or suggest new ones.");
        return;
      }
      
      // Check if this is a note selection from a previous list
      const lastMessage = messages[messages.length - 1];
      console.log("Last message:", lastMessage);
      
      if (lastMessage?.suggestForQuery && lastMessage.sender === "ai" && !lastMessage.suggestedNote) {
        try {
          const noteList = JSON.parse(lastMessage.suggestForQuery);
          console.log("Found note list:", noteList);
          if (Array.isArray(noteList) && noteList.length > 0) {
            // Check if this looks like a note selection (number or partial title match)
            const trimmed = query.toLowerCase().trim();
            
            // First check if it's a new question or command
            if (isQuestionIntent(trimmed) || 
                (isOpenIntent(trimmed) && !trimmed.match(/^\d+$/))) {
              console.log("User asked a new question instead of selecting from list");
              // Skip selection logic and continue with normal flow
            } else {
              // Check for number selection
              const numMatch = query.match(/\b(\d+)\b/);
              const isNumberSelection = numMatch && parseInt(numMatch[1], 10) >= 1 && parseInt(numMatch[1], 10) <= noteList.length;
            
            // Check for selection by title, but only if it's a very clear match
            const clearSelectionMatches = noteList.filter(note => {
              const noteTitle = note.title.toLowerCase();
              return noteTitle === trimmed || // Exact match
                     noteTitle.startsWith(trimmed + " ") || // Starts with the term
                     noteTitle.endsWith(" " + trimmed) || // Ends with the term
                     /^\d+$/.test(trimmed); // Is just a number
            });
            
            const isClearTitleMatch = clearSelectionMatches.length === 1;
            
            // Try to handle as a note selection first
            const handled = handleNoteSelection(query, noteList);
            if (handled) {
              return;
            }
            
            // If not handled as a selection, it might be a new query
            if (isOpenIntent(query)) {
              // Extract search term from open command
              let openSearchTerm = query.trim().toLowerCase();
              openSearchTerm = openSearchTerm.replace(/^(open|show|view|display|go to|find)\s+/i, "").trim();
                
                // Check if any note title closely matches the open request
                const directMatch = noteList.find(note => {
                  const title = note.title.toLowerCase();
                  return title.includes(openSearchTerm) || 
                         openSearchTerm.split(/\W+/).some(term => 
                           term.length > 3 && title.includes(term)
                         );
                });
                
                if (directMatch) {
                  return openNoteDirectly({ 
                    id: directMatch.id, 
                    title: directMatch.title, 
                    content: "" 
                  });
                }
              }
              
              // User is asking a new question, not selecting from the list
              console.log("User asked new question instead of selecting from list");
              // Continue with normal flow below
            }
          }
        } catch (e) {
          console.log("Not a note list:", e);
          // Not a note list, continue with normal flow
        }
      }

      // Check if we're awaiting a suggestion confirmation
      if (lastMessage?.awaitingSuggestion && lastMessage.sender === "ai") {
        const trimmed = query.toLowerCase().trim();
        if (trimmed === "ok" || trimmed === "yes" || trimmed === "sure" || trimmed === "y" || trimmed === "yeah") {
          console.log("User confirmed suggestion request");
          await handleSuggestNote(lastMessage.suggestForQuery || query);
          return;
        }
      }

      // Check for explicit suggestion requests
      if (isSuggestIntent(query) || query.toLowerCase().includes('suggest')) {
        console.log("Detected suggestion intent");
        await handleSuggestNote(query);
        return;
      }

      // Determine intent and handle accordingly
      if (isOpenIntent(query)) {
        console.log("Detected open intent");
        await handleOpenNotes(query);
      } else if (isQuestionIntent(query)) {
        console.log("Detected question intent");
        await handleAnswerQuestion(query);
      } else {
        console.log("Default: treating as question");
        // Default: try to answer as question, fallback to suggestion
        await handleAnswerQuestion(query);
      }
    } catch (error) {
      console.error("Error processing message:", error);
      const errorMsg = "Sorry, I encountered an error. Please try again.";
      typeOutAiMessage(errorMsg);
    } finally {
      setLoading(false);
      hideThinking();
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
            Intelligent Note Taking Agent - Answer questions, open notes, or get suggestions
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 p-4">
          <div className="space-y-4">
            {messages.map((message) => (
              <div key={message.id} className={`flex ${message.sender === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`w-full rounded-md p-3 text-sm border ${
                    message.sender === "user"
                      ? "bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-100 border-blue-200 dark:border-blue-900 text-right"
                      : "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-100 border-emerald-200 dark:border-emerald-900 text-left"
                  }`}
                >
                  {message.isThinking ? (
                    <div className="flex items-center gap-2">
                      <Brain className="h-4 w-4 animate-pulse" />
                      <span className="animate-pulse">{message.text}</span>
                    </div>
                  ) : (
                    <>
                      <MarkdownRenderer markdown={message.text} />
                      {message.isTyping && <span className="animate-pulse">|</span>}
                    </>
                  )}
                  
                  {message.suggestedNote && (
                    <div className="mt-3 border rounded-md overflow-hidden bg-white dark:bg-gray-800">
                      <div className="p-3 border-b font-medium bg-gray-50 dark:bg-gray-700">
                        {message.suggestedNote.title}
                      </div>
                      <div className="p-3">
                        <MarkdownRenderer markdown={message.suggestedNote.content} />
                      </div>
                      <div className="p-3 pt-0 flex gap-2 justify-center">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1 h-8 px-3 text-xs"
                          disabled={regeneratingMsgId === message.id}
                          onClick={() => handleRegenerateSuggestion(message.id, message.suggestForQuery)}
                        >
                          <RotateCcw className="h-3 w-3" />
                          Regenerate
                        </Button>
                        <Button
                          variant="default"
                          size="sm"
                          className="gap-1 h-8 px-3 text-xs"
                          onClick={() => handleAcceptSuggestedNote(message.suggestedNote!)}
                        >
                          <NotebookPen className="h-3 w-3" />
                          Insert
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1 h-8 px-3 text-xs"
                          onClick={() => {
                            setMessages(prev => prev.map(m => 
                              m.id === message.id ? { ...m, suggestedNote: undefined } : m
                            ));
                          }}
                        >
                          <XCircle className="h-3 w-3" />
                          Reject
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        <div className="p-4 border-t flex items-center gap-2">
          <Input
            placeholder="Ask about your notes, open a note, or request suggestions..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { 
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            disabled={loading}
          />
          <Button 
            onClick={handleSendMessage} 
            disabled={loading || !input.trim()} 
            className="gap-1"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ChatDialog;
