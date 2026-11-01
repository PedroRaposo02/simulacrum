import init, { Engine } from "./wasm/wf_wasm.js";

let engine: Promise<Engine> | null = null;

function getEngine(): Promise<Engine> {
  engine ??= Promise.all([init(), fetch(`${import.meta.env.BASE_URL}gamedata.json`).then((r) => r.text())]).then(
    ([, text]) => new Engine(text),
  );
  return engine;
}

self.onmessage = async (e: MessageEvent<{ id: number; weapon: string; base: string; target: string; options: string }>) => {
  const { id, weapon, base, target, options } = e.data;
  try {
    const eng = await getEngine();
    self.postMessage({ id, result: eng.optimize(weapon, base, target, options) });
  } catch (err) {
    self.postMessage({ id, result: JSON.stringify({ error: { code: "internal", message: String(err) } }) });
  }
};
