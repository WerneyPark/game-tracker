import { COVER_MODE, ROW_HEIGHT, COVER_W } from "./config.js";

// ---- Helpers ----------------------------------------------------------------

// Google's API leaves out any field whose value is 0, so the first tab's id,
// or a range starting at row 0, comes back missing rather than as 0. Comparing
// those fields directly to 0 silently never matches.
export const at = (v) => v ?? 0;

const ROMAN_NUMERALS = [
  "i", "ii", "iii", "iv", "v", "vi",
  "vii", "viii", "ix", "x", "xi", "xii",
];

// PSN sometimes writes a numeral as a single Unicode Roman character — "DARK
// SOULS Ⅱ" uses U+2161, not two letter I's. The alphanumeric strip below would
// delete it outright, so the same game ends up on two rows under two keys.
// U+2160-216B are the uppercase forms and U+2170-217B the lowercase.
export const romanToAscii = (s) =>
  s.replace(/[\u2160-\u216B\u2170-\u217B]/g, (ch) => {
    const cp = ch.codePointAt(0);
    const base = cp >= 0x2170 ? 0x2170 : 0x2160;
    return ROMAN_NUMERALS[cp - base];
  });

const ROMAN_TO_NUM = Object.fromEntries(
  ROMAN_NUMERALS.map((r, i) => [r, i + 1])
);

// "PlayStation 4" and "PS5" are platform labels, not part of a game's name.
const PLATFORM_NOISE = /\b(?:playstation|ps)\s*[345]\b/g;

// "Years 1-4" is a range of games in a collection, not a series number.
const YEAR_RANGE = /\byears?(?:\s+\d+)+/g;

export const seriesTokens = (normalisedName) =>
  normalisedName
    .replace(PLATFORM_NOISE, " ")
    .replace(YEAR_RANGE, " ")
    .split(/\s+/)
    .filter(Boolean);

// Every number in a title, as a comparable string. Roman numerals count, and
// digits glued into a word do too — "NBA 2K22" and "NBA 2K21" differ only
// inside a single token, and reading neither as numbered would let them merge.
// Runs of three or more digits are years or the like ("Anno 1800"), not entries
// in a series, so they are ignored.
export const numbersIn = (tokens) => {
  const found = [];
  for (const t of tokens) {
    if (ROMAN_TO_NUM[t]) {
      found.push(ROMAN_TO_NUM[t]);
      continue;
    }
    for (const m of t.matchAll(/(?<!\d)\d{1,2}(?!\d)/g)) found.push(Number(m[0]));
  }
  return found.sort((a, b) => a - b).join(",");
};

// Sony sometimes points a store entry at the wrong game's trophy set — Splitgate
// Arena Reloaded resolves to Splitgate 2's — so a merge that would fold a sequel
// into the original has to be refused.
//
// The veto is deliberately narrow: it only fires when the two names start the
// same way and then disagree about a number, which is what a sequel looks like.
// Names that diverge from the first word ("Skyrim" against "The Elder Scrolls V:
// Skyrim Special Edition") are left to the trophy-set match, which is better
// evidence than anything guessable from the text.
export function sameSeriesEntry(nameA, nameB) {
  const a = seriesTokens(nameA);
  const b = seriesTokens(nameB);
  let shared = 0;
  while (shared < a.length && shared < b.length && a[shared] === b[shared]) {
    shared++;
  }
  if (shared === 0) return true;
  return numbersIn(a) === numbersIn(b);
}

export const norm = (s) =>
  romanToAscii((s || "").toString())
    .toLowerCase()
    .replace(/[™®©:]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    // PS3- and PS4-era trophy lists come back suffixed, e.g. "Apex Legends
    // Trophies" or "Vigor Trophy Set". Same game as the unsuffixed entry.
    .replace(/\s+(trophies|trophy set)$/, "");

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Total across all four grades. Platinum is 0 or 1, so it counts as one trophy.
export const totalTrophies = (t) =>
  t ? (t.bronze || 0) + (t.silver || 0) + (t.gold || 0) + (t.platinum || 0) : 0;

// The Game cell may hold a =HYPERLINK() formula rather than bare text. The game
// name is the formula's label, and that name is the key every row is matched on,
// so it has to be recovered before normalising or rows would duplicate.
const HYPERLINK_LABEL = /^\s*=HYPERLINK\(\s*"[^"]*"\s*,\s*"([^"]*)"/i;
export function gameNameFromCell(v) {
  if (typeof v !== "string") return v;
  const m = HYPERLINK_LABEL.exec(v);
  return m ? m[1] : v;
}

// PSN's own store URL for a game, built from its concept id.
export function gameCell(name, conceptId) {
  if (!conceptId) return name;
  const safe = String(name).replace(/"/g, "'");
  return `=HYPERLINK("https://store.playstation.com/concept/${conceptId}", "${safe}")`;
}

// How the account has access to the game. Two PSN signals feed it: the played
// list's service field, and the purchase list's membership field, which marks
// a monthly PS Plus claim as distinct from a real purchase. Owning a game
// outright beats having it through the subscription. Returns "" when PSN has
// no record either way — disc copies, other accounts, PS3-era games.
export function sourceLabel(g) {
  if (g.service === "none_purchased" || g.owned) return "Digital";
  if (g.service === "ps_plus" || g.plusClaim) return "PS Plus";
  return "";
}

export function durationToHours(iso) {
  if (!iso) return "";
  const m = /P(?:([\d.]+)D)?T?(?:([\d.]+)H)?(?:([\d.]+)M)?(?:([\d.]+)S)?/.exec(iso);
  if (!m) return "";
  const [, d, h, min, sec] = m.map((x) => (x ? parseFloat(x) : 0));
  const hours = (d || 0) * 24 + (h || 0) + (min || 0) / 60 + (sec || 0) / 3600;
  return hours ? Math.round(hours * 10) / 10 : "";
}

export const dateOnly = (iso) => (iso ? iso.slice(0, 10) : "");

export function platformFromCategory(cat) {
  if (!cat) return "";
  if (cat.includes("ps5")) return "PS5";
  if (cat.includes("ps4")) return "PS4";
  if (cat.includes("ps3")) return "PS3";
  if (cat.includes("vita")) return "PS Vita";
  return "";
}

// Pick the best cover from a PSN title's concept art (high-res). Prefer key
// art / portrait; avoid backgrounds and screenshots. Returns "" if none.
export function pickCover(title) {
  const imgs = title && title.concept && title.concept.media && title.concept.media.images;
  if (!Array.isArray(imgs) || imgs.length === 0) return "";
  const prefer = ["MASTER", "KEYART", "KEY_ART", "COVER", "PORTRAIT"];
  for (const p of prefer) {
    const hit = imgs.find((im) => im && im.url && (im.type || "").toUpperCase().includes(p));
    if (hit) return hit.url;
  }
  const bad = /BACKGROUND|SCREENSHOT|PROMO|LOGO|BANNER/i;
  const nice = imgs.find((im) => im && im.url && !bad.test(im.type || ""));
  return ((nice || imgs[0]) || {}).url || "";
}

// Cover cells written by earlier versions of this script are pinned to a fixed
// pixel box, which squashes art that isn't exactly that shape. Re-emit any
// existing formula in the current mode, keeping whatever URL it already points
// at. Returns null if the cell isn't an =IMAGE() formula.
const EXISTING_IMAGE = /^\s*=IMAGE\(\s*"([^"]+)"/i;
export function restyleCover(existing) {
  if (typeof existing !== "string") return null;
  const m = EXISTING_IMAGE.exec(existing);
  return m ? coverFormula(m[1]) : null;
}

export function coverFormula(url) {
  if (!url) return null;
  const safe = String(url).replace(/"/g, "").replace(/^http:/, "https:");
  return COVER_MODE === 4
    ? `=IMAGE("${safe}", 4, ${ROW_HEIGHT}, ${COVER_W})`
    : `=IMAGE("${safe}", ${COVER_MODE})`;
}

// Spreadsheet column index (0-based) to its A1 letter: 0 -> A, 26 -> AA.
export function colLetter(i) {
  let s = "";
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) {
    s = String.fromCharCode(65 + (n % 26)) + s;
  }
  return s;
}

export const rgb = (r, g, b) => ({ red: r / 255, green: g / 255, blue: b / 255 });

// Extract the spreadsheet ID even if the user pasted the full Google Sheets URL
// (e.g. "https://docs.google.com/spreadsheets/d/1abc.../edit#gid=0") or wrapped
// the secret in quotes/spaces.
export function parseSpreadsheetId(raw = process.env.SHEET_ID) {
  const cleaned = String(raw || "")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .trim();
  const urlMatch = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(cleaned);
  return urlMatch ? urlMatch[1] : cleaned;
}

