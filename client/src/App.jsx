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
import Settings from "./views/Settings.jsx";
import Ai from "./views/Ai.jsx";
import {
  deleteImage,
  emptyTrash,
  getImage,
  listImages,
  updateImage,
} from "./api.js";
import { ErrorToaster, pushError } from "./notify.jsx";

const CACHE_PREFIX = "kashida_cache_";
const cacheKey = (view) => `${CACHE_PREFIX}${view}`;

function readCache(view) {
  try {
    return JSON.parse(sessionStorage.getItem(cacheKey(view)));
  } catch {
    return null;
  }
}

function writeCache(view, data) {
  try {
    sessionStorage.setItem(cacheKey(view), JSON.stringify(data));
  } catch {
    // Storage full or unavailable — cache is best-effort.
  }
}

function dropFromCache(objectKey) {
  for (let i = 0; i < sessionStorage.length; i += 1) {
    const key = sessionStorage.key(i);
    if (key && key.startsWith(CACHE_PREFIX)) {
      try {
        const val = JSON.parse(sessionStorage.getItem(key));
        if (Array.isArray(val)) {
          writeCache(
            key.slice(CACHE_PREFIX.length),
            val.filter((x) => x.object_key !== objectKey),
          );
        }
      } catch {
        // Ignore malformed entries.
      }
    }
  }
}

function clearCaches() {
  const keys = [];
  for (let i = 0; i < sessionStorage.length; i += 1) {
    const key = sessionStorage.key(i);
    if (key && key.startsWith(CACHE_PREFIX)) keys.push(key);
  }
  for (const key of keys) sessionStorage.removeItem(key);
}

const VIEWS = ["dashboard", "upload", "detail", "search", "settings", "ai"];

const VIEW_PATH = {
  dashboard: "/",
  upload: "/upload",
  detail: "/detail",
  search: "/search",
  settings: "/settings",
  ai: "/ai",
};

function pathToView(pathname) {
  if (pathname.startsWith("/upload")) return "upload";
  if (pathname.startsWith("/search")) return "search";
  if (pathname.startsWith("/detail")) return "detail";
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.startsWith("/ai")) return "ai";
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
  const [detailFrom, setDetailFrom] = useState("/");
  const [loadError, setLoadError] = useState(null);

  const view = pathToView(location.pathname);

  const go = (path) => navigate(path);
  const goBack = () => navigate(-1);

  const fetchImages = useCallback(async (v) => {
    const data = await listImages(v);
    writeCache(v, data);
    setImages(data);
    return data;
  }, []);

  const loadImages = useCallback(
    async (v, opts = {}) => {
      if (!opts.silent) setLoading(true);
      setLoadError(null);
      try {
        await fetchImages(v);
      } catch (err) {
        if (!opts.silent) {
          setImages([]);
          setLoadError(err?.message || "Failed to load images");
        }
      } finally {
        if (!opts.silent) setLoading(false);
      }
    },
    [fetchImages],
  );

  useEffect(() => {
    // Hydrate instantly from the session cache, then refresh in the
    // background so returning to the library never shows a spinner.
    const cached = readCache(filter);
    if (cached) {
      setImages(cached);
      setLoading(false);
    }
    loadImages(filter, { silent: Boolean(cached) });
  }, [filter, loadImages]);

  const openSearch = (q) => {
    if (q) navigate(`/?q=${encodeURIComponent(q)}`, { replace: true });
    else navigate("/", { replace: true });
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

  const deleteForever = async (objectKey) => {
    try {
      await deleteImage(objectKey, true);
      removeFromList(objectKey);
      dropFromCache(objectKey);
    } catch (err) {
      pushError(err?.message || "Permanent delete failed");
    }
  };

  const emptyTrashList = async () => {
    try {
      await emptyTrash();
      setImages([]);
      setDetailList(null);
      clearCaches();
    } catch (err) {
      pushError(err?.message || "Could not empty trash");
    }
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
        pushError(err?.message || "Failed to load image");
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
    if (key === "ai") {
      go(VIEW_PATH.ai);
      return;
    }
    setFilter(key);
    if (view !== "dashboard") go(VIEW_PATH.dashboard);
  };

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-surface-container text-on-surface font-body-md text-body-md">
      <Taskbar
        onSearch={openSearch}
        onSettings={() => go(VIEW_PATH.settings)}
        onUpload={() => go(VIEW_PATH.upload)}
        searchQuery={searchQuery}
      />
      <div className="flex-1 flex flex-col overflow-hidden px-4 pb-4">
        <div className="flex flex-1 overflow-hidden gap-3">
          <SidePanel
            activeKey={
              view === "upload"
                ? "upload"
                : view === "ai"
                  ? "ai"
                  : view === "dashboard"
                    ? filter
                    : null
            }
            onNavigate={handleNav}
            onSettings={() => go(VIEW_PATH.settings)}
          />
          <div className="flex-1 flex flex-col overflow-hidden bg-white rounded-[2rem] shadow-soft border border-black/5">
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
                      dropFromCache(objectKey);
                    })
                    .catch((err) => {
                      pushError(err?.message || "Restore failed");
                    })
                }
                onDeleteForever={deleteForever}
                onEmptyTrash={emptyTrashList}
                onChanged={() => {
                  clearCaches();
                  loadImages(filter);
                }}
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
                    pushError(err?.message || "Favorite update failed");
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
              />
            )}
            {view === "settings" && (
              <Settings imageCount={images.length} onBack={() => goBack()} />
            )}
            {view === "ai" && <Ai />}
          </div>
        </div>
      </div>
      <ErrorToaster />
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
  const [searchParams] = useSearchParams();
  const searchQuery = searchParams.get("q") || "";
  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-surface-container text-on-surface font-body-md text-body-md">
      <Taskbar
        onSearch={(q) => {
          if (q) navigate(`/?q=${encodeURIComponent(q)}`, { replace: true });
          else navigate("/", { replace: true });
        }}
        onSettings={() => go("/settings")}
        onUpload={() => go("/upload")}
        searchQuery={searchQuery}
      />
      <div className="flex-1 flex flex-col overflow-hidden px-4 pb-4">
        <div className="flex flex-1 overflow-hidden gap-3">
          <SidePanel
            activeKey={null}
            onNavigate={(key) => {
              if (key === "upload") go("/upload");
              else if (key === "ai") go("/ai");
              else go("/");
            }}
            onSettings={() => go("/settings")}
          />
          <div className="flex-1 flex flex-col overflow-hidden bg-white rounded-[2rem] shadow-soft border border-black/5">
            <Profile />
          </div>
        </div>
      </div>
    </div>
  );
}

export { VIEWS };
