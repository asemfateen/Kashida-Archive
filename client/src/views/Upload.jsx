import { useEffect, useRef, useState } from "react";
import { getFolders, uploadFile } from "../api.js";

const STATUS_STYLES = {
  uploading: "bg-surface-container-high text-on-surface-variant",
  done: "bg-tertiary-fixed text-on-tertiary-fixed-variant",
  error: "bg-error-container text-on-error-container",
};

export default function Upload({ onUploaded }) {
  const [uploads, setUploads] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [folder, setFolder] = useState("");
  const [folders, setFolders] = useState([]);
  const inputRef = useRef(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    getFolders()
      .then((list) => {
        if (mounted.current) setFolders(list);
      })
      .catch(() => {});
    return () => {
      mounted.current = false;
    };
  }, []);

  const handleFiles = (fileList) => {
    // Mirrors the server's extension allowlist so what we accept here can
    // actually be uploaded.
    const files = Array.from(fileList).filter((f) =>
      /\.(jpg|jpeg|png|webp|gif|heic|tiff|raw)$/i.test(f.name),
    );
    const targetFolder = folder.trim();
    for (const file of files) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setUploads((prev) => [
        ...prev,
        { id, name: file.name, status: "uploading" },
      ]);
      uploadFile(file, targetFolder)
        .then(() => {
          if (!mounted.current) return;
          setUploads((prev) =>
            prev.map((u) => (u.id === id ? { ...u, status: "done" } : u)),
          );
          onUploaded?.();
        })
        .catch((err) => {
          if (!mounted.current) return;
          setUploads((prev) =>
            prev.map((u) =>
              u.id === id
                ? {
                    ...u,
                    status: "error",
                    error: err?.message || "upload failed",
                  }
                : u,
            ),
          );
        });
    }
  };

  return (
    <>
      <div className="flex flex-1 overflow-hidden">
        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto p-margin-page bg-background">
          <div className="max-w-5xl mx-auto flex flex-col gap-8">
            <div className="flex justify-between items-end">
              <div>
                <h2 className="font-display-lg text-display-lg text-primary">
                  Upload &amp; Process
                </h2>
                <p className="font-body-md text-body-md text-on-surface-variant mt-2">
                  Drag and drop assets or select files to begin ingestion.
                </p>
              </div>
            </div>
            {/* Folder Picker */}
            <div className="flex items-end justify-between gap-4">
              <label className="flex flex-col gap-1 flex-1">
                <span className="font-label-caps text-label-caps text-on-surface-variant">
                  Upload to folder
                </span>
                <input
                  list="folder-options"
                  value={folder}
                  onChange={(e) => setFolder(e.target.value)}
                  className="bg-surface-container-lowest border border-outline-variant focus:border-tertiary-container focus:ring-1 focus:ring-tertiary-container rounded p-2 font-body-sm text-body-sm text-on-surface outline-none"
                  placeholder="Folder name (empty = library root)"
                  maxLength={200}
                />
                <datalist id="folder-options">
                  {folders.map((f) => (
                    <option key={f.folder} value={f.folder}>
                      {f.folder} ({f.count})
                    </option>
                  ))}
                </datalist>
              </label>
              <div className="flex gap-2">
                {folder.trim() && (
                  <button
                    onClick={() => setFolder("")}
                    className="bg-surface-container-high text-primary font-label-caps text-label-caps px-4 py-2 rounded shadow-sm hover:bg-surface-variant transition-colors border border-outline-variant"
                  >
                    No folder
                  </button>
                )}
                {folder.trim() &&
                  !folders.some((f) => f.folder === folder.trim()) && (
                    <span className="bg-tertiary-fixed text-on-tertiary-fixed-variant font-label-caps text-label-caps px-3 py-2 rounded-full">
                      New folder
                    </span>
                  )}
              </div>
            </div>
            {/* Drag & Drop Zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                handleFiles(e.dataTransfer.files);
              }}
              className={`w-full border-2 border-dashed rounded-xl p-12 flex flex-col items-center justify-center text-center transition-colors cursor-pointer group ${
                dragging
                  ? "border-tertiary-container bg-surface-container-low"
                  : "border-outline-variant bg-surface-container-lowest hover:bg-surface-container-low"
              }`}
            >
              <span className="material-symbols-outlined text-4xl text-primary-fixed-dim mb-4 group-hover:text-tertiary-container transition-colors">
                upload_file
              </span>
              <h3 className="font-title-sm text-title-sm text-primary mb-1">
                Drag and drop files here
              </h3>
              <p className="font-body-sm text-body-sm text-on-surface-variant mb-4">
                Supported formats: JPG, PNG, RAW, TIFF (Max 50MB per file)
              </p>
              <button
                onClick={() => inputRef.current?.click()}
                className="bg-surface-container-high text-primary font-label-caps text-label-caps px-6 py-2 rounded shadow-sm hover:bg-surface-variant transition-colors border border-outline-variant"
              >
                Browse Files
              </button>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept="image/*,.heic,.tiff,.raw"
                className="hidden"
                onChange={(e) => {
                  handleFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
            {/* Upload Queue */}
            {uploads.length > 0 && (
              <div className="flex flex-col gap-2">
                {uploads.map((u) => (
                  <div
                    key={u.id}
                    className="flex items-center justify-between px-4 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest"
                  >
                    <span className="font-mono-data text-mono-data text-on-surface truncate">
                      {u.name}
                      {folder.trim() && (
                        <span className="text-on-surface-variant ml-2">
                          → {folder.trim()}
                        </span>
                      )}
                    </span>
                    <span
                      className={`font-label-caps text-label-caps px-2 py-0.5 rounded-full ${STATUS_STYLES[u.status]}`}
                      title={u.error || u.status}
                    >
                      {u.status === "error" ? u.error || "error" : u.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    </>
  );
}
