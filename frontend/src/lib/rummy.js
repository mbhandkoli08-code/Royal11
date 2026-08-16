// Client-side mirror of backend app/games/rummy.py — powers INSTANT live
// meld-assistance labels as the player arranges cards. The server ALWAYS
// re-validates a declaration authoritatively; this is a UX aid only.

const SEQ = { "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, T: 10, J: 11, Q: 12, K: 13 };
const BASE = { "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, T: 10, J: 10, Q: 10, K: 10, A: 10 };

export const isJoker = (card, wildRank) => !!card.joker || (wildRank != null && card.rank === wildRank);

export const cardPoints = (card, wildRank) => (isJoker(card, wildRank) ? 0 : BASE[card.rank] || 0);

const naturalsFitRun = (rankLetters, totalLen) => {
  const aces = rankLetters.filter((r) => r === "A").length;
  if (aces > 1) return false;
  const others = rankLetters.filter((r) => r !== "A");
  const vals = others.map((r) => SEQ[r]);
  if (new Set(vals).size !== vals.length) return false;
  const candidates = aces === 0 ? [vals] : [[...vals, 1], [...vals, 14]];
  for (const cand of candidates) {
    if (cand.length === 0) return true;
    const s = [...cand].sort((a, b) => a - b);
    if (new Set(s).size !== s.length) continue;
    if (s[s.length - 1] - s[0] <= totalLen - 1 && s[0] >= 1 && s[s.length - 1] <= 14) return true;
  }
  return false;
};

export const isPureSequence = (cards) => {
  if (cards.length < 3) return false;
  if (cards.some((c) => c.joker)) return false;
  if (new Set(cards.map((c) => c.suit)).size !== 1) return false;
  const ranks = cards.map((c) => c.rank);
  if (new Set(ranks).size !== ranks.length) return false;
  return naturalsFitRun(ranks, cards.length);
};

export const isSequence = (cards, wildRank) => {
  if (cards.length < 3) return false;
  const naturals = cards.filter((c) => !isJoker(c, wildRank));
  if (naturals.length === 0) return true;
  if (new Set(naturals.map((c) => c.suit)).size !== 1) return false;
  return naturalsFitRun(naturals.map((c) => c.rank), cards.length);
};

export const isSet = (cards, wildRank) => {
  if (cards.length < 3 || cards.length > 4) return false;
  const naturals = cards.filter((c) => !isJoker(c, wildRank));
  if (naturals.length === 0) return true;
  if (new Set(naturals.map((c) => c.rank)).size !== 1) return false;
  const suits = naturals.map((c) => c.suit);
  return new Set(suits).size === suits.length;
};

// Returns { type, label, isSequence, isPure, valid }
export const classifyGroup = (cards, wildRank) => {
  if (isPureSequence(cards)) return { type: "pure_seq", label: "Pure Sequence", isSequence: true, isPure: true, valid: true };
  if (isSequence(cards, wildRank)) return { type: "impure_seq", label: "Sequence", isSequence: true, isPure: false, valid: true };
  if (isSet(cards, wildRank)) return { type: "set", label: "Set", isSequence: false, isPure: false, valid: true };
  if (cards.length === 0) return { type: "empty", label: "Empty", isSequence: false, isPure: false, valid: false };
  return { type: "invalid", label: "Invalid", isSequence: false, isPure: false, valid: false };
};

// DISPLAY-ONLY meld state for the live helper badges. Adds an "incomplete"
// state (a partial group that could still become valid) so a 1–2 card group,
// or a 3+ group still consistent with one meld type, reads as INCOMPLETE rather
// than INVALID. Does NOT affect declare validity (that uses classifyGroup).
// state ∈ pure | impure | set | incomplete | invalid | empty
export const groupDisplayState = (cards, wildRank) => {
  const info = classifyGroup(cards, wildRank);
  if (info.type === "pure_seq") return { state: "pure", label: "Pure Sequence", valid: true };
  if (info.type === "impure_seq") return { state: "impure", label: "Impure Sequence", valid: true };
  if (info.type === "set") return { state: "set", label: "Valid Set", valid: true };
  if (cards.length === 0) return { state: "empty", label: "", valid: false };
  if (cards.length < 3) return { state: "incomplete", label: "Incomplete", valid: false };
  // 3+ cards that aren't yet valid — could they still become valid while editing?
  const naturals = cards.filter((c) => !isJoker(c, wildRank));
  if (naturals.length === 0) return { state: "incomplete", label: "Incomplete", valid: false };
  const suits = new Set(naturals.map((c) => c.suit));
  const ranks = naturals.map((c) => c.rank);
  const uniqueRanks = new Set(ranks).size === ranks.length;
  const potentialSeq = suits.size <= 1 && uniqueRanks;                 // same suit, no repeats → building a run
  const potentialSet = new Set(ranks).size <= 1 && suits.size === naturals.length && cards.length <= 4; // same rank, distinct suits → building a set
  if (potentialSeq || potentialSet) return { state: "incomplete", label: "Incomplete", valid: false };
  return { state: "invalid", label: "Invalid Group", valid: false };
};

// Full declaration readiness for enabling the Declare button.
export const evaluateHand = (groups, wildRank, expected = 13) => {
  const infos = groups.map((g) => classifyGroup(g, wildRank));
  const grouped = groups.reduce((n, g) => n + g.length, 0);
  const seqs = infos.filter((i) => i.isSequence && i.valid).length;
  const pures = infos.filter((i) => i.isPure && i.valid).length;
  const allValid = groups.every((g, i) => g.length === 0 || infos[i].valid);
  const checklist = {
    pure: pures >= 1,
    twoSeq: seqs >= 2,
    allGrouped: grouped === expected,
    allValid,
  };
  const canDeclare = checklist.pure && checklist.twoSeq && checklist.allGrouped && allValid;
  return { infos, checklist, canDeclare, grouped };
};

// Provisional deadwood (greedy, mirrors backend) for the running score hint.
export const provisionalDeadwood = (cards, wildRank) => {
  const jokers = cards.filter((c) => isJoker(c, wildRank));
  const naturals = cards.filter((c) => !isJoker(c, wildRank));
  const bySuit = {};
  naturals.forEach((c) => { (bySuit[c.suit] = bySuit[c.suit] || []).push(c); });
  const used = new Set();
  const pureRuns = [];
  Object.values(bySuit).forEach((cs) => {
    const val = (c) => (c.rank === "A" ? 14 : SEQ[c.rank]);
    const uniq = {};
    cs.sort((a, b) => val(a) - val(b)).forEach((c) => { if (!(val(c) in uniq)) uniq[val(c)] = c; });
    const vals = Object.keys(uniq).map(Number).sort((a, b) => a - b);
    let run = [];
    let prev = null;
    vals.forEach((v) => {
      if (prev !== null && v === prev + 1) run.push(uniq[v]);
      else { if (run.length >= 3) { pureRuns.push(run); run.forEach((c) => used.add(c.id)); } run = [uniq[v]]; }
      prev = v;
    });
    if (run.length >= 3) { pureRuns.push(run); run.forEach((c) => used.add(c.id)); }
  });
  const counted = pureRuns.length === 0 ? new Set() : new Set([...used]);
  void jokers;
  let dead = 0;
  cards.forEach((c) => { if (!counted.has(c.id)) dead += cardPoints(c, wildRank); });
  return Math.min(80, dead);
};
