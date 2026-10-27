import type { ReactNode } from "react";

/** What kind of thing a file is, judged by its name.
 *
 *  Grouped by role rather than by language: a reader scanning a tree wants
 *  "code / markup / config / picture", not thirty different logos. Colour does
 *  the same job — enough to tell a stylesheet from a script at a glance, without
 *  becoming a legend nobody has read. */
type Kind =
  | "folder"
  | "code"
  | "markup"
  | "style"
  | "config"
  | "doc"
  | "image"
  | "lock"
  | "plain";

/** Extensions worth telling apart. Anything unlisted falls to `plain`, which is
 *  a real answer — an unknown file is a file. */
const BY_EXTENSION: Record<string, Kind> = {
  ts: "code", tsx: "code", js: "code", jsx: "code", mjs: "code", cjs: "code",
  rs: "code", py: "code", go: "code", java: "code", kt: "code", rb: "code",
  cs: "code", cpp: "code", c: "code", h: "code", swift: "code", php: "code",
  sh: "code", ps1: "code", bat: "code", cmd: "code", sql: "code",

  html: "markup", htm: "markup", xml: "markup", svg: "markup", vue: "markup",

  css: "style", scss: "style", sass: "style", less: "style",

  json: "config", yaml: "config", yml: "config", toml: "config", ini: "config",
  env: "config", conf: "config",

  md: "doc", mdx: "doc", txt: "doc", rst: "doc", pdf: "doc",

  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image",
  ico: "image", bmp: "image", avif: "image",
};

/** Files whose whole name decides it — a lockfile is not a config you edit. */
const BY_NAME: Record<string, Kind> = {
  "package-lock.json": "lock",
  "cargo.lock": "lock",
  "yarn.lock": "lock",
  "pnpm-lock.yaml": "lock",
  "poetry.lock": "lock",
  ".gitignore": "config",
  dockerfile: "config",
  makefile: "config",
};

export function kindOf(name: string, isDir: boolean): Kind {
  if (isDir) return "folder";
  const lower = name.toLowerCase();
  if (BY_NAME[lower]) return BY_NAME[lower];
  const dot = lower.lastIndexOf(".");
  // A leading dot is not an extension: `.gitignore` is its whole name.
  const ext = dot > 0 ? lower.slice(dot + 1) : "";
  return BY_EXTENSION[ext] ?? "plain";
}

/** One glyph per kind, drawn rather than fetched.
 *
 *  Inline SVG because this is an offline desktop app and an icon font would be
 *  a download that sometimes is not there. `aria-hidden` throughout: the file
 *  name beside it already says what this is, and a screen reader announcing
 *  "image, image, style, style" down a tree is noise, not information. */
const PATHS: Record<Kind, ReactNode> = {
  folder: <path d="M2 4.5h4l1.2 1.5H14v7.5H2z" />,
  // Angle brackets — the same shape the Develop tab uses for code.
  code: (
    <path
      d="M6 5.5L2.5 8 6 10.5M10 5.5L13.5 8 10 10.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  markup: (
    <path
      d="M5.5 3.5l-1 9M11 3.5l-1 9M3 6.5h10M3 9.5h10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
    />
  ),
  // A brush: presentation rather than logic.
  style: <path d="M3 11l5-5 2 2-5 5H3zM9.5 4.5l2-2 2 2-2 2z" />,
  // Sliders, matching Admin's settings glyph.
  config: (
    <>
      <path d="M3 5.5h10M3 10.5h10" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="6" cy="5.5" r="1.8" />
      <circle cx="10" cy="10.5" r="1.8" />
    </>
  ),
  // Lines of prose on a page.
  doc: (
    <>
      <path d="M4 2.5h5.5L12 5v8.5H4z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5.8 7h4.4M5.8 9.3h4.4M5.8 11.6h2.6" stroke="currentColor" strokeWidth="1.1" />
    </>
  ),
  image: (
    <>
      <rect x="2.5" y="3.5" width="11" height="9" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="6" cy="6.5" r="1.1" />
      <path d="M3.5 11l3-3 2.5 2.5 2-1.5 2 2" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </>
  ),
  // A padlock: generated, and not yours to edit by hand.
  lock: (
    <>
      <rect x="4" y="7" width="8" height="6" rx="1.2" />
      <path d="M6 7V5.5a2 2 0 0 1 4 0V7" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </>
  ),
  plain: (
    <path d="M4 2.5h5.5L12 5v8.5H4z" fill="none" stroke="currentColor" strokeWidth="1.2" />
  ),
};

/** The icon for one tree entry.
 *
 *  Decorative by design — the name is right beside it, so this is a scanning
 *  aid rather than information of its own. */
export default function FileIcon({ name, isDir }: { name: string; isDir: boolean }) {
  const kind = kindOf(name, isDir);
  return (
    <svg
      className={`file-icon kind-${kind}`}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[kind]}
    </svg>
  );
}
