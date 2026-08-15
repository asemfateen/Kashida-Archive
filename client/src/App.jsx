import { useCallback, useEffect, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { AuthProvider, useAuth } from "./auth.jsx";
import Taskbar from "./components/Taskbar.jsx";
import SidePanel from "./components/SidePanel.jsx";
import Login from "./views/Login.jsx";
import Profile from "./views/Profile.jsx";
import Dashboard from "./views/Dashboard.jsx";
import Upload from "./views/Upload.jsx";
import Detail from "./views/Detail.jsx";
import Search from "./views/Search.jsx";
import Collections from "./views/Collections.jsx";
import Settings from "./views/Settings.jsx";
import { getImage, listImages, updateImage } from "./api.js";
import { mergeTags } from "./tags.js";

const VIEWS = [
  "dashboard",
  "upload",
  "detail",
  "search",
  "collections",
  "settings",
];

const VIEW_PATH = {
  dashboard: "/",
  upload: "/upload",
  detail: "/detail",
  search: "/search",
  collections: "/collections",
  settings: "/settings",
};

function pathToView(pathname) {
  if (pathname.startsWith("/upload")) return "upload";
  if (pathname.startsWith("/search")) return "search";
  if (pathname.startsWith("/detail")) return "detail";
  if (pathname.startsWith("/collections")) return "collections";
  if (pathname.startsWith("/settings")) return "settings";
  return "dashboard";
}

function detailKeyFromPath(pathname) {
  if (!pathname.startsWith("/detail/")) return null;
  const rest = pathname.slice("/detail/".length);
  try {
    return decodeURIComponent(rest);
  } catch {
    return null;
  }
}

function Guard({ children }) {
  const { isAuthed } = useAuth();
  const location = useLocation();
  if (!isAuthed)
    return <Navigate to="/login" replace state={{ from: location }} />;
  return children;
}

function Shell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [filter, setFilter] = useState("all");
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailList, setDetailList] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [lastOpened, setLastOpened] = useState(null);
  const [pendingBatch, setPendingBatch] = useState(null);
  const [detailFrom, setDetailFrom] = useState("/");
  const [loadError, setLoadError] = useState(null);

  const view = pathToView(location.pathname);

  const go = (path) => navigate(path);
  const goBack = () => navigate(-1);

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

  const openSearch = (q) => {
    navigate(`/?q=${encodeURIComponent(q)}`);
  };

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
    setDetailFrom(location.pathname);
    go(`/detail/${encodeURIComponent(image.object_key)}`);
  };

  const openList = (list, index) => {
    setDetailList(list);
    setSelectedIndex(index);
    setLastOpened(list[index]);
    setDetailFrom(location.pathname);
    go(`/detail/${encodeURIComponent(list[index].object_key)}`);
  };

  const stepImage = (dir) => {
    if (selectedIndex === null) return;
    const list = detailList || images;
    if (list.length === 0) return;
    const next = (selectedIndex + dir + list.length) % list.length;
    setSelectedIndex(next);
    setLastOpened(list[next]);
    if (list[next]?.object_key) {
      navigate(`/detail/${encodeURIComponent(list[next].object_key)}`, {
        replace: true,
      });
    }
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

  const urlKey =
    view === "detail" ? detailKeyFromPath(location.pathname) : null;

  useEffect(() => {
    if (!urlKey) return;
    if (selectedIndex !== null) {
      const list = detailList || images;
      const current = list[selectedIndex];
      if (current && current.object_key === urlKey) return;
    }
    const foundIndex = images.findIndex((i) => i.object_key === urlKey);
    if (foundIndex !== -1) {
      setDetailList(null);
      setSelectedIndex(foundIndex);
      setLastOpened(images[foundIndex]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getImage(urlKey)
      .then((img) => {
        if (cancelled || !img) return;
        setDetailList([img]);
        setSelectedIndex(0);
        setLastOpened(img);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Failed to load image from URL:", err);
        go(detailFrom);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [urlKey, selectedIndex, images, detailList, detailFrom]);

  const searchQuery = searchParams.get("q");

  const handleNav = (key) => {
    if (key === "upload") {
      go(VIEW_PATH.upload);
      return;
    }
    setFilter(key);
    if (view !== "dashboard") go(VIEW_PATH.dashboard);
  };

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-background text-on-surface font-body-md text-body-md">
      <Taskbar
        onSearch={openSearch}
        onSettings={() => go(VIEW_PATH.settings)}
        onUpload={() => go(VIEW_PATH.upload)}
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex flex-1 overflow-hidden">
          <SidePanel
            activeKey={
              view === "upload"
                ? "upload"
                : view === "dashboard"
                  ? filter
                  : null
            }
            onNavigate={handleNav}
            onSettings={() => go(VIEW_PATH.settings)}
          />
          <div className="flex-1 flex flex-col overflow-hidden">
            {view === "dashboard" && (
              <Dashboard
                images={images}
                loading={loading}
                loadError={loadError}
                onRetry={() => loadImages(filter)}
                activeFilter={filter}
                searchQuery={searchQuery}
                onFilter={setFilter}
                onOpenImage={openImage}
                onOpenList={openList}
                onUpload={() => go(VIEW_PATH.upload)}
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
            {view === "upload" && (
              <Upload onUploaded={() => loadImages("all")} />
            )}
            {view === "detail" && selected && (
              <Detail
                image={selected}
                index={selectedIndex}
                total={(detailList || images).length}
                onBack={() => go(detailFrom)}
                onNavigate={stepImage}
                onUpdated={(row) => patchImage(row.object_key, row)}
                onDeleted={() => {
                  removeFromList(selected.object_key);
                  go(detailFrom);
                }}
                onFavorite={async (image) => {
                  try {
                    const row = await toggleFavorite(image);
                    if (filter === "favorites" && image.favorite) {
                      removeFromList(row.object_key);
                      go(detailFrom);
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
                onOpenImage={openImage}
                onOpenList={openList}
                onUpload={() => go(VIEW_PATH.upload)}
                onBack={() => goBack()}
                onSettings={() => go(VIEW_PATH.settings)}
                onBatch={(selected) => {
                  setPendingBatch(selected);
                  go(VIEW_PATH.collections);
                }}
              />
            )}
            {view === "collections" && (
              <Collections
                onBack={() => goBack()}
                onOpenList={openList}
                onUpload={() => go(VIEW_PATH.upload)}
                onSettings={() => go(VIEW_PATH.settings)}
                pendingBatch={pendingBatch}
                onConsumedBatch={() => setPendingBatch(null)}
              />
            )}
            {view === "settings" && (
              <Settings imageCount={images.length} onBack={() => goBack()} />
            )}
          </div>
        </div>
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
                <ProfileShell />
              </Guard>
            }
          />
          <Route
            path="/*"
            element={
              <Guard>
                <Shell />
              </Guard>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

function ProfileShell() {
  const navigate = useNavigate();
  const go = (path) => navigate(path);
  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-background text-on-surface font-body-md text-body-md">
      <Taskbar
        onSearch={(q) => navigate(`/?q=${encodeURIComponent(q)}`)}
        onSettings={() => go("/settings")}
        onUpload={() => go("/upload")}
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex flex-1 overflow-hidden">
          <SidePanel
            activeKey={null}
            onNavigate={(key) => {
              if (key === "upload") go("/upload");
              else go("/");
            }}
            onSettings={() => go("/settings")}
          />
          <div className="flex-1 flex flex-col overflow-hidden">
            <Profile />
          </div>
        </div>
      </div>
    </div>
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
