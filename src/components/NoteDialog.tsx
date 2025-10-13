import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
// Replaced textarea with a rich editor
import { Input } from "@/components/ui/input";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { generateTitle } from "@/lib/gemini";
import React from "react";
// markdown-to-html handled within rich editor for initialization
import { RichNoteEditor } from "@/components/RichNoteEditor";
import { offline } from "@/lib/offline";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Note {
  id: string;
  title: string;
  content: string;
  updated_at: string;
  user_id: string;
}

interface NoteDialogProps {
  note?: Note;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdateNote?: (note: Partial<Note>) => void;
  userId?: string;
}

export const NoteDialog = ({ note, open, onOpenChange, onUpdateNote, userId }: NoteDialogProps) => {
  const [title, setTitle] = useState(note?.title ?? "");
  const [content, setContent] = useState(note?.content ?? "");
  const [originalTitle, setOriginalTitle] = useState(note?.title ?? "");
  const [originalContent, setOriginalContent] = useState(note?.content ?? "");
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  // Textarea removed; rich editor handles formatting interactions

  // Reset form when note changes
  useEffect(() => {
    if (note) {
      setTitle(note.title);
      setContent(note.content);
      setOriginalTitle(note.title ?? "");
      setOriginalContent(note.content ?? "");
    } else {
      setTitle("");
      setContent("");
      setOriginalTitle("");
      setOriginalContent("");
    }
    setHasChanges(false);
  }, [note]);

  // Save note function
  const saveNote = async () => {
    setSaving(true);
    const timestamp = new Date().toISOString();

    // Prepare the update data
    // Auto-generate a title when missing but content exists
    let titleToSave = (title || "").trim();
    const plainContent = (content || "").replace(/<[^>]*>/g, " ").trim();
    try {
      // If there are no changes, do nothing and treat as saved
      const norm = (s: string) => (s || "").replace(/\s+/g, ' ').trim();
      const changed = norm(title) !== norm(originalTitle) || norm(content) !== norm(originalContent);
      if (!changed) {
        setHasChanges(false);
        return true;
      }

      if (!titleToSave && plainContent) {
        // Generate a short title from content
        titleToSave = (await generateTitle(content)).trim() || "Untitled";
        setTitle(titleToSave);
      }
    } catch (e) {
      // Fallback if generation fails
      titleToSave = titleToSave || (plainContent ? "Untitled" : "");
      setTitle(titleToSave);
    }

    const updateData = {
      title: titleToSave,
      content,
      updated_at: timestamp
    };
    try {
      // If empty content/title: do not save. If existing note, delete it.
      const isEmpty = !titleToSave && !content?.replace(/<[^>]*>/g, '').trim();
      if (isEmpty) {
        if (note?.id) {
          if (navigator.onLine) {
            const { error } = await supabase
              .from("notes")
              .delete()
              .eq("id", note.id);
            if (error) throw error;
          } else if (userId) {
            await offline.deleteLocalNote(note.id);
            await offline.queueDelete(note.id, userId);
          }
          onUpdateNote?.(null as any);
        }
        setHasChanges(false);
        return true;
      }

      if (note?.id) {
        // Update existing note
        if (navigator.onLine) {
          const { error } = await supabase
            .from("notes")
            .update(updateData)
            .eq("id", note.id);
          if (error) throw error;
        } else if (userId) {
          const localNote = { id: note.id, user_id: userId, ...updateData } as Note;
          await offline.putLocalNote(localNote as any);
          await offline.queueUpsert(localNote as any);
        }
        // Immediately reflect in UI
        onUpdateNote?.({ id: note.id, ...updateData });
      } else {
        // Create new note
        const authUser = (await supabase.auth.getUser()).data.user;
        const effectiveUserId = userId || authUser?.id;
        if (!effectiveUserId) throw new Error("User not authenticated");

        if (navigator.onLine) {
          const { data, error } = await supabase
            .from("notes")
            .insert({
              ...updateData,
              user_id: effectiveUserId,
            })
            .select()
            .single();
          if (error) throw error;
          if (data && onUpdateNote) onUpdateNote(data);
        } else {
          const id = offline.makeId();
          const localNote = { id, user_id: effectiveUserId, ...updateData } as Note;
          await offline.putLocalNote(localNote as any);
          await offline.queueUpsert(localNote as any);
          onUpdateNote?.(localNote);
        }
      }
      setHasChanges(false);
      return true;
    } catch (error) {
      console.error("Error saving note:", error);
      return false;
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const norm = (s: string) => (s || "").replace(/\s+/g, ' ').trim();
    const changed = norm(title) !== norm(originalTitle) || norm(content) !== norm(originalContent);
    setHasChanges(changed);
  }, [title, content, originalTitle, originalContent]);

  const handleSuggestTitle = async () => {
    if (!content) return;
    setSaving(true);
    try {
      const suggestedTitle = await generateTitle(content);
      setTitle(suggestedTitle);
    } catch (error) {
      console.error("Error generating title:", error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen && hasChanges) {
        setConfirmClose(true);
        return;
      }
      onOpenChange(isOpen);
    }}>
      <DialogContent 
        className="max-w-3xl h-[80vh] flex flex-col p-0"
      >
        <DialogHeader className="p-4 border-b">
          <DialogTitle className="sr-only">
            {note ? "Edit Note" : "Create New Note"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Use this dialog to create or edit your note. Enter a title and content for your note.
          </DialogDescription>
          <div className="flex items-center gap-2">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Note title..."
              className="text-xl font-semibold bg-transparent border-0 p-0 focus-visible:ring-0"
              aria-label="Note title"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={!content || saving}
              onClick={handleSuggestTitle}
              className="flex items-center gap-2"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
              >
                <path d="M15 4V2" />
                <path d="M15 16v-2" />
                <path d="M8 9h2" />
                <path d="M20 9h2" />
                <path d="M17.8 11.8L19 13" />
                <path d="M15 9h0" />
                <path d="M17.8 6.2L19 5" />
                <path d="M12.2 6.2L11 5" />
                <path d="M12.2 11.8L11 13" />
              </svg>
              Suggest
            </Button>
            {/* Removed regenerate option inside notes as requested */}
          </div>
          <div className="text-xs text-muted-foreground">
            {saving ? "Saving..." : hasChanges ? "Unsaved changes" : "All changes saved"}
          </div>
        </DialogHeader>

        <ScrollArea className="flex-1 p-4">
          <RichNoteEditor
            value={content}
            onChange={setContent}
            placeholder="Write your note... (bold, italic, lists, tables, checklists)"
          />
        </ScrollArea>
        <div className="flex items-center justify-end gap-2 p-4 border-t">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            variant="default"
            size="sm"
            disabled={saving}
            onClick={async () => {
              const ok = await saveNote();
              if (ok) onOpenChange(false);
            }}
          >
            Save
          </Button>
        </div>
      </DialogContent>
      {/* Confirm close dialog */}
      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. Would you like to save or discard them?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmClose(false)}>Keep Editing</AlertDialogCancel>
            <AlertDialogAction
              className="bg-muted text-foreground hover:bg-muted/80"
              onClick={() => {
                // Discard
                if (note) {
                  setTitle(note.title);
                  setContent(note.content);
                } else {
                  setTitle("");
                  setContent("");
                }
                setHasChanges(false);
                setConfirmClose(false);
                onOpenChange(false);
              }}
            >
              Discard
            </AlertDialogAction>
            <AlertDialogAction
              onClick={async () => {
                const ok = await saveNote();
                if (ok) {
                  setConfirmClose(false);
                  onOpenChange(false);
                }
              }}
            >
              Save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
};
