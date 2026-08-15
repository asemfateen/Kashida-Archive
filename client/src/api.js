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

export async function getUploadUrl(filename, contentType, folder) {
  const res = await fetch("/api/upload-url", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ filename, contentType, folder }),
  });
  if (!res.ok)
    throw new Error((await res.json()).error || "failed to get upload URL");
  return res.json();
}

export async function uploadFile(file, folder) {
  const { objectKey, uploadUrl } = await getUploadUrl(
    file.name,
    file.type || "application/octet-stream",
    folder,
  );
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!res.ok) throw new Error("R2 upload failed");
  await saveImage(objectKey, file.name, folder);
  return { objectKey };
}

export async function saveImage(objectKey, originalFilename, folder) {
  const res = await fetch("/api/images", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ objectKey, originalFilename, folder }),
  });
  if (!res.ok)
    throw new Error((await res.json()).error || "failed to save image");
  return res.json();
}
export async function searchImages(q, sort) {
  const params = new URLSearchParams({ q });
  if (sort) params.set("sort", sort);
  const res = await fetch(`/api/search?${params}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error((await res.json()).error || "search failed");
  return res.json();
}

export async function listImages(view, folder) {
  const params = new URLSearchParams();
  if (view) params.set("view", view);
  if (folder) params.set("folder", folder);
  const res = await fetch(`/api/images?${params}`, {
    headers: authHeaders(),
  });
  if (!res.ok)
    throw new Error((await res.json()).error || "failed to load images");
  return res.json();
}

export async function getFolders() {
  const res = await fetch("/api/folders", {
    headers: authHeaders(),
  });
  if (!res.ok)
    throw new Error((await res.json()).error || "failed to load folders");
  return res.json();
}

export async function getImage(objectKey) {
  const res = await fetch(`/api/images/${encodeURIComponent(objectKey)}`, {
    headers: authHeaders(),
  });
  if (!res.ok)
    throw new Error((await res.json()).error || "failed to load image");
  return res.json();
}

export async function updateImage(objectKey, patch) {
  const res = await fetch(`/api/images/${encodeURIComponent(objectKey)}`, {
    method: "PATCH",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(patch),
  });
  if (!res.ok)
    throw new Error((await res.json()).error || "failed to update image");
  return res.json();
}

export async function deleteImage(objectKey) {
  const res = await fetch(`/api/images/${encodeURIComponent(objectKey)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok)
    throw new Error((await res.json()).error || "failed to delete image");
  return res.json();
}
export async function tagImage(payload) {
  const res = await fetch("/api/images/tag", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.json()).error || "AI tagging failed");
  return res.json();
}
