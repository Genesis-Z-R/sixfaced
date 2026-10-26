// ── IPC: Asura Scans & ComicK Korean Manhwa Provider for Streambert ────────
// Dedicated high-speed backend for Korean Manhwa (webtoons).
// Provides instant discovery, full English translations, rich metadata, and vertical continuous pages.

const { ipcMain } = require("electron");
const axios = require("axios");
const cheerio = require("cheerio");
const { MANGA } = require("@consumet/extensions");
const { LruCache } = require("./lruCache");
const { assertPublicHttpUrl } = require("./netGuard");

const ASURA_BASE = "https://asurascans.com";
const ASURA_CDN = "https://cdn.asurascans.com";

let _comick = null;
function getComicK() {
  if (!_comick) {
    _comick = new MANGA.ComicK();
  }
  return _comick;
}

const _cache = new Map();
function getCache(key, ttl = 10 * 60 * 1000) {
  const item = _cache.get(key);
  if (item && Date.now() - item.ts < ttl) return item.val;
  return null;
}
function setCache(key, val) {
  _cache.set(key, { val, ts: Date.now() });
}

// Curated all-time popular manhwa with permanent, high-res covers as a guaranteed baseline
const RAW_CLASSICS = [
  {
    id: "comics/solo-leveling-1bb35e56",
    title: "Solo Leveling",
    image: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx105398-b673Vt5ZSuz3.jpg",
    banner: "https://s4.anilist.co/file/anilistcdn/media/manga/banner/105398-4UrEhdqZukrg.jpg",
    media_type: "manhwa",
  },
  {
    id: "comics/omniscient-readers-viewpoint-1bb35e56",
    title: "Omniscient Reader’s Viewpoint",
    image: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx119257-Pi21aq3ey9GG.jpg",
    banner: "https://s4.anilist.co/file/anilistcdn/media/manga/banner/119257-RtxJMRCunHXc.jpg",
    media_type: "manhwa",
  },
  {
    id: "comics/return-of-the-mount-hua-sect-1bb35e56",
    title: "Return of the Mount Hua Sect",
    image: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx132144-i5B4VnG9sRgh.png",
    banner: "https://s4.anilist.co/file/anilistcdn/media/manga/banner/132144-tITrsibdFo3n.jpg",
    media_type: "manhwa",
  },
  {
    id: "comics/the-greatest-estate-developer-1bb35e56",
    title: "The Greatest Estate Developer",
    image: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx140407-fJQr0fmqq1IO.png",
    banner: "https://s4.anilist.co/file/anilistcdn/media/manga/banner/140407-WMGs02Q3fFUb.jpg",
    media_type: "manhwa",
  },
  {
    id: "comics/nano-machine-1bb35e56",
    title: "Nano Machine",
    image: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx120980-RZ9WLd0o9hyo.jpg",
    banner: "https://s4.anilist.co/file/anilistcdn/media/manga/banner/120980-7ak3NnHP5f2X.jpg",
    media_type: "manhwa",
  },
  {
    id: "comics/surviving-the-game-as-a-barbarian-1bb35e56",
    title: "Surviving the Game as a Barbarian",
    image: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx164857-MVeV0leMZb0m.jpg",
    banner: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx164857-MVeV0leMZb0m.jpg",
    media_type: "manhwa",
  },
  {
    id: "comics/solo-max-level-newbie-1bb35e56",
    title: "Solo Max-Level Newbie",
    image: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx137280-juUL79K7f9s7.png",
    banner: "https://s4.anilist.co/file/anilistcdn/media/manga/banner/137280-I46ILENRzGYY.jpg",
    media_type: "manhwa",
  },
  {
    id: "comics/murim-login-1bb35e56",
    title: "Murim Login",
    image: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx120385-4JYGuOR6cn72.jpg",
    banner: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx120385-4JYGuOR6cn72.jpg",
    media_type: "manhwa",
  },
  {
    id: "comics/pick-me-up-infinite-gacha-1bb35e56",
    title: "Pick Me Up, Infinite Gacha",
    image: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx159441-9W8201jAT9Yv.jpg",
    banner: "https://s4.anilist.co/file/anilistcdn/media/manga/banner/159441-ozFKHuPOjxhB.jpg",
    media_type: "manhwa",
  },
  {
    id: "comics/overgeared-1bb35e56",
    title: "Overgeared",
    image: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/medium/n105664-4x0zfa6fmqp8.png",
    banner: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/medium/n105664-4x0zfa6fmqp8.png",
    media_type: "manhwa",
  },
  {
    id: "comics/player-who-cant-level-up-1bb35e56",
    title: "Player Who Can’t Level Up",
    image: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx130511-4O6dF8oaiVJh.jpg",
    banner: "https://s4.anilist.co/file/anilistcdn/media/manga/banner/130511-yhBYCJcZtJyZ.jpg",
    media_type: "manhwa",
  },
  {
    id: "comics/leveling-up-with-the-gods-1bb35e56",
    title: "Leveling Up with the Gods",
    image: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx138222-PyVZk5MOWP07.png",
    banner: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx138222-PyVZk5MOWP07.png",
    media_type: "manhwa",
  },
  {
    id: "comics/damn-reincarnation-1bb35e56",
    title: "Damn Reincarnation",
    image: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx151512-q0Xddr1JNKNq.png",
    banner: "https://s4.anilist.co/file/anilistcdn/media/manga/banner/151512-EPskkVDBQvtC.jpg",
    media_type: "manhwa",
  },
  {
    id: "comics/infinite-mage-1bb35e56",
    title: "Infinite Mage",
    image: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx159930-qK1P4BNQL0zG.jpg",
    banner: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx159930-qK1P4BNQL0zG.jpg",
    media_type: "manhwa",
  },
  {
    id: "comics/reincarnation-of-the-suicidal-battle-god-1bb35e56",
    title: "Doom Breaker (Suicidal Battle God)",
    image: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx136220-u9sewv3u02mN.jpg",
    banner: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx136220-u9sewv3u02mN.jpg",
    media_type: "manhwa",
  },
  {
    id: "comics/swordmasters-youngest-son-1bb35e56",
    title: "Swordmaster’s Youngest Son",
    image: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx149332-adkSyOFY3c5U.jpg",
    banner: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx149332-adkSyOFY3c5U.jpg",
    media_type: "manhwa",
  },
  {
    id: "comics/revenge-of-the-iron-blooded-sword-hound-1bb35e56",
    title: "Revenge of the Iron-Blooded Sword Hound",
    image: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx163824-KiablxybJD6i.jpg",
    banner: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx163824-KiablxybJD6i.jpg",
    media_type: "manhwa",
  },
  {
    id: "comics/terminally-ill-genius-dark-knight-1bb35e56",
    title: "Terminally-Ill Genius Dark Knight",
    image: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx165182-k4Jfk2XMkylP.jpg",
    banner: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx165182-k4Jfk2XMkylP.jpg",
    media_type: "manhwa",
  },
  {
    id: "comics/solo-leveling-ragnarok-1bb35e56",
    title: "Solo Leveling: Ragnarok",
    image: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx179445-ho0nb7baJ1a5.jpg",
    banner: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx179445-ho0nb7baJ1a5.jpg",
    media_type: "manhwa",
  },
  {
    id: "comics/the-novels-extra-remake-1bb35e56",
    title: "The Novel’s Extra",
    image: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx152128-hk1Dq8zlEPVn.png",
    banner: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx152128-hk1Dq8zlEPVn.png",
    media_type: "manhwa",
  },
];

const MANHWA_CLASSICS = RAW_CLASSICS.map((item) => ({
  ...item,
  poster_path: item.image,
  banner_path: item.image,
}));

const HTTP_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

function register() {
  // ── 1. Popular / Spotlight Manhwa ──────────────────────────────────────────
  ipcMain.handle("manhwa-popular", async () => {
    const cacheKey = "manhwa:popular";
    const cached = getCache(cacheKey, 15 * 60 * 1000);
    if (cached) return { ok: true, results: cached };

    try {
      const res = await axios.get(`${ASURA_BASE}/comics`, {
        headers: HTTP_HEADERS,
        timeout: 9000,
      });
      const $ = cheerio.load(res.data);
      const scraped = [];
      $("a[href*=\"/comics/\"]").each((_, el) => {
        const href = $(el).attr("href");
        const img = $(el).find("img").attr("src");
        const title = $(el).find("img").attr("alt") || $(el).text().trim();
        if (
          href &&
          img &&
          !href.includes("/chapter/") &&
          !scraped.some((x) => x.id === href.replace(/^\//, ""))
        ) {
          scraped.push({
            id: href.replace(/^\//, ""),
            title: title.replace(/\s+/g, " "),
            image: img,
            poster_path: img,
            banner_path: img,
            media_type: "manhwa",
            provider: "asura",
          });
        }
      });

      // Merge curated top classics with fresh latest updates
      const seen = new Set();
      const combined = [];
      for (const item of [...MANHWA_CLASSICS, ...scraped]) {
        const norm = item.title.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (!seen.has(norm)) {
          seen.add(norm);
          combined.push({
            ...item,
            poster_path: item.poster_path || item.image,
            banner_path: item.banner_path || item.image,
            image: item.image || item.poster_path,
          });
        }
      }

      setCache(cacheKey, combined);
      return { ok: true, results: combined };
    } catch {
      // Return guaranteed classics if scraping is unavailable
      return { ok: true, results: MANHWA_CLASSICS };
    }
  });

  // ── 2. Search Manhwa ───────────────────────────────────────────────────────
  ipcMain.handle("manhwa-search", async (_, { query }) => {
    if (!query || !query.trim()) return { ok: true, results: [] };
    const cleanQ = query.trim();
    const cacheKey = "manhwa:search:" + cleanQ.toLowerCase();
    const cached = getCache(cacheKey);
    if (cached) return { ok: true, results: cached };

    try {
      const res = await axios.get(
        `${ASURA_BASE}/browse?search=${encodeURIComponent(cleanQ)}`,
        { headers: HTTP_HEADERS, timeout: 9000 }
      );
      const $ = cheerio.load(res.data);
      const results = [];
      $("a[href*=\"/comics/\"]").each((_, el) => {
        const href = $(el).attr("href");
        const img = $(el).find("img").attr("src");
        const title =
          $(el).find("img").attr("alt") ||
          $(el).find("span, h2, h3, p").first().text().trim() ||
          $(el).text().trim();
        if (
          href &&
          img &&
          !href.includes("/chapter/") &&
          !results.some((x) => x.id === href.replace(/^\//, ""))
        ) {
          results.push({
            id: href.replace(/^\//, ""),
            title: title.replace(/\s+/g, " "),
            image: img,
            poster_path: img,
            banner_path: img,
            media_type: "manhwa",
            provider: "asura",
          });
        }
      });

      if (results.length > 0) {
        setCache(cacheKey, results);
        return { ok: true, results };
      }

      // Fallback: ComicK search if Asura didn't return matches
      const comick = getComicK();
      const cRes = await comick.search(cleanQ);
      if (cRes?.results?.length) {
        const comickResults = cRes.results.map((r) => ({
          id: "comick:" + r.id,
          title: r.title,
          image: r.image,
          poster_path: r.image,
          banner_path: r.image,
          media_type: "manhwa",
          provider: "comick",
        }));
        setCache(cacheKey, comickResults);
        return { ok: true, results: comickResults };
      }

      return { ok: true, results: [] };
    } catch {
      // Local fallback from classics list
      const lower = cleanQ.toLowerCase();
      const localMatches = MANHWA_CLASSICS.filter((c) =>
        c.title.toLowerCase().includes(lower)
      );
      return { ok: true, results: localMatches };
    }
  });

  // ── 3. Manhwa Details ──────────────────────────────────────────────────────
  ipcMain.handle("manhwa-details", async (_, { id, title }) => {
    const targetId = id || title;
    if (!targetId) return { ok: false, error: "Missing manhwa id" };
    const cacheKey = "manhwa:details:" + targetId;
    const cached = getCache(cacheKey);
    if (cached) return { ok: true, details: cached };

    // ComicK ID route
    if (typeof targetId === "string" && targetId.startsWith("comick:")) {
      try {
        const rawSlug = targetId.replace("comick:", "");
        const comick = getComicK();
        const info = await comick.fetchMangaInfo(rawSlug);
        const details = {
          id: targetId,
          title: info.title || title,
          name: info.title || title,
          poster_path: info.image,
          overview: info.description || "Korean manhwa series.",
          status: info.status || "Ongoing",
          genres: (info.genres || []).map((g) => ({ name: g })),
          media_type: "manhwa",
          provider: "comick",
        };
        setCache(cacheKey, details);
        return { ok: true, details };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    // Asura Scans route
    try {
      const url = targetId.startsWith("http")
        ? targetId
        : `${ASURA_BASE}/${targetId.replace(/^\//, "")}`;
      const res = await axios.get(url, { headers: HTTP_HEADERS, timeout: 9000 });
      const $ = cheerio.load(res.data);

      const scrapedTitle = $("h1").first().text().trim() || title;
      const cover = $("img[src*=\"/covers/\"], img[src*=\"asura-images\"]").first().attr("src");
      const desc = $("p, .synopsis, .description")
        .filter((_, el) => $(el).text().length > 50)
        .first()
        .text()
        .trim();

      const genres = [];
      $("a[href*=\"genres=\"], button").each((_, el) => {
        const g = $(el).text().trim();
        if (g && g.length < 20 && !genres.some((x) => x.name === g)) {
          genres.push({ name: g });
        }
      });

      const details = {
        id: targetId,
        title: scrapedTitle,
        name: scrapedTitle,
        poster_path: cover || null,
        overview: desc || "Read Korean manhwa chapters with continuous vertical scroll.",
        status: "Ongoing",
        genres: genres.length > 0 ? genres : [{ name: "Manhwa" }, { name: "Action" }],
        media_type: "manhwa",
        provider: "asura",
      };

      setCache(cacheKey, details);
      return { ok: true, details };
    } catch (err) {
      return {
        ok: false,
        error: err?.message || "Failed to load manhwa details",
      };
    }
  });

  // ── 4. Manhwa Chapters ─────────────────────────────────────────────────────
  ipcMain.handle("manhwa-chapters", async (_, { id, title }) => {
    const targetId = id || title;
    if (!targetId) return { ok: false, error: "Missing manhwa id" };
    const cacheKey = "manhwa:chapters:" + targetId;
    const cached = getCache(cacheKey);
    if (cached) return { ok: true, ...cached };

    // ComicK chapter list
    if (typeof targetId === "string" && targetId.startsWith("comick:")) {
      try {
        const rawSlug = targetId.replace("comick:", "");
        const comick = getComicK();
        const info = await comick.fetchMangaInfo(rawSlug);
        const enChapters = (info.chapters || [])
          .filter((c) => !c.lang || c.lang === "en")
          .map((c) => ({
            id: "comick:" + c.id,
            chapter: c.chapterNumber || "1",
            title: c.title ? `Ch. ${c.chapterNumber} - ${c.title}` : `Chapter ${c.chapterNumber}`,
            releaseDate: c.releaseDate || "",
            pages: 1,
            provider: "comick",
          }));

        // Sort ascending numeric
        enChapters.sort((a, b) => parseFloat(a.chapter) - parseFloat(b.chapter));
        const payload = { chapters: enChapters, manhwa: { id: targetId, title: info.title } };
        setCache(cacheKey, payload);
        return { ok: true, ...payload };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    // Asura Scans chapter list
    try {
      const url = targetId.startsWith("http")
        ? targetId
        : `${ASURA_BASE}/${targetId.replace(/^\//, "")}`;
      const res = await axios.get(url, { headers: HTTP_HEADERS, timeout: 9000 });
      const $ = cheerio.load(res.data);

      const seen = new Set();
      const chapters = [];
      $("a[href*=\"/chapter/\"]").each((_, el) => {
        const href = $(el).attr("href");
        if (!href) return;
        const chapNum = href.split("/chapter/")[1]?.split(/[?#/]/)[0] || "";
        const cleanHref = href.replace(/^\//, "");
        if (chapNum && !seen.has(cleanHref)) {
          seen.add(cleanHref);
          const rawText = $(el).text().trim().replace(/\s+/g, " ");
          chapters.push({
            id: cleanHref,
            chapter: chapNum,
            title: rawText || `Chapter ${chapNum}`,
            pages: 1,
            provider: "asura",
          });
        }
      });

      chapters.sort((a, b) => parseFloat(a.chapter) - parseFloat(b.chapter));

      const payload = {
        chapters,
        manhwa: {
          id: targetId,
          title: $("h1").first().text().trim() || title,
        },
      };

      setCache(cacheKey, payload);
      return { ok: true, ...payload };
    } catch (err) {
      return { ok: false, error: err.message || "Failed to load chapters" };
    }
  });

  // ── 5. Manhwa Chapter Pages ────────────────────────────────────────────────
  ipcMain.handle("manhwa-pages", async (_, { chapterId }) => {
    if (!chapterId) return { ok: false, error: "Missing chapterId" };
    const cacheKey = "manhwa:pages:" + chapterId;
    const cached = getCache(cacheKey);
    if (cached) return { ok: true, pages: cached };

    // ComicK pages route
    if (chapterId.startsWith("comick:")) {
      try {
        const rawId = chapterId.replace("comick:", "");
        const comick = getComicK();
        const rawPages = await comick.fetchChapterPages(rawId);
        if (!rawPages || !rawPages.length) {
          return { ok: false, error: "No pages found for chapter on ComicK" };
        }
        const pages = rawPages.map((p, idx) => ({
          pageNumber: idx + 1,
          url: p.img,
          fallbackUrl: p.img,
        }));
        setCache(cacheKey, pages);
        return { ok: true, pages };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    // Asura Scans pages route
    try {
      const url = chapterId.startsWith("http")
        ? chapterId
        : `${ASURA_BASE}/${chapterId.replace(/^\//, "")}`;
      const res = await axios.get(url, { headers: HTTP_HEADERS, timeout: 10000 });
      const $ = cheerio.load(res.data);

      const pages = [];
      $("img[src*=\"/chapters/\"], img[src*=\"asura-images/chapters\"], img[data-src*=\"/chapters/\"]").each(
        (_, el) => {
          const src = $(el).attr("src") || $(el).attr("data-src");
          if (src && !pages.some((p) => p.url === src)) {
            pages.push({
              pageNumber: pages.length + 1,
              url: src,
              fallbackUrl: src,
            });
          }
        }
      );

      if (!pages.length) {
        return { ok: false, error: "No chapter pages found" };
      }

      setCache(cacheKey, pages);
      return { ok: true, pages };
    } catch (err) {
      return { ok: false, error: err.message || "Failed to load chapter pages" };
    }
  });

  // ── 6. Fallback find chapter by title + chapterNumber ─────────────────────
  ipcMain.handle("manhwa-find-chapter", async (_, { title, chapterNumber }) => {
    if (!title || chapterNumber == null) {
      return { ok: false, error: "Missing title or chapterNumber" };
    }
    const cleanTitle = title.trim();
    const targetChNum = parseFloat(chapterNumber);

    try {
      const res = await axios.get(
        `${ASURA_BASE}/browse?search=${encodeURIComponent(cleanTitle)}`,
        { headers: HTTP_HEADERS, timeout: 9000 }
      );
      const $ = cheerio.load(res.data);
      const firstLink = $("a[href*=\"/comics/\"]").first().attr("href");
      if (!firstLink) return { ok: false, error: "Manhwa not found on Asura" };

      const comicUrl = `${ASURA_BASE}/${firstLink.replace(/^\//, "")}`;
      const cRes = await axios.get(comicUrl, { headers: HTTP_HEADERS, timeout: 9000 });
      const c$ = cheerio.load(cRes.data);

      let targetChapterHref = null;
      c$("a[href*=\"/chapter/\"]").each((_, el) => {
        const href = c$(el).attr("href");
        const chapNum = parseFloat(href.split("/chapter/")[1]?.split(/[?#/]/)[0]);
        if (chapNum === targetChNum) {
          targetChapterHref = href;
        }
      });

      if (!targetChapterHref) {
        return { ok: false, error: `Chapter ${chapterNumber} not found` };
      }

      const pRes = await axios.get(`${ASURA_BASE}/${targetChapterHref.replace(/^\//, "")}`, {
        headers: HTTP_HEADERS,
        timeout: 10000,
      });
      const p$ = cheerio.load(pRes.data);
      const pages = [];
      p$("img[src*=\"/chapters/\"], img[src*=\"asura-images/chapters\"]").each((_, el) => {
        const src = p$(el).attr("src") || p$(el).attr("data-src");
        if (src && !pages.some((p) => p.url === src)) {
          pages.push({
            pageNumber: pages.length + 1,
            url: src,
            fallbackUrl: src,
          });
        }
      });

      return { ok: true, pages, chapterId: targetChapterHref.replace(/^\//, "") };
    } catch (err) {
      return { ok: false, error: err.message || "Failed to find chapter" };
    }
  });

  // ── 7. Image proxy helper ──────────────────────────────────────────────────
  ipcMain.handle("manhwa-image", async (_, { url, title }) => {
    if (!url && !title) return { ok: false, error: "Missing image url or title" };
    const cacheKey = "manhwa:img:" + (url || title);
    const cached = getCache(cacheKey, 60 * 60 * 1000);
    if (cached) return { ok: true, dataUrl: cached };

    const tryFetch = async (targetUrl) => {
      if (!targetUrl || typeof targetUrl !== "string") return null;
      if (targetUrl.startsWith("data:")) return targetUrl;
      await assertPublicHttpUrl(targetUrl);
      const isComick = targetUrl.includes("comick");
      const res = await axios.get(targetUrl, {
        headers: {
          Referer: isComick ? "https://comick.art/" : "https://asurascans.com/",
          Origin: isComick ? "https://comick.art" : "https://asurascans.com",
          "User-Agent": HTTP_HEADERS["User-Agent"],
        },
        responseType: "arraybuffer",
        timeout: 10000,
      });
      const contentType = res.headers["content-type"] || "image/webp";
      const base64 = Buffer.from(res.data).toString("base64");
      return `data:${contentType};base64,${base64}`;
    };

    // 1. Try provided URL
    if (url) {
      try {
        const dataUrl = await tryFetch(url);
        if (dataUrl) {
          setCache(cacheKey, dataUrl);
          return { ok: true, dataUrl };
        }
      } catch {}
    }

    // 2. Fallback: Search AniList by title if provided
    if (title) {
      try {
        const cleanTitle = title.replace(/\(.*?\)/g, "").replace(/\[.*?\]/g, "").trim();
        const aniRes = await axios.post(
          "https://graphql.anilist.co",
          {
            query: `
              query ($search: String) {
                Media(search: $search, type: MANGA) {
                  coverImage { extraLarge large }
                }
              }
            `,
            variables: { search: cleanTitle },
          },
          { timeout: 6000 }
        );
        const cover =
          aniRes.data?.data?.Media?.coverImage?.extraLarge ||
          aniRes.data?.data?.Media?.coverImage?.large;
        if (cover) {
          const dataUrl = await tryFetch(cover);
          if (dataUrl) {
            setCache(cacheKey, dataUrl);
            return { ok: true, dataUrl };
          }
        }
      } catch {}
    }

    return { ok: false, error: "Image unavailable" };
  });
}

module.exports = { register };
