# CLAUDE.md — SJ business apps (GitHub Pages, public repo)

`main` = the live site (https://abbas911-prog.github.io/sj-designs/). Bots (`memo-bot`) push to `main` all the time
(photos, stock, costing) — always `git pull --rebase origin main` before pushing.

## Files that matter
- `factory.html` — **AL MUTAGADED** factory app (Trello ALM board + Slack card chats). One file: CSS, HTML, one big `<script>`.
- `memo.html` — SJ Stock app. **Another chat works on it — don't touch unless Abbas asks.**
- `tools/relay.gs` — Google Apps Script relay shared by **all** apps (memo, factory, timo, bills…).
- `tools/fast-worker.js` — Cloudflare worker "sj-fast" (the fast lane).
- `facthumbs/` — card cover thumbnails, made every 20 min by `.github/workflows/fac-thumbs.yml` (`tools/facthumbs.py`).

## Rules (from Abbas)
1. Push app changes straight to `main` (Pages serves `main`). **Bump `var VER` in factory.html on every change**
   (format `YYYY-MM-DDx`, e.g. `2026-10-20a` → `2026-10-20b`) — phones check it every 5 min (`checkVer`) and reload themselves.
2. relay.gs: always start from the **newest copy in the repo**, never an old one. List every `function` before and after an
   edit and make sure none disappeared (`grep -o "^function [A-Za-z0-9_]*" tools/relay.gs | sort`; 131 on 20 Oct 2026).
   Abbas deploys it himself (Apps Script editor → paste → Save → Deploy → New version) — tell him when a relay deploy is needed.
   **Never ask him to open Script properties**; any new setting is set from inside the app (an op that stores it, like `fastset`).
3. **Never put tokens, passwords, costs or prices in any file** — the repo is public. Secrets live only in Script properties /
   Cloudflare secrets / GitHub secrets. (The Trello app *key* `TKEY` and list/channel ids are public ids, not secrets.)
4. Factory app second language = **Bengali** (every label "English · বাংলা"). **Never compress photos or videos** — originals only.
5. **Test before pushing**: Playwright (Chromium is pre-installed, don't `playwright install`) driving factory.html against the
   **real relay.gs code** run in Node with fake Apps Script services (PropertiesService, CacheService, UrlFetchApp, LockService…)
   and fake Trello / Slack / ntfy answers. Also load fast-worker.js with fake `fetch` when it changes.
6. Every change Abbas asks for gets a short line in this file under **Change log**.

## How the factory app works (map)
**Sign in**: name + factory password (stored on the phone). Every relay request = `{job:'fac', req, sig}` where `sig` = HMAC-SHA256
of `req` with the password; relay checks it against `FACTORY_PASSWORD` (or the shop password). Requests older than 10 min are refused.
Actions carry a once-only `rid` (`FAC_ONCE`) so a retry never posts twice. Relay entry: `doPost` → `fac` → `fac0` (switch on `req.op`).

**Lists** (`FAC.LISTS` in relay, `CHIPS`/`NEXT`/`UR` in factory.html): SAMPLES, SAMPLE DONE, START, CUTTING, IN LINE, READY FOR HAND WORK,
IN HAND WORK, CAME FROM HAND WORK, IN LINE (2), IRON/CHECKING, READY, READY 2, FINISH, FINISH SAMPLES, + RETURNS / RETURNS BACK
(made by the relay, ids in `FRET_LISTS`). Long done-lists send only their newest 60 (`FAC.LIMIT`). `op:list` = one Trello call for the
board, cached (`bigPut` in 90 KB pieces); `op:ping` every 4 s = cheap "anything new?" (unread counts, Later, rooms, returns, refs) — it
also runs `facTrelloMoves` (moves made in Trello → line in the chat) and `facSampleNeed`. "Done → next" = `op:move`
(card to top of next list + Trello comment + "→ *LIST* · who" line in its chat). Also: edit, copy, add, attach (photos onto Trello),
archive (only RETURNS BACK cards). Day-count badge comes from the card id timestamp.

**Chats**: a card's chat = the replies of its Slack thread. Where it lives (`facThread`, remembered in `FTH_<cardId>`):
production cards → **#cutting**; sample cards (SAMPLES / SAMPLE DONE / FINISH SAMPLES) → **#samples-discuss**; Usman hand-work cards →
**#usmancutting** (`facUsmanOf`); new sample with USMAN tick → the #usman sample channel (`FAC_USMP`). App lines are posted as
`*Name:* text`; system lines start with `→ *` (moves, edits, photos). **Direct chat** (`dm`, `FAC_DM`) = one chosen/created channel.
Unread / Catch up = `facUnread` vs per-person `FSEEN_<NAME>`; 📌 Later = `FLATER_<NAME>`. Files go to Slack in original quality
straight from the phone (`upurl` → upload → `up`). Outbox on the phone (IndexedDB) keeps sending until Slack has it.

**Fast lane** (`fast-worker.js`): phone → Cloudflare → Slack/Trello in ~0.2 s for reading chats (`thread`, `dm`), text `post`, files
(`/f`, streamed originals), and Trello `tlist`/`tatts`/`timg`/`tmove`. Phone key = sha256("sjfast|"+password), checked once with the relay
(`job:'fastchk'`). Worker link set in the app (status line → Fast lane → `op:fastset`, stored `FAC_FAST`). Worker secrets:
`SLACK_TOKEN`, `TRELLO_TOKEN`. If the worker fails the app silently falls back to the relay. The worker does NOT read the long done-lists.

**Doorbell** (live): private ntfy.sh topic (`facLive` → `FAC_LIVE`); the app listens via EventSource. Rings: `c=<cardId>` (chat changed),
`c=list:<id>` (list changed → reload), `c=ret:<n>`, `s:<channel>:<thread>` (from Slack Event Subscriptions → worker `/slack`; app maps it
to the card with `refs`). No message text ever goes on the doorbell. Polling stays as the safety net. Phone notifications: 🔔 → ntfy app,
per-person topic `FNTFY`, sent by `facNotifyScan` (on Slack events + 1-min timer `facNotifyTick`). Old Telegram buzz (`facWatch`) still exists.

**Returns**: a return IS a card on RETURNS (new via ↩️ sheet = `op:sample` with `kind:'ret'`, chat in #cutting); Done → RETURNS BACK =
pieces came back; there it can be deleted (archived). Older record-style returns (`FRT_<n>`, `retlist/retnew/retset`) still in the relay.

**Samples**: ⭐ New sample = `op:sample` → card on SAMPLES (cover only on Trello) + post with all files in #samples-discuss, which
becomes its chat. **#samplesneed** (SJTC workspace, SJ Memo bot): each new picture post becomes a "SJ-xxxx SAMPLE" card, label SAMPLE,
at the top of RETURNS (`facSampleNeed`, ≤ once a minute, `SNEED_LAST`).

**#laisfactory** (SJTC workspace, private, read/written with `SLACK_BOT_TOKEN`): room chat `lais` + one chat per order post
("Design: SJ-48188 …", id `L<ts>` = its thread). Only Abbas and people whose first name matches a #laisfactory member can see it (`facLaisOk`).

Debug from the Apps Script editor: `facDiag()`, `snDiag()`.

## Change log
- 2026-10-20: CLAUDE.md created (rules + map of the factory app).
