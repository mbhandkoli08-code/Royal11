import { useCallback, useEffect, useState } from "react";
import { Gift, Crown, Sparkles, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useConsoleApi } from "./api";
import { CARD, PanelHeader, Spinner } from "./primitives";

const Field = ({ label, value, onChange, step, suffix }) => (
  <label className="block">
    <span className="mb-1 block text-xs font-bold text-slate-500">{label}</span>
    <div className="flex items-center gap-1">
      <input type="number" step={step || 1} value={value ?? ""} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900 focus:border-royal focus:outline-none"
        data-testid={`cfg-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} />
      {suffix && <span className="text-xs font-bold text-slate-400">{suffix}</span>}
    </div>
  </label>
);

const Section = ({ icon: Icon, title, desc, children, onSave, saving }) => (
  <div className={`${CARD} p-6`}>
    <div className="mb-4 flex items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-royal-light text-royal"><Icon className="h-5 w-5" /></span>
        <div>
          <p className="font-display text-base font-extrabold text-slate-900">{title}</p>
          <p className="text-xs text-slate-500">{desc}</p>
        </div>
      </div>
      <button onClick={onSave} disabled={saving} data-testid={`save-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-royal px-4 py-2 text-xs font-bold text-white transition-transform hover:-translate-y-0.5 disabled:opacity-60">
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
      </button>
    </div>
    {children}
  </div>
);

export const RewardsConfigPanel = () => {
  const api = useConsoleApi();
  const [bonus, setBonus] = useState(null);
  const [vip, setVip] = useState(null);
  const [box, setBox] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [b, v, s] = await Promise.all([
        api.get("/bonus/config"), api.get("/casino/admin/vip-config"), api.get("/bonus/surprise-box-config"),
      ]);
      setBonus(b.data); setVip(v.data); setBox(s.data);
    } catch { toast.error("Couldn't load reward configs"); }
    finally { setLoading(false); }
  }, [api]);
  useEffect(() => { load(); }, [load]);

  const save = async (which, path, body) => {
    setSaving(which);
    try { await api.put(path, body); toast.success("Saved"); }
    catch { toast.error("Save failed"); }
    finally { setSaving(""); }
  };

  const setVipTier = (i, key, val) => setVip((v) => ({ ...v, tiers: v.tiers.map((t, idx) => idx === i ? { ...t, [key]: Number(val) } : t) }));
  const setBoxCap = (key, val) => setBox((b) => ({ ...b, tier_caps: { ...b.tier_caps, [key]: Number(val) } }));

  if (loading) return <Spinner label="Loading reward settings…" />;

  return (
    <div className="space-y-5" data-testid="rewards-config-panel">
      <PanelHeader title="Rewards & Bonuses" subtitle="Tune the shared bonus rail, VIP tier perks and the Weekly Surprise Box. All bonuses are non-withdrawable until played through." />

      {/* Bonus rail */}
      <Section icon={Gift} title="Bonus Rail" desc="Global wagering (playthrough) rules for every bonus." saving={saving === "bonus-rail"}
        onSave={() => save("bonus-rail", "/bonus/config", { multiple: Number(bonus.multiple), release_mode: bonus.release_mode, expiry_days: Number(bonus.expiry_days), max_bet_while_bonus: bonus.max_bet_while_bonus === null || bonus.max_bet_while_bonus === "" ? null : Number(bonus.max_bet_while_bonus) })}>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Field label="Wagering Multiple" value={bonus.multiple} suffix="x" onChange={(v) => setBonus({ ...bonus, multiple: v })} />
          <Field label="Expiry Days" value={bonus.expiry_days} onChange={(v) => setBonus({ ...bonus, expiry_days: v })} />
          <Field label="Max Bet While Bonus" value={bonus.max_bet_while_bonus} onChange={(v) => setBonus({ ...bonus, max_bet_while_bonus: v })} />
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-slate-500">Release Mode</span>
            <select value={bonus.release_mode} onChange={(e) => setBonus({ ...bonus, release_mode: e.target.value })} data-testid="cfg-release-mode"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900 focus:border-royal focus:outline-none">
              <option value="incremental">Incremental</option>
              <option value="on_complete">On complete</option>
            </select>
          </label>
        </div>
      </Section>

      {/* VIP tiers */}
      <Section icon={Crown} title="VIP Tiers" desc="Recharge bonus % + rakeback per loyalty tier." saving={saving === "vip-tiers"}
        onSave={() => save("vip-tiers", "/casino/admin/vip-config", { tiers: vip.tiers, recharge_bonus_max_coins: Number(vip.recharge_bonus_max_coins) })}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead><tr className="text-xs font-bold uppercase text-slate-400"><th className="pb-2">Tier</th><th className="pb-2">Min XP</th><th className="pb-2">Recharge Bonus %</th><th className="pb-2">Rakeback %</th></tr></thead>
            <tbody>
              {vip.tiers.map((t, i) => (
                <tr key={t.key} data-testid={`vip-tier-${t.key}`}>
                  <td className="py-1.5 pr-3 font-bold capitalize text-slate-900">{t.label}</td>
                  <td className="py-1.5 pr-3"><input type="number" value={t.min_xp} onChange={(e) => setVipTier(i, "min_xp", e.target.value)} className="w-28 rounded-lg border border-slate-200 px-2 py-1.5 text-sm" data-testid={`vip-${t.key}-min-xp`} /></td>
                  <td className="py-1.5 pr-3"><input type="number" value={t.recharge_bonus_pct ?? 0} onChange={(e) => setVipTier(i, "recharge_bonus_pct", e.target.value)} className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-sm" data-testid={`vip-${t.key}-recharge-pct`} /></td>
                  <td className="py-1.5"><input type="number" value={t.rakeback_pct ?? 0} onChange={(e) => setVipTier(i, "rakeback_pct", e.target.value)} className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-sm" data-testid={`vip-${t.key}-rakeback`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 max-w-xs"><Field label="Recharge Bonus Cap" value={vip.recharge_bonus_max_coins} suffix="coins" onChange={(v) => setVip({ ...vip, recharge_bonus_max_coins: v })} /></div>
      </Section>

      {/* Surprise box */}
      <Section icon={Sparkles} title="Weekly Surprise Box" desc="Qualification + reward scaling for the weekly box." saving={saving === "weekly-surprise-box"}
        onSave={() => save("weekly-surprise-box", "/bonus/surprise-box-config", { ...box, min_rounds: Number(box.min_rounds), full_rounds: Number(box.full_rounds), floor_factor: Number(box.floor_factor), bonus_pct: Number(box.bonus_pct), consolation: Number(box.consolation), expiry_days: Number(box.expiry_days), multiple: Number(box.multiple) })}>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Field label="Min Rounds" value={box.min_rounds} onChange={(v) => setBox({ ...box, min_rounds: v })} />
          <Field label="Full Rounds" value={box.full_rounds} onChange={(v) => setBox({ ...box, full_rounds: v })} />
          <Field label="Floor Factor" step="0.05" value={box.floor_factor} onChange={(v) => setBox({ ...box, floor_factor: v })} />
          <Field label="Bonus %" value={box.bonus_pct} suffix="%" onChange={(v) => setBox({ ...box, bonus_pct: v })} />
          <Field label="Consolation" value={box.consolation} suffix="coins" onChange={(v) => setBox({ ...box, consolation: v })} />
          <Field label="Expiry Days" value={box.expiry_days} onChange={(v) => setBox({ ...box, expiry_days: v })} />
          <Field label="Wagering Multiple" value={box.multiple} suffix="x" onChange={(v) => setBox({ ...box, multiple: v })} />
        </div>
        <p className="mt-4 mb-2 text-xs font-bold text-slate-500">Per-tier reward caps</p>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {Object.entries(box.tier_caps || {}).map(([k, v]) => (
            <Field key={k} label={k} value={v} suffix="coins" onChange={(val) => setBoxCap(k, val)} />
          ))}
        </div>
      </Section>
    </div>
  );
};
