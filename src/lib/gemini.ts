import { GoogleGenerativeAI } from "@google/generative-ai";

let genAI: GoogleGenerativeAI | null = null;

export const initializeGemini = (apiKey: string) => {
  if (!apiKey || apiKey === "your-api-key-here") {
    console.error("❌ Invalid API key. Please set a valid VITE_GEMINI_API_KEY in your .env file");
    return;
  }

  try {
    genAI = new GoogleGenerativeAI(apiKey);
    console.log("✅ Gemini initialized successfully");
  } catch (error) {
    console.error("💥 Error initializing Gemini:", error);
  }
};

export const generateTitle = async (content: string): Promise<string> => {
  if (!genAI) {
    throw new Error("Gemini API not initialized. Call initializeGemini(apiKey) first.");
  }

  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash", // Production model
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 10, // small output since we only need 1–2 words
      },
    });

    const prompt = `
      Generate a short title in 1–2 words that best represents this note.
      Only return the title — no punctuation, quotes, or explanations.
      ---
      ${content}
    `;

    const result = await model.generateContent(prompt);
    const title = result.response.text().trim();

    return title || "Untitled";
  } catch (error) {
    console.error("❌ Error generating title:", error);
    return "Untitled";
  }
};

export interface NoteLike {
  title: string;
  content: string;
}

const stripHtml = (s: string) => s.replace(/<[^>]*>/g, " ");

// Answers a user question strictly using the provided notes.
// If the question can't be answered from the notes, returns the exact phrase:
// "notes not available for your question."
export const answerQuestionFromNotes = async (
  notes: NoteLike[],
  question: string
): Promise<string> => {
  if (!genAI) {
    throw new Error("Gemini API not initialized. Call initializeGemini(apiKey) first.");
  }

  // Prepare compact, high-signal notes context to stay within limits
  const summarizedNotes = notes
    .filter(n => (n.title || n.content))
    .slice(0, 20)
    .map((n, i) => {
      const body = (n.content || "");
      const textOnly = /<\w+[\s\S]*>/.test(body) ? stripHtml(body) : body;
      // Keep some structure markers
      const compact = textOnly.replace(/\s+/g, ' ').trim().slice(0, 1200);
      return `Note ${i + 1} | Title: ${n.title || "Untitled"}\nBody: ${compact}`;
    })
    .join("\n\n");

  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 512,
    },
  });

  const prompt = `You are an assistant named INTA. You speak in a warm, concise, human tone.
You must answer strictly using ONLY the provided notes.
If no part of the notes is relevant to the user's question, reply EXACTLY with:
notes not available for your question.

Instructions:
- If any content appears relevant, answer concisely using only those facts.
- Prefer quoting phrasing from the notes where possible.
- May cite relevant note titles in parentheses, e.g., (from: Title).
- Do NOT invent knowledge beyond the notes.
 - Keep answers friendly and natural, like a helpful colleague.

Notes:
${summarizedNotes || "(no notes provided)"}

Question:
${question}

Answer strictly from the notes. Interpret Markdown/HTML features (headings, bullets, checklists, tables, code) when extracting facts. If insufficient, reply with the exact phrase above.`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    return text || "notes not available for your question.";
  } catch (error) {
    console.error("Error answering from notes:", error);
    return "notes not available for your question.";
  }
};

// Recommend up to 3 existing notes most relevant to a question
export const recommendNotesFromContext = async (
  notes: NoteLike[],
  question: string
): Promise<number[]> => {
  if (!genAI) {
    throw new Error("Gemini API not initialized. Call initializeGemini(apiKey) first.");
  }

  const list = notes
    .map((n, i) => {
      const body = (n.content || "");
      const textOnly = /<\w+[\s\S]*>/.test(body) ? stripHtml(body) : body;
      return `Note ${i + 1} - ${n.title || "Untitled"}: ${textOnly.slice(0, 400)}`;
    })
    .join("\n\n");

  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 128,
    },
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
      .map(s => parseInt(s.trim(), 10))
      .filter(n => Number.isFinite(n) && n >= 1 && n <= notes.length);
    // Convert to 0-based indices
    return Array.from(new Set(parts.map(n => n - 1))).slice(0, 3);
  } catch (e) {
    console.error("recommendNotesFromContext error:", e);
    return [];
  }
};

// Create a suggested note from a user's question when no relevant notes exist
export const createSuggestedNote = async (
  question: string
): Promise<NoteLike> => {
  if (!genAI) {
    throw new Error("Gemini API not initialized. Call initializeGemini(apiKey) first.");
  }

  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: {
      temperature: 0.6,
      maxOutputTokens: 700,
    },
  });

  const prompt = `Draft a helpful standalone note the user might want to save, based solely on the following question:
"""
${question}
"""

Constraints:
- Do not pretend you have access to the user's notes.
- Keep content factual, general, and practical.
- Use concise Markdown with a short intro, bullet points, and an optional mini-checklist or tips.
- No title in the body; return only the body content.
- Length target: 150-300 words.
`;

  try {
    const result = await model.generateContent(prompt);
    const content = result.response.text().trim();
    const title = await generateTitle(content);
    return { title: title || "New Note", content };
  } catch (error) {
    console.error("Error creating suggested note:", error);
    const fallback = `Question\n\n${question}\n\nNotes\n- Summary\n- Key points\n- Next steps`;
    const title = await generateTitle(fallback).catch(() => "New Note");
    return { title, content: fallback };
  }
};

// Regenerate/improve note content from an existing note body (HTML or Markdown) and optional title.
export const regenerateNoteContent = async (
  content: string,
  title?: string
): Promise<string> => {
  if (!genAI) {
    throw new Error("Gemini API not initialized. Call initializeGemini(apiKey) first.");
  }

  const body = /<\w+[\s\S]*>/.test(content) ? content.replace(/<[^>]*>/g, ' ') : content;
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: {
      temperature: 0.6,
      maxOutputTokens: 900,
    },
  });
  const prompt = `Rewrite and improve this note$${title ? ` titled "${title}"` : ''}.
Keep structure clear; use concise Markdown; preserve key facts; optionally add a short checklist or tips.
Return only the note body in Markdown.

---
${body}`;

  try {
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (error) {
    console.error('Error regenerating note:', error);
    return content;
  }
};
