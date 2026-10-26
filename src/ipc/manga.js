// ── IPC: MangaPill Unified Manga Provider for Streambert ────────────────────
// Serves discovery/popular manga, direct search, rich metadata, complete chapter
// directories, and high-speed Backblaze B2 CDN pages from MangaPill.

const { ipcMain } = require("electron");
const axios = require("axios");
const cheerio = require("cheerio");
const { MANGA } = require("@consumet/extensions");
const { LruCache } = require("./lruCache");
const { assertPublicHttpUrl } = require("./netGuard");

let _mangaPill = null;
function getMangaPill() {
  if (!_mangaPill) {
    _mangaPill = new MANGA.MangaPill();
  }
  return _mangaPill;
}

// Bounded cache (TTL + LRU + byte budget). Image entries are base64 data URLs
// and can be hundreds of KB each, so an unbounded Map is not an option.
const _cache = new LruCache({
  maxEntries: 150,
  maxBytes: 40 * 1024 * 1024,
  ttlMs: 60 * 60 * 1000,
});
function getCache(key, ttl = 10 * 60 * 1000) {
  return _cache.get(key, ttl);
}
function setCache(key, val) {
  _cache.set(key, val);
}

// Curated all-time popular manga on MangaPill as a baseline guaranteed set
const MANGA_CLASSICS = [
  { id: "2/one-piece", title: "One Piece", image: "https://cdn.readdetectiveconan.com/file/mangapill/i/2.webp" },
  { id: "3069/naruto", title: "Naruto", image: "https://cdn.readdetectiveconan.com/file/mangapill/i/3069.jpg" },
  { id: "552/bleach", title: "Bleach", image: "https://cdn.readdetectiveconan.com/file/mangapill/i/552.jpg" },
  { id: "2085/jujutsu-kaisen", title: "Jujutsu Kaisen", image: "https://cdn.readdetectiveconan.com/file/mangapill/i/2085.jpg" },
  { id: "5/shingeki-no-kyojin", title: "Attack on Titan", image: "https://cdn.readdetectiveconan.com/file/mangapill/i/5.jpg" },
  { id: "1/berserk", title: "Berserk", image: "https://cdn.readdetectiveconan.com/file/mangapill/i/1.jpeg" },
  { id: "723/chainsaw-man", title: "Chainsaw Man", image: "https://cdn.readdetectiveconan.com/file/mangapill/i/723.jpeg" },
  { id: "1828/hunter-x-hunter", title: "Hunter x Hunter", image: "https://cdn.readdetectiveconan.com/file/mangapill/i/1828.jpg" },
  { id: "3262/one-punch-man", title: "One-Punch Man", image: "https://cdn.readdetectiveconan.com/file/mangapill/i/3262.webp" },
  { id: "4143/spy-x-family", title: "Spy X Family", image: "https://cdn.readdetectiveconan.com/file/mangapill/i/4143.jpeg" },
  { id: "4741/vinland-saga", title: "Vinland Saga", image: "https://cdn.readdetectiveconan.com/file/mangapill/i/4741.jpeg" },
  { id: "8/kingdom", title: "Kingdom", image: "https://cdn.readdetectiveconan.com/file/mangapill/i/8.jpeg" },
  { id: "580/blue-lock", title: "Blue Lock", image: "https://cdn.readdetectiveconan.com/file/mangapill/i/580.jpg" },
  { id: "5460/dandadan", title: "Dandadan", image: "https://cdn.readdetectiveconan.com/file/mangapill/i/5460.jpg" },
  { id: "7529/kagurabachi", title: "Kagurabachi", image: "https://cdn.readdetectiveconan.com/file/mangapill/i/7529.jpg" },
  { id: "1074/demon-slayer-kimetsu-no-yaiba", title: "Demon Slayer", image: "https://cdn.readdetectiveconan.com/file/mangapill/i/1074.jpg" },
  { id: "2580/my-hero-academia", title: "My Hero Academia", image: "https://cdn.readdetectiveconan.com/file/mangapill/i/2580.jpg" },
  { id: "4444/tokyo-ghoul", title: "Tokyo Ghoul", image: "https://cdn.readdetectiveconan.com/file/mangapill/i/4444.jpg" },
  { id: "1055/death-note", title: "Death Note", image: "https://cdn.readdetectiveconan.com/file/mangapill/i/1055.jpg" },
  { id: "1158/fullmetal-alchemist", title: "Fullmetal Alchemist", image: "https://cdn.readdetectiveconan.com/file/mangapill/i/1158.jpg" },
  { id: "3003/mushoku-tensei-isekai-ittara-honki-dasu", title: "Mushoku Tensei", image: "https://cdn.readdetectiveconan.com/file/mangapill/i/3003.jpg" },
  { id: "4341/solo-leveling", title: "Solo Leveling", image: "https://cdn.readdetectiveconan.com/file/mangapill/i/4341.jpg" },
  { id: "4920/haikyu", title: "Haikyu!!", image: "https://cdn.readdetectiveconan.com/file/mangapill/i/4920.jpg" },
  { id: "4940/dragon-ball", title: "Dragon Ball", image: "https://cdn.readdetectiveconan.com/file/mangapill/i/4940.jpg" },
  { id: "4941/dragon-ball-super", title: "Dragon Ball Super", image: "https://cdn.readdetectiveconan.com/file/mangapill/i/4941.jpg" }
];

function findBestManga(results, query) {
  if (!results || !results.length) return null;
  const q = query.toLowerCase().replace(/[^a-z0-9]/g, "");

  // 1. Exact alphanumeric title match
  let match = results.find((r) => r.title.toLowerCase().replace(/[^a-z0-9]/g, "") === q);
  if (match) return match;

  // 2. Slug exact match (e.g. "attack-on-titan", "shingeki-no-kyojin")
  const slugTarget = query.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  match = results.find((r) => {
    const slug = (r.id || "").replace(/^\d+\//, "");
    return slug === slugTarget;
  });
  if (match) return match;

  // 3. Exclude spinoffs, guidebooks, art books, anthologies, side stories if possible
  const badWords = [
    "art book",
    "guidebook",
    "anthology",
    "chibi",
    "side story",
    "novel",
    "colored",
    "color",
    "fanbook",
  ];
  const filtered = results.filter((r) => {
    const t = (r.title || "").toLowerCase();
    return !badWords.some((w) => t.includes(w));
  });

  const pool = filtered.length > 0 ? filtered : results;
  const candidate = pool.find((r) => (r.title || "").toLowerCase().includes(query.toLowerCase()));
  if (candidate) return candidate;

  return pool[0] || results[0];
}

function register() {
  // ── 1. Popular / Spotlight Manga (Trending + Classics + New Releases) ──────
  ipcMain.handle("manga-pill-popular", async () => {
    try {
      const cached = getCache("popular_manga", 60 * 60 * 1000); // 1 hour cache
      if (cached) return { ok: true, results: cached };

      const list = [];
      const seen = new Set();

      function addItem(id, title, image) {
        if (!id || !title || !image) return;
        const cleanId = id.replace(/^\/manga\//, "");
        if (seen.has(cleanId)) return;
        seen.add(cleanId);
        list.push({
          id: "mangapill:" + cleanId,
          rawId: cleanId,
          title: title.trim(),
          name: title.trim(),
          media_type: "manga",
          poster_path: image,
          banner_path: image,
          overview: `Read ${title.trim()} complete chapters on MangaPill`,
          description: `Read ${title.trim()} complete chapters on MangaPill`,
          status: "ongoing",
          provider: "mangapill",
        });
      }

      // 1. Trending Mangas from MangaPill homepage
      try {
        const res = await axios.get("https://mangapill.com", {
          headers: { "User-Agent": "Mozilla/5.0" },
          timeout: 8000,
        });
        const $ = cheerio.load(res.data);
        const container = $("h4:contains(\"Trending Mangas\")").parent().next("div.grid");
        container.find("> div").each((i, el) => {
          const a = $(el).find("a[href*=\"/manga/\"]").first();
          const href = a.attr("href");
          const img = $(el).find("img").attr("data-src") || $(el).find("img").attr("src");
          const title = $(el).find(".line-clamp-1, .line-clamp-2, a[href*=\"/manga/\"]").last().text().trim().replace(/\s+/g, " ");
          addItem(href, title, img);
        });
      } catch (err) {
        console.warn("[MangaPill] Homepage trending scrape error:", err.message);
      }

      // 2. Classics (guaranteed high-quality popular manga)
      for (const c of MANGA_CLASSICS) {
        addItem(c.id, c.title, c.image);
      }

      // 3. New releases from /mangas/new up to 36 total
      try {
        const res = await axios.get("https://mangapill.com/mangas/new", {
          headers: { "User-Agent": "Mozilla/5.0" },
          timeout: 8000,
        });
        const $ = cheerio.load(res.data);
        $("div.grid > div").each((i, el) => {
          const a = $(el).find("a[href*=\"/manga/\"]").first();
          const href = a.attr("href");
          const img = $(el).find("img").attr("data-src") || $(el).find("img").attr("src");
          const title = $(el).find(".line-clamp-2, .line-clamp-1, a[href*=\"/manga/\"]").last().text().trim().replace(/\s+/g, " ");
          addItem(href, title, img);
        });
      } catch (err) {
        console.warn("[MangaPill] New mangas scrape error:", err.message);
      }

      const results = list.slice(0, 36);
      setCache("popular_manga", results);
      return { ok: true, results };
    } catch (err) {
      return { ok: false, error: err.message || "Failed to load popular manga" };
    }
  });

  // ── 2. Search MangaPill ────────────────────────────────────────────────────
  ipcMain.handle("manga-pill-search", async (_, { query }) => {
    try {
      if (!query || !query.trim()) return { ok: false, error: "Empty query" };
      const cacheKey = "search:" + query.trim().toLowerCase();
      const cached = getCache(cacheKey);
      if (cached) return { ok: true, results: cached };

      const mp = getMangaPill();
      const res = await mp.search(query.trim());
      const results = (res.results || []).map((r) => ({
        id: "mangapill:" + r.id,
        rawId: r.id,
        title: r.title,
        name: r.title,
        media_type: "manga",
        poster_path: r.image,
        banner_path: r.image,
        overview: `Read ${r.title} complete chapters on MangaPill`,
        description: `Read ${r.title} complete chapters on MangaPill`,
        status: "ongoing",
        provider: "mangapill",
      }));
      setCache(cacheKey, results);
      return { ok: true, results };
    } catch (err) {
      return { ok: false, error: err.message || "Failed to search MangaPill" };
    }
  });

  // ── 3. Single Manga Details ────────────────────────────────────────────────
  ipcMain.handle("manga-pill-details", async (_, { id, title }) => {
    try {
      const cleanId = (id || "").replace(/^mangapill:/, "");
      const cacheKey = "details:" + (cleanId || (title || "").toLowerCase());
      const cached = getCache(cacheKey);
      if (cached) return { ok: true, details: cached };

      const mp = getMangaPill();
      let targetId = cleanId;

      if (!targetId && title) {
        const s = await mp.search(title.trim());
        const best = findBestManga(s.results, title.trim());
        if (best) targetId = best.id;
      }

      if (!targetId) {
        return { ok: false, error: "Manga not found" };
      }

      const info = await mp.fetchMangaInfo(targetId);
      const cleanGenres = (info.genres || []).filter((g) => g && g !== "Genres");
      const details = {
        id: "mangapill:" + targetId,
        rawId: targetId,
        title: info.title,
        name: info.title,
        media_type: "manga",
        poster_path: info.image,
        banner_path: info.image,
        overview: info.description || `Read ${info.title} on MangaPill`,
        description: info.description || `Read ${info.title} on MangaPill`,
        status: info.status || "Ongoing",
        genres: cleanGenres,
        releaseDate: info.releaseDate || null,
        year: info.releaseDate ? parseInt(info.releaseDate, 10) : null,
        provider: "mangapill",
      };

      setCache(cacheKey, details);
      return { ok: true, details };
    } catch (err) {
      return { ok: false, error: err.message || "Failed to fetch manga details" };
    }
  });

  // ── 4. Fetch all chapters for a manga ──────────────────────────────────────
  ipcMain.handle("manga-pill-chapters", async (_, { id, title }) => {
    try {
      const cleanId = (id || "").replace(/^mangapill:/, "");
      const cacheKey = "chapters:" + (cleanId || (title || "").toLowerCase());
      const cached = getCache(cacheKey);
      if (cached) return { ok: true, chapters: cached.chapters, manga: cached.manga };

      const mp = getMangaPill();
      let targetId = cleanId;
      let mangaTitle = title;
      let mangaImage = null;

      if (!targetId && title) {
        const searchRes = await mp.search(title.trim());
        if (!searchRes.results?.length) {
          return { ok: false, error: "No manga found matching " + title };
        }
        const best = findBestManga(searchRes.results, title.trim());
        if (best) {
          targetId = best.id;
          mangaTitle = best.title;
          mangaImage = best.image;
        }
      }

      if (!targetId) {
        return { ok: false, error: "Missing manga ID or title" };
      }

      const info = await mp.fetchMangaInfo(targetId);
      const rawChapters = info.chapters || [];

      // Sort chapters ascending (1, 2, 3...)
      const sortedChapters = [...rawChapters].sort((a, b) => {
        const na = parseFloat(a.chapter) || 0;
        const nb = parseFloat(b.chapter) || 0;
        return na - nb;
      });

      const chapters = sortedChapters.map((c) => ({
        id: "mangapill:" + c.id,
        rawId: c.id,
        chapter: c.chapter || "0",
        title: c.title || `Chapter ${c.chapter}`,
        pages: 1,
        provider: "mangapill",
      }));

      const payload = {
        chapters,
        manga: {
          id: "mangapill:" + targetId,
          title: info.title || mangaTitle,
          image: info.image || mangaImage,
        },
      };

      setCache(cacheKey, payload);
      return { ok: true, ...payload };
    } catch (err) {
      return { ok: false, error: err.message || "Failed to fetch chapters from MangaPill" };
    }
  });

  // ── 5. Fetch chapter pages by MangaPill chapter ID ─────────────────────────
  ipcMain.handle("manga-pill-pages", async (_, { chapterId }) => {
    try {
      if (!chapterId) return { ok: false, error: "Missing chapterId" };
      const rawId = chapterId.startsWith("mangapill:")
        ? chapterId.replace("mangapill:", "")
        : chapterId;

      const cacheKey = "pages:" + rawId;
      const cached = getCache(cacheKey);
      if (cached) return { ok: true, pages: cached };

      const mp = getMangaPill();
      const rawPages = await mp.fetchChapterPages(rawId);
      if (!rawPages || !rawPages.length) {
        return { ok: false, error: "No pages found for chapter on MangaPill" };
      }

      const pages = rawPages.map((p, idx) => ({
        pageNumber: idx + 1,
        url: p.img,
        fallbackUrl: p.img,
      }));

      setCache(cacheKey, pages);
      return { ok: true, pages };
    } catch (err) {
      return { ok: false, error: err.message || "Failed to load pages from MangaPill" };
    }
  });

  // ── 6. Fallback helper by title + chapter number ───────────────────────────
  ipcMain.handle("manga-pill-find-chapter", async (_, { title, chapterNumber }) => {
    try {
      if (!title || chapterNumber == null) {
        return { ok: false, error: "Missing title or chapterNumber" };
      }
      const cleanTitle = title.trim();
      const targetChNum = parseFloat(chapterNumber);

      const mp = getMangaPill();
      const searchRes = await mp.search(cleanTitle);
      if (!searchRes.results?.length) {
        return { ok: false, error: "Manga not found on MangaPill" };
      }

      const best = findBestManga(searchRes.results, cleanTitle);
      if (!best) {
        return { ok: false, error: "Manga not found on MangaPill" };
      }

      const info = await mp.fetchMangaInfo(best.id);
      const ch = (info.chapters || []).find((c) => {
        const cNum = parseFloat(c.chapter);
        if (!isNaN(cNum) && !isNaN(targetChNum)) return cNum === targetChNum;
        return c.id.endsWith("-chapter-" + chapterNumber);
      });

      if (!ch) {
        return { ok: false, error: `Chapter ${chapterNumber} not found on MangaPill` };
      }

      const rawPages = await mp.fetchChapterPages(ch.id);
      if (!rawPages || !rawPages.length) {
        return { ok: false, error: "No pages found for chapter on MangaPill" };
      }

      const pages = rawPages.map((p, idx) => ({
        pageNumber: idx + 1,
        url: p.img,
        fallbackUrl: p.img,
      }));

      return { ok: true, pages, chapterId: "mangapill:" + ch.id };
    } catch (err) {
      return { ok: false, error: err.message || "MangaPill fallback failed" };
    }
  });

  // ── 7. Image proxy helper (fetches image with Referer and returns base64 Data URL) ──
  ipcMain.handle("manga-pill-image", async (_, { url }) => {
    try {
      if (!url) return { ok: false, error: "Missing image url" };
      const cacheKey = "img:" + url;
      const cached = getCache(cacheKey, 60 * 60 * 1000); // 1 hr cache
      if (cached) return { ok: true, dataUrl: cached };

      await assertPublicHttpUrl(url);

      const res = await axios.get(url, {
        headers: {
          Referer: "https://mangapill.com/",
          Origin: "https://mangapill.com",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        responseType: "arraybuffer",
        timeout: 12000,
      });

      const contentType = res.headers["content-type"] || "image/jpeg";
      const base64 = Buffer.from(res.data).toString("base64");
      const dataUrl = `data:${contentType};base64,${base64}`;
      setCache(cacheKey, dataUrl);
      return { ok: true, dataUrl };
    } catch (err) {
      return { ok: false, error: err.message || "Failed to proxy image" };
    }
  });
}

module.exports = { register };
