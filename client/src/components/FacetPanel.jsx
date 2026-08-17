const TYPE_LABELS = { jpg: "JPEG", png: "PNG", raw: "RAW" };

const dayLabel = (day) => {
  try {
    return new Date(day).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return day;
  }
};

function Section({ title, dotCls, activeLabel, children }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-midnight-ink flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full shrink-0 ${dotCls}`} />
        {title}
        {activeLabel && (
          <span className="font-mono-data text-mono-data text-on-surface-variant">
            {activeLabel}
          </span>
        )}
      </h3>
      {children}
    </section>
  );
}

function Row({ active, activeCls, label, n, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full px-3 py-2 flex items-center justify-between gap-2 rounded-xl text-sm transition-all cursor-pointer ${
        active
          ? activeCls
          : "text-on-surface-variant bg-white/40 hover:bg-white hover:text-midnight-ink shadow-sm"
      }`}
      title={label}
    >
      <span className="flex items-center gap-2 min-w-0">
        {active && (
          <span className="material-symbols-outlined text-[14px] shrink-0">
            check
          </span>
        )}
        <span className="truncate font-medium text-left">{label}</span>
      </span>
      <span className="font-mono-data text-mono-data shrink-0 opacity-70">
        {n}
      </span>
    </button>
  );
}

export default function FacetPanel({
  facets,
  facetTags = [],
  facetType = null,
  facetDay = null,
  onToggleTag,
  onToggleType,
  onToggleDay,
}) {
  if (!facets) return null;

  const tags = facets.tags || [];
  const types = facets.types || [];
  const days = facets.days || [];
  const activeCount =
    facetTags.length + (facetType ? 1 : 0) + (facetDay ? 1 : 0);

  const clearAll = () => {
    for (const t of facetTags) onToggleTag(t);
    if (facetType) onToggleType(facetType);
    if (facetDay) onToggleDay(facetDay);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-midnight-ink flex items-center gap-2">
          <span className="material-symbols-outlined text-[16px] text-on-surface-variant">
            tune
          </span>
          Refine
          {activeCount > 0 && (
            <span className="font-mono-data text-mono-data text-on-surface-variant">
              ({activeCount})
            </span>
          )}
        </h3>
        {activeCount > 0 && (
          <button
            onClick={clearAll}
            className="text-xs font-medium text-on-surface-variant hover:text-error transition-colors flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[14px]">close</span>
            Clear
          </button>
        )}
      </div>

      <Section
        title="Tags"
        dotCls="bg-primary"
        activeLabel={facetTags.length > 0 ? `${facetTags.length} active` : ""}
      >
        {tags.length === 0 ? (
          <p className="text-xs text-on-surface-variant">
            No tags in this result set yet.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {tags.map(({ tag, n }) => (
              <Row
                key={tag}
                active={facetTags.includes(tag)}
                activeCls="bg-primary text-white"
                label={tag}
                n={n}
                onClick={() => onToggleTag(tag)}
              />
            ))}
          </div>
        )}
      </Section>

      <Section title="Type" dotCls="bg-tertiary-container">
        {types.length === 0 ? (
          <p className="text-xs text-on-surface-variant">No types yet.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {types.map(({ type, n }) => (
              <Row
                key={type}
                active={facetType === type}
                activeCls="bg-tertiary-container text-on-tertiary-container"
                label={TYPE_LABELS[type] || type.toUpperCase()}
                n={n}
                onClick={() => onToggleType(type)}
              />
            ))}
          </div>
        )}
      </Section>

      <Section title="Date" dotCls="bg-secondary">
        {days.length === 0 ? (
          <p className="text-xs text-on-surface-variant">No dates yet.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {days.map(({ day, n }) => (
              <Row
                key={day}
                active={facetDay === day}
                activeCls="bg-secondary text-on-secondary"
                label={dayLabel(day)}
                n={n}
                onClick={() => onToggleDay(day)}
              />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
