# Agentic Notepad
[Live Link](https://agentic-notes.vercel.app/)

Agentic Notepad is a fast, simple, and intelligent note-taking application designed to help you capture, organize, and explore your ideas with AI assistance. It features a responsive UI, a minimal editor, full offline support, and powerful AI capabilities provided by "INTA" (Intelligent Note Taking Agent).

## Features

-   **AI-Powered Note-Taking**: Create, summarize, and enhance your notes with AI. Generate titles automatically or ask INTA to draft content for you.
-   **Rich Text & Markdown Editor**: A clean, distraction-free editor built with Tiptap that supports rich text formatting, lists, tables, and checklists.
-   **Conversational Chat (INTA)**: Chat with your notes. Ask questions, find information, and get suggestions conversationally.
-   **Intelligent Search**: Find notes not just by keywords, but by meaning, using semantic search powered by text embeddings.
-   **Full Offline Support**: Continue working without an internet connection. Changes are saved locally to IndexedDB and synced automatically when you're back online.
-   **Note Organization**: Pin important notes to the top, and use the "Danger Zone" to securely delete single or all notes.
-   **Secure & Realtime**: Built on Supabase for secure authentication, database storage with Row Level Security, and real-time updates.

## Technology Stack

-   **Frontend**: React, Vite, TypeScript, Tailwind CSS
-   **UI Components**: Shadcn UI, Radix UI, Vaul (Mobile Drawer)
-   **Editor**: Tiptap
-   **Backend**: Supabase (PostgreSQL, Auth, Edge Functions)
-   **AI Model**: Google Gemini (`gemini-2.0-flash`, `text-embedding-004`)
-   **Local Storage**: IndexedDB via `idb` library for offline support.

## Architecture

The application is architected to be a robust, offline-first Progressive Web App (PWA) with a powerful AI backend.

### Frontend Application (`/src`)

The client-side is a single-page application built with React and Vite.

-   **Components (`/src/components`)**: Reusable UI elements, including a rich set of components from Shadcn UI. Key custom components include:
    -   `RichNoteEditor.tsx`: The Tiptap-based editor for creating and editing notes.
    -   `ChatDialog.tsx`: The interface for interacting with INTA, the AI assistant.
    -   `NoteCard.tsx` & `NotesGrid.tsx`: Components for displaying the grid of notes.
    -   `NoteDialog.tsx`: A modal for creating/editing a note with autosave and AI title suggestion logic.
-   **Offline Support (`/src/lib/offline.ts`)**: A dedicated module manages all offline functionality. It uses IndexedDB to store notes and a queue of pending operations (upserts/deletes). When the application goes online, it syncs these pending operations with the Supabase backend.
-   **AI Integration (`/src/lib/gemini.ts`)**: This module contains functions for interacting with the Google Gemini API. It handles title generation, question answering from notes, semantic search via embeddings, and generating suggested note content.
-   **State Management**: Client-side state is managed with React hooks and `tanstack/react-query` for server-state caching.

### Backend (Supabase)

The backend is powered entirely by Supabase.

-   **Database (`/supabase/migrations`)**: The PostgreSQL database schema is defined with tables for `notes`, `note_chunks`, `clusters`, and `chat_messages`.
    -   `notes`: Stores the primary content of each note.
    -   `note_chunks`: Stores text chunks and their corresponding embeddings for semantic search.
    -   `clusters` & `note_clusters`: Designed for automatically grouping related notes (clustering).
    -   **Security**: Row Level Security (RLS) is enabled on all tables to ensure users can only access their own data.
-   **Edge Functions (`/supabase/functions`)**: Serverless Deno functions handle complex backend logic.
    -   `generate-embeddings`: Takes note content, chunks it, and generates embeddings using the Gemini API, storing them in `note_chunks`.
    -   `chat`: Powers the conversational AI. It takes a user query, finds relevant note chunks via semantic search, and uses them as context for the Gemini model to generate a response (RAG).
    -   `generate-clusters`: A function to perform agglomerative clustering on notes based on their embedding similarity to automatically group related content.

## Local Development

To set up and run this project locally, follow these steps:

### Prerequisites
- Node.js (v18 or later)
- An account with [Supabase](https://supabase.com/)
- A Google Gemini API Key from [Google AI Studio](https://aistudio.google.com/app/apikey)

### 1. Clone the Repository

```bash
git clone https://github.com/SarevalasaBharathkumar/agentic_notes.git
cd agentic_notes
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Set Up Environment Variables

Create a `.env` file in the root of the project and add the following environment variables. You can find the Supabase URL and key in your Supabase project's "API" settings.

```env
# Supabase credentials
VITE_SUPABASE_URL="https://your-project-id.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="your-supabase-anon-key"

# Google Gemini API Key
VITE_GEMINI_API_KEY="your-gemini-api-key"
```

### 4. Set up Supabase

1.  Create a new project on Supabase.
2.  In the SQL Editor, copy and run the contents of the migration file at `supabase/migrations/20251010131234_23ddc437-3b7d-4dac-8b6a-a7aa31289cf2.sql` to create the necessary tables and policies.
3.  Deploy the edge functions located in the `/supabase/functions` directory using the Supabase CLI or by copying the code into the Supabase dashboard.

### 5. Run the Application

```bash
npm run dev
```

The application will be available at `http://localhost:8080`.

## Available Scripts

-   `npm run dev`: Starts the development server.
-   `npm run build`: Creates a production-ready build of the application.
-   `npm run lint`: Lints the source code using ESLint.
-   `npm run migrate:notes`: A utility script to migrate notes from plain Markdown to the HTML format used by the Tiptap editor. This can be useful for data migration.
