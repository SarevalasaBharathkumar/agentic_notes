import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { generateTitle } from "@/lib/gemini";
import React from "react";
import { RichNoteEditor } from "@/components/RichNoteEditor";
import { offline } from "@/lib/offline";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

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
  onUpdateNote?: (note: Partial<Note> | null) => void;
  userId?: string;
}

export const NoteDialog: React.FC<NoteDialogProps> = ({ note, open, onOpenChange, onUpdateNote, userId }) => {
  const [title, setTitle] = useState(note?.title ?? "");
  const [content, setContent] = useState(note?.content ?? "");
  const [originalTitle, setOriginalTitle] = useState(note?.title ?? "");
  const [originalContent, setOriginalContent] = useState(note?.content ?? "");
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [isEditMode, setIsEditMode] = useState(!note);

  // Reset form when note changes
  useEffect(() => {
    if (note) {
      setTitle(note.title ?? "");
      setContent(note.content ?? "");
      setOriginalTitle(note.title ?? "");
      setOriginalContent(note.content ?? "");
      setIsEditMode(false);
    } else {
      setTitle("");
      setContent("");
      setOriginalTitle("");
      setOriginalContent("");
      setIsEditMode(true);
    }
    setHasChanges(false);
  }, [note]);

  // Save note function
  const saveNote = async () => {
    if (saving) return false;
    setSaving(true);

    try {
      const timestamp = new Date().toISOString();
      let titleToSave = (title || "").trim();
      const plainContent = (content || "").replace(/<[^>]*>/g, " ").trim();

      if (!titleToSave && plainContent) {
        if (navigator.onLine) {
          titleToSave = (await generateTitle(content)).trim() || "Untitled";
        } else {
          titleToSave = (plainContent.slice(0, 60) + (plainContent.length > 60 ? "..." : "")).trim() || "Untitled";
        }
        setTitle(titleToSave);
      }

      const updateData = {
        title: titleToSave,
        content,
        updated_at: timestamp
      };

      // If empty content/title: do not save. If existing note, delete it.
      const isEmpty = !titleToSave && !content?.replace(/<[^>]*>/g, "").trim();
      if (isEmpty) {
        if (note?.id) {
          if (navigator.onLine) {
            const { error } = await supabase.from("notes").delete().eq("id", note.id);
            if (error) throw error;
            await offline.deleteLocalNote(note.id);
          } else if (userId) {
            await offline.deleteLocalNote(note.id);
            await offline.queueDelete(note.id, userId);
          }
          onUpdateNote?.(null);
        }
        setHasChanges(false);
        return true;
      }

      if (note?.id) {
        if (navigator.onLine) {
          const { error } = await supabase.from("notes").update(updateData).eq("id", note.id);
          if (error) throw error;
          const localNote = { id: note.id, user_id: note.user_id, ...updateData } as Note;
          await offline.putLocalNote(localNote as any);
          onUpdateNote?.(localNote);
        } else if (userId) {
          const localNote = { id: note.id, user_id: userId, ...updateData } as Note;
          await offline.putLocalNote(localNote as any);
          await offline.queueUpsert(localNote as any);
          onUpdateNote?.(localNote);
        }
      } else {
        let effectiveUserId = userId;
        if (!effectiveUserId) {
          const { data } = await supabase.auth.getUser();
          effectiveUserId = data.user?.id;
        }
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
          if (data) {
            await offline.putLocalNote(data as any);
            onUpdateNote?.(data);
          }
        } else {
          const id = offline.makeId();
          const localNote = { id, user_id: effectiveUserId, ...updateData } as Note;
          await offline.putLocalNote(localNote as any);
          await offline.queueUpsert(localNote as any);
          onUpdateNote?.(localNote);
        }
      }

      setOriginalTitle(titleToSave);
      setOriginalContent(content);
      setHasChanges(false);
      return true;
    } catch (error) {
      console.error("Error saving note:", error);
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Track changes
  useEffect(() => {
    if (!saving) {
      const norm = (s: string) => (s || "").replace(/\s+/g, " ").trim();
      const changed = norm(title) !== norm(originalTitle) || norm(content) !== norm(originalContent);
      setHasChanges(changed);
    }
  }, [title, content, originalTitle, originalContent, saving]);

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
    <>
      <Dialog open={open} onOpenChange={(isOpen) => {
        if (!isOpen && (hasChanges || isEditMode)) {
          setConfirmClose(true);
          return;
        }
        onOpenChange(isOpen);
      }}>
        <DialogContent className="max-w-3xl h-[80vh] flex flex-col p-0">
          <DialogHeader className="p-4 border-b">
            <DialogTitle className="sr-only">
              {note ? "Edit Note" : "Create New Note"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Use this dialog to create or edit your note. Enter a title and content for your note.
            </DialogDescription>
              <div className="flex items-center justify-between gap-2 w-full">
                <div className="flex-grow">
                  {isEditMode ? (
                    <Input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Note title..."
                      className="text-xl font-semibold bg-transparent border-0 p-0 focus-visible:ring-0 text-left w-full cursor-text"
                      aria-label="Note title"
                    />
                  ) : (
                    <div className="text-xl font-semibold text-left select-none">{title || "Untitled Note"}</div>
                  )}
                  <div className="text-xs text-muted-foreground text-left mt-1">
                    {saving ? "Saving..." : hasChanges ? "Unsaved changes" : "All changes saved"}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isEditMode && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!content || saving}
                      onClick={() => handleSuggestTitle()}
                      className="flex items-center gap-2 shrink-0"
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
                  )}
                  {note && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setIsEditMode(!isEditMode)}
                      className="h-8 w-8 shrink-0"
                      aria-label={isEditMode ? "View mode" : "Edit mode"}
                    >
                      {isEditMode ? (
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
                          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      ) : (
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
                          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                          <path d="m15 5 4 4"/>
                        </svg>
                      )}
                    </Button>
                  )}
                </div>
              </div>
          </DialogHeader>

          <ScrollArea className="flex-1 p-4">
            {isEditMode ? (
              <RichNoteEditor
                value={content}
                onChange={setContent}
                placeholder="Write your note... (bold, italic, lists, tables, checklists)"
              />
            ) : (
              <div 
                className="prose prose-sm max-w-none pointer-events-none select-none [&_.task-list]:list-none [&_.task-list]:pl-0 [&_.task-item]:flex [&_.task-item]:items-baseline [&_.task-item]:gap-2 [&_.task-item]:my-1 [&_.task-item_input]:mt-[3px] [&_.task-item_p]:m-0"
                dangerouslySetInnerHTML={{ __html: content }} 
              />
            )}
          </ScrollArea>
          <div className="flex items-center justify-end gap-2 p-4 border-t">
            {isEditMode ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    if (hasChanges) {
                      setConfirmClose(true);
                    } else {
                      setConfirmClose(false);
                      if (note) {
                        setIsEditMode(false);
                      } else {
                        onOpenChange(false);
                      }
                    }
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  onClick={async () => {
                    const ok = await saveNote();
                    if (ok) {
                      if (note) {
                        setIsEditMode(false);
                      } else {
                        onOpenChange(false);
                      }
                    }
                  }}
                >
                  {saving ? "Saving..." : "Save"}
                </Button>
              </>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onOpenChange(false)}
              >
                Close
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

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
                  setTitle(note.title ?? "");
                  setContent(note.content ?? "");
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
    </>
  );
};
