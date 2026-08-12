export default function Avatar({ size = 32 }) {
  return (
    <div
      className="rounded-full border border-outline-variant overflow-hidden flex items-center justify-center bg-gradient-to-br from-primary-container to-tertiary-container text-primary shrink-0"
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
