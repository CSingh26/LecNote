import { useEffect, useId, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import DOMPurify from "dompurify";
import type { Visual } from "../types";
import { lecturePath } from "../lib/api";

export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { strict: true, trust: false }]]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          img: ({ src, alt }) =>
            typeof src === "string" && src.startsWith("/api/lectures/") ? (
              <img src={src} alt={alt || "Lecture image"} loading="lazy" />
            ) : (
              <span>{alt || "Image omitted"}</span>
            ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

let mermaidQueue = Promise.resolve();
function Mermaid({ source }: { source: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setSvg("");
    setError("");
    mermaidQueue = mermaidQueue.then(async () => {
      if (cancelled) return;
      try {
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "neutral",
          fontFamily: "system-ui",
          htmlLabels: false,
          flowchart: { htmlLabels: false },
          maxTextSize: 50000,
          suppressErrorRendering: true,
        });
        const result = await mermaid.render(`diagram${id}`, source);
        if (!cancelled)
          setSvg(
            DOMPurify.sanitize(result.svg, {
              USE_PROFILES: { svg: true, svgFilters: true },
              FORBID_TAGS: ["foreignObject", "script", "style"],
              FORBID_ATTR: ["onclick", "onload"],
            }),
          );
      } catch {
        if (!cancelled) setError("This diagram could not be rendered.");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [id, source]);
  return error ? (
    <div className="notice">
      {error}
      <details>
        <summary>Diagram source</summary>
        <pre>{source}</pre>
      </details>
    </div>
  ) : svg ? (
    <div
      className="mermaid"
      role="img"
      aria-label="Lecture diagram"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  ) : (
    <p className="muted">Rendering diagram…</p>
  );
}

export function NoteVisual({
  visual,
  lectureId,
}: {
  visual: Visual;
  lectureId: string;
}) {
  const asset = visual.image;
  const safeAsset =
    asset &&
    (asset.startsWith(`/api${lecturePath(lectureId)}/assets/`)
      ? asset
      : /^[a-zA-Z0-9_.-]+\.(png|jpg|jpeg|webp)$/i.test(asset)
        ? `/api${lecturePath(lectureId)}/assets/${encodeURIComponent(asset)}`
        : null);
  const pairs = (visual.x ?? [])
    .map((x, i) => ({ x, y: visual.y?.[i] }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  let points = "";
  if (pairs.length) {
    const xs = pairs.map((p) => p.x);
    const ys = pairs.map((p) => p.y);
    const xmin = Math.min(...xs);
    const xmax = Math.max(...xs);
    const ymin = Math.min(...ys);
    const ymax = Math.max(...ys);
    points = pairs
      .map(
        (p) =>
          `${50 + ((p.x - xmin) / (xmax - xmin || 1)) * 530},${230 - ((p.y - ymin) / (ymax - ymin || 1)) * 205}`,
      )
      .join(" ");
  }
  return (
    <figure className="note-visual">
      <figcaption>{visual.title}</figcaption>
      {visual.kind === "mermaid" && visual.mermaid ? (
        <Mermaid source={visual.mermaid} />
      ) : safeAsset ? (
        <img src={safeAsset} alt={visual.title} loading="lazy" />
      ) : pairs.length ? (
        <svg viewBox="0 0 640 285" role="img" aria-label={visual.title}>
          <line x1="50" y1="230" x2="590" y2="230" stroke="currentColor" />
          <line x1="50" y1="20" x2="50" y2="230" stroke="currentColor" />
          <polyline
            fill="none"
            stroke="#235b44"
            strokeWidth="2.5"
            points={points}
          />
          <text x="320" y="272" textAnchor="middle">
            {visual.x_label}
          </text>
          <text
            x="16"
            y="130"
            textAnchor="middle"
            transform="rotate(-90 16 130)"
          >
            {visual.y_label}
          </text>
        </svg>
      ) : (
        <p className="muted">No plot data available.</p>
      )}
      {visual.kind === "plot" && pairs.length > 0 && (
        <details>
          <summary>View plot data</summary>
          <table>
            <thead>
              <tr>
                <th>{visual.x_label || "x"}</th>
                <th>{visual.y_label || "y"}</th>
              </tr>
            </thead>
            <tbody>
              {pairs.map((p, i) => (
                <tr key={i}>
                  <td>{p.x}</td>
                  <td>{p.y}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </figure>
  );
}
