import { HLTB_ENABLED, HLTB_DELAY_MS } from "./config.js";
import { sleep } from "./utils.js";

// Est Hrs from HowLongToBeat (maintained library). Logs how many
// lookups actually succeeded, so a silent breakage is visible in the run log.
export async function enrichHltb(games, knownHours) {
  let attempted = 0;
  let matched = 0;
  if (!HLTB_ENABLED) {
    for (const [key, g] of games) {
      if (knownHours.has(key)) g.hoursToBeat = knownHours.get(key);
    }
    console.log("HLTB: disabled (HLTB_ENABLED=0); reused existing sheet values.");
    return;
  }
  try {
    const mod = await import("howlongtobeat-core");
    const HowLongToBeat =
      mod.HowLongToBeat || (mod.default && mod.default.HowLongToBeat) || mod.default;
    const hltb = new HowLongToBeat();

    for (const [key, g] of games) {
      if (knownHours.has(key)) {
        g.hoursToBeat = knownHours.get(key);
        continue;
      }
      attempted++;
      try {
        const results = await hltb.search(g.name);
        if (results && results.length) {
          results.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
          const best = results[0];
          if ((best.similarity || 0) >= 0.4) {
            const hrs = best.gameplayMain || best.gameplayMainExtra || "";
            if (hrs) {
              g.hoursToBeat = hrs;
              matched++;
            }
          }
        }
      } catch {
        // one bad lookup shouldn't stop the rest
      }
      await sleep(HLTB_DELAY_MS);
    }
  } catch (e) {
    console.warn("HowLongToBeat unavailable:", e.message);
  }
  console.log(`HLTB: filled hours for ${matched} of ${attempted} new lookups.`);
}
