import { useEffect, useRef, useState } from "react";
import { collections } from "../store.js";
import { getImage } from "../api.js";
import Avatar from "../components/Avatar.jsx";

export default function Collections({
  onBack,
  onOpenList,
  onUpload,
  onSettings,
  onSearchView,
  pendingBatch,
  onConsumedBatch,
}) {
  const [list, setList] = useState(() => collections.list());
  const [draft, setDraft] = useState("");
  const [toast, setToast] = useState(null);
  const openIdRef = useRef(0);

  useEffect(() => {
    return () => {
      openIdRef.current++;
    };
  }, []);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  const createCollection = (e, items = []) => {
    e.preventDefault();
    const name = draft.trim();
    if (!name) return;
    collections.create(name, items);
    setList(collections.list());
    setDraft("");
    showToast(`Created "${name}"`);
  };

  const openCollection = async (coll) => {
    if (coll.items.length === 0) return;
    const requestedId = ++openIdRef.current;
    const fallback = coll.items.map((i) => ({
      object_key: i.key,
      url: i.url,
      src: i.url,
      original_filename: i.filename,
      tags: "",
      created_at: "",
    }));
    try {
      // Fetch full rows so favorite/tag state is correct in Detail.
      const rows = await Promise.all(coll.items.map((i) => getImage(i.key)));
      if (requestedId !== openIdRef.current) return;
      onOpenList(
        rows.map((r) => ({ ...r, src: r.url || r.src })),
        0,
      );
    } catch {
      if (requestedId === openIdRef.current) onOpenList(fallback, 0);
    }
  };

  const deleteCollection = (id, e) => {
    e.stopPropagation();
    collections.remove(id);
    setList(collections.list());
    showToast("Collection deleted");
  };

  const addPending = (coll, e) => {
    e.stopPropagation();
    const coll2 = collections.addItems(
      coll.id,
      pendingBatch.map((img) => ({
        key: img.object_key,
        url: img.url || img.src,
        filename: img.original_filename,
      })),
    );
    setList((prev) => prev.map((c) => (c.id === coll.id ? coll2 : c)));
    showToast(`Added ${pendingBatch.length} images to "${coll.name}"`);
  };

  const batchItem = (img) => ({
    key: img.object_key,
    url: img.url || img.src,
    filename: img.original_filename,
  });

  return (
    <>
      <header className="bg-surface-container-lowest border-b border-outline-variant px-margin-page py-unit h-16 z-50 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-6">
          <button
            onClick={onBack}
            className="text-on-surface-variant hover:text-primary transition-colors flex items-center gap-1"
          >
            <span className="material-symbols-outlined">arrow_back</span>
            <span className="font-label-caps text-label-caps">Library</span>
          </button>
          <div>
            <h1 className="font-headline-md text-headline-md text-primary tracking-tight font-bold">
              Collections
            </h1>
            <p className="font-body-sm text-body-sm text-on-surface-variant -mt-1">
              Organize assets for stories, shoots and assignments
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={onSearchView}
            className="text-on-surface-variant hover:bg-surface-container transition-colors p-2 rounded-full"
            title="Advanced Search"
          >
            <span className="material-symbols-outlined">tune</span>
          </button>
          <button
            onClick={onSettings}
            className="text-on-surface-variant hover:bg-surface-container transition-colors p-2 rounded-full"
            title="Settings"
          >
            <span className="material-symbols-outlined">settings</span>
          </button>
          <button
            onClick={onUpload}
            className="bg-tertiary text-on-tertiary px-4 py-2 rounded-lg font-title-sm text-title-sm hover:bg-tertiary-container transition-colors flex items-center gap-2"
          >
            <span className="material-symbols-outlined">upload</span>
            Upload
          </button>
          <Avatar />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-margin-page bg-background">
        <div className="max-w-5xl mx-auto flex flex-col gap-8">
          {/* Pending batch banner */}
          {pendingBatch && pendingBatch.length > 0 && (
            <div className="flex items-center justify-between gap-4 bg-primary-container border border-primary rounded-xl p-4">
              <p className="font-body-md text-body-md text-on-primary-fixed-variant">
                <span className="font-bold">
                  {pendingBatch.length} selected
                </span>{" "}
                images ready to organize — add them to a collection below.
              </p>
              <button
                onClick={() => onConsumedBatch()}
                className="px-3 py-1.5 rounded-lg font-label-caps text-label-caps text-on-primary-fixed-variant border border-primary hover:bg-primary-fixed transition-colors"
              >
                Dismiss
              </button>
            </div>
          )}

          {list.length === 0 && !(pendingBatch && pendingBatch.length > 0) && (
            <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
              <span className="material-symbols-outlined text-5xl text-primary-fixed-dim">
                auto_awesome_motion
              </span>
              <p className="font-title-sm text-title-sm text-primary">
                No collections yet
              </p>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Create one to group related assets — from a search, pick images
                and send them here.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {list.map((coll) => {
              const cover = coll.items[0];
              return (
                <div
                  key={coll.id}
                  onClick={() => openCollection(coll)}
                  className={`group relative rounded-xl overflow-hidden cursor-pointer border ${
                    pendingBatch && pendingBatch.length > 0
                      ? "border-primary"
                      : "border-outline-variant"
                  } bg-surface-container-lowest hover:border-primary transition-colors shadow-[0px_10px_15px_rgba(0,0,0,0.05)]`}
                >
                  {cover ? (
                    <img
                      src={cover.url}
                      alt={coll.name}
                      className="w-full aspect-[16/10] object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                        e.currentTarget.parentElement.classList.add(
                          "aspect-[16/10]",
                          "bg-surface-variant",
                        );
                      }}
                    />
                  ) : (
                    <div className="w-full aspect-[16/10] bg-surface-variant flex items-center justify-center">
                      <span className="material-symbols-outlined text-4xl text-on-surface-variant opacity-50">
                        photo_library
                      </span>
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent"></div>
                  <div className="absolute bottom-0 left-0 right-0 p-4 text-white flex items-end justify-between">
                    <div>
                      <p className="font-title-sm text-title-sm">{coll.name}</p>
                      <p className="font-mono-data text-mono-data text-white/70">
                        {coll.items.length}{" "}
                        {coll.items.length === 1 ? "asset" : "assets"}
                      </p>
                    </div>
                    <button
                      onClick={(e) => deleteCollection(coll.id, e)}
                      className="bg-surface-container-lowest/80 backdrop-blur p-1.5 rounded-full text-on-surface-variant hover:text-error transition-colors opacity-0 group-hover:opacity-100"
                      title="Delete collection"
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        delete
                      </span>
                    </button>
                  </div>
                  {!cover && (
                    <div className="absolute bottom-0 left-0 right-0 p-4 text-white flex items-end justify-between">
                      <div>
                        <p className="font-title-sm text-title-sm">
                          {coll.name}
                        </p>
                        <p className="font-mono-data text-mono-data text-white/70">
                          empty
                        </p>
                      </div>
                      <button
                        onClick={(e) => deleteCollection(coll.id, e)}
                        className="bg-surface-container-lowest/80 backdrop-blur p-1.5 rounded-full text-on-surface-variant hover:text-error transition-colors opacity-0 group-hover:opacity-100"
                        title="Delete collection"
                      >
                        <span className="material-symbols-outlined text-[18px]">
                          delete
                        </span>
                      </button>
                    </div>
                  )}
                  {pendingBatch && pendingBatch.length > 0 && (
                    <button
                      onClick={(e) =>
                        addPending({ ...coll, items: coll.items }, e)
                      }
                      className="absolute top-3 right-3 bg-primary text-on-primary text-xs font-label-caps text-label-caps px-3 py-1.5 rounded-full shadow"
                    >
                      + Add {pendingBatch.length}
                    </button>
                  )}
                </div>
              );
            })}

            {/* New Collection Card */}
            <form
              onSubmit={(e) =>
                createCollection(
                  e,
                  pendingBatch && pendingBatch.length > 0
                    ? pendingBatch.map(batchItem)
                    : [],
                )
              }
              className="rounded-xl border-2 border-dashed border-outline-variant hover:border-primary transition-colors p-5 flex flex-col gap-3 justify-center min-h-[180px]"
            >
              <span className="material-symbols-outlined text-3xl text-on-surface-variant">
                add
              </span>
              <label className="font-label-caps text-label-caps text-on-surface-variant">
                New Collection
              </label>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="w-full bg-surface-container-lowest border border-outline-variant focus:border-primary focus:ring-1 focus:ring-primary rounded px-3 py-2 text-body-sm text-on-surface outline-none transition-colors"
                placeholder="Collection name..."
                type="text"
              />
              <button
                type="submit"
                disabled={!draft.trim()}
                className="bg-tertiary text-on-tertiary font-label-caps text-label-caps px-4 py-2 rounded-lg hover:bg-tertiary-container transition-colors disabled:opacity-50"
              >
                {pendingBatch && pendingBatch.length > 0
                  ? `Create with ${pendingBatch.length} selected`
                  : "Create"}
              </button>
            </form>
          </div>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] bg-on-surface text-surface-container-lowest px-4 py-2 rounded-full font-body-sm text-body-sm shadow-lg">
          {toast}
        </div>
      )}
    </>
  );
}
