const API = "https://api.themoviedb.org/3";

export const dynamic = "force-dynamic";

// TMDB responses are cached by Next's data cache, so repeat page/genre lookups never hit the API again.
const REVALIDATE = 60 * 60 * 24;

async function tmdb(key, path, params = {}) {
  const url = new URL(API + path);
  const headers = {};
  if (key.length > 40) headers.Authorization = `Bearer ${key}`;
  else url.searchParams.set("api_key", key);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers, next: { revalidate: REVALIDATE } });
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  return res.json();
}

const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const SLICES = 5; // independent random pages per pool
const FIRST_YEAR = 1900;
const MAX_PAGES = 500; // TMDB won't serve past page 500 of any query
const VOTE_FLOORS = [50, 500, 2500, 10000];
const RUNTIMES = {
  short: { "with_runtime.lte": 89 },
  mid: { "with_runtime.gte": 90, "with_runtime.lte": 120 },
  long: { "with_runtime.gte": 121 },
};

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const discover = (key, params) =>
  tmdb(key, "/discover/movie", { include_adult: false, sort_by: "popularity.desc", ...params });

// "1990-1999, 2004" -> merged, clamped [from, to] ranges; empty means every year
function parseRanges(raw, now) {
  const ranges = [];
  for (const tok of (raw || "").split(/[,\s]+/).filter(Boolean)) {
    const m = tok.match(/^(\d{4})(?:-(\d{4}))?$/);
    if (!m) continue;
    let [from, to] = [+m[1], +(m[2] ?? m[1])];
    if (from > to) [from, to] = [to, from];
    from = Math.max(FIRST_YEAR, from);
    to = Math.min(now + 1, to);
    if (from <= to) ranges.push([from, to]);
  }
  ranges.sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged.length ? merged : [[FIRST_YEAR, now + 1]];
}

function filterParams(q) {
  const num = (k) => (q.get(k) && !Number.isNaN(+q.get(k)) ? +q.get(k) : null);
  const now = new Date().getFullYear();
  const params = {};
  if (q.get("lang")) params.with_original_language = q.get("lang");
  const genres = (q.get("genres") || "").split(",").filter((g) => /^\d+$/.test(g));
  if (genres.length) params.with_genres = genres.join("|"); // any of the chosen genres
  if (num("rating")) params["vote_average.gte"] = num("rating");
  Object.assign(params, RUNTIMES[q.get("runtime")]);
  // every pull needs a minimum of real votes behind it
  params["vote_count.gte"] = VOTE_FLOORS.includes(num("votes")) ? num("votes") : VOTE_FLOORS[0];
  return { params, ranges: parseRanges(q.get("ranges"), now) };
}

const yearRange = (from, to) => ({
  "primary_release_date.gte": `${from}-01-01`,
  "primary_release_date.lte": `${to}-12-31`,
});
const expand = (ranges) => ranges.flatMap(([f, t]) => Array.from({ length: t - f + 1 }, (_, i) => f + i));

// A single discover query only reaches its first 10,000 films, so a big result set is
// sliced by release year (and by original language when a year alone is still too big).
async function sliceFromYear(key, base, years, languages) {
  let params = { ...base, ...yearRange(...Array(2).fill(pick(years))) };
  let meta = await discover(key, params);

  if (meta.total_pages > MAX_PAGES && !base.with_original_language) {
    const narrowed = { ...params, with_original_language: pick(languages) };
    const m = await discover(key, narrowed);
    if (m.total_results > 0) [params, meta] = [narrowed, m];
  }
  if (!meta.total_results) return [];

  const page = 1 + Math.floor(Math.random() * Math.min(meta.total_pages, MAX_PAGES));
  return page === 1 ? meta.results : (await discover(key, { ...params, page })).results;
}

async function samplePages(key, { params, ranges }, languages) {
  // one contiguous range can be queried directly; several ranges can't be OR-ed in one query
  if (ranges.length === 1) {
    const base = { ...params, ...yearRange(...ranges[0]) };
    const meta = await discover(key, base);
    if (!meta.total_results) return [];

    // the whole filtered set is reachable: sample pages straight from it
    if (meta.total_pages <= MAX_PAGES) {
      const pages = new Set();
      while (pages.size < Math.min(SLICES, meta.total_pages)) pages.add(1 + Math.floor(Math.random() * meta.total_pages));
      return (
        await Promise.all([...pages].map((page) => (page === 1 ? meta.results : discover(key, { ...base, page }).then((r) => r.results))))
      ).flat();
    }
  }

  // too big to reach in one query: slice by year, retrying years that come up empty
  const years = expand(ranges);
  const out = [];
  for (let attempt = 0; attempt < SLICES * 3 && out.length < SLICES * 15; attempt++) {
    out.push(...(await sliceFromYear(key, params, years, languages)));
  }
  return out;
}

export async function GET(request) {
  const key = (process.env.TMDB_KEY || "").trim();
  if (!key) return Response.json({ demo: true });

  try {
    const [{ genres }, langs] = await Promise.all([
      tmdb(key, "/genre/movie/list"),
      tmdb(key, "/configuration/languages"),
    ]);
    const languages = langs.map((l) => l.iso_639_1);

    const results = await samplePages(key, filterParams(new URL(request.url).searchParams), languages);
    const seen = new Set();
    const pool = shuffle(
      results
        .filter((m) => m.poster_path && !seen.has(m.id) && seen.add(m.id))
        .map((m) => ({
          id: m.id,
          title: m.title,
          original_title: m.original_title,
          original_language: m.original_language,
          release_date: m.release_date,
          vote_average: m.vote_average,
          vote_count: m.vote_count,
          overview: m.overview,
          poster_path: m.poster_path,
          genres: (m.genre_ids || []).map((id) => genres.find((g) => g.id === id)?.name).filter(Boolean),
        }))
    );
    return Response.json({ pool });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 502 });
  }
}
