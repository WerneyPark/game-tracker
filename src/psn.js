import {
  call,
  exchangeNpssoForAccessCode,
  exchangeAccessCodeForAuthTokens,
  getUserTitles,
  getUserPlayedGames,
  getPurchasedGames,
  makeUniversalSearch,
  getProfileFromUserName,
} from "psn-api";
import {
  TITLE_BRIDGE_ENABLED,
  BRIDGE_BATCH,
  BRIDGE_DELAY_MS,
  TROPHY_API,
} from "./config.js";
import {
  norm,
  sameSeriesEntry,
  sleep,
  durationToHours,
  dateOnly,
  platformFromCategory,
  pickCover,
} from "./utils.js";

// ---- PSN pulls --------------------------------------------------------------
export async function getAuth() {
  const npsso = process.env.NPSSO;
  try {
    const accessCode = await exchangeNpssoForAccessCode(npsso);
    return await exchangeAccessCodeForAuthTokens(accessCode);
  } catch {
    // Overwhelmingly the cause: NPSSO tokens expire roughly every two months.
    throw new Error(
      "PSN sign-in failed — your NPSSO token has expired or is invalid. Log in " +
        "at playstation.com, open https://ca.account.sony.com/api/v1/ssocookie, " +
        "and update the NPSSO secret with the fresh value."
    );
  }
}

// Resolve a PSN Online ID (username, e.g. "WerneyPark") to its numeric
// accountId so a secondary/bot NPSSO token can query a target account instead
// of "me". Returns "me" when onlineId is omitted or explicitly set to "me".
export async function resolveAccountId(auth, onlineId) {
  const target = (onlineId || "").trim();
  if (!target || target.toLowerCase() === "me") {
    console.log('PSN target: using authenticated account ("me").');
    return "me";
  }
  if (/^\d+$/.test(target)) {
    console.log(`PSN target: using numeric accountId ${target}.`);
    return target;
  }

  try {
    const searchRes = await makeUniversalSearch(
      { accessToken: auth.accessToken },
      target,
      "SocialAllAccounts"
    );
    const results = searchRes?.domainResponses?.[0]?.results || [];
    const exact = results.find(
      (r) =>
        r?.socialMetadata?.onlineId &&
        r.socialMetadata.onlineId.toLowerCase() === target.toLowerCase()
    );
    const picked = exact?.socialMetadata || results[0]?.socialMetadata;
    if (picked?.accountId) {
      console.log(
        `PSN target: resolved Online ID "${picked.onlineId || target}" -> accountId ${picked.accountId}.`
      );
      return String(picked.accountId);
    }
  } catch (e) {
    console.warn(
      `Universal search failed for "${target}", trying profile lookup:`,
      e.message
    );
  }

  try {
    const profileRes = await getProfileFromUserName(
      { accessToken: auth.accessToken },
      target
    );
    const accountId = profileRes?.profile?.accountId;
    if (accountId) {
      console.log(
        `PSN target: resolved Online ID "${profileRes.profile.onlineId || target}" -> accountId ${accountId}.`
      );
      return String(accountId);
    }
  } catch {
    // Handled by the error thrown below.
  }

  throw new Error(
    `Could not find PSN accountId for Online ID "${target}". ` +
      `Check the PSN_ONLINE_ID spelling and ensure the account is searchable.`
  );
}

export async function pullTrophyTitles(auth, accountId = "me") {
  const games = new Map();
  const limit = 100;
  let offset = 0;
  for (let page = 0; page < 50; page++) {
    const res = await getUserTitles(
      { accessToken: auth.accessToken },
      accountId,
      { limit, offset }
    );
    const titles = res.trophyTitles || [];
    for (const t of titles) {
      const key = norm(t.trophyTitleName);
      if (!key) continue;
      games.set(key, {
        name: t.trophyTitleName,
        trophyName: t.trophyTitleName,
        platform: t.trophyTitlePlatform || "",
        progress: typeof t.progress === "number" ? t.progress : "",
        playtime: "",
        lastPlayed: "",
        iconUrl: t.trophyTitleIconUrl || "",
        coverUrl: "",
        // PSN reports platinum as 0 or 1 — a title has at most one.
        trophies: t.earnedTrophies || null,
        definedTrophies: t.definedTrophies || null,
        npComm: t.npCommunicationId || "",
        // Games hidden on the PSN profile itself.
        hidden: t.hiddenFlag === true,
      });
    }
    if (titles.length < limit) break;
    offset += limit;
  }
  return games;
}

// Ask the trophy service which trophy set each store title belongs to.
// Returns a Map of npTitleId -> npCommunicationId. Any failure returns what it
// has so far: a missing bridge just means falling back to name matching.
export async function bridgeTitleIds(auth, titleIds, accountId = "me") {
  const found = new Map();
  if (!TITLE_BRIDGE_ENABLED || titleIds.length === 0) return found;

  let shapeLogged = false;
  for (let i = 0; i < titleIds.length; i += BRIDGE_BATCH) {
    const slice = titleIds.slice(i, i + BRIDGE_BATCH);
    try {
      const res = await call(
        {
          url: `${TROPHY_API}/users/${accountId}/titles/trophyTitles?npTitleIds=${slice.join(",")}`,
        },
        { accessToken: auth.accessToken }
      );

      // Undocumented endpoint: accept either shape it might return, and print
      // the raw keys once so an unexpected response is diagnosable from the log
      // rather than silently yielding nothing.
      const rows = res.titles || res.trophyTitles || [];
      if (!shapeLogged) {
        shapeLogged = true;
        if (!Array.isArray(rows) || rows.length === 0) {
          console.warn(
            "Title bridge: unrecognised response shape, keys =",
            Object.keys(res || {}).join(",") || "(none)"
          );
        }
      }

      for (const row of rows) {
        const npTitleId = row.npTitleId || row.npTitleIds;
        const sets = row.trophyTitles || (row.npCommunicationId ? [row] : []);
        // A store title can map to several trophy sets. Keep them all so the
        // merge step can reject one and try the next.
        const ids = sets.map((s) => s && s.npCommunicationId).filter(Boolean);
        if (npTitleId && ids.length) found.set(npTitleId, ids);
      }
    } catch (e) {
      console.warn(`Title bridge stopped after ${found.size} matches:`, e.message);
      return found;
    }
    await sleep(BRIDGE_DELAY_MS);
  }
  return found;
}

export async function enrichPlayed(auth, games, accountId = "me") {
  let played = [];
  try {
    const limit = 100;
    let offset = 0;
    for (let page = 0; page < 50; page++) {
      const res = await getUserPlayedGames(
        { accessToken: auth.accessToken },
        accountId,
        { limit, offset }
      );
      const titles = res.titles || [];
      played.push(...titles);
      if (titles.length < limit) break;
      offset += limit;
    }
  } catch (e) {
    console.warn("Playtime pull skipped:", e.message);
    return;
  }

  // Where the name already matches a trophy title there's nothing to resolve,
  // so only the leftovers go through the bridge. That's usually a small
  // fraction of the library and keeps the extra calls down.
  const byNpComm = new Map();
  for (const [key, g] of games) {
    if (g.npComm) byNpComm.set(g.npComm, key);
  }
  const unmatched = played.filter(
    (t) => t.name && !games.has(norm(t.name)) && t.titleId
  );
  const bridged = await bridgeTitleIds(
    auth,
    unmatched.map((t) => t.titleId),
    accountId
  );
  const merges = [];
  const rejected = [];
  // How many PlayStation entries fed each game, so a row built from more than
  // one is visible rather than having to be inferred.
  const contributions = new Map();

  for (const t of played) {
    let key = norm(t.name);
    if (!key) continue;
    if (!games.has(key)) {
      // The same game under the store's name rather than the trophy set's.
      for (const npComm of bridged.get(t.titleId) || []) {
        const existingKey = byNpComm.get(npComm);
        if (!existingKey) continue;
        const target = games.get(existingKey);
        const targetName = (target && target.name) || existingKey;
        if (!sameSeriesEntry(norm(t.name), norm(targetName))) {
          rejected.push([t.name, targetName]);
          continue;
        }
        merges.push([t.name, targetName]);
        // Kept so a stale row filed under this name can later be traced back
        // to the game it now belongs to.
        if (target) (target.aliases ||= []).push(t.name);
        key = existingKey;
        break;
      }
    }
    const entry = games.get(key) || {
      name: t.name,
      platform: platformFromCategory(t.category),
      progress: "",
      iconUrl: "",
      coverUrl: "",
      trophies: null,
    };
    // When one game arrives under two names, show the plainer one. The trophy
    // set is often named for a mode or an edition ("Fortnite: Save the World",
    // "Control Ultimate Edition") where the store simply calls it "Fortnite".
    if (t.name && entry.name && t.name.length < entry.name.length) {
      entry.name = t.name;
    }
    // A game can arrive as several PSN entries — a PS4 and a PS5 edition, say —
    // that all land on one row. Overwriting meant the last one seen won, so a
    // brief PS5 launch could bury a hundred hours logged on PS4. Accumulate
    // instead: hours and launches add up, first played is the earliest seen and
    // last played the most recent.
    const hrs = durationToHours(t.playDuration);
    if (hrs !== "") {
      const running = typeof entry.playtime === "number" ? entry.playtime : 0;
      entry.playtime = Math.round((running + hrs) * 10) / 10;
    }
    const lastSeen = dateOnly(t.lastPlayedDateTime);
    if (lastSeen && (!entry.lastPlayed || lastSeen > entry.lastPlayed)) {
      entry.lastPlayed = lastSeen;
    }
    const firstSeen = dateOnly(t.firstPlayedDateTime);
    if (firstSeen && (!entry.firstPlayed || firstSeen < entry.firstPlayed)) {
      entry.firstPlayed = firstSeen;
    }
    // Owning a game outright beats having it through the subscription.
    if (t.service && entry.service !== "none_purchased") entry.service = t.service;
    if (typeof t.playCount === "number") {
      entry.playCount = (entry.playCount || 0) + t.playCount;
    }
    if (t.concept && t.concept.id) entry.conceptId = t.concept.id;
    if (!entry.platform) entry.platform = platformFromCategory(t.category);
    const cov = pickCover(t);
    if (cov) entry.coverUrl = cov; // high-res PSN key art
    games.set(key, entry);
    contributions.set(key, (contributions.get(key) || 0) + 1);
  }

  if (TITLE_BRIDGE_ENABLED) {
    console.log(
      `Title bridge: resolved ${bridged.size} of ${unmatched.length} unmatched ` +
        `titles, merging ${merges.length} into an existing trophy set.`
    );
    for (const [from, to] of merges) {
      console.log(`  merged "${from}"  ->  "${to}"`);
    }
    for (const [from, to] of rejected) {
      console.log(`  refused "${from}"  ->  "${to}" (different entry in the series)`);
    }
  }

  const combined = [...contributions].filter(([, n]) => n > 1);
  if (combined.length) {
    console.log(`${combined.length} game(s) built from several PlayStation entries:`);
    for (const [key, n] of combined) {
      const g = games.get(key);
      console.log(
        `  ${g.name}: ${n} entries -> ${g.playtime}h, ${g.playCount ?? 0} plays, ` +
          `first ${g.firstPlayed || "?"}, last ${g.lastPlayed || "?"}`
      );
    }
  }
}

// Preferring the plainer name can hand two different games the same one: the
// PS4 and PS5 trophy lists for Minecraft both became "Minecraft". Where that
// happens, each goes back to its own trophy-list name, which tells them apart.
export function resolveNameClashes(games) {
  const byName = new Map();
  for (const g of games.values()) {
    const k = norm(g.name);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(g);
  }
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    for (const g of group) if (g.trophyName) g.name = g.trophyName;
  }
}

export async function enrichPurchased(auth, games, accountId = "me") {
  // Sony's purchasedTitlesRetrieve endpoint only returns store purchases for
  // the token owner ("me") and does not accept an accountId. Skip when querying
  // another account via a bot NPSSO so the bot's library is never mixed in.
  if (accountId !== "me") {
    console.log(
      "Purchased-games pull skipped: only available when querying own account (\"me\")."
    );
    return;
  }

  try {
    const limit = 100;
    let offset = 0;
    for (let page = 0; page < 50; page++) {
      const res = await getPurchasedGames(
        { accessToken: auth.accessToken },
        { limit, offset }
      );
      const titles = res.titles || [];
      for (const t of titles) {
        const key = norm(t.name);
        if (!key) continue;
        const existing = games.get(key);
        if (existing) {
          if (t.membership === "PS_PLUS") existing.plusClaim = true;
          else existing.owned = true;
          if (!existing.conceptId && t.concept && t.concept.id) {
            existing.conceptId = t.concept.id;
          }
          if (!existing.coverUrl) {
            const c = pickCover(t);
            if (c) existing.coverUrl = c;
          }
          continue;
        }
        games.set(key, {
          name: t.name,
          platform: platformFromCategory(t.category),
          progress: "",
          playtime: "",
          lastPlayed: "",
          iconUrl: "",
          coverUrl: pickCover(t),
          trophies: null,
          owned: t.membership !== "PS_PLUS",
          plusClaim: t.membership === "PS_PLUS",
          conceptId: t.concept && t.concept.id ? t.concept.id : null,
        });
      }
      if (titles.length < limit) break;
      offset += limit;
    }
  } catch (e) {
    console.warn("Purchased-games pull skipped:", e.message);
  }
}
