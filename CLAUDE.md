# CLAUDE.md — SJ business apps (GitHub Pages, public repo)

`main` = the live site (https://abbas911-prog.github.io/sj-designs/). Bots (`memo-bot`) push to `main` all the time
(photos, stock, costing) — always `git pull --rebase origin main` before pushing.

## Files that matter
- `factory.html` — **AL MUTAGADED** factory app (Trello ALM board + Slack card chats). One file: CSS, HTML, one big `<script>`.
- `memo.html` — SJ Stock app. **Another chat works on it — don't touch unless Abbas asks.**
- `tools/relay.gs` — Google Apps Script relay shared by **all** apps (memo, factory, timo, bills…).
- `tools/fast-worker.js` — Cloudflare worker "sj-fast" (the fast lane).
- `fac-sw.js` — the factory app's phone helper (service worker, scope = factory.html ONLY): keeps the page on the phone (opens at once /
  offline; `?v=` reloads go network-first so updates still arrive) and shows Web Push notifications. `factory.webmanifest`, `fac-icon-*.png`.
- `tools/test/` — the factory test harness (see rule 5).
- `facthumbs/` — card cover thumbnails, made every 20 min by `.github/workflows/fac-thumbs.yml` (`tools/facthumbs.py`).

## Rules (from Abbas)
1. Push app changes straight to `main` (Pages serves `main`). **Bump `var VER` in factory.html on every change**
   (format `YYYY-MM-DDx`, e.g. `2026-10-20a` → `2026-10-20b`) — phones check it every 5 min (`checkVer`) and reload themselves.
2. relay.gs: always start from the **newest copy in the repo**, never an old one. List every `function` before and after an
   edit and make sure none disappeared (`grep -o "^function [A-Za-z0-9_]*" tools/relay.gs | sort`; 136 on 20 Oct 2026).
   Abbas deploys it himself (Apps Script editor → paste → Save → Deploy → New version) — tell him when a relay deploy is needed.
   **Never ask him to open Script properties**; any new setting is set from inside the app (an op that stores it, like `fastset`).
3. **Never put tokens, passwords, costs or prices in any file** — the repo is public. Secrets live only in Script properties /
   Cloudflare secrets / GitHub secrets. (The Trello app *key* `TKEY` and list/channel ids are public ids, not secrets.)
4. Factory app second language = **Bengali** (every label "English · বাংলা"). **Never compress photos or videos** — originals only.
5. **Test before pushing**: `node tools/test/factory.test.js` (≈3 min, must end "0 failed"). It runs factory.html in Chromium
   (Playwright, pre-installed — never `playwright install`) against the **real relay.gs** (in Node, fake Apps Script services) and the
   **real fast-worker.js**, with fake Trello / Slack / ntfy (`tools/test/fakes.js`). Four rounds: relay only, fast lane, and both again
   with a 2-s relay delay (real Google speed). Add a test for every bug fixed (it must fail on the old code).
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
**Web Push** (no extra app, phone must have the app on its Home Screen): 🔔 → Turn on → `wpkey` / `wpset` → `FWP_<NAME>` (≤4 phones).
`facNotifyScan` sends to both ntfy and Web Push; the relay hands the worker (`op:push`, `op:vapidnew`) the addresses + the VAPID pair
(`FAC_VAPID`, made once by the worker) because Apps Script cannot do the encryption. Phone notifications need the fast lane on.
**Done / Move**: no question; ↩ Undo bar 5 s (`MV`, `mvGo`), sent to Trello after 5 s or when the app goes to the background.

**Returns**: a return IS a card on RETURNS (new via ↩️ sheet = `op:sample` with `kind:'ret'`, chat in #cutting); Done → RETURNS BACK =
pieces came back; there it can be deleted (archived). Older record-style returns (`FRT_<n>`, `retlist/retnew/retset`) still in the relay.

**Samples**: ⭐ New sample = `op:sample` → card on SAMPLES (cover only on Trello) + post with all files in #samples-discuss, which
becomes its chat. **#samplesneed** (SJTC workspace, SJ Memo bot): each new picture post becomes a "SJ-xxxx SAMPLE" card, label SAMPLE,
at the top of RETURNS (`facSampleNeed`, ≤ once a minute, `SNEED_LAST`).

**#laisfactory** (SJTC workspace, private, read/written with `SLACK_BOT_TOKEN`): room chat `lais` + one chat per order post
("Design: SJ-48188 …", id `L<ts>` = its thread). Only Abbas and people whose first name matches a #laisfactory member can see it (`facLaisOk`).

Debug from the Apps Script editor: `facDiag()`, `snDiag()`.

## SJ Stock app (memo.html) — notes from the memo chat
Owner: Abbas (SJ Trading / SJTC, Dubai). Not a programmer: explain in plain words, short, no jargon. Approval mode is auto —
when the right change is clear, do it, test it, commit it and report; ask only when something is genuinely unknown.

- `memo.html` — **SJ Stock app** (the order memo), https://abbas911-prog.github.io/sj-designs/memo.html. **Bump its `var VER`
  on every change** (same `YYYY-MM-DDx` format). `timo.html` — Timo planner (owner phones, opened inside SJ Stock).
- relay jobs used by the apps: live, orders, vault, slackpdf/slackpdf2, dorder, cust, cash, cchat, bills, timo, fac, fastchk.
- `tools/stock.py` (GitHub job memo-stock: Include & share takes pieces off Trello; op `retbill` puts a return bill's pieces back),
  `tools/catalog/*` (catalogue builder), `.github/workflows/*`.
- **Tests** in `tests/` (Playwright + a fake relay; no real Slack/Trello/Google is touched):
  `node tests/t_shell.js` (32), `node tests/t_ord.js` (32), `node tests/t_rn.js` (13), `node tests/t_fix.js` (8), `python3 tests/t_stock.py`.
  Run them before every memo commit (if `require('playwright')` fails: `NODE_PATH=$(npm root -g)`). The test list password
  `test1234` is a fake list made inside the test, not the shop password.
- Relay deploy: Abbas pastes `tools/relay.gs` into the Apps Script editor → Save → Deploy → Manage deployments → ✏️ → New version
  → Deploy (or `clasp push` + `clasp deploy -i <existing deployment id>`). **Keep the same /exec URL — never make a new deployment.**
  After a relay change that uses a new Google service, run `sheetCheck` (or `setupSheets`) once from the editor and press Allow.

Memo rules (his words, short):
- Never handle, type or ask for the shop password, the owner password or any token/key.
- A memo never changes Trello; only Include & share (and a Return bill's Return & share) does.
- Nothing goes to a Slack group unless its button is pressed. #godown gets only the godown part.
- Work in progress must never reset. Costs and 50-50 are never shown to staff.
- Every order has one screen: preview with photos, 4 steps with ticks, Make / Continue bill, and two chats —
  📦 #godown (thread under its pick-list post) and 👤 #customer (thread under its memo post).
- A return line's colour is the card's colour NUMBER (1, 2, 3…), never a name.
- Slack returns emoji as shortcodes (`:bust_in_silhouette:`) — parse both forms.
- Full history: the claude.ai Project "SJTC", docs `SJ STOCK APP (order memo) - START HERE`,
  `SJ STOCK - ORDER SCREEN, CHATS, DRAFTS (20 Oct 2026)`, `SJ STOCK - RETURN BILL (19 Oct 2026)`,
  `RELAY - ONE CODE FOR ALL APPS (read before changing relay.gs)`.

## Change log
- 2026-10-20: CLAUDE.md created (rules + map of the factory app).
- 2026-10-20: memo tests added in `tests/` (t_shell, t_ord, t_rn, t_stock) + SJ Stock notes merged in here.
- 2026-10-20 (VER 2026-10-20b) "make the whole process more smooth": test harness added (tools/test). Fixed: (1) a message written just after
  leaving a chat was marked read (no NEW badge / notification) — the phone now sends "seen" only for lines it showed; (2) long chats showed only
  the last 40 lines after the app was reopened; (3) chat answers dropped when the card list refreshed (extra wait); (4) photo / voice retries
  could post twice; (5) new-message chats now pre-load through the fast lane. No relay deploy needed.
- 2026-10-20: memo 2026-10-20c — bug sweep: Undo→Include gets a new number, stock job result goes to the right invoice, return lines from typed lines keep their number, no double #godown/#customer post, photos cached, staff never see factory password/costs, Small vendors keeps typing, 🔔 screen stays, new design order never makes a 2nd card (+ `tests/t_fix.js`).
- 2026-10-20 (VER 2026-10-20c) "do all" UX, part 1 (phone only): Done / Move = ↩ Undo bar for 5 s instead of the "Move…?" question (Trello is
  told after 5 s, or at once when the app goes to the background); swipe a card row left = Done; voice notes load by themselves into a
  player (photos already did); status line "● Up to date" / "⚠ No internet"; every error message also in Bengali; search by words; ↩ reply
  to a message (Slack quote "> *Name:* text"); Slack's &amp; shown as &.
- 2026-10-20 (VER 2026-10-20d) "do all" UX, part 2: the app opens at once / offline (fac-sw.js, factory.html only); phone notifications without
  ntfy (Web Push via relay + worker; ntfy unchanged); Home Screen icon. NEEDS: relay deploy + fast-worker.js paste in Cloudflare.
- 2026-10-20: memo 2026-10-20d — order screen: customer + photo tile per design at the top, opens at the preview (newest line if unread), steps folded under one tap; old orders find their #godown/#customer posts (`findroot`); customer balances: owe/advance totals, search #50 or words, filter, sort, ＋Receipt/＋Invoice; long return bills print on more pages; same design twice → oldest card keeps the plain number; failed cost sync is sent again. t_ord now 32/32.
