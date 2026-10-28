// ---- Config ----------------------------------------------------------------
// Everything here is overridable by environment variable; see README.
const num = (name, fallback) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

// Target PlayStation Online ID (PSN username) to query, e.g. "WerneyPark".
// Allows authenticating with a secondary/bot NPSSO token while fetching data
// for your main account. Leave blank or "me" to query the NPSSO owner itself.
export const PSN_ONLINE_ID = (process.env.PSN_ONLINE_ID || "").trim();

export const SHEET_TAB = process.env.SHEET_TAB || "Games";

// Cover art sizing. Mode 1 = fit inside the cell without distortion.
// (Switch to 4 to force an exact box, at the cost of stretching odd shapes.)
// 1 fits the art inside the cell without distorting it; 4 forces an exact
// pixel box and will stretch anything that isn't that shape.
export const COVER_MODE = num("COVER_MODE", 1);
export const COVER_W = num("COVER_W", 150);      // Cover column width, pixels
export const GAME_W = num("GAME_W", 150);        // Game column width
export const PLATFORM_W = num("PLATFORM_W", 25); // Platform column width
export const ROW_HEIGHT = num("ROW_HEIGHT", 150);
export const HEADER_HEIGHT = num("HEADER_HEIGHT", 50);

// Options offered by the Status dropdown, in order. Override with a
// comma-separated list to suit how you actually track things.
export const STATUS_OPTIONS = (
  process.env.STATUS_OPTIONS ||
  "Backlog,Playing,Ongoing,Beaten,Platinum,100%,Dropped"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Statuses that mean "done with it" — these sink to the bottom of the play order.
export const DONE_STATUSES = ["Beaten", "Platinum", "100%", "Dropped"];

// Source dropdown. PSN fills in Digital and PS Plus on its own; the rest are
// for the games it has no record of, entered by hand.
export const SOURCE_OPTIONS = (
  process.env.SOURCE_OPTIONS || "Digital,Disc,PS Plus,Gift,Free,Borrowed,Old"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Half steps, so a 3.5 is expressible.
export const RATING_OPTIONS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

// PlayStation names the same game differently depending on which endpoint you
// ask, so a title can arrive twice under two names. This undocumented trophy
// endpoint maps a store title id to its trophy set, giving the two halves a
// shared key. Switch it off with TITLE_BRIDGE_ENABLED=0 if it ever misbehaves —
// the sync then falls back to matching on names alone.
export const TITLE_BRIDGE_ENABLED = process.env.TITLE_BRIDGE_ENABLED !== "0";
export const BRIDGE_BATCH = num("BRIDGE_BATCH", 5);
export const BRIDGE_DELAY_MS = num("BRIDGE_DELAY_MS", 300);
export const TROPHY_API = "https://m.np.playstation.com/api/trophy/v1";

export const BANNER_HEIGHT = num("BANNER_HEIGHT", 28);
// How many cells the timestamp banner spans across the top.
export const BANNER_SPAN = num("BANNER_SPAN", 5);
// When two rows turn out to be the same game, fold the stale one into the live
// one: copy across anything you entered that the live row lacks, then delete
// it. FOLD_STALE=0 switches this off and leaves stale rows for you to handle.
export const FOLD_STALE = process.env.FOLD_STALE !== "0";

// Cover and Game stay on screen while scrolling sideways through the columns.
export const FROZEN_COLUMNS = (() => {
  // Unlike the other sizes, 0 is meaningful here: it turns the freeze off.
  const raw = process.env.FROZEN_COLUMNS;
  const v = Number(raw);
  return raw !== undefined && raw !== "" && Number.isInteger(v) && v >= 0 ? v : 2;
})();

// HowLongToBeat is the slow, flaky step. HLTB_ENABLED=0 skips it entirely.
export const HLTB_ENABLED = process.env.HLTB_ENABLED !== "0";
export const HLTB_DELAY_MS = num("HLTB_DELAY_MS", 400);
// Covers come from PlayStation key art. If none exists, leave the cell blank
// rather than dropping in the square trophy icon.
export const FALLBACK_TO_ICON = false;

export const PRICE_FORMAT = process.env.PRICE_FORMAT || "0.00";

// Renaming a column would otherwise look like "old one missing, add a new one",
// which would strand the data in the old column. Applied to the sheet's header
// before the missing-column check.
export const HEADER_RENAMES = {
  "Progress %": "%",
  "Playtime (hrs)": "Played",
  "Hrs. Played": "Played",
  "Hours to beat": "Est Hrs",
  "Goal/Reminder": "Next Goal",
  Hidden: "Hide",
  Bronze: "B",
  Silver: "S",
  Gold: "G",
  Platinum: "P",
};

export const PROGRESS_H = "%";
export const PLAYTIME_H = "Played";
export const EST_H = "Est Hrs";
export const GOAL_H = "Next Goal";
export const HIDE_H = "Hide";

export const AUTO_HEADERS = [
  "Cover",
  "Game",
  "Platform",
  "Source",
  PROGRESS_H,
  "B",
  "S",
  "G",
  "P",
  "Trophies",
  PLAYTIME_H,
  "Plays",
  EST_H,
  "First played",
  "Last played",
  "PSN ID",
  "Sort order",
];
export const TROPHY_COLUMNS = [
  { header: "B", grade: "bronze", color: [205, 127, 50] },
  { header: "S", grade: "silver", color: [192, 192, 192] },
  { header: "G", grade: "gold", color: [255, 215, 0] },
  // Platinum keeps the light blue PlayStation itself uses for the grade.
  { header: "P", grade: "platinum", color: [173, 216, 230] },
];
export const TROPHY_HEADERS = TROPHY_COLUMNS.map((t) => t.header);
export const PERSONAL_HEADERS = [
  "Status",
  "Priority",
  "Rating",
  "Price paid",
  "Notes",
  GOAL_H,
  HIDE_H,
];
export const ALL_HEADERS = [...AUTO_HEADERS, ...PERSONAL_HEADERS];

export function preflight() {
  const required = ["NPSSO", "SHEET_ID", "GOOGLE_SERVICE_ACCOUNT_KEY"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        `Running locally? Copy .env.example to .env and use ` +
        `\`node --env-file=.env sync.js\`. Running in GitHub Actions? Add them ` +
        `under Settings > Secrets and variables > Actions. See the README.`
    );
  }
}
