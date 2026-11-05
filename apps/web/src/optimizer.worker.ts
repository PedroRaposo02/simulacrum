import init, { Engine } from "./wasm/wf_wasm.js";

let engine: Promise<Engine> | null = null;

// The page sends the data file's address: relative paths here would resolve against this worker's
// own folder (assets/), not the page.
function getEngine(dataUrl: string): Promise<Engine> {
  engine ??= Promise.all([
    init(),
    fetch(dataUrl).then((r) => {
      if (!r.ok) throw new Error(`game data: HTTP ${r.status}`);
      return r.text();
    }),
  ]).then(([, text]) => new Engine(text));
  return engine;
}

self.onmessage = async (
  e: MessageEvent<{ id: number; kind?: "optimize" | "rankRivens" | "modes"; dataUrl: string; weapon: string; base: string; target: string; options: string }>,
) => {
  const { id, kind, dataUrl, weapon, base, target, options } = e.data;
  try {
    const eng = await getEngine(dataUrl);
    const result =
      kind === "rankRivens"
        ? eng.rankRivens(weapon, base, target, options)
        : kind === "modes"
          ? eng.candidateModes(weapon, base, target)
          : eng.optimize(weapon, base, target, options);
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, result: JSON.stringify({ error: { code: "internal", message: String(err) } }) });
  }
};
