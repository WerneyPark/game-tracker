import {
  BANNER_HEIGHT,
  HEADER_HEIGHT,
  ROW_HEIGHT,
  COVER_W,
  GAME_W,
  PLATFORM_W,
  PROGRESS_H,
  PLAYTIME_H,
  EST_H,
  HIDE_H,
  GOAL_H,
  TROPHY_HEADERS,
  TROPHY_COLUMNS,
  FROZEN_COLUMNS,
  PRICE_FORMAT,
  BANNER_SPAN,
  RATING_OPTIONS,
  STATUS_OPTIONS,
  SOURCE_OPTIONS,
} from "./config.js";
import { at, colLetter, rgb } from "./utils.js";

// ---- Formatting -------------------------------------------------------------
const PLATINUM_BG = rgb(173, 216, 230); // light blue, the platinum convention

const PROGRESS_LOW = rgb(230, 124, 115);
const PROGRESS_MID = rgb(255, 214, 102);
const PROGRESS_HIGH = rgb(87, 187, 138);

// Column sizing, conditional colour, and the rating dropdown. Safe to re-run:
// every request here overwrites rather than appends, and the conditional rules
// are torn down and rebuilt so repeated syncs can't stack duplicates.
export async function applyFormatting(
  sheets,
  spreadsheetId,
  sheetId,
  header,
  dataRowCount
) {
  const col = (name) => header.indexOf(name);
  const requests = [];

  const sizeRows = (startIndex, endIndex, px) =>
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: "ROWS", startIndex, endIndex },
        properties: { pixelSize: px },
        fields: "pixelSize",
      },
    });

  const sizeCol = (name, px) => {
    const i = col(name);
    if (i === -1) return;
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 },
        properties: { pixelSize: px },
        fields: "pixelSize",
      },
    });
  };

  sizeRows(0, 1, BANNER_HEIGHT);
  sizeRows(1, 2, HEADER_HEIGHT);
  if (dataRowCount > 0) sizeRows(2, 2 + dataRowCount, ROW_HEIGHT);

  sizeCol("Cover", COVER_W);
  sizeCol("Game", GAME_W);
  sizeCol("Platform", PLATFORM_W);
  sizeCol("Sort order", 70);
  sizeCol(PROGRESS_H, 50);
  sizeCol(PLAYTIME_H, 75);
  sizeCol(EST_H, 75);
  sizeCol(HIDE_H, 60);
  sizeCol("PSN ID", 90);
  sizeCol("Trophies", 60);
  sizeCol("Plays", 50);
  sizeCol("First played", 75);
  sizeCol("Last played", 75);
  for (const t of TROPHY_HEADERS) sizeCol(t, 25);

  // Everything sits in the vertical middle of its row. Done first and as a
  // single field so the per-column rules below layer on top of it.
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: header.length },
      cell: { userEnteredFormat: { verticalAlignment: "MIDDLE" } },
      fields: "userEnteredFormat.verticalAlignment",
    },
  });

  // Per-column presentation. Each call names only the fields it sets, so these
  // never clobber one another or anything set by hand in the sheet.
  const styleCol = (name, fmt, fields, fromRow = 2, toRow) => {
    const i = col(name);
    if (i === -1) return;
    const range = {
      sheetId,
      startRowIndex: fromRow,
      startColumnIndex: i,
      endColumnIndex: i + 1,
    };
    if (toRow !== undefined) range.endRowIndex = toRow;
    requests.push({
      repeatCell: {
        range,
        cell: { userEnteredFormat: fmt },
        fields: fields.map((f) => `userEnteredFormat.${f}`).join(","),
      },
    });
  };

  const CENTER = [{ horizontalAlignment: "CENTER" }, ["horizontalAlignment"]];
  const WRAP = [{ wrapStrategy: "WRAP" }, ["wrapStrategy"]];

  styleCol(PROGRESS_H, ...CENTER);
  styleCol(PLAYTIME_H, ...CENTER);
  styleCol(EST_H, ...CENTER);
  styleCol("Trophies", ...CENTER);
  styleCol("Plays", ...CENTER);
  styleCol("Game", ...WRAP);
  styleCol("Notes", ...WRAP);
  styleCol(GOAL_H, ...WRAP);

  // Platform is a 25px column, so the label is turned on its side to fit.
  styleCol(
    "Platform",
    { textRotation: { angle: 90 } },
    ["textRotation"]
  );

  // The header row gets room to breathe and wraps, since several columns are
  // now narrower than their own titles.
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: header.length },
      cell: {
        userEnteredFormat: { wrapStrategy: "WRAP", verticalAlignment: "MIDDLE" },
      },
      fields: "userEnteredFormat.wrapStrategy,userEnteredFormat.verticalAlignment",
    },
  });

  // Tint each trophy column's header cell with its grade colour.
  for (const t of TROPHY_COLUMNS) {
    styleCol(t.header, { backgroundColor: rgb(...t.color) }, ["backgroundColor"], 1, 2);
    styleCol(t.header, ...CENTER);
  }

  // Keep the header on screen while scrolling down, and the cover and title on
  // screen while scrolling across.
  requests.push({
    updateSheetProperties: {
      properties: {
        sheetId,
        gridProperties: { frozenRowCount: 2, frozenColumnCount: FROZEN_COLUMNS },
      },
      fields: "gridProperties.frozenRowCount,gridProperties.frozenColumnCount",
    },
  });

  // Display formats only — the underlying values stay numeric so sorting,
  // filtering and the colour scale all keep working.
  const numberFormat = (name, pattern) => {
    const i = col(name);
    if (i === -1) return;
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 2,
          startColumnIndex: i,
          endColumnIndex: i + 1,
        },
        cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern } } },
        fields: "userEnteredFormat.numberFormat",
      },
    });
  };
  // PSN reports progress as 0-100, so append a literal % rather than using a
  // PERCENT format, which would multiply by 100 again and show "4200%".
  numberFormat(PROGRESS_H, '0"%"');
  numberFormat(PLAYTIME_H, "0.0");
  numberFormat("Price paid", PRICE_FORMAT);
  numberFormat("Priority", "0");
  numberFormat("Plays", "0");

  // One read of the tab's current formatting state, used by the merge,
  // banding and conditional-rule sections below.
  // removed, so delete from the end backwards.
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields:
      "sheets(properties.sheetId,conditionalFormats,basicFilter,merges,bandedRanges)",
  });
  const sheet = (meta.data.sheets || []).find(
    (s) => at(s.properties.sheetId) === sheetId
  );

  // Merge the banner across the top. Sheets refuses to merge across the line
  // between frozen and scrolling columns, so when columns are frozen the banner
  // stays inside them — Cover and Game together are wide enough for it.
  const bannerWidth = Math.min(
    FROZEN_COLUMNS > 0 ? FROZEN_COLUMNS : BANNER_SPAN,
    header.length
  );
  const existingMerges = (sheet && sheet.merges) || [];
  const bannerMerge = existingMerges.find((m) => at(m.startRowIndex) === 0);
  const bannerMatches =
    bannerMerge &&
    at(bannerMerge.startColumnIndex) === 0 &&
    bannerMerge.endColumnIndex === bannerWidth &&
    bannerMerge.endRowIndex === 1;
  // Both halves go out on their own rather than in the main request. An old,
  // wider banner merge has to be undone *before* the freeze is applied, since
  // Sheets won't freeze a line through a merged cell; and the new merge goes
  // last, so a merge Sheets rejects can't take the rest of the formatting down.
  const unmergeFirst = [];
  const mergeRequests = [];
  if (!bannerMatches) {
    if (bannerMerge) {
      unmergeFirst.push({
        unmergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 } },
      });
    }
    mergeRequests.push({
      mergeCells: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: bannerWidth,
        },
        mergeType: "MERGE_ALL",
      },
    });
  }

  // Alternating row colours. Like the conditional rules these stack if simply
  // re-added, so the existing ones go first.
  for (const b of (sheet && sheet.bandedRanges) || []) {
    requests.push({ deleteBanding: { bandedRangeId: b.bandedRangeId } });
  }
  requests.push({
    addBanding: {
      bandedRange: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: header.length },
        rowProperties: {
          headerColor: rgb(232, 232, 232),
          firstBandColor: rgb(255, 255, 255),
          secondBandColor: rgb(246, 246, 246),
        },
      },
    },
  });

  const existingRules = (sheet && sheet.conditionalFormats) || [];
  for (let i = existingRules.length - 1; i >= 0; i--) {
    requests.push({ deleteConditionalFormatRule: { sheetId, index: i } });
  }

  const progressCol = col(PROGRESS_H);
  const platinumCol = col("P");
  if (progressCol !== -1) {
    // No endRowIndex: the rules cover the whole column, including rows that
    // don't exist yet, so they never need revisiting as the library grows.
    const ranges = [
      {
        sheetId,
        startRowIndex: 2,
        startColumnIndex: progressCol,
        endColumnIndex: progressCol + 1,
      },
    ];

    // Rules are evaluated in order, so the platinum rule goes first and wins
    // outright where it matches.
    let index = 0;
    if (platinumCol !== -1) {
      requests.push({
        addConditionalFormatRule: {
          index: index++,
          rule: {
            ranges,
            booleanRule: {
              condition: {
                type: "CUSTOM_FORMULA",
                values: [
                  { userEnteredValue: `=$${colLetter(platinumCol)}3=1` },
                ],
              },
              format: { backgroundColor: PLATINUM_BG },
            },
          },
        },
      });
    }

    // Everything else grades red -> yellow -> green across 0-100% complete.
    requests.push({
      addConditionalFormatRule: {
        index,
        rule: {
          ranges,
          gradientRule: {
            minpoint: { color: PROGRESS_LOW, type: "NUMBER", value: "0" },
            midpoint: { color: PROGRESS_MID, type: "NUMBER", value: "50" },
            maxpoint: { color: PROGRESS_HIGH, type: "NUMBER", value: "100" },
          },
        },
      },
    });
  }

  // Validation applied before the banner existed is anchored to the grid, not
  // to the content, so when the banner pushed everything down a row it ended up
  // covering the header — which is why "Status" and "Rating" show as errors in
  // their own header cells. Clear the top two rows outright before re-applying.
  requests.push({
    setDataValidation: {
      range: {
        sheetId,
        startRowIndex: 0,
        endRowIndex: 2,
        startColumnIndex: 0,
        endColumnIndex: header.length,
      },
    },
  });

  // Dropdowns. strict:false warns on values outside the list rather than
  // rejecting them, so nothing already in a column gets blocked.
  const dropdown = (name, options) => {
    const i = col(name);
    if (i === -1 || options.length === 0) return;
    requests.push({
      setDataValidation: {
        range: {
          sheetId,
          startRowIndex: 2,
          startColumnIndex: i,
          endColumnIndex: i + 1,
        },
        rule: {
          condition: {
            type: "ONE_OF_LIST",
            values: options.map((o) => ({ userEnteredValue: String(o) })),
          },
          showCustomUi: true,
          strict: false,
        },
      },
    });
  };

  dropdown("Rating", RATING_OPTIONS);
  dropdown("Status", STATUS_OPTIONS);
  dropdown("Source", SOURCE_OPTIONS);

  // Hidden is a checkbox. Ticking it drops the row out of the view via the
  // filter below; untick it, or clear the filter, to get the row back.
  const hiddenCol = col(HIDE_H);
  if (hiddenCol !== -1) {
    requests.push({
      setDataValidation: {
        range: {
          sheetId,
          startRowIndex: 2,
          startColumnIndex: hiddenCol,
          endColumnIndex: hiddenCol + 1,
        },
        rule: { condition: { type: "BOOLEAN" }, showCustomUi: true },
      },
    });

    // Set the filter once and then leave it alone: re-applying it on every run
    // would throw away whatever sort or extra criteria you'd set up. Delete the
    // filter in Sheets and the next sync will recreate it from scratch.
    // Same problem as the validation above: a filter created before the banner
    // starts on the banner row and treats it as the header. Leave an aligned
    // filter alone so a sort you set survives, but rebuild a misaligned one.
    const existingFilter = sheet && sheet.basicFilter;
    const filterAligned =
      existingFilter &&
      existingFilter.range &&
      existingFilter.range.startRowIndex === 1;
    if (!filterAligned) {
      requests.push({
        setBasicFilter: {
          filter: {
            range: {
              sheetId,
              startRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: header.length,
            },
            criteria: { [hiddenCol]: { hiddenValues: ["TRUE"] } },
            ...(col("Sort order") !== -1
              ? {
                  sortSpecs: [
                    {
                      dimensionIndex: col("Sort order"),
                      sortOrder: "ASCENDING",
                    },
                  ],
                }
              : {}),
          },
        },
      });
    }
  }

  if (unmergeFirst.length) {
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: unmergeFirst },
      });
    } catch (e) {
      console.warn("Old banner merge could not be removed:", e.message);
    }
  }
  if (requests.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    });
  }
  if (mergeRequests.length) {
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: mergeRequests },
      });
    } catch (e) {
      console.warn("Banner merge skipped:", e.message);
    }
  }
}
