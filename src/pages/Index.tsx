import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Auth } from "@/components/Auth";
import { MessageSquare, Plus } from "lucide-react";
import { generateTitle } from "@/lib/gemini";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { Layout } from "@/components/Layout";
import { NotesGrid } from "@/components/NotesGrid";
import { Loading } from "@/components/Loading";
import { ChatDialog } from "@/components/ChatDialog";
import { NoteDialog } from "@/components/NoteDialog";
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
  tags?: string[] | null;
}

const Index = () => {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState<Note[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [selectedNote, setSelectedNote] = useState<Note | undefined>();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [noteToDelete, setNoteToDelete] = useState<Note | undefined>();
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [fallbackUserId, setFallbackUserId] = useState<string | undefined>();
  const [online, setOnline] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [pendingCount, setPendingCount] = useState<number>(0);
  // refs for aggressive polling timeouts
  const aggressiveTimeoutsRef = useRef<number[] | null>(null);
  const fetchRemoteAndMergeRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      toast({
        title: "Connected",
        description: "You're back online. Full functionality restored.",
      });
    };
    
    const handleOffline = () => {
      setOnline(false);
      toast({
        title: "Offline Mode",
        description: "Working offline. Some features are limited.",
        variant: "destructive"
      });
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);
  const { toast } = useToast();
  const MIN_FETCH_INTERVAL_MS = 60_000; // 1 minute cooldown for remote fetches
  const FULL_SYNC_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours - perform a full sync at least once per day
  
  // Track if we pushed a history entry for dialogs
  const pushedChatRef = useRef(false);
  const pushedNoteRef = useRef(false);

  const pushQueryParam = (key: string, value: string) => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set(key, value);
      window.history.pushState({ modal: key, value }, "", url.toString());
    } catch {}
  };

  const removeQueryParam = (key: string) => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete(key);
      window.history.replaceState({}, "", url.toString());
    } catch {}
  };

  // Handle browser back/forward to close dialogs instead of leaving app
  useEffect(() => {
    const onPop = () => {
      const sp = new URLSearchParams(window.location.search);
      const chatParam = sp.get("chat");
      const noteParam = sp.get("note");
      if (!chatParam && chatOpen) {
        setChatOpen(false);
        pushedChatRef.current = false;
      }
      if (!noteParam && noteDialogOpen) {
        setNoteDialogOpen(false);
        setSelectedNote(undefined);
        pushedNoteRef.current = false;
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [chatOpen, noteDialogOpen]);
  
  const handleCreateNoteFromChat = async (note: { title: string; content: string }) => {
    if (!session?.user?.id) return;
    try {
      if (navigator.onLine) {
        const { data, error } = await supabase
          .from("notes")
          .insert({
            title: note.title,
            content: note.content,
            user_id: session.user.id,
          })
          .select("*")
          .single();
        if (error) throw error;
        if (data) await offline.putLocalNote(data as any);
        setNotes((prev) => [data as Note, ...prev]);
      } else {
        const local = {
          id: offline.makeId(),
          title: note.title,
          content: note.content,
          user_id: session.user.id,
          updated_at: new Date().toISOString(),
        } as Note;
        await offline.putLocalNote(local as any);
        await offline.queueUpsert(local as any);
        // bump aggressive polling and update pending count
        bumpAggressive();
        try { setPendingCount(await offline.getPendingCount(session.user.id)); } catch {}
        setNotes((prev) => [local, ...prev]);
      }
      toast({ title: "Note saved", description: `Added "${note.title}" from assistant.` });
    } catch (e) {
      console.error("Error creating note from chat:", e);
      toast({ title: "Error", description: "Failed to save note.", variant: "destructive" });
    }
  };

  // Trigger a few short, aggressive fetches after a local change to speed convergence
  const bumpAggressive = () => {
    // clear previous scheduled aggressive fetches
    if (aggressiveTimeoutsRef.current) {
      for (const id of aggressiveTimeoutsRef.current) clearTimeout(id);
    }
    // immediate fetch
    fetchRemoteAndMergeRef.current?.().catch(() => {});
    // schedule two more near-term fetches
    const t1 = window.setTimeout(() => fetchRemoteAndMergeRef.current?.().catch(() => {}), 5000);
    const t2 = window.setTimeout(() => fetchRemoteAndMergeRef.current?.().catch(() => {}), 10000);
    aggressiveTimeoutsRef.current = [t1, t2];
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user?.id) {
        // Remember last signed-in user for offline refresh
        offline.setLastUserId(session.user.id).catch(() => {});
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session?.user?.id) offline.setLastUserId(session.user.id).catch(() => {});
    });

    // One-time offline notice on initial load
    if (!navigator.onLine) {
      toast({ title: "Offline", description: "You are viewing offline." });
    }

    return () => subscription.unsubscribe();
  }, []);

  // Track connectivity for UI + toast on transition to offline
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => {
      setOnline(false);
      toast({ title: "Offline", description: "You are viewing offline." });
    };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // If offline and we don't have a session yet, try to restore last user id
  useEffect(() => {
    if (!session && !navigator.onLine && !fallbackUserId) {
      offline.getLastUserId().then((id) => {
        if (id) setFallbackUserId(id);
      }).catch(() => {});
    }
  }, [session, fallbackUserId]);

  // Fetch notes when session changes (with offline support)
  useEffect(() => {
    const userId = session?.user?.id || fallbackUserId;
    if (userId) {
      const isAuthed = !!session?.user?.id;
      const hydrateFromLocal = async () => {
        const local = await offline.getLocalNotes(userId);
        setNotes(local as any);
        return local as any as Note[];
      };

      const fetchRemoteAndMerge = async () => {
        // Decide between delta fetch and full sync
        try {
          const lastFull = await offline.getLastFullSync(userId);
          const lastFetched = await offline.getLastFetchedAt(userId);
          const now = Date.now();

          const doFull = !lastFull || (now - lastFull) > FULL_SYNC_THRESHOLD_MS || !lastFetched;

          // Helper to filter out any remote notes that we have pending deletes for
          const filterPendingDeletes = async (rows: any[]) => {
            const pendingDeletes = await offline.getPendingDeletes(userId);
            return (rows || []).filter((n: any) => !pendingDeletes.includes(n.id));
          };

          if (doFull) {
            // Full fetch: get entire remote set and reconcile (this allows detecting deletions)
            const { data, error } = await supabase
              .from("notes")
              .select("*")
              .eq("user_id", userId)
              .order("updated_at", { ascending: false });
            if (!error && data) {
              const filtered = await filterPendingDeletes(data as any);
              await offline.mergeRemoteIntoLocal(filtered as any);
              const local = await offline.getLocalNotes(userId);
              setNotes(local as any);
              await offline.setLastFullSync(userId);
              await offline.setLastFetchedAt(userId);
            }
          } else {
            // Delta fetch: get notes updated since lastFetched
            const iso = new Date(lastFetched!).toISOString();
            const { data, error } = await supabase
              .from("notes")
              .select("*")
              .eq("user_id", userId)
              .gt("updated_at", iso)
              .order("updated_at", { ascending: false });
            if (!error && data && (data as any).length > 0) {
              const filtered = await filterPendingDeletes(data as any);
              // For deltas we only upsert changed records; don't remove local notes here
              await offline.putManyLocalNotes(filtered as any);
              const local = await offline.getLocalNotes(userId);
              setNotes(local as any);
              await offline.setLastFetchedAt(userId);
            } else if (error) {
              // Delta failed; fall back to full fetch to be safe
              console.warn('Delta fetch failed, falling back to full sync', error);
              const { data: fullData, error: fullErr } = await supabase
                .from("notes")
                .select("*")
                .eq("user_id", userId)
                .order("updated_at", { ascending: false });
              if (!fullErr && fullData) {
                const filtered = await filterPendingDeletes(fullData as any);
                await offline.mergeRemoteIntoLocal(filtered as any);
                const local = await offline.getLocalNotes(userId);
                setNotes(local as any);
                await offline.setLastFullSync(userId);
                await offline.setLastFetchedAt(userId);
              }
            }
          }

          // After any successful fetch, update UI counters and dirty flag
          try { setPendingCount(await offline.getPendingCount(userId)); } catch {}
          const dirty = await offline.isDirty();
          if (!dirty) {
            await offline.setDirty(false);
          }
          setLastSyncAt(Date.now());
        } catch (e) {
          console.warn('fetchRemoteAndMerge error', e);
        }
      };
      // expose fetchRemoteAndMerge to outer scope for aggressive polling
      fetchRemoteAndMergeRef.current = fetchRemoteAndMerge;

      const shouldFetch = async (localLen: number) => {
        if (!navigator.onLine || !isAuthed) return false;
        // Fetch if nothing locally
        if (localLen === 0) return true;
        // Fetch if there are pending ops for user
        const pendingCount = await offline.getPendingCount(userId);
        if (pendingCount > 0) return true;
        // Fetch if beyond cooldown interval
        const last = await offline.getLastFetchedAt(userId);
        if (!last) return true;
        return Date.now() - last > MIN_FETCH_INTERVAL_MS;
      };

      // Always show whatever we have locally first
      hydrateFromLocal().then(async (local) => {
        try { setPendingCount(await offline.getPendingCount(userId)); } catch {}
        // If authenticated, try to sync + conditionally fetch remote when online
        if (isAuthed && navigator.onLine) {
          const res = await offline.syncPending(userId);
          const needBySync = !!(res?.synced && res.synced > 0);
          const needByPolicy = await shouldFetch(local?.length || 0);
          if (needBySync || needByPolicy) {
            await fetchRemoteAndMerge();
          }
        }
      });

      // When coming back online, sync pending and refresh
      const onOnline = async () => {
        if (isAuthed) {
          const t = toast({ title: "Reconnected", description: "Syncing changes…" });
          try {
            const res = await offline.syncPending(userId);
            // After syncing pending ops, always refresh remote state so we
            // pick up deletes/changes that happened while this client was offline.
            // This ensures devices converge even if they had no local pending ops.
            await fetchRemoteAndMerge();
            if (res?.synced && res.synced > 0) {
              t.update({ id: t.id, title: "Synced", description: `Pushed ${res.synced} change${res.synced === 1 ? '' : 's'} to cloud.` });
            } else {
              t.dismiss();
            }
          } catch (e) {
            t.update({
              id: t.id,
              variant: "destructive",
              title: "Sync failed",
              description: "Will retry automatically. You can retry now.",
              action: (
                <ToastAction altText="Retry" onClick={() => onOnline()}>Retry</ToastAction>
              ),
            } as any);
          }
        }
      };
      window.addEventListener('online', onOnline);
      const onLocalChange = async () => {
        bumpAggressive();
        try { setPendingCount(await offline.getPendingCount(userId)); } catch {}
      };
      window.addEventListener('local-change', onLocalChange as EventListener);

      // Subscribe to realtime changes
      const subscription = isAuthed ? supabase
        .channel(`notes_channel_${userId}`, { config: { broadcast: { self: true } } })
        .on(
          "postgres_changes",
          {
            event: "DELETE",
            schema: "public",
            table: "notes",
            filter: `user_id=eq.${userId}`,
          },
          async (payload) => {
            console.log("[Realtime] DELETE event received for note:", payload.old.id);
            // Use the same sync pattern as INSERT: fetch and merge all remote notes
            // This ensures the deleted note is removed and state is consistent
            await fetchRemoteAndMerge();
            toast({
              title: "Note deleted",
              description: "A note was deleted on another device.",
              duration: 3000,
            });
          }
        )
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notes",
            filter: `user_id=eq.${userId}`,
          },
          async () => {
            console.log("[Realtime] INSERT event received");
            // Refetch and merge
            await fetchRemoteAndMerge();
          }
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "notes",
            filter: `user_id=eq.${userId}`,
          },
          async (payload) => {
            console.log("[Realtime] UPDATE event received for note:", payload.new.id);
            // Update/merge then hydrate from local
            await offline.putLocalNote(payload.new as any);
            const local = await offline.getLocalNotes(userId);
            setNotes(local as any);
          }
        )
        .on("system", {}, (message) => {
          console.log("[Realtime] System message:", message);
        })
        .subscribe((status, err) => {
          console.log("[Realtime] Subscription status:", status, err);
          if (err) {
            console.error("[Realtime] Subscription error:", err);
            toast({
              title: "Realtime sync error",
              description: "Failed to connect for live updates. Will sync manually.",
              variant: "destructive",
              duration: 5000,
            });
          }
        }) : { unsubscribe: () => {} } as any;

      // Fallback polling: if realtime isn't reliably delivering deletes, poll
      // the server periodically to ensure eventual consistency. This is a
      // conservative short-interval poll while the app is active; adjust as needed.
      const POLL_INTERVAL_MS = 15000; // 15s
      let pollId: number | null = null;
      if (isAuthed) {
        pollId = window.setInterval(() => {
          if (navigator.onLine) {
            fetchRemoteAndMerge().catch((e) => console.warn('[Poll] fetchRemoteAndMerge failed', e));
          }
        }, POLL_INTERVAL_MS);
      }

      return () => {
        console.log("[Realtime] Unsubscribing from notes channel");
        subscription.unsubscribe();
        if (pollId) clearInterval(pollId);
        window.removeEventListener('online', onOnline);
        window.removeEventListener('local-change', onLocalChange as EventListener);
      };
    }
  }, [session, fallbackUserId]);

  const handleDeleteNote = async (note: Note) => {
    setNoteToDelete(note);
    setDeleteDialogOpen(true);
  };

  const togglePin = async (note: Note) => {
    const currentTags = note.tags || [];
    const isPinned = currentTags.includes('pinned');
    const nextTags = isPinned ? currentTags.filter(t => t !== 'pinned') : [...currentTags, 'pinned'];

    // Optimistic UI update
    setNotes(curr => curr.map(n => n.id === note.id ? { ...n, tags: nextTags } : n)
      .slice().sort((a, b) => {
        const ap = (a.tags || []).includes('pinned') ? 1 : 0;
        const bp = (b.tags || []).includes('pinned') ? 1 : 0;
        if (ap !== bp) return bp - ap;
        const ta = new Date(a.updated_at || 0).getTime();
        const tb = new Date(b.updated_at || 0).getTime();
        return tb - ta;
      })
    );

    // Persist to Supabase using tags column
    try {
      const { error } = await supabase
        .from("notes")
        .update({ tags: nextTags })
        .eq("id", note.id);
      if (error) throw error;
      await offline.putLocalNote({ ...note, tags: nextTags } as any);
    } catch (e) {
      // Revert on error
      setNotes(curr => curr.map(n => n.id === note.id ? note : n));
    }
  };

  const confirmDelete = async () => {
    if (!noteToDelete) return;
    
    try {
      // If the note is an optimistic temp note, remove locally without hitting Supabase
      if (noteToDelete.id === 'temp') {
        setNotes(currentNotes => currentNotes.filter(note => note.id !== 'temp'));
        toast({ title: "Note removed", description: "Unsaved note draft was discarded." });
        return;
      }

      if (navigator.onLine) {
        // Try to delete on the server first. If server delete fails, fall back to
        // deleting locally and queueing the delete so it will be retried later.
        const { error } = await supabase
          .from("notes")
          .delete()
          .eq("id", noteToDelete.id);
        if (error) {
          // Fallback: remove locally and queue delete for later retry
          await offline.deleteLocalNote(noteToDelete.id);
          if (session?.user?.id) await offline.queueDelete(noteToDelete.id, session.user.id);
          throw error;
        }

        // Server-side delete succeeded. Ensure we don't have pending upserts that
        // could resurrect the note later, then remove from local DB.
        try {
          await offline.removePendingForNote(noteToDelete.id, session?.user?.id);
        } catch (e) {
          // non-fatal
        }
        await offline.deleteLocalNote(noteToDelete.id);
      } else if (session?.user?.id) {
        // Offline path: remove locally and queue delete for later sync
        await offline.deleteLocalNote(noteToDelete.id);
        await offline.queueDelete(noteToDelete.id, session.user.id);
      }
      
      // Immediately update the UI by removing the deleted note
      setNotes(currentNotes => currentNotes.filter(note => note.id !== noteToDelete.id));
      
      toast({
        title: "Note deleted",
        description: "Your note has been permanently deleted.",
      });
    } catch (error) {
      console.error("Error deleting note:", error);
      toast({
        title: "Error",
        description: "Failed to delete note. Please try again.",
        variant: "destructive",
      });
    } finally {
      setDeleteDialogOpen(false);
      setNoteToDelete(undefined);
    }
  };

  const confirmDeleteAll = async () => {
    if (!session?.user?.id) return;
    setDeletingAll(true);
    try {
      const { error } = await supabase
        .from("notes")
        .delete()
        .eq("user_id", session.user.id);
      if (error) throw error;
      await offline.clearAllLocal(session.user.id);
      setNotes([]);
      toast({
        title: "All notes deleted",
        description: "All your notes have been permanently removed.",
      });
    } catch (error) {
      console.error("Error deleting all notes:", error);
      toast({
        title: "Error",
        description: "Failed to delete all notes. Please try again.",
        variant: "destructive",
      });
    } finally {
      setDeletingAll(false);
      setDeleteAllOpen(false);
    }
  };

  const handleSuggestTitle = async (note: Note) => {
    if (!note.content) return;
    
    try {
      const title = await generateTitle(note.content);
      
      // Update local state immediately
      setNotes(currentNotes => 
        currentNotes.map(n => 
          n.id === note.id ? { ...n, title } : n
        )
      );

      const { error } = await supabase
        .from("notes")
        .update({ title })
        .eq("id", note.id);

      if (error) {
        // Revert changes if update fails
        setNotes(currentNotes => 
          currentNotes.map(n => 
            n.id === note.id ? note : n
          )
        );
        throw error;
      }

      // Keep local cache updated when online
      await offline.putLocalNote({ ...note, title } as any);

      toast({
        title: "Title updated",
        description: "AI has suggested a new title for your note.",
      });
    } catch (error) {
      console.error("Error suggesting title:", error);
      toast({
        title: "Error",
        description: "Failed to generate title suggestion. Please try again.",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return <Loading />;
  }

  if (!session && !fallbackUserId) {
    return <Auth />;
  }

  return (
    <Layout>
      <div className="max-w-6xl mx-auto">
        {!online && (
          <div className="text-center text-muted-foreground mb-4">You are viewing offline</div>
        )}
        <NotesGrid 
          notes={notes.map(note => ({
            id: note.id,
            title: note.title || "Untitled Note",
            content: note.content,
            updatedAt: note.updated_at,
            pinned: (note.tags || []).includes('pinned'),
          }))} 
          onNoteClick={(note) => {
            const fullNote = notes.find(n => n.id === note.id);
            if (fullNote) {
              // Push URL state so back button closes dialog
              pushQueryParam("note", fullNote.id);
              pushedNoteRef.current = true;
              setSelectedNote(fullNote);
              setNoteDialogOpen(true);
            }
          }}
          onDeleteNote={(note) => {
            const fullNote = notes.find(n => n.id === note.id);
            if (fullNote) handleDeleteNote(fullNote);
          }}
          onSuggestTitle={(note) => {
            const fullNote = notes.find(n => n.id === note.id);
            if (fullNote) handleSuggestTitle(fullNote);
          }}
          onTogglePin={(note) => {
            const fullNote = notes.find(n => n.id === note.id);
            if (fullNote) togglePin(fullNote);
          }}
        />
        
      </div>
      
      {/* Danger Zone: Delete All Notes */}
      <div className="max-w-6xl mx-auto mt-12">
        <div className="border border-destructive/30 rounded-lg p-4 bg-destructive/5">
          <h3 className="font-semibold text-destructive mb-1">Danger Zone</h3>
          <p className="text-sm text-muted-foreground mb-3">
            Permanently delete all your notes. This action cannot be undone.
          </p>
          <Button
            variant="destructive"
            onClick={() => setDeleteAllOpen(true)}
            disabled={notes.length === 0 || deletingAll}
          >
            {deletingAll ? "Deleting..." : "Delete all my notes"}
          </Button>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete your note. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete All Confirmation Dialog */}
      <AlertDialog open={deleteAllOpen} onOpenChange={setDeleteAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all notes?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all your notes. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingAll}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteAll}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deletingAll}
            >
              {deletingAll ? "Deleting..." : "Delete all"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Floating Action Buttons */}
      <div className="fixed bottom-6 right-6 flex flex-col gap-4 z-50">
        <Button
          className="rounded-full w-12 h-12 shadow-glow bg-gradient-primary p-0"
          onClick={() => {
            // Open a new/blank editor and push a history entry
            // so the mobile back button closes the editor first.
            setSelectedNote(undefined);
            if (!pushedNoteRef.current) {
              pushQueryParam("note", "new");
              pushedNoteRef.current = true;
            }
            setNoteDialogOpen(true);
          }}
        >
          <Plus className="h-6 w-6 text-primary-foreground" />
        </Button>
        <Button
          className={`rounded-full w-12 h-12 p-0 ${!online ? 'bg-gray-400' : 'shadow-glow bg-gradient-primary'}`}
          onClick={() => {
            if (!online) {
              toast({
                title: "Offline Mode",
                description: "Can't use the assistant in offline mode. Please check your internet connection.",
                variant: "destructive"
              });
              return;
            }
            pushQueryParam("chat", "1");
            pushedChatRef.current = true;
            setChatOpen(true);
          }}
        >
          <MessageSquare className={`h-6 w-6 ${!online ? 'text-gray-600' : 'text-primary-foreground'}`} />
        </Button>
      </div>

      <ChatDialog
        open={chatOpen}
        onOpenChange={(isOpen) => {
          if (isOpen) {
            if (!pushedChatRef.current) {
              pushQueryParam("chat", "1");
              pushedChatRef.current = true;
            }
            setChatOpen(true);
          } else {
            setChatOpen(false);
            if (pushedChatRef.current) {
              pushedChatRef.current = false;
              // Pop the history entry
              window.history.back();
            } else {
              removeQueryParam("chat");
            }
          }
        }}
        notes={notes.map(n => ({ id: n.id, title: n.title || "Untitled Note", content: n.content || "" }))}
        onNewNote={handleCreateNoteFromChat}
        onOpenNote={(noteId) => {
          const fullNote = notes.find(n => n.id === noteId);
          if (fullNote) {
            pushQueryParam("note", fullNote.id);
            pushedNoteRef.current = true;
            setSelectedNote(fullNote);
            setNoteDialogOpen(true);
          }
        }}
        
      />

      <NoteDialog
        note={selectedNote}
        open={noteDialogOpen}
        userId={session.user?.id || fallbackUserId}
        onOpenChange={(isOpen) => {
          if (isOpen) {
            if (!pushedNoteRef.current) {
              // For existing notes, use their id; for new notes, mark as "new".
              const value = selectedNote?.id ?? "new";
              pushQueryParam("note", value);
              pushedNoteRef.current = true;
            }
            setNoteDialogOpen(true);
          } else {
            setNoteDialogOpen(false);
            setSelectedNote(undefined);
            if (pushedNoteRef.current) {
              pushedNoteRef.current = false;
              window.history.back();
            } else {
              removeQueryParam("note");
            }
          }
        }}
        onUpdateNote={(updatedNote) => {
          if (!updatedNote) {
            // Note creation failed or was cancelled
            setNotes(currentNotes => currentNotes.filter(n => n.id !== 'temp'));
            return;
          }
          
          setNotes(currentNotes => {
            // If flagged as temp, just prepend
            if (updatedNote.id === 'temp') {
              return [updatedNote as Note, ...currentNotes];
            }
            // Check if it already exists
            const exists = currentNotes.some(n => n.id === updatedNote.id);
            let next = exists
              ? currentNotes.map(note => note.id === updatedNote.id ? { ...note, ...updatedNote } as Note : note)
              : [updatedNote as Note, ...currentNotes];
            // Keep the UI order pinned first, then updated_at desc
            next = next.slice().sort((a, b) => {
              const ap = (a.tags || []).includes('pinned') ? 1 : 0;
              const bp = (b.tags || []).includes('pinned') ? 1 : 0;
              if (ap !== bp) return bp - ap;
              const ta = new Date(a.updated_at || 0).getTime();
              const tb = new Date(b.updated_at || 0).getTime();
              return tb - ta;
            });
            return next;
          });
        }}
      />

      
    </Layout>
  );
};

export default Index;
