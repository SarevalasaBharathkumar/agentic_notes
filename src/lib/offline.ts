import { openDB, IDBPDatabase } from 'idb'
import { supabase } from '@/integrations/supabase/client'

export type NoteLike = {
  id: string
  title: string
  content: string
  updated_at: string
  user_id: string
  tags?: string[] | null
  source_url?: string | null
}

type PendingOp =
  | { id?: number; kind: 'upsert'; note: NoteLike; ts: number }
  | { id?: number; kind: 'delete'; noteId: string; user_id: string; ts: number }

let dbPromise: Promise<IDBPDatabase> | null = null
const isOpenIntent = (text: string): boolean => {
  const t = text.trim().toLowerCase();
  // Overly broad conditions
  return /^(open|show|view|display|go to|find|look at|see|check)\b/.test(t) ||
         /\b(open|show|view|display|find|look at|see|check)\b.*\b(note|notes)\b/.test(t) ||
         /\b(notes?)\b.*\b(about|related to|on|for)\b/.test(t) ||
         /\b(chat gpt|gemini|earning|photo|react|groceries|shopping|postal|code)\b/.test(t) ||
         // This condition is especially problematic
         /^open\s+\w+/.test(t);
};
function getDB() {
  if (!dbPromise) {
    dbPromise = openDB('agentic-notes', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('notes')) {
          const s = db.createObjectStore('notes', { keyPath: 'id' })
          s.createIndex('user_id', 'user_id')
          s.createIndex('updated_at', 'updated_at')
        }
        if (!db.objectStoreNames.contains('pending')) {
          db.createObjectStore('pending', { keyPath: 'id', autoIncrement: true })
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta')
        }
      },
    })
  }
  return dbPromise!
}

export async function putLocalNote(note: NoteLike) {
  const db = await getDB()
  await db.put('notes', note)
}

export async function putManyLocalNotes(notes: NoteLike[]) {
  const db = await getDB()
  const tx = db.transaction('notes', 'readwrite')
  for (const n of notes) await tx.store.put(n)
  await tx.done
}

export async function deleteLocalNote(id: string) {
  const db = await getDB()
  await db.delete('notes', id)
}

export async function getLocalNotes(user_id: string): Promise<NoteLike[]> {
  const db = await getDB()
  const idx = db.transaction('notes').store.index('user_id')
  const all = await idx.getAll(IDBKeyRange.only(user_id)) as NoteLike[]
  
  // Always return local data immediately, even if loading or offline
  return all
    .filter(n => n && (n.title?.trim() || (n.content || '').replace(/<[^>]*>/g, ' ').trim()))
    .sort((a, b) => {
      const ap = (a.tags || []).includes('pinned') ? 1 : 0
      const bp = (b.tags || []).includes('pinned') ? 1 : 0
      if (ap !== bp) return bp - ap
      return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
    })
}

export async function queueUpsert(note: NoteLike) {
  const db = await getDB()
  const op: PendingOp = { kind: 'upsert', note, ts: Date.now() }
  await db.add('pending', op)
  // mark local data changed
  await db.put('meta', 1, 'dirty')
}

export async function queueDelete(id: string, user_id: string) {
  const db = await getDB()
  const op: PendingOp = { kind: 'delete', noteId: id, user_id, ts: Date.now() }
  await db.add('pending', op)
  // mark local data changed
  await db.put('meta', 1, 'dirty')
}

export async function syncPending(user_id?: string) {
  if (!navigator.onLine) return { synced: 0 }
  const db = await getDB()
  const tx = db.transaction('pending', 'readwrite')
  const pending = await tx.store.getAll() as PendingOp[]
  const keys = await tx.store.getAllKeys() as (number | string | undefined)[]
  // Pair ops with their keys so we can delete the exact entry after success
  const paired = pending.map((op, i) => ({ op, key: keys[i] }))
  let count = 0
  for (const pair of paired.sort((a, b) => (a.op.ts || 0) - (b.op.ts || 0))) {
    try {
      const op = pair.op
      if (op.kind === 'upsert') {
        if (user_id && op.note.user_id !== user_id) continue
        const { error } = await supabase.from('notes').upsert(op.note)
        if (error) throw error
      } else if (op.kind === 'delete') {
        if (user_id && op.user_id !== user_id) continue
        const { error } = await supabase.from('notes').delete().eq('id', op.noteId)
        if (error) throw error
      }
      // Remove op once succeeded
      if (typeof pair.key !== 'undefined') await tx.store.delete(pair.key as any)
      count++
    } catch {
      // stop early; will retry later
      break
    }
  }
  await tx.done
  // If we synced and no more pending for this user, clear dirty flag
  try {
    if (count > 0) {
      const remaining = (await (await getDB()).getAll('pending')) as PendingOp[]
      const left = user_id ? remaining.filter(op => op.kind === 'upsert' ? op.note.user_id === user_id : op.user_id === user_id) : remaining
      if (left.length === 0) {
        const db2 = await getDB()
        await db2.put('meta', 0, 'dirty')
      }
    }
  } catch {}
  return { synced: count }
}

export async function mergeRemoteIntoLocal(remote: NoteLike[]) {
  // Replace local notes for the user with the remote set (merge semantics):
  // - Upsert all remote notes
  // - Remove any local notes for the same user that are not present remotely
  // This prevents deleted remote notes from being resurrected locally.
  if (!remote || remote.length === 0) {
    return
  }
  const db = await getDB()
  const tx = db.transaction('notes', 'readwrite')
  // Upsert remote notes
  for (const n of remote) await tx.store.put(n)

  // Determine user id from remote payload (assume all belong to same user)
  const userId = (remote[0] && (remote[0] as any).user_id) as string | undefined
  if (userId) {
    try {
      const idx = (tx.objectStore('notes') as any).index('user_id')
      const localKeys = await idx.getAllKeys(IDBKeyRange.only(userId))
      const remoteIds = new Set(remote.map(r => r.id))
      for (const key of localKeys) {
        // key corresponds to note.id because object store keyPath is 'id'
        if (!remoteIds.has(key as string)) {
          await tx.objectStore('notes').delete(key as any)
        }
      }
    } catch (e) {
      // If index access fails for any reason, ignore and keep local notes as-is
      console.warn('mergeRemoteIntoLocal: cleanup failed', e)
    }
  }

  await tx.done
}

// Remove pending operations (upsert/delete) that reference a specific note id.
// Useful after a server-side delete to avoid resurrecting the note from a queued upsert.
export async function removePendingForNote(noteId: string, user_id?: string) {
  const db = await getDB()
  const tx = db.transaction('pending', 'readwrite')
  const ops = await tx.store.getAll() as PendingOp[]
  const keys = await tx.store.getAllKeys() as (number | string | undefined)[]
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]
    const key = keys[i]
    try {
      if (!key) continue
      if (op.kind === 'upsert' && (op.note?.id === noteId)) {
        if (!user_id || op.note.user_id === user_id) await tx.store.delete(key as any)
      } else if (op.kind === 'delete' && (op as any).noteId === noteId) {
        if (!user_id || (op as any).user_id === user_id) await tx.store.delete(key as any)
      }
    } catch {}
  }
  await tx.done
}

// Read pending delete operations (used to avoid resurrecting notes before sync)
export async function getPendingDeletes(user_id?: string): Promise<string[]> {
  const db = await getDB()
  const ops = await db.getAll('pending') as PendingOp[]
  return ops
    .filter(op => op.kind === 'delete' && (!user_id || op.user_id === user_id))
    .map(op => (op as any).noteId)
}

export async function isDirty(): Promise<boolean> {
  const db = await getDB()
  const v = await db.get('meta', 'dirty')
  return v === 1
}

export async function getPendingCount(user_id?: string): Promise<number> {
  const db = await getDB()
  const ops = await db.getAll('pending') as PendingOp[]
  return user_id
    ? ops.filter(op => op.kind === 'upsert' ? op.note.user_id === user_id : op.user_id === user_id).length
    : ops.length
}

export async function setDirty(v: boolean) {
  const db = await getDB()
  await db.put('meta', v ? 1 : 0, 'dirty')
}

// Simple meta helpers (e.g., remember last user)
export async function setMeta(key: string, value: any) {
  const db = await getDB()
  await db.put('meta', value, key)
}

export async function getMeta<T = any>(key: string): Promise<T | undefined> {
  const db = await getDB()
  return (await db.get('meta', key)) as T | undefined
}

export async function setLastUserId(user_id: string) {
  await setMeta('lastUserId', user_id)
}

export async function getLastUserId(): Promise<string | undefined> {
  return getMeta<string>('lastUserId')
}

// Track last successful remote fetch per user to reduce backend reads
export async function setLastFetchedAt(user_id: string, ts: number = Date.now()) {
  const key = `lastFetchedAt:${user_id}`
  await setMeta(key, ts)
}

export async function getLastFetchedAt(user_id: string): Promise<number | undefined> {
  const key = `lastFetchedAt:${user_id}`
  return getMeta<number>(key)
}

export async function setLastFullSync(user_id: string, ts: number = Date.now()) {
  const key = `lastFullSync:${user_id}`
  await setMeta(key, ts)
}

export async function getLastFullSync(user_id: string): Promise<number | undefined> {
  const key = `lastFullSync:${user_id}`
  return getMeta<number>(key)
}

export function nowISO() {
  return new Date().toISOString()
}

export function makeId() {
  return (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36))
}

export async function clearAllLocal(user_id: string) {
  const db = await getDB()
  const tx = db.transaction(['notes', 'pending'], 'readwrite')
  // Remove user notes
  const idx = (tx.objectStore('notes') as any).index('user_id')
  const all = await idx.getAllKeys(IDBKeyRange.only(user_id))
  for (const key of all) await tx.objectStore('notes').delete(key)
  // Also clear pending ops for user
  const p = await tx.objectStore('pending').getAll() as PendingOp[]
  for (const op of p) {
    if (op.kind === 'upsert' && op.note.user_id === user_id) {
      await tx.objectStore('pending').delete((op as any).id)
    } else if (op.kind === 'delete' && op.user_id === user_id) {
      await tx.objectStore('pending').delete((op as any).id)
    }
  }
  await tx.done
}

export const offline = {
  getLocalNotes,
  putLocalNote,
  putManyLocalNotes,
  deleteLocalNote,
  queueUpsert,
  queueDelete,
  syncPending,
  mergeRemoteIntoLocal,
  setLastFullSync,
  getLastFullSync,
  removePendingForNote,
  getPendingDeletes,
  getPendingCount,
  clearAllLocal,
  setMeta,
  getMeta,
  setLastUserId,
  getLastUserId,
  setLastFetchedAt,
  getLastFetchedAt,
  isDirty,
  setDirty,
  nowISO,
  makeId,
}
