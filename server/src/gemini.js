import { GoogleGenAI } from "@google/genai";

export function isGeminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

export const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "missing",
});

export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
