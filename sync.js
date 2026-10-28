import { PSN_ONLINE_ID, preflight } from "./src/config.js";
import {
  getAuth,
  resolveAccountId,
  pullTrophyTitles,
  enrichPlayed,
  enrichPurchased,
  resolveNameClashes,
} from "./src/psn.js";
import { enrichHltb } from "./src/hltb.js";
import {
  parseSpreadsheetId,
  getSheetsClient,
  getSheetId,
  readSheet,
  existingHoursMap,
  writeSheet,
} from "./src/sheets.js";
import { applyFormatting } from "./src/formatting.js";

// ---- Run --------------------------------------------------------------------
async function main() {
  preflight();
  const auth = await getAuth();
  const accountId = await resolveAccountId(auth, PSN_ONLINE_ID);
  const sheets = getSheetsClient();
  const spreadsheetId = parseSpreadsheetId();

  const sheetId = await getSheetId(sheets, spreadsheetId);
  const { header, body, headerRow } = await readSheet(sheets, spreadsheetId);
  const knownHours = existingHoursMap(header, body);

  const games = await pullTrophyTitles(auth, accountId);
  await enrichPlayed(auth, games, accountId);
  await enrichPurchased(auth, games, accountId);
  resolveNameClashes(games);
  await enrichHltb(games, knownHours);

  const dataRowCount = await writeSheet(
    sheets, spreadsheetId, sheetId, headerRow, header, body, games
  );
  await applyFormatting(sheets, spreadsheetId, sheetId, header, dataRowCount);
}

main().catch((e) => {
  console.error(`\nSync failed: ${e.message}\n`);
  if (process.env.DEBUG) console.error(e);
  process.exit(1);
});
