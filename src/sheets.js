import { google } from "googleapis";
import {
  SHEET_TAB,
  HEADER_RENAMES,
  ALL_HEADERS,
  EST_H,
  PROGRESS_H,
  PLAYTIME_H,
  HIDE_H,
  GOAL_H,
  TROPHY_COLUMNS,
  FALLBACK_TO_ICON,
  FOLD_STALE,
  DONE_STATUSES,
} from "./config.js";
import {
  at,
  norm,
  gameNameFromCell,
  gameCell,
  sourceLabel,
  totalTrophies,
  coverFormula,
  restyleCover,
  colLetter,
} from "./utils.js";

// ---- Google Sheets ----------------------------------------------------------
export function getSheetsClient() {
  let credentials;
  try {
    credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  } catch {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_KEY is not valid JSON. It should be the entire " +
        "contents of the service-account key file, braces included."
    );
  }
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

export async function getSheetId(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(sheetId,title)",
  });
  const found = (meta.data.sheets || []).find(
    (s) => s.properties.title === SHEET_TAB
  );
  if (!found) {
    const names = (meta.data.sheets || [])
      .map((s) => `"${s.properties.title}"`)
      .join(", ");
    throw new Error(
      `No tab named "${SHEET_TAB}" in this spreadsheet. Found: ${names}. ` +
        `Rename a tab to "${SHEET_TAB}" or set SHEET_TAB to one of these.`
    );
  }
  return at(found.properties.sheetId);
}

export async function readSheet(sheets) {
  const spreadsheetId = process.env.SHEET_ID;
  const read = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: SHEET_TAB,
    valueRenderOption: "FORMULA",
  });
  const rows = read.data.values || [];
  // A timestamp banner may sit above the header, so find the header by content
  // rather than assuming row 1. Sheets written by older versions have no banner.
  let headerRow = rows.findIndex(
    (r) => Array.isArray(r) && r.some((c) => gameNameFromCell(c) === "Game")
  );
  if (headerRow === -1) headerRow = rows.length ? 0 : -1;
  let header = headerRow === -1 ? null : rows[headerRow];
  const body = headerRow === -1 ? [] : rows.slice(headerRow + 1);
  // Keep whatever column order the sheet already uses and append only what is
  // missing. Replacing the header wholesale would silently shift every existing
  // row out of alignment the first time a new column is introduced.
  if (header) {
    header = header.map((h) => HEADER_RENAMES[h] || h);
  }
  if (!header || header.filter(Boolean).length === 0) {
    header = [...ALL_HEADERS];
  } else {
    for (const h of ALL_HEADERS) if (!header.includes(h)) header.push(h);
  }
  return { spreadsheetId, header, body, headerRow };
}

export function existingHoursMap(header, body) {
  const map = new Map();
  const gameCol = header.indexOf("Game");
  const hoursCol = header.indexOf(EST_H);
  if (hoursCol === -1) return map;
  for (const r of body) {
    const key = norm(gameNameFromCell(r[gameCol]));
    const val = r[hoursCol];
    if (key && val !== undefined && val !== "") map.set(key, val);
  }
  return map;
}

export async function writeSheet(
  sheets,
  spreadsheetId,
  sheetId,
  headerRow,
  header,
  body,
  games
) {
  const idx = {};
  ALL_HEADERS.forEach((h) => (idx[h] = header.indexOf(h)));

  const gameCol = idx["Game"];
  const width = header.length;
  const pad = (r) => {
    while (r.length < width) r.push("");
    return r;
  };
  const setAuto = (row, g) => {
    row[idx["Game"]] = gameCell(g.name, g.conceptId);
    row[idx["Platform"]] = g.platform || "";
    if (idx["Source"] !== -1) {
      const label = sourceLabel(g);
      if (label) row[idx["Source"]] = label;
    }
    row[idx[PROGRESS_H]] = typeof g.progress === "number" ? g.progress : 0;
    row[idx[PLAYTIME_H]] = g.playtime ?? "";
    row[idx["Last played"]] = g.lastPlayed || "";
    if (idx["First played"] !== -1) {
      row[idx["First played"]] = g.firstPlayed || "";
    }
    if (idx["PSN ID"] !== -1 && g.npComm) row[idx["PSN ID"]] = g.npComm;
    if (idx["Trophies"] !== -1) {
      row[idx["Trophies"]] = g.definedTrophies
        ? `${totalTrophies(g.trophies)} / ${totalTrophies(g.definedTrophies)}`
        : "";
    }
    if (idx["Plays"] !== -1) {
      row[idx["Plays"]] = typeof g.playCount === "number" ? g.playCount : "";
    }
    // PSN's own hidden flag ticks the box but never unties it. Hiding a game in
    // the sheet is your decision, and PSN not hiding it is no reason to undo it.
    if (idx[HIDE_H] !== -1 && g.hidden) {
      const current = String(row[idx[HIDE_H]] ?? "").trim().toUpperCase();
      if (current !== "TRUE") row[idx[HIDE_H]] = true;
    }
    for (const t of TROPHY_COLUMNS) {
      const i = idx[t.header];
      if (i === -1) continue;
      const v = g.trophies ? g.trophies[t.grade] : undefined;
      row[i] = typeof v === "number" ? v : "";
    }
    if (g.hoursToBeat !== undefined && g.hoursToBeat !== "") {
      row[idx[EST_H]] = g.hoursToBeat;
    }
    const existingCover = row[idx["Cover"]];
    if (g.coverUrl) {
      row[idx["Cover"]] = coverFormula(g.coverUrl);
    } else {
      const restyled = restyleCover(existingCover);
      if (restyled) {
        row[idx["Cover"]] = restyled;
      } else if (!existingCover && FALLBACK_TO_ICON && g.iconUrl) {
        row[idx["Cover"]] = coverFormula(g.iconUrl);
      }
    }
  };

  const rowByKey = new Map();
  const rowById = new Map();
  const collisions = new Map();
  const psnIdCol = idx["PSN ID"];
  for (const r of body) {
    if (psnIdCol !== -1 && r[psnIdCol]) {
      rowById.set(String(r[psnIdCol]).trim(), r);
    }
    const key = norm(gameNameFromCell(r[gameCol]));
    if (!key) continue;
    if (rowByKey.has(key)) {
      const group = collisions.get(key) || [rowByKey.get(key)];
      group.push(r);
      collisions.set(key, group);
    }
    rowByKey.set(key, r);
  }

  // The trophy-set id is the stable identifier, so it wins where the sheet has
  // one recorded. Names are the fallback, and the only option on the first run
  // after this column appears.
  const rowFor = (key, g) =>
    (g.npComm && rowById.get(g.npComm)) || rowByKey.get(key);

  const matched = new Set();
  for (const [key, g] of games) {
    const existing = rowFor(key, g);
    if (existing) {
      matched.add(existing);
      pad(existing);
      setAuto(existing, g);
    }
  }

  // Rows left untouched are usually the far half of a pair that has just been
  // merged under one identity: a store name the bridge folded into a trophy
  // set, or a twin that normalises to the same name as a live row.
  const allOrphans = body.filter(
    (r) => !matched.has(r) && norm(gameNameFromCell(r[gameCol]))
  );

  // Every name a live row answers to: its current name, its trophy-list name,
  // and any store name merged into it. A stale row filed under one of these is
  // a copy of that game.
  const liveByName = new Map();
  for (const [key, g] of games) {
    const live = rowFor(key, g);
    if (!live) continue;
    for (const n of [g.name, g.trophyName, ...(g.aliases || [])]) {
      const k = norm(n);
      if (!k) continue;
      if (!liveByName.has(k)) liveByName.set(k, new Set());
      liveByName.get(k).add(live);
    }
  }

  // What can be carried across. Hide is deliberately absent: a stale copy is
  // often hidden precisely because it was a duplicate, and copying that tick
  // would hide the live game.
  const STRICT = ["Status", "Priority", "Rating", "Price paid", "Notes", GOAL_H];
  const COPY = [...STRICT, "Source"];
  const blank = (v) => v === undefined || v === null || String(v).trim() === "";

  const folded = new Set();
  const foldLog = [];
  const heldBack = [];
  const heldBackRows = new Set();
  if (FOLD_STALE && headerRow === 1) {
    for (const r of allOrphans) {
      // A row that was ever stamped with a trophy-set id is a real game in its
      // own right, not a duplicate; leave it.
      if (psnIdCol !== -1 && !blank(r[psnIdCol])) continue;
      const name = gameNameFromCell(r[gameCol]);
      const twins = liveByName.get(norm(name));
      if (!twins || twins.size === 0) continue;

      const entered = COPY.filter((c) => idx[c] !== -1 && !blank(r[idx[c]]));
      // With nothing entered there's nothing to lose, so any live twin will do.
      // With entries, they need a single unambiguous home.
      if (entered.length && twins.size !== 1) {
        heldBack.push(`${name} (matches ${twins.size} live rows)`);
        heldBackRows.add(r);
        continue;
      }
      const live = [...twins][0];
      pad(live);
      const clashes = STRICT.filter(
        (c) =>
          idx[c] !== -1 &&
          !blank(r[idx[c]]) &&
          !blank(live[idx[c]]) &&
          String(r[idx[c]]).trim() !== String(live[idx[c]]).trim()
      );
      if (clashes.length) {
        heldBack.push(
          `${name} (${clashes
            .map((c) => `${c}: "${r[idx[c]]}" vs "${live[idx[c]]}"`)
            .join(", ")})`
        );
        heldBackRows.add(r);
        continue;
      }
      const carried = [];
      for (const c of entered) {
        if (blank(live[idx[c]])) {
          live[idx[c]] = r[idx[c]];
          carried.push(`${c}=${r[idx[c]]}`);
        }
      }
      folded.add(r);
      foldLog.push(
        `${name}  ->  ${gameNameFromCell(live[gameCol])}` +
          (carried.length ? `   (carried ${carried.join(", ")})` : "")
      );
    }
  }

  // Delete folded rows from the sheet itself before writing, so anything
  // formatted by hand on the rows below moves up with its content. If the
  // delete fails, write everything back as it was rather than shifting values
  // out of line with their rows.
  let keptBody = body;
  if (folded.size) {
    const gridRows = body
      .map((r, i) => (folded.has(r) ? headerRow + 1 + i : -1))
      .filter((i) => i >= 0)
      .sort((a, b) => b - a);
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: gridRows.map((i) => ({
            deleteDimension: {
              range: { sheetId, dimension: "ROWS", startIndex: i, endIndex: i + 1 },
            },
          })),
        },
      });
      keptBody = body.filter((r) => !folded.has(r));
      console.log(`\nFolded ${folded.size} stale row(s) into their live copies:`);
      for (const line of foldLog) console.log(`  - ${line}`);
    } catch (e) {
      folded.clear();
      console.warn("Stale rows could not be removed, so none were folded:", e.message);
    }
  }
  if (heldBack.length) {
    console.warn(
      `\n${heldBack.length} stale row(s) left alone because folding them would ` +
        `overwrite something, or there's no single place to put it:`
    );
    for (const line of heldBack) console.warn(`  - ${line}`);
  }

  // Pairs still sharing a name after folding.
  const stillColliding = [...collisions.values()]
    .map((g) => g.filter((r) => !folded.has(r)))
    .filter((g) => g.length > 1 && !g.some((r) => heldBackRows.has(r)));
  if (stillColliding.length) {
    console.warn(
      `\n${stillColliding.length} pair(s) of rows resolve to the same game. ` +
        `Only one of each is kept up to date:`
    );
    for (const g of stillColliding) {
      console.warn(`  - ${g.map((r) => gameNameFromCell(r[gameCol])).join("   ==   ")}`);
    }
  }

  const orphans = allOrphans.filter((r) => !folded.has(r) && !heldBackRows.has(r));
  if (orphans.length) {
    console.warn(
      `\n${orphans.length} row(s) matched no game in this sync and were left ` +
        `untouched. If a game now appears twice, this is the stale copy:`
    );
    for (const r of orphans.slice(0, 25)) {
      console.warn(`  - ${gameNameFromCell(r[gameCol])}`);
    }
    if (orphans.length > 25) {
      console.warn(`  ... and ${orphans.length - 25} more`);
    }
    console.warn("");
  }

  const newGames = [...games.entries()].filter(([k, g]) => !rowFor(k, g));
  newGames.sort((a, b) => (b[1].lastPlayed || "").localeCompare(a[1].lastPlayed || ""));
  const appended = newGames.map(([, g]) => {
    const r = pad([]);
    setAuto(r, g);
    return r;
  });

  const banner = pad([
    `Last synced: ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
  ]);
  const finalValues = [banner, header, ...keptBody, ...appended];

  // Sort order is a formula, not a value, so it keeps reacting as you edit
  // Status and Priority by hand. Row numbers are only known now that the sheet
  // has been assembled, hence writing it here rather than in setAuto.
  const sortCol = idx["Sort order"];
  const statusCol = idx["Status"];
  const priorityCol = idx["Priority"];
  if (sortCol !== -1 && statusCol !== -1 && priorityCol !== -1) {
    const s = colLetter(statusCol);
    const p = colLetter(priorityCol);
    // Sheets reads a dropdown choice the way it reads typing, so "100%" can land
    // as the number 1 formatted as a percentage rather than as text. Match both,
    // or a 100% game would never sink.
    const done = DONE_STATUSES.flatMap((x) => {
      const test = [`$${s}{R}="${x}"`];
      const pct = /^(\d+(?:\.\d+)?)%$/.exec(x);
      if (pct) test.push(`$${s}{R}=${Number(pct[1]) / 100}`);
      return test;
    }).join(",");
    for (let i = 2; i < finalValues.length; i++) {
      const R = i + 1; // 1-based sheet row
      finalValues[i][sortCol] =
        `=IF(OR(${done.replace(/\{R\}/g, R)}),1000000,` +
        `IF($${p}${R}="",500000,$${p}${R}))`;
    }
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_TAB}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: finalValues },
  });

  console.log(`Synced ${games.size} games (${appended.length} new).`);
  return finalValues.length - 2;
}
