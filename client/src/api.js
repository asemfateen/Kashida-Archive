export async function getUploadUrl(filename, contentType) {
  const res = await fetch("/api/upload-url", {
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
  if (!res.ok) throw new Error("R2 upload failed");
  await saveImage(objectKey, file.name);
  return { objectKey };
}

export async function saveImage(objectKey, originalFilename) {
  const res = await fetch("/api/images", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ objectKey, originalFilename }),
  });
  if (!res.ok)
    throw new Error((await res.json()).error || "failed to save image");
  return res.json();
}
export async function searchImages(q, sort) {
  const params = new URLSearchParams({ q });
  if (sort) params.set("sort", sort);
  const res = await fetch(`/api/search?${params}`);
  if (!res.ok) throw new Error((await res.json()).error || "search failed");
  return res.json();
}

export async function listImages(view) {
  const params = view ? `?view=${view}` : "";
  const res = await fetch(`/api/images${params}`);
  if (!res.ok)
    throw new Error((await res.json()).error || "failed to load images");
  return res.json();
}

export async function getImage(objectKey) {
  const res = await fetch(`/api/images/${encodeURIComponent(objectKey)}`);
  if (!res.ok)
    throw new Error((await res.json()).error || "failed to load image");
  return res.json();
}

export async function updateImage(objectKey, patch) {
  const res = await fetch(`/api/images/${encodeURIComponent(objectKey)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok)
    throw new Error((await res.json()).error || "failed to update image");
  return res.json();
}

export async function deleteImage(objectKey) {
  const res = await fetch(`/api/images/${encodeURIComponent(objectKey)}`, {
    method: "DELETE",
  });
  if (!res.ok)
    throw new Error((await res.json()).error || "failed to delete image");
  return res.json();
}
export async function tagImage(payload) {
  const res = await fetch("/api/images/tag", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.json()).error || "AI tagging failed");
  return res.json();
}
