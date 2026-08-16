import { useState } from "react";

const NAV_ITEM_BASE =
  "flex items-center gap-gutter text-on-surface-variant px-4 py-3 hover:bg-surface-container-highest transition-all rounded-xl font-label-caps text-label-caps translate-x-1 hover:translate-x-0";
const NAV_ITEM_COLLAPSED =
  "flex items-center gap-gutter text-on-surface-variant hover:bg-surface-container-highest transition-all rounded-xl font-label-caps text-label-caps justify-center px-0";

const NAV_ACTIVE_BASE =
  "flex items-center gap-gutter bg-surface-container-high text-primary rounded-xl px-4 py-3 transition-all translate-x-1 font-label-caps text-label-caps";
const NAV_ACTIVE_COLLAPSED =
  "flex items-center gap-gutter bg-surface-container-high text-primary rounded-xl py-3 transition-all font-label-caps text-label-caps justify-center px-0";

const NAV_ITEMS = [
  { key: "all", icon: "photo_library", label: "All Photos", fill: true },
  { key: "recent", icon: "schedule", label: "Recent", fill: false },
  { key: "favorites", icon: "star", label: "Favorites", fill: false },
  { key: "trash", icon: "delete", label: "Trash", fill: false },
  { key: "upload", icon: "cloud_upload", label: "Uploads", fill: false },
];

export default function SidePanel({ activeKey, onNavigate, onSettings }) {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("kashida_sidebar_collapsed") === "1",
  );

  const toggle = () => {
    setCollapsed((prev) => {
      localStorage.setItem("kashida_sidebar_collapsed", prev ? "0" : "1");
      return !prev;
    });
  };

  const navClass = (isActive) =>
    isActive
      ? collapsed
        ? NAV_ACTIVE_COLLAPSED
        : NAV_ACTIVE_BASE
      : collapsed
        ? NAV_ITEM_COLLAPSED
        : NAV_ITEM_BASE;

  return (
    <aside
      className={`bg-surface-container-low border-r border-outline-variant flex flex-col p-4 transition-all duration-200 ease-in-out overflow-hidden ${
        collapsed ? "w-[76px]" : "w-panel-width-fixed"
      }`}
    >
      <div
        className={`mb-6 flex items-center ${
          collapsed ? "justify-center" : "justify-between"
        }`}
      >
        {!collapsed && (
          <div>
            <h2 className="font-headline-md text-headline-md text-primary">
              Library
            </h2>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              Visual Assets
            </p>
          </div>
        )}
        <button
          onClick={toggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-surface-container-highest text-on-surface-variant transition-colors shrink-0"
        >
          <span className="material-symbols-outlined text-[20px]">
            {collapsed ? "menu" : "menu_open"}
          </span>
        </button>
      </div>
      <nav
        className={`flex-1 flex flex-col font-label-caps text-label-caps ${
          collapsed ? "gap-3" : "gap-1"
        }`}
      >
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            onClick={() => onNavigate(item.key)}
            title={collapsed ? item.label : undefined}
            className={navClass(activeKey === item.key)}
          >
            <span
              className="material-symbols-outlined"
              style={
                item.fill ? { fontVariationSettings: "'FILL' 1" } : undefined
              }
            >
              {item.icon}
            </span>
            {!collapsed && item.label}
          </button>
        ))}
      </nav>
      <div className="mt-auto pt-4 border-t border-outline-variant flex flex-col gap-1 font-label-caps text-label-caps">
        <button
          onClick={onSettings}
          title={collapsed ? "Settings" : undefined}
          className={`flex items-center gap-gutter text-on-surface-variant px-4 py-3 hover:bg-surface-container-highest transition-all font-label-caps text-label-caps ${
            collapsed ? "justify-center px-0" : ""
          }`}
        >
          <span className="material-symbols-outlined">settings</span>
          {!collapsed && "Settings"}
        </button>
      </div>
    </aside>
  );
}
