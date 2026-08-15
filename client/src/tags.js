// Merge a stored space-separated tag string with an incoming tag list,
// preserving the existing order first, then appending new tags. Duplicates
// are dropped case-insensitively so the result is a clean unique set.
export function mergeTags(existing, incoming) {
  const seen = new Set();
  const merged = [];
  const push = (tag) => {
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) return;
    seen.add(key);
    merged.push(tag);
  };
  for (const tag of String(existing || "")
    .split(" ")
    .filter(Boolean)) {
    push(tag);
  }
  for (const tag of incoming || []) {
    push(String(tag).trim());
  }
  return merged;
}
