/**
 * Reads the website's section registry in a child process whose cwd is the
 * project, so tsx resolves that project's tsconfig aliases (`@/...`). Prints a
 * single JSON payload on the last line of stdout.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type SceneInfo = {
  id: string;
  index: number;
  chapter: string;
  name: string;
  title: string;
  accent: string;
  surface: string;
};

type TransitionInfo = {
  from: number;
  to: number;
  kind: string;
  label: string;
};

type ScenePayload = {
  scenes: SceneInfo[];
  source: string | null;
  transitions: TransitionInfo[];
  transitionSource: string | null;
  error?: string;
};

const cwd = process.cwd();
const sectionDir = path.join(cwd, "src", "sections");
const registry = ["registry.ts", "registry.tsx", "registry.js"]
  .map((name) => path.join(sectionDir, name))
  .find((file) => fs.existsSync(file));

/**
 * Pulls the index pairs out of a condition in render-pipeline.ts, e.g.
 * `(fromIndex === 3 && toIndex === 4) || (fromIndex === 4 && toIndex === 3)`.
 */
function extractPairs(source: string, name: string): Array<[number, number]> {
  const block =
    new RegExp(`${name}\\s*=\\s*([\\s\\S]*?);`).exec(source)?.[1] ?? "";
  const pairs: Array<[number, number]> = [];
  const pairRe = /fromIndex\s*===\s*(\d+)\s*&&\s*toIndex\s*===\s*(\d+)/g;
  let match = pairRe.exec(block);
  while (match) {
    pairs.push([Number(match[1]), Number(match[2])]);
    match = pairRe.exec(block);
  }
  return pairs;
}

/**
 * The pipeline picks a shader per adjacent pair: page curl for the last pair,
 * column melt for 1 ↔ 2, and the liquid wipe otherwise. Mirror that mapping so
 * the timeline uses the same names as the site.
 */
function readTransitions(scenes: SceneInfo[]): {
  transitions: TransitionInfo[];
  transitionSource: string | null;
} {
  const pipeline = ["render-pipeline.ts", "render-pipeline.tsx"]
    .map((name) => path.join(cwd, "src", "lib", name))
    .find((file) => fs.existsSync(file));

  if (!pipeline) return { transitions: [], transitionSource: null };

  let source = "";
  try {
    source = fs.readFileSync(pipeline, "utf8");
  } catch {
    return { transitions: [], transitionSource: null };
  }

  const pageCurlPairs = extractPairs(source, "isPageCurlPair");
  const meltPairs = extractPairs(source, "isMeltPair");
  const understood = pageCurlPairs.length > 0 || meltPairs.length > 0;
  if (!understood) return { transitions: [], transitionSource: null };

  const matches = (pairs: Array<[number, number]>, a: number, b: number) =>
    pairs.some(([from, to]) => (from === a && to === b) || (from === b && to === a));

  const transitions: TransitionInfo[] = [];
  for (let index = 0; index < scenes.length - 1; index += 1) {
    const from = scenes[index].index;
    const to = scenes[index + 1].index;
    const transition = matches(pageCurlPairs, from, to)
      ? { kind: "page-curl", label: "page curl" }
      : matches(meltPairs, from, to)
        ? { kind: "melt", label: "melt" }
        : { kind: "liquid", label: "liquid" };
    transitions.push({ from, to, ...transition });
  }

  return {
    transitions,
    transitionSource: path.relative(cwd, pipeline),
  };
}

async function main(): Promise<ScenePayload> {
  if (!registry) {
    return {
      scenes: [],
      source: null,
      transitions: [],
      transitionSource: null,
      error: "No src/sections/registry.ts found in the working directory.",
    };
  }

  try {
    const mod = (await import(pathToFileURL(registry).href)) as {
      SECTIONS?: unknown;
    };
    const sections = Array.isArray(mod.SECTIONS) ? mod.SECTIONS : [];
    const scenes = sections
      .map((entry) => {
        const scene = (entry ?? {}) as Record<string, unknown>;
        return {
          id: String(scene.id ?? ""),
          index: Number(scene.index ?? 0),
          chapter: String(scene.chapter ?? ""),
          name: String(scene.name ?? ""),
          title: String(scene.title ?? ""),
          accent: String(scene.accent ?? "#ffb46b"),
          surface: String(scene.surface ?? "#151009"),
        };
      })
      .filter((scene) => scene.id && scene.name)
      .sort((a, b) => a.index - b.index);

    const { transitions, transitionSource } = readTransitions(scenes);

    return {
      scenes,
      source: path.relative(cwd, registry),
      transitions,
      transitionSource,
      error: scenes.length ? undefined : "The registry did not export SECTIONS.",
    };
  } catch (error: unknown) {
    return {
      scenes: [],
      source: path.relative(cwd, registry),
      transitions: [],
      transitionSource: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const payload = await main();
console.log(JSON.stringify(payload));
