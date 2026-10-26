import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  calculateReadingPosition,
  calculateTargetScrollTop,
} from "../src/utils/readingProgress.js";

// Page wrappers in the reader are separated by a 2px margin, so scrollTop can
// legitimately land between two elements. That gap used to be reported as the
// last page (and therefore as chapter completion) — the regression these tests
// lock down.
const pages = [
  { offsetTop: 0, clientHeight: 1000 },
  { offsetTop: 1002, clientHeight: 1000 },
  { offsetTop: 2004, clientHeight: 1000 },
];

describe("reading position: page wrappers and gaps", () => {
  test("scrollTop inside the gap belongs to the preceding page", () => {
    const result = calculateReadingPosition({
      scrollTop: 1001,
      clientHeight: 800,
      scrollHeight: 3004,
      pageElements: pages,
      totalPages: 3,
    });
    assert.equal(result.page, 1);
    assert.equal(result.scrollRatio, 1);
    assert.equal(result.isCompleted, false);
  });

  test("scrollTop inside a page reports that page and its ratio", () => {
    const result = calculateReadingPosition({
      scrollTop: 1501,
      clientHeight: 800,
      scrollHeight: 3004,
      pageElements: pages,
      totalPages: 3,
    });
    assert.equal(result.page, 2);
    assert.equal(result.scrollRatio, 0.499);
    assert.equal(result.isCompleted, false);
  });

  test("scrolling past the last page is not completion unless near the bottom", () => {
    const result = calculateReadingPosition({
      scrollTop: 2700,
      clientHeight: 800,
      scrollHeight: 5000, // extra footer content, so not near the bottom
      pageElements: pages,
      totalPages: 3,
    });
    assert.equal(result.page, 3);
    assert.equal(result.scrollRatio, 0.696);
    assert.equal(result.isCompleted, false);
  });

  test("completion only fires within the threshold of the container bottom", () => {
    const result = calculateReadingPosition({
      scrollTop: 3004 - 800,
      clientHeight: 800,
      scrollHeight: 3004,
      pageElements: pages,
      totalPages: 3,
    });
    assert.equal(result.isCompleted, true);
    assert.equal(result.page, 3);
    assert.equal(result.scrollRatio, 1);
  });

  test("missing elements never throw and degrade to page 1", () => {
    const result = calculateReadingPosition({
      scrollTop: 10,
      clientHeight: 800,
      scrollHeight: 1000,
      pageElements: [null, null],
      totalPages: 2,
    });
    assert.equal(result.page, 1);
    assert.equal(result.isCompleted, false);
  });

  test("zero pages returns a neutral position", () => {
    const result = calculateReadingPosition({
      scrollTop: 0,
      clientHeight: 800,
      scrollHeight: 0,
      pageElements: [],
      totalPages: 0,
    });
    assert.deepEqual(result, { page: 1, scrollRatio: 0, isCompleted: false });
  });
});

describe("reading position: restoration target", () => {
  test("round-trips a saved page and ratio", () => {
    const saved = calculateReadingPosition({
      scrollTop: 2462,
      clientHeight: 800,
      scrollHeight: 6000,
      pageElements: pages,
      totalPages: 3,
    });
    const target = calculateTargetScrollTop({
      targetPage: saved.page,
      targetRatio: saved.scrollRatio,
      pageElements: pages,
    });
    assert.equal(target, 2462);
  });

  test("clamps a page beyond the chapter to the top", () => {
    assert.equal(
      calculateTargetScrollTop({
        targetPage: 45,
        targetRatio: 0.5,
        pageElements: pages,
      }),
      0,
    );
  });

  test("clamps an out-of-range ratio", () => {
    assert.equal(
      calculateTargetScrollTop({
        targetPage: 2,
        targetRatio: 9,
        pageElements: pages,
      }),
      2002,
    );
  });
});
