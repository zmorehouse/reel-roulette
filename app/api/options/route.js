const API = "https://api.themoviedb.org/3";
const REVALIDATE = 60 * 60 * 24 * 7;

async function tmdb(key, path) {
  const url = new URL(API + path);
  const headers = {};
  if (key.length > 40) headers.Authorization = `Bearer ${key}`;
  else url.searchParams.set("api_key", key);
  const res = await fetch(url, { headers, next: { revalidate: REVALIDATE } });
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  return res.json();
}

export async function GET() {
  const key = (process.env.TMDB_KEY || "").trim();
  if (!key) {
    return Response.json({
      languages: [{ code: "en", name: "English" }],
      genres: ["Action", "Comedy", "Drama", "Horror", "Sci-Fi"].map((name, id) => ({ id, name })),
    });
  }
  try {
    const [{ genres }, langs] = await Promise.all([
      tmdb(key, "/genre/movie/list"),
      tmdb(key, "/configuration/languages"),
    ]);
    const languages = langs
      .filter((l) => l.iso_639_1 !== "xx")
      .map((l) => ({ code: l.iso_639_1, name: l.english_name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return Response.json({ languages, genres });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 502 });
  }
}
