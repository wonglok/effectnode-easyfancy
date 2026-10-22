import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: "400",
  style: "italic",
});

export const metadata: Metadata = {
  // Absolute URLs for the generated Open Graph and Twitter images resolve
  // against this; file-convention icons (icon.svg, apple-icon.png, favicon.ico)
  // and social images are picked up automatically from this directory.
  metadataBase: new URL("https://effectnode.com"),
  title: {
    default: "effectnode-easy-fancy",
    template: "%s — effectnode-easy-fancy",
  },
  description:
    "effectnode-easy-fancy is a five-chapter demo of scroll-driven 3D on the web. Five real-time Three.js scenes, full-screen render targets and TSL transitions, rendered as you scroll.",
  applicationName: "effectnode-easy-fancy",
  keywords: [
    "WebGPU",
    "Three.js",
    "TSL",
    "React Three Fiber",
    "3D scroll website",
    "scroll-driven animation",
    "real-time 3D",
    "WebGPU demo",
    "creative development",
    "interactive experiences",
  ],
  authors: [{ name: "EffectNode", url: "https://effectnode.com" }],
  creator: "EffectNode",
  publisher: "EffectNode",
  category: "technology",
  alternates: { canonical: "/" },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "effectnode-easy-fancy",
    locale: "en_US",
    title: "effectnode-easy-fancy",
    description:
      "Scroll through five real-time WebGPU scenes. effectnode-easy-fancy is a 3D scroll website demo built with Three.js and TSL.",
  },
  twitter: {
    card: "summary_large_image",
    title: "effectnode-easy-fancy",
    description:
      "Scroll through five real-time WebGPU scenes. effectnode-easy-fancy is a 3D scroll website demo built with Three.js and TSL.",
  },
  appleWebApp: {
    capable: true,
    title: "effectnode-easy-fancy",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#030403",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} h-full`}
    >
      <body>{children}</body>
    </html>
  );
}
