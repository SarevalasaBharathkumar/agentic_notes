import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { noteId, chunks } = await req.json();
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

    console.log(`Generating embeddings for note ${noteId}, chunks: ${chunks.length}`);

    // Generate embeddings for each chunk
    const embeddingPromises = chunks.map(async (chunk: { text: string, index: number }) => {
      const response = await fetch('https://ai.gateway.lovable.dev/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${lovableApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'text-embedding-3-small',
          input: chunk.text,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Embedding API error:', response.status, errorText);
        throw new Error(`Failed to generate embedding: ${response.status}`);
      }

      const data = await response.json();
      const embedding = data.data[0].embedding;

      // Store chunk with embedding
      const { error: insertError } = await supabase
        .from('note_chunks')
        .insert({
          note_id: noteId,
          chunk_text: chunk.text,
          chunk_index: chunk.index,
          embedding: embedding,
        });

      if (insertError) {
        console.error('Error inserting chunk:', insertError);
        throw insertError;
      }

      return { success: true, index: chunk.index };
    });

    const results = await Promise.all(embeddingPromises);
    console.log(`Successfully generated ${results.length} embeddings`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        chunksProcessed: results.length 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in generate-embeddings:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});