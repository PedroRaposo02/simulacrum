import Logo from "./Logo";
import { SITE } from "./site";
import { useStore } from "./store";
import BestBuildDisclaimer from "./Disclaimer";

const FEATURES: [string, string][] = [
  ["Every weapon", "Primaries, secondaries, melee with stances, arch-guns and companion weapons, each attack mode computed separately."],
  ["Explainable numbers", "Every figure opens into the step-by-step calculation: mods, crit, status, armor and Viral."],
  ["Best builds", "A search over mods, arcanes, Incarnon evolutions and a theoretical riven, with comfort and capacity options."],
  ["Rivens", "Real roll ranges with sliders, spliced stats, and a grade against the god roll for your weapon."],
  ["Scenario", "Enemy presets, outsourced Viral and Corrosive, Corrosive Projection, Roar, Eclipse, Nourish and companion bonds."],
];

export default function Home() {
  const { setTab, data } = useStore();
  return (
    <div className="mx-auto max-w-3xl space-y-6 py-6">
      <div className="flex items-center gap-4">
        <Logo className="h-14 w-14" />
        <div>
          <h2 className="text-2xl font-semibold">Welcome to {SITE.title}</h2>
          <p className="text-zinc-500">{SITE.tagline}.</p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <button onClick={() => setTab("browser")} className="card text-left hover:border-indigo-500">
          <div className="font-semibold">Weapons →</div>
          <p className="text-sm text-zinc-500">Rank all {data?.weapons.length ?? ""} weapons by category, unmodded or with their best builds.</p>
        </button>
        <button onClick={() => setTab("build")} className="card text-left hover:border-indigo-500">
          <div className="font-semibold">Build editor →</div>
          <p className="text-sm text-zinc-500">Mod a weapon, add a riven and evolutions, and let the optimizer find the best build.</p>
        </button>
      </div>
      <div className="card space-y-2">
        <h3 className="font-semibold">What it does</h3>
        <ul className="space-y-1.5 text-sm">
          {FEATURES.map(([t, d]) => (
            <li key={t}>
              <span className="font-medium">{t}:</span> <span className="text-zinc-500">{d}</span>
            </li>
          ))}
        </ul>
      </div>
      <BestBuildDisclaimer />
      <p className="text-xs text-zinc-500">
        Beta: numbers are modelled from wiki and community data and can be wrong. Each attack shows how confident the model is (Computed / Approximate /
        Unsupported).
      </p>
    </div>
  );
}
