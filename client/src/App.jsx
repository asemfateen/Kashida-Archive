import { useCallback, useEffect, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { AuthProvider, useAuth } from "./auth.jsx";
import Taskbar from "./components/Taskbar.jsx";
import Login from "./views/Login.jsx";
import Profile from "./views/Profile.jsx";
import Dashboard from "./views/Dashboard.jsx";
import Upload from "./views/Upload.jsx";
import Detail from "./views/Detail.jsx";
import Search from "./views/Search.jsx";
import Collections from "./views/Collections.jsx";
import Settings from "./views/Settings.jsx";
import { listImages, updateImage } from "./api.js";
import { mergeTags } from "./tags.js";

const VIEWS = [
  "dashboard",
  "upload",
  "detail",
  "search",
  "collections",
  "settings",
];

function Guard({ children }) {
  const { isAuthed } = useAuth();
  const location = useLocation();
  if (!isAuthed)
    return <Navigate to="/login" replace state={{ from: location }} />;
  return children;
}

function Shell() {
  const location = useLocation();
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
  const [searchQuery, setSearchQuery] = useState(null);

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

  const openSearch = (q) => {
    setSearchQuery(q);
    setView("search");
  };

  // Home link lands on the dashboard: reset the view whenever the shell route
  // changes (e.g. returning from /profile via the Home link).
  useEffect(() => {
    setView("dashboard");
  }, [location.pathname]);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-background text-on-surface font-body-md text-body-md">
      <Taskbar onSearch={openSearch} onSettings={() => setView("settings")} />
      <div className="flex-1 flex flex-col overflow-hidden">
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
              updateImage(objectKey, { deleted: false })
                .then((row) => {
                  patchImage(objectKey, row);
                  removeFromList(objectKey);
                })
                .catch((err) => {
                  console.error("Restore failed:", err);
                })
            }
          />
        )}
        {view === "upload" && <Upload onBack={() => setView("dashboard")} />}
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
            query={searchQuery}
            onSearchHandled={() => setSearchQuery(null)}
            onOpenImage={openImage}
            onOpenList={openList}
            onUpload={() => setView("upload")}
            onBack={() => setView("dashboard")}
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
            pendingBatch={pendingBatch}
            onConsumedBatch={() => setPendingBatch(null)}
          />
        )}
        {view === "settings" && (
          <Settings
            imageCount={images.length}
            onBack={() => setView("dashboard")}
          />
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/profile"
            element={
              <Guard>
                <div className="h-screen w-screen flex flex-col overflow-hidden bg-background text-on-surface font-body-md text-body-md">
                  <Taskbar onSearch={() => {}} />
                  <Profile />
                </div>
              </Guard>
            }
          />
          <Route
            path="/*"
            element={
              <Guard>
                <Shell key="shell" />
              </Guard>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export { VIEWS };

async function quickTag(image, tag, patchImage) {
  if (!image) return;
  try {
    const merged = mergeTags(image.tags || "", [tag]);
    const row = await updateImage(image.object_key, {
      tags: merged.join(" "),
    });
    patchImage(image.object_key, row);
  } catch (err) {
    console.error("Quick tag failed:", err);
    throw err;
  }
}
