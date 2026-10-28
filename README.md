Keeps a Google Sheet synced with your PlayStation library.
Synced elements include: cover art, trophy counts by grade, trophy progress, time played, PSN ID (for version validation), and an estimate of how long each game takes to finish.
Manual elements include: status, rating, notes, goal/reminder, and hidden.

## Columns

[TBD]

## Running through GitHub Actions

1. Create a new Google Sheet. Rename the first tab to "Games".
2. Grab the Sheet's URL ID and save it for later.
```
https://docs.google.com/spreadsheets/d/<THIS_IS_YOUR_SHEET_ID>/edit
```
3. Create a Google service account.
4. Open the [Google Cloud console](https://console.cloud.google.com/). Create a project.
5. Enable Google Sheets API: **APIs & Services > Library > search "Sheets"**.
6. Open the new service account > **Keys > Add key > Create new key > JSON**. Save this file for later.
7. Copy the "client_email" from that file:
```
"something@your-project.iam.gserviceaccount.com"
```
8. In your Sheet, click **Share** and give Editor access to your "client_email" address.
9. Log in at [Playstation](https://www.playstation.com) (either with your main account or, **for better security**, with a secondary/bot PSN account — see the note below).
10. Now that you've logged in, open (https://ca.account.sony.com/api/v1/ssocookie).
11. Copy the 64-character "npsso" value and save it for later. This is your PlayStation session token, and could be used to access the account if leaked. *Keep it private.*
    * **Security tip (Bot Account + `PSN_ONLINE_ID`):** Using a secondary/bot PSN account to generate the `NPSSO` token and setting `PSN_ONLINE_ID` to your main account's Online ID (e.g. `WerneyPark`) protects your main PlayStation account if the `NPSSO` token ever leaks. Make sure your main account's **Trophies** and **Gaming History** privacy settings are visible to *Anyone* (or to *Friends* if the bot account is added as a friend). **Trade-off:** when using a secondary/bot account for `NPSSO`, you gain much greater security for your main account, but you cannot query your private store purchases (`getPurchasedGames`), so unplayed store purchases that have never been launched will not be imported automatically (all played games and trophy titles still sync normally).
12. Note that this value expires every two months or so, so you will need to remember to retrieve a new NPSSO token when this one expires.
13. Fork this repo. You will now add your repository secrets (and optionally `PSN_ONLINE_ID`).
14. In your new repo, go to **Settings > Secrets and variables > Actions**.
15. Enter the secrets below, named exactly as seen:
16. 'NPSSO': the token from step 11.
17. 'SHEET_ID': the URL ID from step 2.
18. 'GOOGLE_SERVICE_ACCOUNT_KEY': the entire contents of the JSON file from step 6.
19. *(Optional / Recommended with bot account)* 'PSN_ONLINE_ID': your target PlayStation Online ID (e.g. `WerneyPark`), added under **Variables** (or **Secrets**). Leave unset or `me` if your `NPSSO` is from your own main account.
20. Run the Workflow once by hand. In your forked repo, **Actions > Sync PSN games > Run workflow**. It may take a few minutes.
21. Now that you've run it once, the Workflow will run once daily at 8:00 UTC. This time is configurable in the "cron" line in [.github/workflows/sync.yml](.github/workflows/sync.yml).

## Running locally

Node 22 or newer is required (googleapis will not run on anything older).

```bash
npm ci # "clean install command" that reads package-lock.json and installs those versions
cp .env.example .env # this makes a file, .env, from the template .env.example. Open .env in a text editor and fill in NPSSO, PSN_ONLINE_ID (optional if using your own account), SHEET_ID, and GOOGLE_SERVICE_ACCOUNT_KEY
node --env-file=.env sync.js # runs the script itself
```
After setup, you can run ```npm run sync:local``` for convenience.

## Configuration

Several variables you may want to adjust.

Variable: "PSN_ONLINE_ID"
Default: "me" (authenticated NPSSO account)
Note: Target PlayStation Online ID (username, e.g. `WerneyPark`) to fetch trophies and played games from. Allows using a secondary/bot account for `NPSSO` for extra security, at the cost of not being able to query unplayed store purchases (`getPurchasedGames`).

Variable: "SHEET_TAB"
Default: "Games"
Note: Determines the tab name in the shared Sheet that the Action's output will write to.

Variable: "COVER_W" / "GAME_W" / "PLATFORM_W"
Default: 150 / 150 / 25
Note: Column widths in pixels.

Variable: "BANNER_SPAN" / "BANNER_HEIGHT"
Default: 5 / 28
Note: How many cells the last-synced banner spans across the top, and how tall that row is.

Variable: "PRICE_FORMAT"
Default: 0.00
Note: Number format for the Price paid column. Change it if you want a currency symbol, e.g. "£"#,##0.00

Variable: "COVER_MODE"
Default: 1
Note: 1 scales cover art to fit the cell without distorting it. 4 forces an exact pixel box and will stretch art to fit that shape.

Variable: "ROW_HEIGHT" / "HEADER_HEIGHT"
Default: 150 / 50
Note: Row heights in pixels.

Variable: "STATUS_OPTIONS"
Default: Backlog,Playing,Beaten,Platinum,Dropped,Ongoing
Note: Comma-separated list of choices in the Status dropdown. Add here if you want more options.

Variable: HLTB_ENABLED
Default: 1
Note: Set to 0 to skip HowLongToBeat lookups

Variable: HLTB_DELAY_MS
Default: 400
Note: Pause between each HLTB lookup. Lowering this value may result in rejected calls to HLTB.

## How it works

On first run, all necessary rows and titles populate the "Game" sheet. Trophy titles, played games, and purchases (when authenticating directly as `me`) import via your PlayStation session token. When `PSN_ONLINE_ID` is set to a target Online ID, the script resolves it to its numeric `accountId` and imports trophy titles and played games using that `accountId` (allowing you to authenticate with a secondary/bot `NPSSO` token for better security, while skipping private store purchase lookups). All entries are merged by normalized titles. On subsequent runs, existing rows are updated in place and rows are only created when new games have been added to your PlayStation library since the last run. HowLongToBeat values are never updated given the slow and unreliable nature of calls to its database.

## Restrictions

Don't edit the sheet while a sync is working. Because the script reads the whole tab and writes it all back, any edits will be overwritten.
HowLongToBeat is not always reliable for the purposes of this project, and access may break in the future.
Deleting a row is not the way to hide a game from your list. Tick the Hidden checkbox instead.

## Built with

[`psn-api`](https://github.com/achievements-app/psn-api) ·
[`howlongtobeat-core`](https://www.npmjs.com/package/howlongtobeat-core) ·
[`googleapis`](https://github.com/googleapis/google-api-nodejs-client)

## License

MIT — see [LICENSE](LICENSE).
