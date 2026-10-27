"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

const IMG = "https://image.tmdb.org/t/p";
const REEL_LEN = 60;
const WINNER_IDX = 48;
const START_IDX = 4; // previous winner sits here so cards fill the left side too
const SPIN_MS = 7500;

const RARITIES = [
  [8.0, "Covert", "#ffd34d"],
  [7.5, "Classified", "#eb4b4b"],
  [7.0, "Restricted", "#d32ce6"],
  [6.0, "Mil-Spec", "#4b69ff"],
  [5.0, "Industrial", "#5e98d9"],
  [0, "Consumer", "#8a8a9a"],
];
const rarityOf = (m) => RARITIES.find(([min]) => m.vote_average >= min);

const easeOut = (t) => 1 - Math.pow(1 - t, 5);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

function demoPool() {
  return shuffle(
    Array.from({ length: 40 }, (_, i) => ({
      id: -i,
      title: `Demo Movie ${i + 1}`,
      release_date: `${1980 + (i % 44)}-01-01`,
      vote_average: 4 + Math.random() * 5,
      overview: "Demo mode: set TMDB_KEY in .env.local to spin real movies.",
      genres: [],
      poster_path: null,
      hue: Math.floor(Math.random() * 360),
    }))
  );
}

const NO_MATCH = "No films match those filters.";
const NO_FILTERS = { lang: "en", genres: [], decades: [], years: "", rating: "", runtime: "", votes: "50" };
const NOW = new Date().getFullYear();
const DECADES = Array.from({ length: Math.floor((NOW - 1900) / 10) + 1 }, (_, i) => Math.floor(NOW / 10) * 10 - i * 10);
const RATINGS = [5, 6, 7, 8];
const COMMON_LANGS = [
  ["", "any"],
  ["en", "English"],
  ["es", "Spanish"],
  ["fr", "French"],
  ["de", "German"],
  ["it", "Italian"],
  ["pt", "Portuguese"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["zh", "Chinese"],
  ["hi", "Hindi"],
];
const RUNTIMES = [
  ["short", "under 90 min"],
  ["mid", "90–120 min"],
  ["long", "over 120 min"],
];
const VOTES = [
  ["50", "any"],
  ["500", "500+"],
  ["2500", "2,500+"],
  ["10000", "10,000+"],
];

async function fetchPool(filters = NO_FILTERS) {
  const qs = new URLSearchParams();
  const ranges = [...filters.decades.map((d) => `${d}-${d + 9}`), filters.years.trim()].filter(Boolean).join(",");
  if (filters.lang) qs.set("lang", filters.lang);
  if (filters.genres.length) qs.set("genres", filters.genres.join(","));
  if (ranges) qs.set("ranges", ranges);
  for (const k of ["rating", "runtime", "votes"]) if (filters[k]) qs.set(k, filters[k]);
  const res = await fetch(`/api/pool?${qs}`, { cache: "no-store" });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  if (data.demo) return { pool: demoPool(), demo: true };
  if (!data.pool.length) throw new Error(NO_MATCH);
  return { pool: data.pool, demo: false };
}

const SPACING = 6; // the same film never appears within this many cards of itself

function buildItems(pool, winner, first) {
  const fillers = pool.length > 1 ? pool.filter((m) => m !== winner) : pool;
  const items = Array(REEL_LEN).fill(null);
  if (first) items[START_IDX] = first;
  items[WINNER_IDX] = winner;

  const near = (i, m) => {
    for (let j = Math.max(0, i - SPACING); j <= Math.min(REEL_LEN - 1, i + SPACING); j++) if (j !== i && items[j] === m) return true;
    return false;
  };
  for (let i = 0; i < REEL_LEN; i++) {
    if (items[i]) continue;
    // with a small pool the spacing can't always hold, so fall back to the first pick
    let m = pick(fillers);
    for (let t = 0; t < 40 && near(i, m); t++) m = pick(fillers);
    items[i] = m;
  }
  return items;
}

// Decode every poster before the reel moves, so cards never pop in mid-spin.
const preload = (items) =>
  Promise.race([
    Promise.allSettled(
      [...new Set(items.map((m) => m.poster_path).filter(Boolean))].map((p) => {
        const img = new Image();
        img.src = `${IMG}/w342${p}`;
        return img.decode();
      })
    ),
    new Promise((r) => setTimeout(r, 5000)),
  ]);

const languageName = (code) => {
  if (!code || code === "xx") return "";
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code);
  } catch {
    return code;
  }
};

const ICON_MENU = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
    <path d="M3 7h18M3 12h18M3 17h18" />
  </svg>
);
const ICON_FILTER = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
    <path d="M3 6h18M3 12h18M3 18h18" />
    <path d="M8 3v6M16 9v6M10 15v6" strokeWidth="3" />
  </svg>
);

const ICON_ON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
    <path d="M3 9v6h4l5 4V5L7 9H3z" />
    <path d="M16 8.5a5 5 0 0 1 0 7M19 5.5a9 9 0 0 1 0 13" />
  </svg>
);
const ICON_OFF = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
    <path d="M3 9v6h4l5 4V5L7 9H3z" />
    <path d="M16 9l6 6M22 9l-6 6" />
  </svg>
);

export default function Page() {
  const reelRef = useRef(null);
  const wrapRef = useRef(null);
  const tickerRef = useRef(null);
  const resultRef = useRef(null);
  const ac = useRef(null);
  const mutedRef = useRef(false);
  const lastWinner = useRef(null);
  const spinningRef = useRef(false);

  const [items, setItems] = useState([]);
  const [done, setDone] = useState(false);
  const [result, setResult] = useState(null);
  const [visible, setVisible] = useState(false); // drives the fade in up / out down
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(true);
  const [loading, setLoading] = useState(true);
  const [demo, setDemo] = useState(false);
  const [filters, setFilters] = useState(NO_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [spun, setSpun] = useState(false);
  const [moreLangs, setMoreLangs] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef([]);
  const showToast = (text, color = "#fff") => {
    toastTimer.current.forEach(clearTimeout);
    setToast({ text, color, id: Date.now(), out: false });
    toastTimer.current = [
      setTimeout(() => setToast((t) => t && { ...t, out: true }), 3200),
      setTimeout(() => setToast(null), 3600),
    ];
  };
  const [options, setOptions] = useState({ languages: [], genres: [] });
  const setFilter = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const toggleIn = (k, v) =>
    setFilters((f) => ({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] }));
  const showLangSelect = moreLangs || !COMMON_LANGS.some(([code]) => code === filters.lang);
  const activeFilters = [
    filters.lang !== NO_FILTERS.lang,
    filters.genres.length > 0,
    filters.decades.length > 0 || filters.years.trim() !== "",
    filters.rating !== "",
    filters.runtime !== "",
    filters.votes !== NO_FILTERS.votes,
  ].filter(Boolean).length;

  // ---------- geometry ----------
  const cssNum = (name) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  const cardW = () => reelRef.current?.firstElementChild?.offsetWidth || cssNum("--card-w");
  const gap = () => cssNum("--gap");
  // x position that centers card i (plus offset px) under the ticker
  const offsetFor = (i, jitter = 0) =>
    wrapRef.current.clientWidth / 2 - (i * (cardW() + gap()) + cardW() / 2 + jitter);
  const setX = (x) => (reelRef.current.style.transform = `translateX(${x}px)`);

  // ---------- audio ----------
  const blip = (freq, dur, type = "square", vol = 0.05) => {
    if (mutedRef.current) return;
    ac.current ??= new (window.AudioContext || window.webkitAudioContext)();
    const ctx = ac.current;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + dur);
  };
  const winSound = () =>
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, 0.25, "triangle", 0.12), i * 90));
  const tick = () => {
    const t = tickerRef.current;
    t.classList.remove("tick");
    void t.offsetWidth; // restart animation
    t.classList.add("tick");
    blip(1100, 0.03);
  };

  // ---------- init ----------
  useEffect(() => {
    const m = localStorage.getItem("muted") === "1";
    mutedRef.current = m;
    setMuted(m);

    fetch("/api/options")
      .then((r) => r.json())
      .then((o) => !o.error && setOptions(o));

    fetchPool()
      .then(({ pool, demo }) => {
        setDemo(demo);
        lastWinner.current = pool[0];
        setItems(buildItems(pool, pool[1] || pool[0], pool[0]));
        setBusy(false);
        setLoading(false);
      })
      .catch((e) => (setLoading(false), showToast(`Couldn't load TMDB (${e.message}). Check TMDB_KEY in .env.local.`, "#eb4b4b")));
  }, []);

  // park the reel at the start position whenever a fresh reel is rendered
  useLayoutEffect(() => {
    if (items.length) setX(offsetFor(START_IDX));
  }, [items]);

  useEffect(() => {
    const onResize = () => !spinningRef.current && items.length && setX(offsetFor(START_IDX));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [items]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && (setFiltersOpen(false), setMenuOpen(false), setAboutOpen(false), setVisible(false));
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    // on phones the details are a modal sheet, so stop the page scrolling behind it
    const phone = window.matchMedia("(max-width: 720px)").matches;
    document.body.style.overflow = visible && phone ? "hidden" : "";
  }, [visible]);

  useEffect(() => {
    if (result) resultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [result]);

  // ---------- spin ----------
  const spin = async () => {
    if (spinningRef.current) return;
    spinningRef.current = true;
    setBusy(true);
    setLoading(true);
    setVisible(false);
    setDone(false);

    let pool;
    try {
      ({ pool } = await fetchPool(filters));
    } catch (e) {
      spinningRef.current = false;
      setBusy(false);
      setLoading(false);
      showToast(e.message === NO_MATCH ? e.message : `Couldn't reach TMDB (${e.message}). Check TMDB_KEY in .env.local.`, "#eb4b4b");
      return;
    }
    const winner = pick(pool);
    const next = buildItems(pool, winner, lastWinner.current);
    await preload(next);
    flushSync(() => setItems(next));
    setLoading(false);

    const startX = offsetFor(START_IDX);
    setX(startX);
    await new Promise(requestAnimationFrame);

    const w = cardW() + gap();
    const jitter = (Math.random() - 0.5) * cardW() * 0.7; // never lands on a card edge
    const endX = offsetFor(WINNER_IDX, jitter);
    let lastIdx = START_IDX;
    const t0 = performance.now();

    await new Promise((resolve) => {
      const frame = (now) => {
        const t = Math.min((now - t0) / SPIN_MS, 1);
        const x = startX + (endX - startX) * easeOut(t);
        setX(x);
        const idx = Math.floor((wrapRef.current.clientWidth / 2 - x) / w);
        if (idx !== lastIdx) {
          lastIdx = idx;
          tick();
        }
        t < 1 ? requestAnimationFrame(frame) : resolve();
      };
      requestAnimationFrame(frame);
    });

    winSound();
    lastWinner.current = winner;
    setDone(true);
    setResult(winner);
    setTimeout(() => setVisible(true), 600); // let the winner sit for a beat before the sheet comes up
    setSpun(true);
    showToast(`${winner.title} · ${rarityOf(winner)[1]}`, rarityOf(winner)[2]);
    spinningRef.current = false;
    setBusy(false);
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.code === "Space" && !["INPUT", "SELECT", "SUMMARY"].includes(e.target.tagName)) {
        e.preventDefault();
        spin();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const toggleMute = () => {
    const next = !muted;
    mutedRef.current = next;
    setMuted(next);
    localStorage.setItem("muted", next ? "1" : "0");
  };

  const rarity = result && rarityOf(result);

  return (
    <>
      {toast && (
        <div className={`toast${toast.out ? " out" : ""}`} key={toast.id} role="status" style={{ "--c": toast.color }}>
          {toast.text}
        </div>
      )}
      {loading && <div className="loader" role="progressbar" aria-label="Loading" />}
      <header className="top">
        <h1 className="title">Reel Roulette</h1>
        <button className="menu-btn" onClick={() => setMenuOpen(true)} aria-label="Menu" aria-expanded={menuOpen}>
          {ICON_MENU}
        </button>
        <nav className={`corner${menuOpen ? " open" : ""}`}>
          <button className="menu-close" onClick={() => setMenuOpen(false)} aria-label="Close menu">✕</button>
          <a href="https://zmorehouse.com/" target="_blank" rel="noopener noreferrer">portfolio</a>
          <a href="https://github.com/zmorehouse" target="_blank" rel="noopener noreferrer">github</a>
          <div className={`about${aboutOpen ? " open" : ""}`}>
            <button className="about-btn" onClick={() => setAboutOpen((o) => !o)} aria-label="About" aria-expanded={aboutOpen} title="About">
              ?
            </button>
            <div className="about-card">
              <p>
                Reel Roulette picks a random film from TMDB. Hit spin, watch the reel run past the ticker, and see
                where it lands.
              </p>
              <p>
                Cards are coloured by TMDB rating, CS:GO case style (see the rarity key). Use the filters to narrow
                it down by language, genre, decade, rating, runtime and how well known a film is.
              </p>
              <ul className="rarity-key" aria-label="Rarity key">
                {RARITIES.map(([min, name, color]) => (
                  <li key={name} style={{ "--c": color }}>
                    <i />
                    {name}
                    <span>{min ? `${min.toFixed(1)}+` : "<5.0"}</span>
                  </li>
                ))}
              </ul>
              <p className="credit">
                This product uses the{" "}
                <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer">TMDB</a> API
              </p>
            </div>
          </div>
          <button className="mute" onClick={toggleMute} aria-label="Toggle sound" aria-pressed={muted} title="Toggle sound">
            {muted ? ICON_OFF : ICON_ON}
          </button>
        </nav>
      </header>

      <main>
        <section className="stage">
          <div className="reel-wrap" ref={wrapRef}>
            <div className={`reel${done ? " done" : ""}`} ref={reelRef}>
              {items.map((m, i) => (
                <div
                  key={i}
                  className={`card${done && i === WINNER_IDX ? " winner" : ""}`}
                  style={{ "--rarity": rarityOf(m)[2] }}
                >
                  {m.poster_path ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`${IMG}/w342${m.poster_path}`} alt="" draggable="false" />
                  ) : (
                    <div className="fallback" style={{ "--h": m.hue ?? 260 }}>{m.title}</div>
                  )}
                </div>
              ))}
            </div>
            <div className="ticker" ref={tickerRef}>
              <span className="ticker-head" />
            </div>
          </div>
          <div className="actions">
            <button className={`spin-btn${loading ? " loading" : ""}`} onClick={spin} disabled={busy}>{spun ? "RESPIN" : "SPIN"}</button>
            <button className="filters-btn" onClick={() => setFiltersOpen(true)} aria-label="Filters" title="Filters">
              {ICON_FILTER}
              {activeFilters > 0 && <b>{activeFilters}</b>}
            </button>
          </div>
        </section>

        {result && (
          <>
          <div className={`sheet-backdrop${visible ? " in" : ""}`} onClick={() => setVisible(false)} />
          <section className={`result${visible ? " in" : ""}`} ref={resultRef} style={{ "--rarity": rarity[2] }}>
            {result.poster_path ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`${IMG}/w500${result.poster_path}`} alt="" />
            ) : (
              <div className="no-poster" />
            )}
            <button className="sheet-close" onClick={() => setVisible(false)} aria-label="Close details">✕</button>
            <div className="r-info">
              <div className="r-rarity">{rarity[1]}</div>
              <h2>{result.title}</h2>
              <div className="r-meta">
                {[
                  (result.release_date || "").slice(0, 4),
                  result.vote_count ? `★ ${result.vote_average.toFixed(1)}` : "unrated",
                  languageName(result.original_language),
                  ...result.genres.slice(0, 3),
                ]
                  .filter(Boolean)
                  .map((t) => (
                    <span key={t} className="tag">{t}</span>
                  ))}
              </div>
              <p>{result.overview}</p>
              {!demo && (
                <a href={`https://www.themoviedb.org/movie/${result.id}`} target="_blank" rel="noopener noreferrer">
                  View on TMDB ↗
                </a>
              )}
            </div>
          </section>
          </>
        )}
      </main>

      <div className={`backdrop${filtersOpen || menuOpen ? " open" : ""}`} onClick={() => (setFiltersOpen(false), setMenuOpen(false))} />
      <aside className={`drawer${filtersOpen ? " open" : ""}`} aria-hidden={!filtersOpen} inert={!filtersOpen}>
        <div className="drawer-head">
          <span>filters</span>
          <button onClick={() => setFiltersOpen(false)} aria-label="Close filters">✕</button>
        </div>

        <div className="drawer-body">
          <div className="field">
            <span>language</span>
            <div className="chips">
              {COMMON_LANGS.map(([code, name]) => (
                <button key={name} className={`chip${filters.lang === code ? " on" : ""}`} onClick={() => setFilters((f) => ({ ...f, lang: code }))}>
                  {name}
                </button>
              ))}
              <button className={`chip${showLangSelect ? " on" : ""}`} onClick={() => setMoreLangs((m) => !m)} aria-label="More languages" title="More languages">
                +
              </button>
            </div>
            {showLangSelect && (
              <select value={filters.lang} onChange={setFilter("lang")} aria-label="Language">
                <option value="">Any language</option>
                {options.languages.map((l) => (
                  <option key={l.code} value={l.code}>{l.name}</option>
                ))}
              </select>
            )}
          </div>

          <div className="field">
            <span>genre</span>
            <div className="chips">
              {options.genres.map((g) => (
                <button
                  key={g.id}
                  className={`chip${filters.genres.includes(String(g.id)) ? " on" : ""}`}
                  onClick={() => toggleIn("genres", String(g.id))}
                >
                  {g.name}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span>decade</span>
            <div className="chips">
              {DECADES.map((d) => (
                <button key={d} className={`chip${filters.decades.includes(d) ? " on" : ""}`} onClick={() => toggleIn("decades", d)}>
                  {d}s
                </button>
              ))}
            </div>
          </div>

          <label className="field">
            <span>or specific years</span>
            <input type="text" placeholder="1994, 2001-2005" value={filters.years} onChange={setFilter("years")} />
          </label>

          <div className="field">
            <span>min rating</span>
            <div className="chips">
              {[["", "any"], ...RATINGS.map((r) => [String(r), `${r}+`])].map(([v, label]) => (
                <button key={label} className={`chip${filters.rating === v ? " on" : ""}`} onClick={() => setFilters((f) => ({ ...f, rating: v }))}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span>runtime</span>
            <div className="chips">
              {[["", "any"], ...RUNTIMES].map(([v, label]) => (
                <button key={label} className={`chip${filters.runtime === v ? " on" : ""}`} onClick={() => setFilters((f) => ({ ...f, runtime: v }))}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span>votes</span>
            <div className="chips">
              {VOTES.map(([v, label]) => (
                <button key={v} className={`chip${filters.votes === v ? " on" : ""}`} onClick={() => setFilters((f) => ({ ...f, votes: v }))}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="drawer-foot">
          <button className="reset" onClick={() => setFilters(NO_FILTERS)} disabled={activeFilters === 0}>reset</button>
          <button className="done" onClick={() => setFiltersOpen(false)}>done</button>
        </div>
      </aside>
    </>
  );
}
