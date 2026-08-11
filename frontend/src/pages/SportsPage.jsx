import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Radio, CalendarClock, History, ChevronRight, Loader2 } from "lucide-react";
import axios from "axios";
import { Logo } from "@/components/Logo";
import { MatchDetail } from "@/components/MatchDetail";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const POLL_MS = 45000; // aligns with backend cache TTL

const TeamRow = ({ team }) => (
  <div className="flex items-center justify-between gap-3">
    <span className="truncate text-sm font-bold text-slate-800" title={team.full || team.name}>
      {team.full || team.name}
    </span>
    <span className="shrink-0 font-mono text-sm font-bold text-slate-900">
      {team.score ? `${team.score}${team.ov ? ` (${team.ov})` : ""}` : "—"}
    </span>
  </div>
);

const MatchCard = ({ m, onOpen }) => (
  <motion.button
    layout
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    data-testid={`match-card-${m.id}`}
    onClick={() => onOpen(m)}
    className="flex w-full items-center gap-4 rounded-2xl bg-white p-4 text-left shadow-soft transition-transform hover:-translate-y-0.5"
  >
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        <span className="truncate">{m.sport}</span>
        {m.live && (
          <span className="flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-500">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" /> LIVE
          </span>
        )}
      </div>
      <div className="mt-2 space-y-1">
        <TeamRow team={m.teamA} />
        <TeamRow team={m.teamB} />
      </div>
      {m.note && <p className="mt-2 truncate text-xs font-medium text-slate-500">{m.note}</p>}
    </div>
    <ChevronRight className="h-5 w-5 shrink-0 text-slate-300" />
  </motion.button>
);

const StateBlock = ({ testid, children }) => (
  <div data-testid={testid} className="flex items-center gap-3 rounded-3xl bg-white p-6 shadow-soft">
    {children}
  </div>
);

const Section = ({ icon: Icon, title, status, matches, emptyText, tone, onOpen }) => (
  <section className="mt-8">
    <div className="mb-3 flex items-center gap-2">
      <span className={`grid h-8 w-8 place-items-center rounded-xl ${tone}`}>
        <Icon className="h-4 w-4" />
      </span>
      <h2 className="font-display text-lg font-extrabold tracking-tight text-slate-900">{title}</h2>
      {status === "ok" && matches.length > 0 && (
        <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">{matches.length}</span>
      )}
    </div>

    {status === "loading" ? (
      <StateBlock testid={`${title.toLowerCase()}-loading`}>
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-royal" />
        <span className="text-sm font-medium text-slate-400">Loading…</span>
      </StateBlock>
    ) : status === "unavailable" ? (
      <StateBlock testid={`${title.toLowerCase()}-unavailable`}>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-amber-50 text-amber-500">
          <Radio className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-bold text-slate-800">Temporarily unavailable</p>
          <p className="text-xs text-slate-500">{`We'll reconnect automatically — check back in a moment.`}</p>
        </div>
      </StateBlock>
    ) : matches.length === 0 ? (
      <StateBlock testid={`${title.toLowerCase()}-empty`}>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-royal-light text-royal">
          <Icon className="h-5 w-5" />
        </span>
        <p className="text-sm font-medium text-slate-600">{emptyText}</p>
      </StateBlock>
    ) : (
      <div className="space-y-3">
        {matches.map((m) => (
          <MatchCard key={m.id} m={m} onOpen={onOpen} />
        ))}
      </div>
    )}
  </section>
);

export default function SportsPage() {
  const [live, setLive] = useState({ status: "loading", matches: [] });
  const [all, setAll] = useState({ status: "loading", matches: [] });
  const [detailMatch, setDetailMatch] = useState(null);

  const load = useCallback(async () => {
    const pull = async (path, set) => {
      try {
        const { data } = await axios.get(`${API}/cricket/${path}`);
        set(data.status === "ok" ? { status: "ok", matches: data.matches || [] } : { status: "unavailable", matches: [] });
      } catch {
        set({ status: "unavailable", matches: [] });
      }
    };
    await Promise.all([pull("live", setLive), pull("matches", setAll)]);
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, POLL_MS);
    return () => clearInterval(iv);
  }, [load]);

  const { upcoming, recent } = useMemo(() => {
    const now = Date.now();
    const isUpcoming = (m) =>
      m.status === "NS" || (m.starting_at && new Date(m.starting_at).getTime() >= now);
    const up = all.matches.filter((m) => !m.live && isUpcoming(m));
    const rec = all.matches.filter((m) => !m.live && !isUpcoming(m));
    up.sort((a, b) => new Date(a.starting_at || 0) - new Date(b.starting_at || 0)); // soonest first
    rec.sort((a, b) => new Date(b.starting_at || 0) - new Date(a.starting_at || 0)); // most recent first
    return { upcoming: up, recent: rec };
  }, [all.matches]);

  return (
    <div className="min-h-screen bg-background pb-28" data-testid="sports-page">
      <header className="border-b border-slate-100 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4 sm:px-8">
          <Logo />
          <span className="rounded-full bg-royal-light px-3 py-1 text-xs font-bold text-royal">Cricket</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-7 sm:px-8">
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">Live Cricket Hub</h1>
        <p className="mt-1 text-sm text-slate-500">Live scores, upcoming fixtures and recent results — powered by real data.</p>

        <Section
          icon={Radio} title="Live" tone="bg-red-50 text-red-500"
          status={live.status} matches={live.matches}
          emptyText="No live matches right now." onOpen={setDetailMatch}
        />
        <Section
          icon={CalendarClock} title="Upcoming" tone="bg-royal-light text-royal"
          status={all.status} matches={upcoming}
          emptyText="No upcoming matches scheduled." onOpen={setDetailMatch}
        />
        <Section
          icon={History} title="Recent" tone="bg-mint/20 text-mint"
          status={all.status} matches={recent}
          emptyText="No recent results to show." onOpen={setDetailMatch}
        />
      </main>

      <MatchDetail open={!!detailMatch} onClose={() => setDetailMatch(null)} match={detailMatch} />
    </div>
  );
}
