export function parseTags(text) {
  if (!text) return null;

  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (!arrayMatch) return null;

  let parsed;
  try {
    parsed = JSON.parse(arrayMatch[0]);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) return null;

  return parsed
    .filter((t) => typeof t === "string")
    .map((t) =>
      t
        .toLowerCase()
        .replace(/[^\p{L}\p{N}_-]+/gu, " ")
        .trim(),
    )
    .filter((t) => t.length > 0)
    .slice(0, 25);
}
