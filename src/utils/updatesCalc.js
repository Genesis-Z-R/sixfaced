// ── Updates feed calculations ────────────────────────────────────────────────
// Pure helpers behind the "Updates" tabs. A row compares the stored position
// (from history) with the newest chapter/episode a provider knows about.

/** "Chapter 200.5" / "200.5" / 200 → 200.5 (null when there is no number). */
export function parseChapterNumber(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value);
  // Prefer an explicit "Ch. 7.5" over a volume number like "Vol.3".
  const explicit = raw.match(/(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i);
  const match = explicit ? explicit[1] : raw.match(/\d+(?:\.\d+)?/)?.[0];
  if (!match) return null;
  const num = Number(match);
  return Number.isFinite(num) ? num : null;
}

/**
 * @param {Array<object>} chapters  chapter objects from the provider
 * @param {object|null} lastRead    history entry for this title
 */
export function computeMangaUpdate(chapters, lastRead) {
  const list = (chapters || [])
    .map((chapter) => ({ chapter, num: parseChapterNumber(chapter?.chapter) }))
    .filter((entry) => entry.num !== null)
    .sort((a, b) => b.num - a.num);

  const latest = list[0]?.chapter || null;
  const currentNum = lastRead ? parseChapterNumber(lastRead.chapter) : null;

  if (currentNum === null) {
    return {
      status: "not_started",
      latest,
      latestNum: latest ? parseChapterNumber(latest.chapter) : null,
      current: null,
      currentNum: null,
      newCount: null,
    };
  }

  const current =
    list.find((entry) => entry.num === currentNum)?.chapter ||
    { ...lastRead, chapter: lastRead.chapter };

  const newCount = list.filter((entry) => entry.num > currentNum).length;

  return {
    status: newCount > 0 ? "new" : "up_to_date",
    latest,
    latestNum: latest ? parseChapterNumber(latest.chapter) : null,
    current,
    currentNum,
    newCount,
  };
}

/** Same idea for a show: compare the stored episode with the last aired one. */
export function computeSeriesUpdate(show, lastWatch) {
  const latest = show?.last_episode_to_air || null;
  const currentSeason =
    lastWatch?.season !== null && lastWatch?.season !== undefined
      ? Number(lastWatch.season)
      : null;
  const currentEpisode =
    lastWatch?.episode !== null && lastWatch?.episode !== undefined
      ? Number(lastWatch.episode)
      : null;

  if (!latest) {
    return {
      status: "unknown",
      latest: null,
      current: lastWatch || null,
      newCount: null,
      newSeason: false,
    };
  }

  const latestSeason = Number(latest.season_number);
  const latestEpisode = Number(latest.episode_number);

  if (currentSeason === null || currentEpisode === null) {
    return {
      status: "not_started",
      latest,
      current: null,
      newCount: null,
      newSeason: false,
    };
  }

  if (latestSeason === currentSeason) {
    const diff = latestEpisode - currentEpisode;
    return {
      status: diff > 0 ? "new" : "up_to_date",
      latest,
      current: lastWatch,
      newCount: diff > 0 ? diff : 0,
      newSeason: false,
    };
  }

  if (latestSeason > currentSeason) {
    return {
      status: "new",
      latest,
      current: lastWatch,
      newCount: null,
      newSeason: true,
    };
  }

  return {
    status: "up_to_date",
    latest,
    current: lastWatch,
    newCount: 0,
    newSeason: false,
  };
}

const STATUS_RANK = {
  new: 0,
  not_started: 1,
  loading: 2,
  error: 3,
  unknown: 3,
  up_to_date: 4,
};

/** Unread titles first, then the biggest backlog, then alphabetical. */
export function sortUpdates(rows) {
  return [...(rows || [])].sort((a, b) => {
    const rank = (STATUS_RANK[a.status] ?? 5) - (STATUS_RANK[b.status] ?? 5);
    if (rank !== 0) return rank;
    const backlog = (b.newCount || 0) - (a.newCount || 0);
    if (backlog !== 0) return backlog;
    return String(a.title || "").localeCompare(String(b.title || ""));
  });
}

/** How many rows actually have something new to read. */
export function countWithUpdates(rows) {
  return (rows || []).filter((row) => row.status === "new").length;
}

/** "S2 E5" / "E5" formatting used by series rows. */
export function formatEpisode(season, episode, { withSeason = true } = {}) {
  if (episode === null || episode === undefined) return null;
  if (!withSeason || season === null || season === undefined) {
    return `E${episode}`;
  }
  return `S${season} E${episode}`;
}
