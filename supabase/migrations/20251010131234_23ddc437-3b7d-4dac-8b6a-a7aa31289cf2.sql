-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create notes table
CREATE TABLE public.notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  source_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create note_chunks table for semantic search
CREATE TABLE public.note_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id UUID NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  chunk_text TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  embedding JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create clusters table
CREATE TABLE public.clusters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  description TEXT,
  confidence_score FLOAT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create note_clusters junction table
CREATE TABLE public.note_clusters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id UUID NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  cluster_id UUID NOT NULL REFERENCES public.clusters(id) ON DELETE CASCADE,
  similarity_score FLOAT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(note_id, cluster_id)
);

-- Create chat_messages table
CREATE TABLE public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create indexes for better performance
CREATE INDEX idx_notes_user_id ON public.notes(user_id);
CREATE INDEX idx_notes_created_at ON public.notes(created_at DESC);
CREATE INDEX idx_note_chunks_note_id ON public.note_chunks(note_id);
CREATE INDEX idx_clusters_user_id ON public.clusters(user_id);
CREATE INDEX idx_note_clusters_note_id ON public.note_clusters(note_id);
CREATE INDEX idx_note_clusters_cluster_id ON public.note_clusters(cluster_id);
CREATE INDEX idx_chat_messages_user_id ON public.chat_messages(user_id);
CREATE INDEX idx_chat_messages_created_at ON public.chat_messages(created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.note_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.note_clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies for notes
CREATE POLICY "Users can view their own notes"
  ON public.notes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own notes"
  ON public.notes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own notes"
  ON public.notes FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own notes"
  ON public.notes FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for note_chunks
CREATE POLICY "Users can view chunks of their notes"
  ON public.note_chunks FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.notes
    WHERE notes.id = note_chunks.note_id
    AND notes.user_id = auth.uid()
  ));

CREATE POLICY "Users can create chunks for their notes"
  ON public.note_chunks FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.notes
    WHERE notes.id = note_chunks.note_id
    AND notes.user_id = auth.uid()
  ));

CREATE POLICY "Users can delete chunks of their notes"
  ON public.note_chunks FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.notes
    WHERE notes.id = note_chunks.note_id
    AND notes.user_id = auth.uid()
  ));

-- RLS Policies for clusters
CREATE POLICY "Users can view their own clusters"
  ON public.clusters FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own clusters"
  ON public.clusters FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own clusters"
  ON public.clusters FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own clusters"
  ON public.clusters FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for note_clusters
CREATE POLICY "Users can view note-cluster associations"
  ON public.note_clusters FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.notes
    WHERE notes.id = note_clusters.note_id
    AND notes.user_id = auth.uid()
  ));

CREATE POLICY "Users can create note-cluster associations"
  ON public.note_clusters FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.notes
    WHERE notes.id = note_clusters.note_id
    AND notes.user_id = auth.uid()
  ));

CREATE POLICY "Users can delete note-cluster associations"
  ON public.note_clusters FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.notes
    WHERE notes.id = note_clusters.note_id
    AND notes.user_id = auth.uid()
  ));

-- RLS Policies for chat_messages
CREATE POLICY "Users can view their own chat messages"
  ON public.chat_messages FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own chat messages"
  ON public.chat_messages FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own chat messages"
  ON public.chat_messages FOR DELETE
  USING (auth.uid() = user_id);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER update_notes_updated_at
  BEFORE UPDATE ON public.notes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_clusters_updated_at
  BEFORE UPDATE ON public.clusters
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();