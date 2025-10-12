import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function cosineSimilarity(a: number[], b: number[]): number {
  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (magnitudeA * magnitudeB);
}

// Simple agglomerative clustering
function clusterNotes(notes: any[], threshold: number = 0.6) {
  if (notes.length === 0) return [];
  if (notes.length === 1) return [[notes[0]]];

  const clusters: any[][] = notes.map(note => [note]);
  
  while (true) {
    let maxSimilarity = -1;
    let mergeIndices = [-1, -1];

    // Find most similar clusters
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        // Calculate average similarity between clusters
        let totalSim = 0;
        let count = 0;
        
        for (const note1 of clusters[i]) {
          for (const note2 of clusters[j]) {
            totalSim += cosineSimilarity(
              note1.avgEmbedding,
              note2.avgEmbedding
            );
            count++;
          }
        }
        
        const avgSim = totalSim / count;
        if (avgSim > maxSimilarity) {
          maxSimilarity = avgSim;
          mergeIndices = [i, j];
        }
      }
    }

    // Stop if no similar clusters found
    if (maxSimilarity < threshold) break;

    // Merge the two most similar clusters
    const [i, j] = mergeIndices;
    clusters[i] = [...clusters[i], ...clusters[j]];
    clusters.splice(j, 1);

    // Stop if only one cluster remains
    if (clusters.length === 1) break;
  }

  return clusters.filter(cluster => cluster.length > 0);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const token = authHeader.replace('Bearer ', '');
    const { data: { user } } = await supabase.auth.getUser(token);
    
    if (!user) {
      throw new Error('Unauthorized');
    }

    console.log(`Generating clusters for user ${user.id}`);

    // Get all notes with their chunks
    const { data: notes } = await supabase
      .from('notes')
      .select('*, note_chunks(*)')
      .eq('user_id', user.id);

    if (!notes || notes.length < 2) {
      return new Response(
        JSON.stringify({ 
          message: 'Need at least 2 notes to create clusters',
          clusters: []
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Calculate average embedding for each note
    const notesWithEmbeddings = notes
      .filter(note => note.note_chunks && note.note_chunks.length > 0)
      .map(note => {
        const embeddings = note.note_chunks.map((chunk: any) => chunk.embedding as number[]);
        const avgEmbedding = embeddings[0].map((_: number, i: number) => 
          embeddings.reduce((sum: number, emb: number[]) => sum + emb[i], 0) / embeddings.length
        );
        return {
          ...note,
          avgEmbedding
        };
      });

    if (notesWithEmbeddings.length < 2) {
      return new Response(
        JSON.stringify({ 
          message: 'Not enough notes with embeddings',
          clusters: []
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Clustering ${notesWithEmbeddings.length} notes`);

    // Perform clustering
    const clusters = clusterNotes(notesWithEmbeddings, 0.6);

    console.log(`Created ${clusters.length} clusters`);

    // Generate labels for each cluster using AI
    const clusterPromises = clusters.map(async (cluster, index) => {
      const noteTitles = cluster.map(n => n.title).join(', ');
      const noteContents = cluster.map(n => n.content.substring(0, 200)).join('\n\n');

      const labelResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
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
              content: 'You are an AI that generates concise, descriptive labels for groups of notes. Respond with only the label, nothing else. Max 5 words.'
            },
            {
              role: 'user',
              content: `Generate a label for these related notes:\n\nTitles: ${noteTitles}\n\nContent preview:\n${noteContents}`
            }
          ],
        }),
      });

      if (!labelResponse.ok) {
        console.error('Failed to generate label for cluster', index);
        return null;
      }

      const labelData = await labelResponse.json();
      const label = labelData.choices[0].message.content.trim();

      // Calculate confidence score (average similarity within cluster)
      let totalSim = 0;
      let count = 0;
      for (let i = 0; i < cluster.length; i++) {
        for (let j = i + 1; j < cluster.length; j++) {
          totalSim += cosineSimilarity(
            cluster[i].avgEmbedding,
            cluster[j].avgEmbedding
          );
          count++;
        }
      }
      const confidence = count > 0 ? totalSim / count : 1.0;

      // Insert cluster into database
      const { data: newCluster, error: clusterError } = await supabase
        .from('clusters')
        .insert({
          user_id: user.id,
          label,
          confidence_score: confidence,
          description: `Auto-generated cluster containing ${cluster.length} notes`
        })
        .select()
        .single();

      if (clusterError) {
        console.error('Error creating cluster:', clusterError);
        return null;
      }

      // Link notes to cluster
      const noteClusterInserts = cluster.map(note => ({
        note_id: note.id,
        cluster_id: newCluster.id,
        similarity_score: confidence
      }));

      await supabase.from('note_clusters').insert(noteClusterInserts);

      return {
        ...newCluster,
        noteCount: cluster.length,
        noteIds: cluster.map(n => n.id)
      };
    });

    const createdClusters = (await Promise.all(clusterPromises)).filter(c => c !== null);

    console.log(`Successfully created ${createdClusters.length} clusters`);

    return new Response(
      JSON.stringify({ 
        success: true,
        clusters: createdClusters
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in generate-clusters:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});