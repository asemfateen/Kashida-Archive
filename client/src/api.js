function getToken() {
  try {
    return localStorage.getItem("kashida_token");
  } catch {
    return null;
  }
}

function authHeaders(extra = {}) {
  const headers = { ...extra };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function errMessage(res, fallback) {
  try {
    const data = await res.clone().json();
    return data?.error || fallback;
  } catch {
    return `${fallback} (HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""})`;
  }
}

// If the server responds 401 (expired/invalid token), clear local state and
// redirect to login. Uses the module-level callback wired by auth.jsx to
// avoid a circular import.
let _notify401 = null;
try {
  // Dynamic import is not needed — auth.jsx sets this before any API call.
  import("./auth.jsx").then((m) => {
    _notify401 = m.notifyUnauthorized;
  });
} catch { /* ignore */ }

function handle401() {
  try {
    localStorage.removeItem("kashida_token");
  } catch { /* ignore */ }
  if (_notify401) _notify401();
}

// Wrapper around fetch that attaches auth headers and handles 401.
async function apiFetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: authHeaders(opts.headers),
  });
  if (res.status === 401) {
    handle401();
    throw new Error("session expired — please log in again");
  }
  return res;
}

// Timeout-aware fetch. On expiry the request rejects with a real Error
// ("Request timed out after ...") so callers can distinguish a hang from a
// user-initiated AbortError. An external signal is still honored alongside
// the timer via AbortSignal.any.
export function http(url, opts = {}, timeoutMs = 15_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    ctrl.abort(new Error(`Request timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  const signal = opts.signal
    ? AbortSignal.any([opts.signal, ctrl.signal])
    : ctrl.signal;
  return fetch(url, { ...opts, signal })
    .then((res) => {
      if (res.status === 401) {
        handle401();
        throw new Error("session expired — please log in again");
      }
      return res;
    })
    .finally(() => clearTimeout(timer));
}

export async function getUploadUrl(filename, contentType) {
  const res = await apiFetch("/api/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, contentType }),
  });
  if (!res.ok)
    throw new Error((await res.json()).error || "failed to get upload URL");
  return res.json();
}

export async function uploadFile(file) {
  const { objectKey, uploadUrl } = await getUploadUrl(
    file.name,
    file.type || "application/octet-stream",
  );
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!res.ok)
    throw new Error(
      `R2 upload failed (HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""})`,
    );
  await saveImage(objectKey, file.name);
  return { objectKey };
}

export async function saveImage(objectKey, originalFilename) {
  const res = await apiFetch("/api/images", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ objectKey, originalFilename }),
  });
  if (!res.ok) throw new Error(await errMessage(res, "failed to save image"));
  return res.json();
}
export async function searchImages(q, sort) {
  // Accept a prebuilt URLSearchParams (carrying q + facets) or a plain q.
  const params = q instanceof URLSearchParams ? q : new URLSearchParams({ q });
  if (typeof q === "string" && sort) params.set("sort", sort);
  const res = await apiFetch(`/api/search?${params}`);
  if (!res.ok) throw new Error(await errMessage(res, "search failed"));
  return res.json();
}

// Facet matrix for the current query context. Accepts the same params as
// searchImages (q, tag[], type, dateFrom, dateTo) so counts always match the
// result set — no dead-ends.
export async function getFacets(params) {
  const p = params instanceof URLSearchParams ? params : new URLSearchParams();
  const res = await apiFetch(`/api/facets?${p}`);
  if (!res.ok) throw new Error(await errMessage(res, "failed to load facets"));
  return res.json();
}

// Tag prefix suggestions for keyword disambiguation ({tag, n}[]).
export async function suggestTags(q) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  const res = await apiFetch(`/api/tags/suggest?${params}`);
  if (!res.ok)
    throw new Error(await errMessage(res, "failed to load suggestions"));
  return res.json();
}

// Exact per-tag counts across the live library ({tag, n}[]).
export async function countTags(tags) {
  const params = new URLSearchParams();
  for (const tag of tags) params.append("tag", tag);
  const res = await apiFetch(`/api/tags/count?${params}`);
  if (!res.ok)
    throw new Error(await errMessage(res, "failed to load tag counts"));
  return res.json();
}

export async function listImages(view) {
  const params = view ? `?view=${view}` : "";
  const res = await apiFetch(`/api/images${params}`);
  if (!res.ok) throw new Error(await errMessage(res, "failed to load images"));
  return res.json();
}

export async function getImage(objectKey) {
  const res = await apiFetch(`/api/images/${encodeURIComponent(objectKey)}`);
  if (!res.ok) throw new Error(await errMessage(res, "failed to load image"));
  return res.json();
}

export async function updateImage(objectKey, patch) {
  const res = await http(`/api/images/${encodeURIComponent(objectKey)}`, {
    method: "PATCH",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await errMessage(res, "failed to update image"));
  return res.json();
}

export async function deleteImage(objectKey, permanent) {
  const params = permanent ? "?permanent=true" : "";
  const res = await apiFetch(
    `/api/images/${encodeURIComponent(objectKey)}${params}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(await errMessage(res, "failed to delete image"));
  return res.json();
}

export async function emptyTrash() {
  const res = await apiFetch("/api/trash", { method: "DELETE" });
  if (!res.ok) throw new Error(await errMessage(res, "failed to empty trash"));
  return res.json();
}
export async function batchUpdate(objectKeys, patch) {
  const res = await apiFetch("/api/images/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ objectKeys, patch }),
  });
  if (!res.ok)
    throw new Error(await errMessage(res, "failed to update images"));
  return res.json();
}

export async function batchDelete(objectKeys) {
  const res = await apiFetch("/api/images/batch-delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ objectKeys }),
  });
  if (!res.ok)
    throw new Error(await errMessage(res, "failed to delete images"));
  return res.json();
}

// Merge tags server-side across a key set in one transaction — a single
// request replaces N per-image PATCH round trips.
export async function batchTag(objectKeys, tags, signal) {
  const res = await http(
    "/api/images/batch-tag",
    {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ objectKeys, tags }),
      signal,
    },
    30_000,
  );
  if (!res.ok) throw new Error(await errMessage(res, "failed to tag images"));
  return res.json();
}

export async function tagImage(payload) {
  const res = await apiFetch("/api/images/tag", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await errMessage(res, "AI tagging failed"));
  return res.json();
}

// ---------------------------------------------------------------------------
// AI control plane (/api/ai/*) — queue, status and config
// ---------------------------------------------------------------------------

export async function getAiStatus() {
  const res = await apiFetch("/api/ai/status");
  if (!res.ok)
    throw new Error(await errMessage(res, "failed to load AI status"));
  return res.json();
}

export async function listAiJobs({ status, limit = 200 } = {}) {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  params.set("limit", String(limit));
  const res = await apiFetch(`/api/ai/jobs?${params}`);
  if (!res.ok)
    throw new Error(await errMessage(res, "failed to load AI queue"));
  return res.json();
}

export async function enqueueAiJobs(objectKeys, prompt) {
  const res = await apiFetch("/api/ai/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ objectKeys, prompt }),
  });
  if (!res.ok)
    throw new Error(await errMessage(res, "failed to queue AI tagging"));
  return res.json();
}

export async function patchAiJob(jobId, patch) {
  const res = await apiFetch(`/api/ai/jobs/${encodeURIComponent(jobId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await errMessage(res, "failed to update job"));
  return res.json();
}

export async function retryAiJob(jobId) {
  const res = await apiFetch(`/api/ai/jobs/${encodeURIComponent(jobId)}/retry`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(await errMessage(res, "failed to retry job"));
  return res.json();
}

export async function retryAllFailedAiJobs() {
  const res = await apiFetch("/api/ai/jobs/retry-failed", {
    method: "POST",
  });
  if (!res.ok)
    throw new Error(await errMessage(res, "failed to retry failed jobs"));
  return res.json();
}

export async function cancelAllAiJobs() {
  const res = await apiFetch("/api/ai/jobs/cancel-all", {
    method: "POST",
  });
  if (!res.ok) throw new Error(await errMessage(res, "failed to cancel jobs"));
  return res.json();
}

export async function clearDoneAiJobs() {
  const res = await apiFetch("/api/ai/jobs/clear-done", {
    method: "DELETE",
  });
  if (!res.ok)
    throw new Error(await errMessage(res, "failed to clear finished jobs"));
  return res.json();
}

export async function deleteAiJob(jobId) {
  const res = await apiFetch(`/api/ai/jobs/${encodeURIComponent(jobId)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await errMessage(res, "failed to delete job"));
  return res.json();
}

export async function getAiConfig() {
  const res = await apiFetch("/api/ai/config");
  if (!res.ok)
    throw new Error(await errMessage(res, "failed to load AI settings"));
  return res.json();
}

export async function patchAiConfig(patch) {
  const res = await apiFetch("/api/ai/config", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok)
    throw new Error(await errMessage(res, "failed to save AI settings"));
  return res.json();
}
