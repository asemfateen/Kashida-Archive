export default function Avatar({ size = 40 }) {
  return (
    <div
      className="rounded-full bg-midnight-ink flex items-center justify-center text-white hover:bg-prussian-navy transition-colors shadow-sm shrink-0"
      style={{ width: size, height: size }}
      title="Photo Editor"
    >
      <span
        className="material-symbols-outlined"
        style={{ fontSize: size * 0.55 }}
      >
        person
      </span>
    </div>
  );
}
