import "dotenv/config";
import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { r2, R2_BUCKET, isR2Configured } from "./r2.js";
import pool from "./db.js";
import { ai, GEMINI_MODEL, isGeminiConfigured } from "./gemini.js";
import { parseTags } from "./tagParser.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "15mb" }));

const ALLOWED_EXTENSIONS = /\.(jpg|jpeg|png|webp|gif|heic|tiff|raw)$/i;

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "smart-image-archive" });
});

app.post("/api/upload-url", async (req, res) => {
  const { filename, contentType } = req.body || {};

  if (!filename || typeof filename !== "string") {
    return res.status(400).json({ error: "filename is required" });
  }

  const extMatch = filename.match(ALLOWED_EXTENSIONS);
  if (!extMatch) {
    return res.status(400).json({ error: "unsupported file extension" });
  }

  if (!isR2Configured()) {
    return res
      .status(500)
      .json({ error: "R2 is not configured on the server" });
  }

  const objectKey = `uploads/${randomUUID()}${extMatch[0].toLowerCase()}`;

  try {
    const uploadUrl = await getSignedUrl(
      r2,
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: objectKey,
        ContentType: contentType || "application/octet-stream",
      }),
      { expiresIn: 60 },
    );

    res.json({ objectKey, uploadUrl });
  } catch (err) {
    console.error("Presign failed:", err.message);
    res.status(500).json({ error: "failed to generate upload URL" });
  }
});

app.post("/api/images", async (req, res) => {
  const { objectKey, originalFilename } = req.body || {};
  if (
    !objectKey ||
    typeof objectKey !== "string" ||
    !originalFilename ||
    typeof originalFilename !== "string"
  ) {
    return res
      .status(400)
      .json({ error: "objectKey and originalFilename are required" });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO images (object_key, original_filename) VALUES ($1, $2)
       RETURNING id, object_key, original_filename, tags, created_at`,
      [objectKey, originalFilename],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "image already saved" });
    }
    console.error("Save image failed:", err.message);
    res.status(500).json({ error: "failed to save image" });
  }
});

const SEARCH_LIMIT = 100;

function imageUrl(row, publicBase) {
  return publicBase ? `${publicBase}/${row.object_key}` : null;
}

app.get("/api/images", async (req, res) => {
  const view = req.query.view || "all";
  const publicBase = (process.env.R2_PUBLIC_BASE_URL || "").replace(/\/+$/, "");

  let where = "deleted = false";
  if (view === "trash") where = "deleted = true";
  else if (view === "favorites") where = "deleted = false AND favorite = true";

  try {
    const { rows } = await pool.query(
      `SELECT id, object_key, original_filename, tags, favorite, deleted, created_at
       FROM images WHERE ${where}
       ORDER BY created_at DESC LIMIT 200`,
    );
    res.json(rows.map((row) => ({ ...row, url: imageUrl(row, publicBase) })));
  } catch (err) {
    console.error("List images failed:", err.message);
    res.status(500).json({ error: "failed to list images" });
  }
});

app.patch("/api/images/:objectKey", async (req, res) => {
  const { objectKey } = req.params;
  const { tags, favorite, deleted } = req.body || {};

  const sets = [];
  const values = [];
  if (typeof tags === "string") {
    values.push(tags);
    sets.push(`tags = $${values.length}`);
  }
  if (typeof favorite === "boolean") {
    values.push(favorite);
    sets.push(`favorite = $${values.length}`);
  }
  if (typeof deleted === "boolean") {
    values.push(deleted);
    sets.push(`deleted = $${values.length}`);
  }
  if (sets.length === 0) {
    return res.status(400).json({ error: "nothing to update" });
  }

  values.push(objectKey);
  try {
    const { rows } = await pool.query(
      `UPDATE images SET ${sets.join(", ")} WHERE object_key = $${values.length}
       RETURNING id, object_key, original_filename, tags, favorite, deleted, created_at`,
      values,
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "image not found" });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error("Update image failed:", err.message);
    res.status(500).json({ error: "failed to update image" });
  }
});

app.delete("/api/images/:objectKey", async (req, res) => {
  const { objectKey } = req.params;
  try {
    const { rows } = await pool.query(
      `UPDATE images SET deleted = true WHERE object_key = $1 RETURNING id`,
      [objectKey],
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "image not found" });
    }
    res.json({ deleted: true });
  } catch (err) {
    console.error("Delete image failed:", err.message);
    res.status(500).json({ error: "failed to delete image" });
  }
});

function buildTsQuery(raw) {
  const terms = (raw.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(
    (t) => t.length > 1,
  );
  if (terms.length === 0) return null;
  return terms.join(" | ");
}

app.get("/api/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) {
    return res.status(400).json({ error: "q query parameter is required" });
  }

  const tsQuery = buildTsQuery(q);
  if (!tsQuery) {
    return res.json([]);
  }

  const publicBase = (process.env.R2_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  const sort = req.query.sort || "rank";
  const orderBy =
    sort === "newest"
      ? "created_at DESC"
      : sort === "oldest"
        ? "created_at ASC"
        : "rank DESC, created_at DESC";

  try {
    const { rows } = await pool.query(
      `SELECT id, object_key, original_filename, tags, favorite, created_at,
              ts_rank(search_vector, to_tsquery('simple', $1)) AS rank
       FROM images
       WHERE search_vector @@ to_tsquery('simple', $1)
         AND deleted = false
       ORDER BY ${orderBy}
       LIMIT ${SEARCH_LIMIT}`,
      [tsQuery],
    );

    res.json(
      rows.map((row) => ({
        ...row,
        url: publicBase ? `${publicBase}/${row.object_key}` : null,
      })),
    );
  } catch (err) {
    console.error("Search failed:", err.message);
    res.status(500).json({ error: "search failed" });
  }
});

const DEFAULT_TAG_PROMPT = "Give me 5 descriptive keywords for this image.";

app.post("/api/images/tag", async (req, res) => {
  const { objectKey, thumbnail, mimeType, imageUrl, prompt } = req.body || {};

  if (!objectKey || typeof objectKey !== "string") {
    return res.status(400).json({ error: "objectKey is required" });
  }
  if (!isGeminiConfigured()) {
    return res
      .status(500)
      .json({ error: "Gemini is not configured on the server" });
  }

  let data = thumbnail;
  let mime = mimeType || "image/jpeg";

  if (!data && imageUrl) {
    let imageRes;
    try {
      imageRes = await fetch(imageUrl);
    } catch {
      return res.status(400).json({ error: "failed to fetch image reference" });
    }
    if (!imageRes.ok) {
      return res.status(400).json({ error: "failed to fetch image reference" });
    }
    mime = imageRes.headers.get("content-type") || mime;
    data = Buffer.from(await imageRes.arrayBuffer()).toString("base64");
  }

  if (!data || typeof data !== "string") {
    return res.status(400).json({ error: "thumbnail or imageUrl is required" });
  }

  const dataUrlMatch = data.match(/^data:([^;]+);base64,(.*)$/s);
  if (dataUrlMatch) {
    mime = dataUrlMatch[1];
    data = dataUrlMatch[2];
  }

  const userPrompt =
    typeof prompt === "string" && prompt.trim()
      ? prompt.trim()
      : DEFAULT_TAG_PROMPT;

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        { inlineData: { mimeType: mime, data } },
        `${userPrompt}\nRespond ONLY with a JSON array of strings, e.g. ["tag1","tag2"].`,
      ],
    });

    const tags = parseTags(response.text);
    if (!tags) {
      return res
        .status(500)
        .json({ error: "Gemini response was not a tag array" });
    }

    const { rows } = await pool.query(
      `UPDATE images SET tags = $1 WHERE object_key = $2
       RETURNING id, object_key, original_filename, tags, created_at`,
      [tags.join(" "), objectKey],
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "image not found" });
    }

    res.json({ objectKey, tags, image: rows[0] });
  } catch (err) {
    console.error("AI tagging failed:", err.message);
    res.status(500).json({ error: "AI tagging failed" });
  }
});

let server;
if (
  process.argv[1] &&
  import.meta.url === new URL(process.argv[1], "file:").href
) {
  server = app.listen(PORT, () => {
    console.log(`API listening on http://localhost:${PORT}`);
  });
}

export { app, server };
