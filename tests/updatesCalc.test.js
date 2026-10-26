import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  parseChapterNumber,
  computeMangaUpdate,
  computeSeriesUpdate,
  sortUpdates,
  countWithUpdates,
  formatEpisode,
} from "../src/utils/updatesCalc.js";

const chaptersDesc = [
  { id: "c210", chapter: 210 },
  { id: "c205", chapter: 205 },
  { id: "c201", chapter: 201 },
  { id: "c200.5", chapter: 200.5 },
  { id: "c200", chapter: 200 },
  { id: "c199", chapter: 199 },
];

describe("chapter numbers", () => {
  test("parses plain, prefixed and decimal numbers", () => {
    assert.equal(parseChapterNumber(200), 200);
    assert.equal(parseChapterNumber("200.5"), 200.5);
    assert.equal(parseChapterNumber("Chapter 12"), 12);
    assert.equal(parseChapterNumber("Vol.3 Ch.7.5"), 7.5);
    assert.equal(parseChapterNumber("extra"), null);
    assert.equal(parseChapterNumber(null), null);
  });
});

describe("manga updates", () => {
  test("counts everything after the current chapter", () => {
    const result = computeMangaUpdate(chaptersDesc, { chapter: "200", page: 4 });
    assert.equal(result.status, "new");
    assert.equal(result.newCount, 4); // 200.5, 201, 205, 210
    assert.equal(result.latest.chapter, 210);
    assert.equal(result.currentNum, 200);
    assert.equal(result.current.chapter, 200);
  });

  test("up to date when the newest chapter is the current one", () => {
    const result = computeMangaUpdate(chaptersDesc, { chapter: 210 });
    assert.equal(result.status, "up_to_date");
    assert.equal(result.newCount, 0);
  });

  test("not started when there is no history", () => {
    const result = computeMangaUpdate(chaptersDesc, null);
    assert.equal(result.status, "not_started");
    assert.equal(result.newCount, null);
    assert.equal(result.latest.chapter, 210);
  });

  test("keeps the stored chapter when the provider no longer lists it", () => {
    const result = computeMangaUpdate(chaptersDesc, { chapter: "150", chapterId: "gone" });
    assert.equal(result.status, "new");
    assert.equal(result.current.chapter, "150");
    assert.equal(result.newCount, 6);
  });

  test("ignores unparseable chapters and survives an empty list", () => {
    const result = computeMangaUpdate([{ chapter: "extras" }], { chapter: 3 });
    assert.equal(result.latest, null);
    assert.equal(result.newCount, 0);
  });
});

describe("series updates", () => {
  const show = {
    last_episode_to_air: { season_number: 2, episode_number: 9 },
  };

  test("counts new episodes in the same season", () => {
    const result = computeSeriesUpdate(show, { season: 2, episode: 5 });
    assert.equal(result.status, "new");
    assert.equal(result.newCount, 4);
  });

  test("up to date when the last aired episode was watched", () => {
    const result = computeSeriesUpdate(show, { season: 2, episode: 9 });
    assert.equal(result.status, "up_to_date");
    assert.equal(result.newCount, 0);
  });

  test("flags a new season without inventing an episode count", () => {
    const result = computeSeriesUpdate(show, { season: 1, episode: 12 });
    assert.equal(result.status, "new");
    assert.equal(result.newSeason, true);
    assert.equal(result.newCount, null);
  });

  test("not started with no history, unknown without air data", () => {
    assert.equal(computeSeriesUpdate(show, null).status, "not_started");
    assert.equal(computeSeriesUpdate({}, { season: 1, episode: 1 }).status, "unknown");
  });

  test("formats episode labels", () => {
    assert.equal(formatEpisode(2, 5), "S2 E5");
    assert.equal(formatEpisode(null, 5), "E5");
    assert.equal(formatEpisode(2, null), null);
  });
});

describe("sorting", () => {
  test("new first, then not started, then up to date", () => {
    const rows = sortUpdates([
      { title: "C", status: "up_to_date", newCount: 0 },
      { title: "B", status: "not_started", newCount: null },
      { title: "A", status: "new", newCount: 3 },
      { title: "D", status: "new", newCount: 12 },
    ]);
    assert.deepEqual(
      rows.map((r) => r.title),
      ["D", "A", "B", "C"],
    );
    assert.equal(countWithUpdates(rows), 2);
  });
});
