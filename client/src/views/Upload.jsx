import { useEffect, useRef, useState } from "react";
import { uploadFile } from "../api.js";

const STATUS_STYLES = {
  uploading: "bg-surface-container-high text-on-surface-variant",
  done: "bg-tertiary-fixed text-on-tertiary-fixed-variant",
  error: "bg-error-container text-on-error-container",
};

const MAX_CONCURRENT = 4;

export default function Upload({ onUploaded }) {
  const [uploads, setUploads] = useState([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);
  const dirInputRef = useRef(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const setStatus = (id, patch) =>
    setUploads((prev) =>
      prev.map((u) => (u.id === id ? { ...u, ...patch } : u)),
    );

  const uploadOne = async (file, id) => {
    try {
      await uploadFile(file);
      if (!mounted.current) return;
      setStatus(id, { status: "done" });
    } catch (err) {
      if (!mounted.current) return;
      setStatus(id, {
        status: "error",
        error: err?.message || "upload failed",
      });
    }
  };

  // Upload many files with a small concurrency pool so a whole folder of
  // photos streams through without hammering the browser or the presign
  // rate limit, while each row still shows its own live status. onUploaded
  // fires once after the whole batch so the library refreshes a single time.
  const handleFiles = async (fileList) => {
    // Mirrors the server's extension allowlist so what we accept here can
    // actually be uploaded. webkitRelativePath keeps subfolder context.
    const files = Array.from(fileList)
      .filter((f) => /\.(jpg|jpeg|png|webp|gif|heic|tiff|raw)$/i.test(f.name))
      .map((f) => ({
        file: f,
        name: f.webkitRelativePath || f.name,
      }));
    if (files.length === 0) return;

    const queue = files.map(({ file, name }) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setUploads((prev) => [...prev, { id, name, status: "uploading" }]);
      return { file, id };
    });

    const workers = Array.from(
      { length: Math.min(MAX_CONCURRENT, queue.length) },
      async () => {
        while (queue.length > 0) {
          const next = queue.shift();
          if (!next) break;
          await uploadOne(next.file, next.id);
        }
      },
    );
    await Promise.all(workers);
    if (mounted.current) onUploaded?.();
  };

  const doneCount = uploads.filter((u) => u.status === "done").length;
  const hasActive = uploads.some((u) => u.status === "uploading");

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
                  Drop files or pick an entire folder of photos to ingest them
                  all at once.
                </p>
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
              <div className="flex gap-3">
                <button
                  onClick={() => inputRef.current?.click()}
                  className="bg-surface-container-high text-primary font-label-caps text-label-caps px-6 py-2 rounded shadow-sm hover:bg-surface-variant transition-colors border border-outline-variant"
                >
                  Browse Files
                </button>
                <button
                  onClick={() => dirInputRef.current?.click()}
                  className="bg-tertiary text-on-tertiary font-label-caps text-label-caps px-6 py-2 rounded shadow-sm hover:bg-tertiary-container transition-colors"
                >
                  Upload a Folder
                </button>
              </div>
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-3">
                Pick a folder and every photo inside it (including subfolders)
                uploads automatically.
              </p>
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
              <input
                ref={dirInputRef}
                type="file"
                multiple
                webkitdirectory=""
                directory=""
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
                {hasActive && (
                  <p className="font-body-sm text-body-sm text-on-surface-variant">
                    {doneCount} / {uploads.length} uploaded
                  </p>
                )}
                {uploads.map((u) => (
                  <div
                    key={u.id}
                    className="flex items-center justify-between px-4 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest"
                  >
                    <span className="font-mono-data text-mono-data text-on-surface truncate">
                      {u.name}
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
