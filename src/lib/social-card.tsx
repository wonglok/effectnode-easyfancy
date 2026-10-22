import { ImageResponse } from "next/og";

export const SOCIAL_SIZE = { width: 1200, height: 630 };

export const SOCIAL_ALT =
  "effectnode-easy-fancy — a lime e mark beside the project name over a dark teal field.";

const TITLE = "effectnode-easy-fancy";
const TAGLINE = "Real-time experiences, rendered beyond the pixel.";

/**
 * One social card shared by `opengraph-image` and `twitter-image`, so both
 * cards always carry the current project name.
 */
export function renderSocialCard(): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background:
            "linear-gradient(135deg, #040b07 0%, #071712 55%, #0b241e 100%)",
          color: "#f3fbf4",
          fontFamily: "sans-serif",
          border: "1px solid rgba(168, 240, 106, 0.28)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 76,
              height: 76,
              borderRadius: 20,
              border: "2px solid #a8f06a",
              color: "#a8f06a",
              fontSize: 46,
              fontWeight: 600,
            }}
          >
            e
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 24,
              letterSpacing: 9,
              color: "#8fb39f",
            }}
          >
            EFFECTNODE
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div
            style={{
              display: "flex",
              fontSize: 82,
              fontWeight: 600,
              letterSpacing: -2,
              lineHeight: 1,
              color: "#f3fbf4",
            }}
          >
            {TITLE}
          </div>
          <div
            style={{ display: "flex", fontSize: 30, color: "#9fc4ae" }}
          >
            {TAGLINE}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            fontSize: 22,
            letterSpacing: 2,
            color: "#6f8f7c",
          }}
        >
          <span>WebGPU</span>
          <span>·</span>
          <span>Three.js</span>
          <span>·</span>
          <span>TSL</span>
          <span>·</span>
          <span>5 chapters</span>
        </div>
      </div>
    ),
    SOCIAL_SIZE,
  );
}
