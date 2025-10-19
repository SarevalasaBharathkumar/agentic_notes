import { GoogleGenerativeAI } from "@google/generative-ai";

let genAI: GoogleGenerativeAI | null = null;

export const initializeGemini = (apiKey: string) => {
  if (!apiKey || apiKey === "your-api-key-here") {
    console.error("Invalid API key. Please set VITE_GEMINI_API_KEY in your .env file");
    return;
  }
  try {
    genAI = new GoogleGenerativeAI(apiKey);
    console.log("Gemini initialized successfully");
  } catch (error) {
    console.error("Error initializing Gemini:", error);
  }
};

export const generateTitle = async (content: string): Promise<string> => {
  if (!genAI) throw new Error("Gemini API not initialized. Call initializeGemini(apiKey) first.");
  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      generationConfig: { temperature: 0.5, maxOutputTokens: 10 },
    });
    const prompt = `
Generate a short title in 1-2 words that best represents this note.
Only return the title - no punctuation, quotes, or explanations.
---
${content}
`;
    const result = await model.generateContent(prompt);
    const title = result.response.text().trim();
    return title || "Untitled";
  } catch (error) {
    console.error("Error generating title:", error);
    return "Untitled";
  }
};

export interface NoteLike {
  title: string;
  content: string;
  id?: string;
  tags?: string[];
}

export interface SemanticMatch {
  note: NoteLike;
  similarity: number;
  snippet: string;
}

const stripHtml = (s: string) => s.replace(/<[^>]*>/g, " ");

const generateSnippet = (note: NoteLike, query: string): string => {
  const content = stripHtml(note.content || "");
  const sentences = content.split(/[.!?]+/);
  const qWords = query.toLowerCase().split(/\s+/);
  let best = sentences[0] || "";
  let max = 0;
  for (const s of sentences) {
    const sw = s.toLowerCase().split(/\s+/);
    const matches = qWords.filter((qw) => sw.some((w) => w.includes(qw) || qw.includes(w))).length;
    if (matches > max) {
      max = matches;
      best = s.trim();
    }
  }
  if (!best || best.length < 20) best = content.slice(0, 100).trim();
  return best.length > 120 ? best.slice(0, 120) + "..." : best;
};

// Removed legacy keyword/intent-based retrieval in favor of embeddings-only

// Embeddings-only retrieval using Gemini embeddings API
const GEMINI_EMBED_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents?key=${import.meta.env.VITE_GEMINI_API_KEY}`;

const cosine = (a: number[], b: number[]) => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length && i < b.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
};

// Simple in-memory cache to support dynamic note changes in realtime while avoiding redundant embeds
const queryCache = new Map<string, number[]>();
const noteCache = new Map<string, number[]>();
const MAX_CACHE = 256;
const setCache = (map: Map<string, number[]>, k: string, v: number[]) => { map.set(k, v); if (map.size > MAX_CACHE) { const first = map.keys().next().value; map.delete(first); } };
const checksum = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h.toString(16);
};
const noteKey = (n: NoteLike) => `${n.id || n.title}:${(n.title||'').length}:${(n.content||'').length}:${checksum((n.title||'') + '|' + (n.content||'').slice(0,512))}`;

const embedTexts = async (texts: string[]): Promise<number[][]> => {
  const batchSize = 16;
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const slice = texts.slice(i, i + batchSize).map(t => t.slice(0, 2000));
    // Prefer official SDK when available (more stable than raw REST from browser)
    if (genAI) {
      const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
      try {
        const res = await model.batchEmbedContents({
          requests: slice.map((t) => ({ content: { parts: [{ text: t }] } })),
        } as any);
        if ((res as any)?.embeddings?.length) {
          for (const e of (res as any).embeddings) vectors.push(e.values as number[]);
        } else {
          // Fallback shape; ensure consistent output
          const arr: any[] = (res as any)?.responses || [];
          for (const r of arr) vectors.push((r.embedding?.values || []) as number[]);
        }
        continue;
      } catch (e: any) {
        console.error("Gemini SDK batchEmbedContents failed; falling back to REST:", e?.message || e);
        // fall through to REST
      }
    }

    // REST fallback
    const body = {
      requests: slice.map((t) => ({ content: { parts: [{ text: t }] } })),
    } as any;
    const res = await fetch(GEMINI_EMBED_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error("Gemini embeddings REST error", res.status, txt);
      throw new Error(`Gemini embedding error: ${res.status}`);
    }
    const data = await res.json();
    if (data.embeddings?.length) {
      for (const e of data.embeddings) vectors.push(e.values as number[]);
    } else if (Array.isArray(data.responses)) {
      for (const r of data.responses) vectors.push((r.embedding?.values || []) as number[]);
    } else {
      // Unknown shape; push empty vectors to keep indexing consistent
      for (let k = 0; k < slice.length; k++) vectors.push([]);
    }
  }
  return vectors;
};

export const embeddingNoteRetrieval = async (
  notes: NoteLike[],
  query: string
): Promise<{ matches: SemanticMatch[] }> => {
  // Query vector (cache per exact query string)
  let qv = queryCache.get(query);
  if (!qv) {
    qv = (await embedTexts([query]))[0] || [];
    setCache(queryCache, query, qv);
  }

  // Note vectors with caching per note content signature
  const indicesToEmbed: number[] = [];
  const toEmbedTexts: string[] = [];
  const keys: string[] = notes.map(noteKey);
  const noteVecs: (number[] | null)[] = new Array(notes.length).fill(null);
  for (let i = 0; i < notes.length; i++) {
    const k = keys[i];
    const v = noteCache.get(k);
    if (v) {
      noteVecs[i] = v;
    } else {
      indicesToEmbed.push(i);
      toEmbedTexts.push(`${notes[i].title}\n\n${stripHtml(notes[i].content || "").slice(0, 2000)}`);
    }
  }
  if (toEmbedTexts.length) {
    const newVecs = await embedTexts(toEmbedTexts);
    for (let j = 0; j < indicesToEmbed.length; j++) {
      const idx = indicesToEmbed[j];
      const vec = newVecs[j] || [];
      noteVecs[idx] = vec;
      setCache(noteCache, keys[idx], vec);
    }
  }

  // Initial pass
  let sims = notes.map((n, i) => cosine(qv!, noteVecs[i] || []));
  let pairs: SemanticMatch[] = notes.map((n, i) => ({ note: n, similarity: sims[i] || 0, snippet: generateSnippet(n, query) }));
  pairs.sort((a, b) => b.similarity - a.similarity);

  // If top match is weak, expand the query semantically and take the max similarity
  const TOP_WEAK_SIM = 0.6;
  if ((pairs[0]?.similarity ?? 0) < TOP_WEAK_SIM && genAI) {
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", generationConfig: { temperature: 0.2, maxOutputTokens: 64 } });
      const prompt = `Generate 3 short alternative phrasings or close synonyms for this search query. Return a comma-separated list, no extra text. Query: ${query}`;
      const res = await model.generateContent(prompt);
      const text = (res.response.text() || "").trim();
      const alts = Array.from(new Set(text.split(/[,\n]+/).map(s => s.trim()).filter(Boolean)));
      if (alts.length) {
        // Embed the variants (cache per variant string) and take max over all query vectors
        const need: string[] = [];
        const qvecs: number[][] = [qv!];
        for (const a of alts) {
          const cached = queryCache.get(a);
          if (cached) {
            qvecs.push(cached);
          } else {
            need.push(a);
          }
        }
        if (need.length) {
          const newQ = await embedTexts(need);
          for (let i = 0; i < need.length; i++) {
            const vec = newQ[i] || [];
            setCache(queryCache, need[i], vec);
            qvecs.push(vec);
          }
        }
        // recompute sims as max across variants
        sims = notes.map((_, i) => Math.max(...qvecs.map(v => cosine(v, noteVecs[i] || []))));
        pairs = notes.map((n, i) => ({ note: n, similarity: sims[i] || 0, snippet: generateSnippet(n, query) })).sort((a, b) => b.similarity - a.similarity);
      }
    } catch (e) {
      console.warn("Query expansion failed; continuing with original query", e);
    }
  }

  return { matches: pairs.slice(0, 5) };
};

// Answers strictly from provided notes with optional enhanced context
export const answerQuestionFromNotes = async (
  notes: NoteLike[], 
  question: string,
  options?: { relevantNotesContext?: string }
): Promise<string> => {
  if (!genAI) throw new Error("Gemini API not initialized. Call initializeGemini(apiKey) first.");
  const summarized = notes
    .filter((n) => n.title || n.content)
    .slice(0, 20)
    .map((n, i) => {
      const body = n.content || "";
      const textOnly = /<\w+[\s\S]*>/.test(body) ? stripHtml(body) : body;
      const compact = textOnly.replace(/\s+/g, " ").trim().slice(0, 1200);
      return `Note ${i + 1} | Title: ${n.title || "Untitled"}\nBody: ${compact}`;
    })
    .join("\n\n");

  // If we have specific relevant notes context, use it for a more focused answer
  const enhancedContext = options?.relevantNotesContext || "";

  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: { temperature: 0.2, maxOutputTokens: 512 },
  });

  const prompt = enhancedContext
    ? `You are an assistant named INTA that answers user questions specifically about their notes.

I've found some notes that might be relevant to the user's question. These are the most closely matching notes:

${enhancedContext}

Additional notes for context:\n${summarized || "(no additional notes)"}

User question: ${question}

Instructions:
1. Answer the specific question asked, not a general version of it
2. Focus on information from the notes that directly addresses the question
3. If the matching notes contain the answer, highlight that specific information
4. If no part of the notes answers the question, reply EXACTLY with: \nnotes not available for your question.
5. Do NOT make up information that isn't in the notes
6. Keep your answer concise and targeted to what was actually asked
`
    : `You are an assistant named INTA. Answer using ONLY the provided notes.
If no part of the notes is relevant, reply EXACTLY with: \nnotes not available for your question.

Notes:\n${summarized || "(no notes provided)"}

Question:\n${question}
`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    return text || "notes not available for your question.";
  } catch (e) {
    console.error("Error answering from notes:", e);
    return "notes not available for your question.";
  }
};

// Recommend up to 3 existing notes most relevant to a question (returns 0-based indices)
export const recommendNotesFromContext = async (notes: NoteLike[], question: string): Promise<number[]> => {
  if (!genAI) throw new Error("Gemini API not initialized. Call initializeGemini(apiKey) first.");
  const list = notes
    .map((n, i) => {
      const body = n.content || "";
      const textOnly = /<\w+[\s\S]*>/.test(body) ? stripHtml(body) : body;
      return `Note ${i + 1} - ${n.title || "Untitled"}: ${textOnly.slice(0, 400)}`;
    })
    .join("\n\n");

  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: { temperature: 0.1, maxOutputTokens: 128 },
  });

  const prompt = `Given the user's question and the list of notes, return the indices (1-based) of up to 3 notes that are most relevant. Return only a comma-separated list of indices, no text.

Question: ${question}

Notes:
${list}`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const parts = text
      .replace(/[^0-9,]/g, "")
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n >= 1 && n <= notes.length);
    return Array.from(new Set(parts.map((n) => n - 1))).slice(0, 3);
  } catch (e) {
    console.error("recommendNotesFromContext error:", e);
    return [];
  }
};

// Create a suggested note from a user's question
export const createSuggestedNote = async (question: string): Promise<NoteLike> => {
  if (!genAI) throw new Error("Gemini API not initialized. Call initializeGemini(apiKey) first.");
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: { temperature: 0.7, maxOutputTokens: 800 },
  });
  const prompt = `Create a helpful, comprehensive note based on this request: "${question}"

Guidelines:
- Make it practical and actionable
- Use clear Markdown formatting with headers, bullet points, and checklists
- Include relevant examples or tips when appropriate
- Keep it informative but concise (200-400 words)
- Structure it logically with clear sections
- Focus on the actual topic, not meta-commentary about the note itself
- Don't include redundant title information in the content
- Return only the note content in Markdown format, no title`;

  try {
    const result = await model.generateContent(prompt);
    const content = result.response.text().trim();
    
    // Clean up any redundant title information
    const cleanedContent = content
      .replace(/^#\s*.*$/gm, '') // Remove any standalone title headers
      .replace(/^.*Understanding and Responding to.*$/gm, '') // Remove meta-commentary
      .replace(/^.*This note provides.*$/gm, '') // Remove meta-commentary
      .trim();
    
    const title = await generateTitle(cleanedContent || content).catch(() => "New Note");
    return { title: title || "New Note", content: cleanedContent || content };
  } catch (e) {
    console.error("Error creating suggested note:", e);
    const fallback = `# ${question}\n\n## Overview\n\nThis note covers the topic you asked about.\n\n## Key Points\n\n- Important information\n- Relevant details\n- Action items\n\n## Next Steps\n\n- [ ] Research further\n- [ ] Take action\n- [ ] Follow up`;
    const title = await generateTitle(fallback).catch(() => "New Note");
    return { title, content: fallback };
  }
};

// Regenerate/improve note content (Markdown) from an existing body and optional title
export const regenerateNoteContent = async (content: string, title?: string): Promise<string> => {
  if (!genAI) throw new Error("Gemini API not initialized. Call initializeGemini(apiKey) first.");
  const body = /<\w+[\s\S]*>/.test(content) ? content.replace(/<[^>]*>/g, " ") : content;
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: { temperature: 0.6, maxOutputTokens: 900 },
  });
  const prompt = `Rewrite and improve this note${title ? ` titled "${title}"` : ""}.
Keep structure clear; use concise Markdown; preserve key facts; optionally add a short checklist or tips.
Return only the note body in Markdown.

---
${body}`;

  try {
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (e) {
    console.error("Error regenerating note:", e);
    return content;
  }
};


