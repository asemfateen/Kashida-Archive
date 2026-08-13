import { useEffect, useRef, useState } from "react";
import { uploadFile } from "../api.js";
import Avatar from "../components/Avatar.jsx";

const NAV_LINK =
  "flex items-center gap-gutter text-on-surface-variant px-4 py-3 hover:bg-surface-container-highest transition-all rounded-xl font-label-caps text-label-caps translate-x-1 hover:translate-x-0";

const STATUS_STYLES = {
  uploading: "bg-surface-container-high text-on-surface-variant",
  done: "bg-tertiary-fixed text-on-tertiary-fixed-variant",
  error: "bg-error-container text-on-error-container",
};

export default function Upload({ onBack, onSettings }) {
  const [uploads, setUploads] = useState([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);
  const mounted = useRef(true);

  useEffect(() => {
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
    for (const file of files) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setUploads((prev) => [
        ...prev,
        { id, name: file.name, status: "uploading" },
      ]);
      uploadFile(file)
        .then(() => {
          if (!mounted.current) return;
          setUploads((prev) =>
            prev.map((u) => (u.id === id ? { ...u, status: "done" } : u)),
          );
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
      {/* TopNavBar */}
      <header className="bg-surface-container-lowest border-b border-outline-variant flex justify-between items-center w-full px-margin-page py-unit h-16 z-50">
        <div className="flex items-center gap-4">
          <h1 className="font-headline-md text-headline-md text-primary font-bold tracking-tight">
            NewsLens
          </h1>
        </div>
        <div className="flex-1 max-w-xl mx-8 hidden md:flex items-center bg-[#F1F5F9] focus-within:bg-white focus-within:border-tertiary-container focus-within:ring-1 focus-within:ring-tertiary-container border border-transparent rounded-lg px-3 py-2 transition-all">
          <span className="material-symbols-outlined text-outline mr-2">
            search
          </span>
          <input
            className="bg-transparent border-none focus:ring-0 w-full text-body-md p-0 placeholder-on-surface-variant"
            placeholder="Search NewsLens..."
            type="text"
          />
          <span className="font-mono-data text-mono-data text-outline bg-surface-container-high px-1.5 rounded ml-2">
            ⌘K
          </span>
        </div>
        <div className="flex items-center gap-4">
          <button className="text-on-surface-variant hover:bg-surface-container transition-colors p-2 rounded-full scale-95 active:opacity-80 transition-transform">
            <span className="material-symbols-outlined">notifications</span>
          </button>
          <button className="text-on-surface-variant hover:bg-surface-container transition-colors p-2 rounded-full scale-95 active:opacity-80 transition-transform">
            <span className="material-symbols-outlined">settings</span>
          </button>
          <button className="bg-tertiary text-on-tertiary font-label-caps text-label-caps px-4 py-2 rounded scale-95 active:opacity-80 transition-transform">
            Upload
          </button>
          <Avatar />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* SideNavBar */}
        <nav className="hidden lg:flex fixed left-0 top-16 h-[calc(100vh-64px)] w-panel-width-fixed flex-col p-4 z-40 bg-surface-container-low border-r border-outline-variant">
          <div className="mb-6 px-4">
            <h2 className="font-headline-md text-headline-md text-primary">
              Library
            </h2>
            <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
              News Assets
            </p>
          </div>
          <ul className="flex flex-col gap-2 mb-8">
            <li>
              <a
                className={NAV_LINK}
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  onBack();
                }}
              >
                <span className="material-symbols-outlined">photo_library</span>
                All Photos
              </a>
            </li>
            <li>
              <a
                className="flex items-center gap-gutter bg-surface-container-high text-primary rounded-xl px-4 py-3 transition-all font-label-caps text-label-caps"
                href="#"
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  cloud_upload
                </span>
                Uploads
              </a>
            </li>
            <li>
              <a className={NAV_LINK} href="#">
                <span className="material-symbols-outlined">schedule</span>
                Recent
              </a>
            </li>
          </ul>
          <div className="mt-auto pt-4 border-t border-outline-variant flex flex-col gap-1 font-label-caps text-label-caps">
            <a
              className={NAV_LINK}
              href="#"
              onClick={(e) => {
                e.preventDefault();
                onSettings();
              }}
            >
              <span className="material-symbols-outlined">settings</span>
              Settings
            </a>
          </div>
        </nav>

        {/* Main Content Area */}
        <main className="flex-1 lg:ml-panel-width-fixed overflow-y-auto p-margin-page bg-background">
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
