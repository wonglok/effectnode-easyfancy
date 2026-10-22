"use client";

import {
  Component,
  type CSSProperties,
  type ReactNode,
  useEffect,
  useSyncExternalStore,
} from "react";
import { Canvas, type Renderer } from "@react-three/fiber";
import {
  ACESFilmicToneMapping,
  PCFShadowMap,
  SRGBColorSpace,
  WebGPURenderer,
} from "three/webgpu";
import { SceneDirector } from "./SceneDirector";
import { useScrollerStore } from "@/store/useScrollerStore";
import { SECTIONS } from "@/sections/registry";
import styles from "./SceneStage.module.css";

type BoundaryProps = {
  children: ReactNode;
  onError: () => void;
};

class CanvasBoundary extends Component<BoundaryProps, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

function GpuFallback() {
  const activeIndex = useScrollerStore((state) => state.activeIndex);
  const section = SECTIONS[activeIndex] ?? SECTIONS[0];

  return (
    <div
      className={styles.fallback}
      style={{ "--accent": section.accent } as CSSProperties}
      aria-hidden="true"
    >
      <div className={styles.fallbackOrb} />
      <div className={styles.fallbackGrid} />
      <div className={styles.fallbackNoise} />
    </div>
  );
}

const subscribeToGpu = () => () => {};
const hasWebGpuSnapshot = () =>
  typeof navigator !== "undefined" && "gpu" in navigator;
const getServerGpuSnapshot = () => null;

export function SceneStage() {
  const supported = useSyncExternalStore<boolean | null>(
    subscribeToGpu,
    hasWebGpuSnapshot,
    getServerGpuSnapshot,
  );
  const gpuStatus = useScrollerStore((state) => state.gpuStatus);

  useEffect(() => {
    if (supported === null) return;

    const state = useScrollerStore.getState();
    state.setGpuStatus(supported ? "checking" : "unsupported");

    if (!supported) return;

    const timeout = window.setTimeout(() => {
      const current = useScrollerStore.getState();
      if (current.gpuStatus === "checking") {
        current.setGpuStatus("error");
      }
    }, 12000);

    return () => window.clearTimeout(timeout);
  }, [supported]);

  if (supported === null) return null;
  if (!supported || gpuStatus === "error") return <GpuFallback />;

  return (
    <div className={styles.stage} aria-hidden="true">
      <CanvasBoundary
        onError={() => {
          useScrollerStore.getState().setGpuStatus("error");
        }}
      >
        <Canvas
          className={styles.canvas}
          dpr={[1, 1.65]}
          gl={async (props) => {
            try {
              const renderer = new WebGPURenderer({
                canvas: props.canvas as HTMLCanvasElement,
                antialias: true,
                alpha: false,
                powerPreference: "high-performance",
              });

              await renderer.init();
              renderer.toneMapping = ACESFilmicToneMapping;
              renderer.toneMappingExposure = 1.06;
              renderer.outputColorSpace = SRGBColorSpace;
              renderer.setClearColor(0x030405, 1);

              if (
                !renderer.backend ||
                !("isWebGPUBackend" in renderer.backend)
              ) {
                throw new Error("WebGPU backend unavailable");
              }

              return renderer as unknown as Renderer;
            } catch (error) {
              useScrollerStore.getState().setGpuStatus("error");
              throw error;
            }
          }}
          camera={{ position: [0, 0, 6], fov: 42 }}
          frameloop="always"
          shadows={{ enabled: false, type: PCFShadowMap }}
          onCreated={() => {
            useScrollerStore.getState().setGpuStatus("ready");
          }}
          resize={{ debounce: 80 }}
        >
          <SceneDirector />
        </Canvas>
      </CanvasBoundary>
    </div>
  );
}
