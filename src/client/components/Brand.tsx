import { Link } from "react-router-dom";
export function Brand() {
  return (
    <Link to="/" className="brand" aria-label="Maplora home">
      <svg
        width="30"
        height="30"
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M16 16 6 6m10 10L26 7M16 16l10 10M16 16 6 26"
          stroke="currentColor"
          strokeWidth="2"
        />
        <circle cx="16" cy="16" r="5" fill="currentColor" />
        <circle cx="5" cy="5" r="3" fill="currentColor" />
        <circle cx="27" cy="6" r="3" fill="currentColor" />
        <circle cx="27" cy="27" r="3" fill="currentColor" />
        <circle cx="5" cy="27" r="3" fill="currentColor" />
      </svg>
      maplora<span className="brand-dot">.</span>
    </Link>
  );
}
export function MapGlyph() {
  return (
    <svg viewBox="0 0 160 90" fill="none" aria-hidden="true">
      <path
        d="M80 45C50 45 62 20 32 20M80 45C50 45 62 70 32 70M80 45C110 45 98 20 128 20M80 45C110 45 98 70 128 70"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect
        x="60"
        y="34"
        width="40"
        height="22"
        rx="7"
        fill="currentColor"
        opacity=".8"
      />
      <rect
        x="8"
        y="13"
        width="32"
        height="14"
        rx="4"
        fill="currentColor"
        opacity=".3"
      />
      <rect
        x="8"
        y="63"
        width="32"
        height="14"
        rx="4"
        fill="currentColor"
        opacity=".3"
      />
      <rect
        x="120"
        y="13"
        width="32"
        height="14"
        rx="4"
        fill="currentColor"
        opacity=".3"
      />
      <rect
        x="120"
        y="63"
        width="32"
        height="14"
        rx="4"
        fill="currentColor"
        opacity=".3"
      />
    </svg>
  );
}
