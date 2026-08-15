const NAV_LINK =
  "flex items-center gap-gutter text-on-surface-variant px-4 py-3 hover:bg-surface-container-highest transition-all rounded-xl font-label-caps text-label-caps translate-x-1 hover:translate-x-0";

const NAV_ACTIVE =
  "flex items-center gap-gutter bg-surface-container-high text-primary rounded-xl px-4 py-3 transition-all translate-x-1 font-label-caps text-label-caps";

const NAV_ITEMS = [
  { key: "all", icon: "photo_library", label: "All Photos", fill: true },
  { key: "recent", icon: "schedule", label: "Recent", fill: false },
  { key: "favorites", icon: "star", label: "Favorites", fill: false },
  { key: "trash", icon: "delete", label: "Trash", fill: false },
  { key: "upload", icon: "cloud_upload", label: "Uploads", fill: false },
];

export default function SidePanel({ activeKey, onNavigate, onSettings }) {
  return (
    <aside className="bg-surface-container-low border-r border-outline-variant w-panel-width-fixed flex flex-col p-4">
      <div className="mb-6 px-4">
        <h2 className="font-headline-md text-headline-md text-primary">
          Library
        </h2>
        <p className="font-body-sm text-body-sm text-on-surface-variant">
          Visual Assets
        </p>
      </div>
      <nav className="flex-1 flex flex-col gap-1 font-label-caps text-label-caps">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            onClick={() => onNavigate(item.key)}
            className={activeKey === item.key ? NAV_ACTIVE : NAV_LINK}
          >
            <span
              className="material-symbols-outlined"
              style={
                item.fill ? { fontVariationSettings: "'FILL' 1" } : undefined
              }
            >
              {item.icon}
            </span>
            {item.label}
          </button>
        ))}
      </nav>
      <div className="mt-auto pt-4 border-t border-outline-variant flex flex-col gap-1 font-label-caps text-label-caps">
        <button
          onClick={onSettings}
          className="flex items-center gap-gutter text-on-surface-variant px-4 py-3 hover:bg-surface-container-highest transition-all font-label-caps text-label-caps"
        >
          <span className="material-symbols-outlined">help</span>
          Settings
        </button>
      </div>
    </aside>
  );
}
