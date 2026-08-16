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
  return fetch(url, { ...opts, signal }).finally(() => clearTimeout(timer));
}

export async function getUploadUrl(filename, contentType) {
  const res = await fetch("/api/upload-url", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
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
  const res = await fetch("/api/images", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ objectKey, originalFilename }),
  });
  if (!res.ok) throw new Error(await errMessage(res, "failed to save image"));
  return res.json();
}
export async function searchImages(q, sort) {
  const params = new URLSearchParams({ q });
  if (sort) params.set("sort", sort);
  const res = await fetch(`/api/search?${params}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await errMessage(res, "search failed"));
  return res.json();
}

export async function listImages(view) {
  const params = view ? `?view=${view}` : "";
  const res = await fetch(`/api/images${params}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await errMessage(res, "failed to load images"));
  return res.json();
}

export async function getImage(objectKey) {
  const res = await fetch(`/api/images/${encodeURIComponent(objectKey)}`, {
    headers: authHeaders(),
  });
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
  const res = await fetch(
    `/api/images/${encodeURIComponent(objectKey)}${params}`,
    {
      method: "DELETE",
      headers: authHeaders(),
    },
  );
  if (!res.ok) throw new Error(await errMessage(res, "failed to delete image"));
  return res.json();
}

export async function emptyTrash() {
  const res = await fetch("/api/trash", {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await errMessage(res, "failed to empty trash"));
  return res.json();
}
export async function batchUpdate(objectKeys, patch) {
  const res = await fetch("/api/images/batch", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ objectKeys, patch }),
  });
  if (!res.ok)
    throw new Error(await errMessage(res, "failed to update images"));
  return res.json();
}

export async function batchDelete(objectKeys) {
  const res = await fetch("/api/images/batch-delete", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
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
  const res = await fetch("/api/images/tag", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await errMessage(res, "AI tagging failed"));
  return res.json();
}

// ---------------------------------------------------------------------------
// AI control plane (/api/ai/*) — queue, status and config
// ---------------------------------------------------------------------------

export async function getAiStatus() {
  const res = await fetch("/api/ai/status", { headers: authHeaders() });
  if (!res.ok)
    throw new Error(await errMessage(res, "failed to load AI status"));
  return res.json();
}

export async function listAiJobs({ status, limit = 200 } = {}) {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  params.set("limit", String(limit));
  const res = await fetch(`/api/ai/jobs?${params}`, { headers: authHeaders() });
  if (!res.ok)
    throw new Error(await errMessage(res, "failed to load AI queue"));
  return res.json();
}

export async function enqueueAiJobs(objectKeys, prompt) {
  const res = await fetch("/api/ai/jobs", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ objectKeys, prompt }),
  });
  if (!res.ok)
    throw new Error(await errMessage(res, "failed to queue AI tagging"));
  return res.json();
}

export async function patchAiJob(jobId, patch) {
  const res = await fetch(`/api/ai/jobs/${encodeURIComponent(jobId)}`, {
    method: "PATCH",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await errMessage(res, "failed to update job"));
  return res.json();
}

export async function retryAiJob(jobId) {
  const res = await fetch(`/api/ai/jobs/${encodeURIComponent(jobId)}/retry`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await errMessage(res, "failed to retry job"));
  return res.json();
}

export async function retryAllFailedAiJobs() {
  const res = await fetch("/api/ai/jobs/retry-failed", {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok)
    throw new Error(await errMessage(res, "failed to retry failed jobs"));
  return res.json();
}

export async function cancelAllAiJobs() {
  const res = await fetch("/api/ai/jobs/cancel-all", {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await errMessage(res, "failed to cancel jobs"));
  return res.json();
}

export async function deleteAiJob(jobId) {
  const res = await fetch(`/api/ai/jobs/${encodeURIComponent(jobId)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await errMessage(res, "failed to delete job"));
  return res.json();
}

export async function getAiConfig() {
  const res = await fetch("/api/ai/config", { headers: authHeaders() });
  if (!res.ok)
    throw new Error(await errMessage(res, "failed to load AI settings"));
  return res.json();
}

export async function patchAiConfig(patch) {
  const res = await fetch("/api/ai/config", {
    method: "PATCH",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(patch),
  });
  if (!res.ok)
    throw new Error(await errMessage(res, "failed to save AI settings"));
  return res.json();
}
