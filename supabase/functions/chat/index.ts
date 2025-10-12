import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const baseCorsHeaders = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

function buildCors(req: Request) {
  const origin = req.headers.get('origin') ?? '*';
  const reqHeaders = req.headers.get('access-control-request-headers')
    ?? 'authorization, x-client-info, apikey, content-type';
  return {
    ...baseCorsHeaders,
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': reqHeaders,
  } as Record<string, string>;
}

// Cosine similarity function
function cosineSimilarity(a: number[], b: number[]): number {
  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (magnitudeA * magnitudeB);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    const cors = buildCors(req);
    return new Response(null, { status: 200, headers: cors });
  }

  try {
    const { query, k = 5 } = await req.json();
    const authHeader = req.headers.get('Authorization');
    
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Get user from auth header
    const token = authHeader.replace('Bearer ', '');
    const { data: { user } } = await supabase.auth.getUser(token);
    
    if (!user) {
      throw new Error('Unauthorized');
    }

    console.log(`Processing chat query for user ${user.id}: "${query}"`);

    // Generate embedding for the query
    const embeddingResponse = await fetch('https://ai.gateway.lovable.dev/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: query,
      }),
    });

    if (!embeddingResponse.ok) {
      throw new Error('Failed to generate query embedding');
    }

    const embeddingData = await embeddingResponse.json();
    const queryEmbedding = embeddingData.data[0].embedding;

    // Get all chunks for user's notes
    const { data: userNotes } = await supabase
      .from('notes')
      .select('id')
      .eq('user_id', user.id);

    if (!userNotes || userNotes.length === 0) {
      // No notes, return a message
      return new Response(
        JSON.stringify({ 
          answer: "You don't have any notes yet. Try adding some notes first, and I'll be able to answer questions about them!",
          sources: []
        }),
        { headers: { ...buildCors(req), 'Content-Type': 'application/json' } }
      );
    }

    const noteIds = userNotes.map(n => n.id);

    // Get all chunks for these notes
    const { data: chunks } = await supabase
      .from('note_chunks')
      .select('*, notes!inner(id, title, created_at)')
      .in('note_id', noteIds);

    if (!chunks || chunks.length === 0) {
      return new Response(
        JSON.stringify({ 
          answer: "Your notes don't have embeddings yet. Try editing or re-saving them.",
          sources: []
        }),
        { headers: { ...buildCors(req), 'Content-Type': 'application/json' } }
      );
    }

    // Calculate similarity scores
    const scoredChunks = chunks.map(chunk => {
      const emb = (chunk as any).embedding as number[] | undefined;
      const sim = Array.isArray(emb) && emb.length === queryEmbedding.length
        ? cosineSimilarity(queryEmbedding, emb)
        : 0;
      return { ...chunk, similarity: sim } as any;
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k);

    console.log(`Found ${scoredChunks.length} relevant chunks`);

    // If no relevant chunks found (low similarity)
    if (scoredChunks.length === 0 || scoredChunks[0].similarity < 0.3) {
      return new Response(
        JSON.stringify({ 
          answer: "I couldn't find any relevant notes for your question. Try asking something else or adding more notes.",
          sources: []
        }),
        { headers: { ...buildCors(req), 'Content-Type': 'application/json' } }
      );
    }

    // Prepare context for RAG
    const context = scoredChunks.map((chunk: any, i: number) => {
      const title = chunk?.notes?.title ?? 'Untitled';
      const text = String(chunk?.chunk_text ?? '');
      return `[Source ${i + 1}: "${title}"]\n${text}`;
    }).join('\n\n');

    const sources = scoredChunks.map((chunk: any) => ({
      noteId: chunk?.note_id,
      title: chunk?.notes?.title ?? 'Untitled',
      snippet: String(chunk?.chunk_text ?? '').substring(0, 150) + '...',
      similarity: chunk?.similarity ?? 0,
    }));

    // Generate answer using RAG
    const chatResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: `You are a helpful AI assistant that answers questions based on the user's notes. 
Use the provided context to answer questions accurately. If the context doesn't contain enough information, say so.
Always cite which source(s) you used by mentioning "Source 1", "Source 2", etc.
Be concise but thorough.`
          },
          {
            role: 'user',
            content: `Context from my notes:\n\n${context}\n\nQuestion: ${query}`
          }
        ],
      }),
    });

    if (!chatResponse.ok) {
      const errorText = await chatResponse.text();
      console.error('Chat API error:', chatResponse.status, errorText);
      
      if (chatResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again in a moment.' }),
          { 
            status: 429,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }
      
      throw new Error('Failed to generate response');
    }

    const chatData = await chatResponse.json();
    const answer = chatData.choices[0].message.content;

    console.log('Successfully generated answer');

    return new Response(
      JSON.stringify({ 
        answer,
        sources,
        chunksSearched: chunks.length
      }),
      { headers: { ...buildCors(req), 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in chat function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...buildCors(req), 'Content-Type': 'application/json' } 
      }
    );
  }
});
