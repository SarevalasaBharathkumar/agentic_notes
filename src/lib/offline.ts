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
}

export async function queueDelete(id: string, user_id: string) {
  const db = await getDB()
  const op: PendingOp = { kind: 'delete', noteId: id, user_id, ts: Date.now() }
  await db.add('pending', op)
}

export async function syncPending(user_id?: string) {
  if (!navigator.onLine) return { synced: 0 }
  const db = await getDB()
  const tx = db.transaction('pending', 'readwrite')
  const pending = await tx.store.getAll() as PendingOp[]
  let count = 0
  for (const op of pending.sort((a, b) => (a.ts || 0) - (b.ts || 0))) {
    try {
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
      if (typeof (op as any).id !== 'undefined') await tx.store.delete((op as any).id)
      count++
    } catch {
      // stop early; will retry later
      break
    }
  }
  await tx.done
  return { synced: count }
}

export async function mergeRemoteIntoLocal(remote: NoteLike[]) {
  // Last-write-wins by updated_at
  const db = await getDB()
  const tx = db.transaction('notes', 'readwrite')
  for (const n of remote) await tx.store.put(n)
  await tx.done
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
  clearAllLocal,
  nowISO,
  makeId,
}

