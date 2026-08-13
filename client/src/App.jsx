import { useCallback, useEffect, useState } from "react";
import Dashboard from "./views/Dashboard.jsx";
import Upload from "./views/Upload.jsx";
import Detail from "./views/Detail.jsx";
import Search from "./views/Search.jsx";
import Collections from "./views/Collections.jsx";
import Settings from "./views/Settings.jsx";
import { listImages, updateImage } from "./api.js";

const VIEWS = [
  "dashboard",
  "upload",
  "detail",
  "search",
  "collections",
  "settings",
];

export default function App() {
  const [view, setView] = useState("dashboard");
  const [filter, setFilter] = useState("all");
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailList, setDetailList] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [lastOpened, setLastOpened] = useState(null);
  const [pendingBatch, setPendingBatch] = useState(null);
  const [detailFrom, setDetailFrom] = useState("dashboard");
  const [loadError, setLoadError] = useState(null);

  const loadImages = useCallback(async (v) => {
    setLoading(true);
    setLoadError(null);
    try {
      setImages(await listImages(v));
    } catch (err) {
      setImages([]);
      setLoadError(err?.message || "Failed to load images");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadImages(filter);
  }, [filter, loadImages]);

  const openImage = (image) => {
    const index = images.findIndex((i) => i.object_key === image.object_key);
    if (index !== -1) {
      setDetailList(null);
      setSelectedIndex(index);
    } else {
      setDetailList([image]);
      setSelectedIndex(0);
    }
    setLastOpened(image);
    setDetailFrom(view);
    setView("detail");
  };

  const openList = (list, index) => {
    setDetailList(list);
    setSelectedIndex(index);
    setLastOpened(list[index]);
    setDetailFrom(view);
    setView("detail");
  };

  const navigate = (dir) => {
    if (selectedIndex === null) return;
    const list = detailList || images;
    if (list.length === 0) return;
    const next = (selectedIndex + dir + list.length) % list.length;
    setSelectedIndex(next);
    setLastOpened(list[next]);
  };

  const patchImage = (objectKey, patch) => {
    setImages((prev) =>
      prev.map((img) =>
        img.object_key === objectKey ? { ...img, ...patch } : img,
      ),
    );
    setDetailList((prev) =>
      prev
        ? prev.map((img) =>
            img.object_key === objectKey ? { ...img, ...patch } : img,
          )
        : prev,
    );
    setLastOpened((prev) =>
      prev && prev.object_key === objectKey ? { ...prev, ...patch } : prev,
    );
  };

  const removeFromList = (objectKey) => {
    setImages((prev) => prev.filter((img) => img.object_key !== objectKey));
    setDetailList((prev) =>
      prev ? prev.filter((img) => img.object_key !== objectKey) : prev,
    );
    setSelectedIndex(null);
  };

  const toggleFavorite = async (image) => {
    const row = await updateImage(image.object_key, {
      favorite: !image.favorite,
    });
    patchImage(row.object_key, row);
    return row;
  };

  const selected =
    selectedIndex !== null
      ? (detailList || images)[selectedIndex] || null
      : null;

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-background text-on-surface font-body-md text-body-md">
      {view === "dashboard" && (
        <Dashboard
          images={images}
          loading={loading}
          loadError={loadError}
          onRetry={() => loadImages(filter)}
          activeFilter={filter}
          onFilter={setFilter}
          onOpenImage={openImage}
          onOpenList={openList}
          onUpload={() => setView("upload")}
          onSearchView={() => setView("search")}
          onCollections={() => setView("collections")}
          onSettings={() => setView("settings")}
          onQuickTag={(image, tag) => quickTag(image, tag, patchImage)}
          lastOpened={lastOpened}
          onFavorite={async (image) => {
            const row = await toggleFavorite(image);
            if (filter === "favorites" && !row.favorite) {
              removeFromList(row.object_key);
            }
            return row;
          }}
          onRestore={(objectKey) =>
            updateImage(objectKey, { deleted: false }).then((row) => {
              patchImage(objectKey, row);
              removeFromList(objectKey);
            }).catch((err) => {
              console.error("Restore failed:", err);
            })
          }
        />
      )}
      {view === "upload" && (
        <Upload
          onBack={() => setView("dashboard")}
          onSettings={() => setView("settings")}
        />
      )}
      {view === "detail" && selected && (
        <Detail
          image={selected}
          index={selectedIndex}
          total={(detailList || images).length}
          onBack={() => setView(detailFrom)}
          onNavigate={navigate}
          onUpdated={(row) => patchImage(row.object_key, row)}
          onDeleted={() => {
            removeFromList(selected.object_key);
            setView(detailFrom);
          }}
          onFavorite={async (image) => {
            try {
              const row = await toggleFavorite(image);
              if (filter === "favorites" && image.favorite) {
                removeFromList(row.object_key);
                setView(detailFrom);
              }
            } catch (err) {
              console.error("Favorite update failed:", err);
            }
          }}
        />
      )}
      {view === "search" && (
        <Search
          onOpenImage={openImage}
          onOpenList={openList}
          onUpload={() => setView("upload")}
          onBack={() => setView("dashboard")}
          onCollections={() => setView("collections")}
          onSettings={() => setView("settings")}
          onBatch={(selected) => {
            setPendingBatch(selected);
            setView("collections");
          }}
        />
      )}
      {view === "collections" && (
        <Collections
          onBack={() => setView("dashboard")}
          onOpenList={openList}
          onUpload={() => setView("upload")}
          onSettings={() => setView("settings")}
          onSearchView={() => setView("search")}
          pendingBatch={pendingBatch}
          onConsumedBatch={() => setPendingBatch(null)}
        />
      )}
      {view === "settings" && (
        <Settings
          onBack={() => setView("dashboard")}
          imageCount={images.length}
        />
      )}
    </div>
  );
}

export { VIEWS };

async function quickTag(image, tag, patchImage) {
  if (!image) return;
  try {
    const existing = (image.tags || "").split(" ").filter(Boolean);
    if (existing.includes(tag)) return;
    const row = await updateImage(image.object_key, {
      tags: [...existing, tag].join(" "),
    });
    patchImage(image.object_key, row);
  } catch (err) {
    console.error("Quick tag failed:", err);
    throw err;
  }
}
