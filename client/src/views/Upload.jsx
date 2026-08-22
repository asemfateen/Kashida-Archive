import { useEffect, useRef, useState } from "react";
import { uploadFile } from "../api.js";
import { IMAGE_EXTENSIONS } from "../constants.js";

const STATUS_STYLES = {
  uploading: "bg-surface-container-high text-on-surface-variant",
  done: "bg-tertiary-fixed text-on-tertiary-fixed-variant",
  error: "bg-error-container text-on-error-container",
};

const MAX_CONCURRENT = 4;
const MAX_FILE_SIZE_MB = 50;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

export default function Upload({ onUploaded }) {
  const [uploads, setUploads] = useState([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);
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

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList)
      .filter((f) => IMAGE_EXTENSIONS.test(f.name))
      .map((f) => ({
        file: f,
        name: f.webkitRelativePath || f.name,
      }));
    if (files.length === 0) return;

    const rejected = files.filter((f) => f.file.size > MAX_FILE_SIZE_BYTES);
    const queue = files.filter((f) => f.file.size <= MAX_FILE_SIZE_BYTES);

    if (rejected.length > 0) {
      const names = rejected.map((f) => f.name).join(", ");
      queue.push({
        file: new File([], ""),
        name: `${rejected.length} file(s) too large (>${MAX_FILE_SIZE_MB}MB): ${names}`,
        status: "error",
        skipUpload: true,
        error: `Exceeds ${MAX_FILE_SIZE_MB}MB limit`,
      });
    }

    if (queue.length === 0) return;

    const items = queue.map(({ file, name, status, skipUpload, error }) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setUploads((prev) => [...prev, { id, name, status: status || "uploading", error }]);
      return { file, id, skipUpload };
    });

    const workers = Array.from(
      { length: Math.min(MAX_CONCURRENT, items.length) },
      async () => {
        while (items.length > 0) {
          const next = items.shift();
          if (!next) break;
          if (next.skipUpload) continue;
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
        <main className="flex-1 overflow-y-auto p-margin-page bg-background">
          <div className="max-w-5xl mx-auto flex flex-col gap-8">
            <div>
              <h2 className="font-display-lg text-display-lg text-primary">
                Upload &amp; Process
              </h2>
              <p className="font-body-md text-body-md text-on-surface-variant mt-2">
                Drop files or pick an entire folder of photos to ingest them
                all at once.
              </p>
            </div>

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
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  inputRef.current?.click();
                }
              }}
              role="button"
              tabIndex={0}
              aria-label="Drop files here or click to browse"
              className={`w-full border-2 border-dashed rounded-2xl p-12 flex flex-col items-center justify-center text-center transition-all duration-300 ease-out cursor-pointer group ${
                dragging
                  ? "border-tertiary-container bg-surface-container-low dark:bg-dark-surface-container-high scale-[1.02] shadow-soft-lg"
                  : "border-outline-variant dark:border-dark-outline-variant bg-surface-container-lowest dark:bg-dark-surface-container hover:bg-surface-container-low dark:hover:bg-dark-surface-container-high hover:border-primary/30 dark:hover:border-dark-primary/30 hover:shadow-soft"
              }`}
            >
              <div className={`w-16 h-16 rounded-3xl flex items-center justify-center mb-4 transition-all duration-300 ease-out ${
                dragging ? "bg-tertiary-container/20 scale-110" : "bg-surface-container-low dark:bg-dark-surface-container-highest group-hover:bg-primary/5 dark:group-hover:bg-dark-primary/10 group-hover:scale-105"
              }`}>
                <span className={`material-symbols-outlined text-4xl transition-all duration-300 ${
                  dragging ? "text-tertiary-container scale-110" : "text-on-surface-variant/40 group-hover:text-primary"
                }`}>
                  upload_file
                </span>
              </div>
              <h3 className="font-title-sm text-title-sm text-primary mb-1">
                Drag and drop files here
              </h3>
              <p className="font-body-sm text-body-sm text-on-surface-variant mb-4">
                Supported formats: JPG, PNG, RAW, TIFF (Max 50MB per file)
              </p>
              <button
                type="button"
                className="bg-midnight-ink dark:bg-dark-primary-container text-white dark:text-dark-on-primary font-label-caps text-label-caps px-6 py-2.5 rounded-full shadow-sm hover:bg-prussian-navy dark:hover:opacity-90 transition-all duration-200 active:scale-95"
              >
                Browse Files or Folder
              </button>
              <p className="font-body-sm text-body-sm text-on-surface-variant/60 mt-3">
                Pick a folder and every photo inside it uploads automatically
              </p>
              <input
                ref={inputRef}
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

            {uploads.length > 0 && (
              <div className="flex flex-col gap-2">
                {hasActive && (
                  <div className="flex items-center gap-3 animate-in">
                    <p className="font-body-sm text-body-sm text-on-surface-variant">
                      {doneCount} / {uploads.length} uploaded
                    </p>
                    <div className="flex-1 h-1.5 bg-surface-container-high dark:bg-dark-surface-container-highest rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-midnight-ink to-prussian-navy dark:from-dark-primary dark:to-dark-tertiary rounded-full transition-all duration-500 ease-out"
                        style={{ width: `${uploads.length > 0 ? (doneCount / uploads.length) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                )}
                {uploads.map((u, i) => (
                  <div
                    key={u.id}
                    className="flex items-center justify-between px-4 py-2.5 rounded-xl border border-outline-variant dark:border-dark-outline-variant bg-surface-container-lowest dark:bg-dark-surface-container hover:bg-surface-container-low dark:hover:bg-dark-surface-container-high transition-colors duration-150 animate-in-up"
                    style={{ animationDelay: `${i * 30}ms` }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${
                        u.status === "done" ? "bg-emerald-500" : u.status === "error" ? "bg-error" : "bg-amber-500"
                      }`} />
                      <span className="font-mono-data text-mono-data text-on-surface truncate text-sm">
                        {u.name}
                      </span>
                    </div>
                    <span
                      className={`font-label-caps text-label-caps px-2.5 py-0.5 rounded-full ${STATUS_STYLES[u.status]}`}
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
