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
- `memo-sw.js` — SJ Stock's phone helper (service worker, scope = memo.html ONLY): keeps the app page on the phone (opens at once / offline;
  ETag check in the background; `?v=` reloads go network-first). `memo.webmanifest`, `memo-icon-180/512.png` (Home Screen icon).
- `.nojekyll` — tells GitHub Pages to publish the files as they are (no Jekyll pass over 400 MB of photos/videos): publishes in ~1 min
  instead of 3-10, so fewer builds get cancelled by the next commit. Never delete it.
- `facthumbs/` — card cover thumbnails, made every 20 min by `.github/workflows/fac-thumbs.yml` (`tools/facthumbs.py`).

## Rules (from Abbas)
1. Push app changes straight to `main` (Pages serves `main`). **Bump `var VER` in factory.html on every change**
   (format `YYYY-MM-DDx`, e.g. `2026-10-20a` → `2026-10-20b`) — phones check it every 5 min (`checkVer`) and reload themselves.
2. relay.gs: always start from the **newest copy in the repo**, never an old one. List every `function` before and after an
   edit and make sure none disappeared (`grep -o "^function [A-Za-z0-9_]*" tools/relay.gs | sort`; 186 on 23 Oct 2026).
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
**Work per worker** (21 Oct 2026): the machine workers = the "W - Name" people of the AL MUTAGADED GARMENTS Google Sheet (NOT the Trello
worker fields `DOX.TEN` — those are Usman hand-work's people). Kept on the relay as `FAC_WORKERS` (`facWorkers`; default list in
`FAC_WORKERS_DEFAULT`), changed from the app: More → Workers → ✏️ Edit the list (`op:workers`).
Pieces per day = per WORK day (`facWorkMs`: Dubai time, Sat–Thu 08:00–22:00 minus the breaks 09:00–09:20, 13:00–14:00, 19:00–19:20
= 12 h 20 min = 1 day (`WORK_BREAKS`, `WORK_DAY_MS`), Friday 08:00–12:00; nights and breaks count 0). Clock hours (`facAttHours` → `facNetMs`) also skip the breaks.
Card screen "👷 WORK": one row per worker, pieces box + ▶ Give / ✓ Done. `op:workset` writes a Trello comment ("👷 IN · NAME · 20 pcs · who
(factory app)" / "👷 OUT · … · 1 d 2 h · …"), a chat line "→ *WORK* · who · NAME ← 20 pcs given", and the worker's Trello field ("18 ✓").
No script properties: `op:work` reads the batches back from the card's comments (`facActs` → `facWkParse`); `op:workrep` sums the board's
comments per worker over 7/30/90 days (More → Workers). **Production report** (`facReport`): time per list from Trello's move history
(`facStages`, up to the last arrival in READY / READY 2, else FINISH) + the workers; posted ONCE per card (chat line + Trello comment
"#report") when a card reaches FINISH / FINISH SAMPLES — by `op:move`, by the app after a fast-lane move (`op:reportauto`), or by
`facTrelloMoves` for moves made in Trello; `op:report` = by hand from the card's ⋯ menu / WORK box (also "so far").
**#cash / #expenses** (21 Oct 2026): two more channel chats (`FAC_XROOMS`, keys `cash` / `exp`) of the factory (ChatGPT) workspace, found by
name among the bot's channels (`facXRoom`, joined if public, kept in `FAC_ROOM_<k>`). Only Abbas (`facOwner`: sign-in name Abbas…) gets them
(`facXRoomsFor` → `D.rooms`); every room op refuses other names (`noaccess`). In the app they behave like the Direct chat (`xrooms()`).
**Done / Move**: no question; ↩ Undo bar 5 s (`MV`, `mvGo`), sent to Trello after 5 s or when the app goes to the background.
**Factory extras (22 Oct 2026, all optional — nothing changes if nobody uses them)**: the card **📋 SHEET** (`sheetDraw`, op `sheetset`) = cut /
rejected / packed / to-from hand work / first piece approved (Trello comments `📋 CUT · 196 pcs · who (factory app)`, parsed by `SH_RE` →
`facSheetParse`, returned by op `work` as `sheet`) + the **due date** (Trello's own `due`, in the list as `due`; badge `dueHtml` only when set:
red late / amber ≤ 2 d). WORK box shows a progress bar (card pcs · done · in hand · left · rejected). **Workers dashboard** (`wksDraw`): tiles
filter (tap), status chips (Working / ⚠ Long / Free / Idle 2+ d), sort (`WKS`), By design = progress bars + chips, Week = pieces per day table
(`byDay` from `facWorkRep`) with ✗ absent, share. **More → 🏭 Factory** (`#fac`, `facDraw`): attendance per day (`FAC_ATT_<date>`, ops `att`/`attset`,
anyone), late / due soon (`facLate`), materials (`FAC_MAT`, ops `mat`/`matset`, low alert), salaries (**Abbas only**, monthly, `FAC_SAL`,
ops `sal`/`salset`, never in the repo — the workers are NOT on piece rates; the Month screen shows the pay estimate), daily closing (`facDailyText`/`facDaily`: pieces per worker, in hand, attendance, moves, late, low
stock → posted into the Direct chat at 22:00 Dubai / Friday 12:00 by `facDailyTick` from the 1-min timer, once a day `FAC_DAILY_LAST`; off =
`FAC_DAILY_OFF`; op `daily` get / set / preview / now).

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
  **Today tab** (owner phones, `isBoss`): `tdDraw` in memo.html reads Timo's day from `localStorage['timo-state']` (same origin) and sends every
  change (`tdSend` → postMessage `{timo:'op', op:step|done|open|focus|new|wa}`) to the hidden Timo iframe (`tdEnsure`, one frame shared with
  More → Timo), which owns the data and syncs it (relay job `timo`); Timo posts `{timo:'state'}` after every save → redraw. WhatsApp
  follow-ups = `S.wa` typed by hand (no API for a normal number). A repeating block can have its own steps on one day: `S.over['id@day'] = {items}`
  (Timo `itemsOn/actOn/editItems`, asks "Only this day / Every day"); a quick task line ("Call Usman #T1 tomorrow 20 min", `parseQuick/quickTask`)
  becomes a step of that block on that day only. Test: `node tests/t_today.js` (30).
- relay jobs used by the apps: live, orders, vault, slackpdf/slackpdf2, dorder, cust, cash, cchat, bills, timo, fac, fastchk.
- **Direct chats** (22 Oct 2026): Abbas ↔ one person each, in SJ Stock's Chats tab ("Direct · مباشر"). Relay `cchat`: private Slack channel
  `#sj-direct` (found by name or made by the relay, id in `CC_DM_CH`), one thread root per person (`CC_DM_ROOT_<NAME>`), the chat = its replies;
  people = `CC_DM_PEOPLE` (default Muhammad, Imran; op `dmpeople`, owner `chk`). `list/ping` answer carries `dms` (only the chats this `who`
  may see: Abbas = all, a person = his own by first name); `thread/seen/post/up` with `ch:'direct'` share the #godown branch (`XCH/XP`);
  unread keys `D<root>`; ntfy notification + deep link `memo.html#dm=NAME`. Tests: `node tests/t_dm.js` (11, real relay.gs + fake Slack),
  `node tests/t_dmapp.js` (8, the app).
- `tools/stock.py` (GitHub job memo-stock: Include & share takes pieces off Trello; op `retbill` puts a return bill's pieces back),
  `tools/catalog/*` (catalogue builder), `.github/workflows/*`.
- **Tests** in `tests/` (Playwright + a fake relay; no real Slack/Trello/Google is touched):
  `node tests/t_shell.js` (32), `node tests/t_ord.js` (32), `node tests/t_rn.js` (13), `node tests/t_fix.js` (24), `node tests/t_ntfy.js` (3, real relay.gs), `node tests/t_bills.js` (6, real relay.gs + fake Sheet: one number series),
  `node tests/t_sw.js` (5, Home Screen helper), `node tests/t_cat.js` (13, catalogue builder in CAT_LOCAL mode: sold-out dresses cut at the real edges, rest joined, card numbers; `tests/fixtures/lineup-57026.jpg` = a real studio photo guarding the cutter), `python3 tests/t_stock.py`.
  Looks: `node tests/shots.js <dir>` screenshots 24 screens (frozen clock, fixed data); `python3 tests/shotdiff.py before after` compares pixel by pixel
  (the bottom-bar badges differ run to run — timing; anything else must be 0). Take a `before` set before any CSS/markup tidy-up.
  Speed: `node tests/perf.js` (350 fake designs at phone CPU speed; prints freeze ms per action), `node tests/walk.js` (walks every screen with
  Google answering after 2 s = real relay speed; prints ms until each screen is usable, and KB downloaded when the app comes to the front).
  Run them before every memo commit (if `require('playwright')` fails: `NODE_PATH=$(npm root -g)`). The test list password
  `test1234` is a fake list made inside the test, not the shop password.
- Relay deploy: Abbas pastes `tools/relay.gs` into the Apps Script editor → Save → Deploy → Manage deployments → ✏️ → New version
  → Deploy (or `clasp push` + `clasp deploy -i <existing deployment id>`). **Keep the same /exec URL — never make a new deployment.**
  After a relay change that uses a new Google service, run `sheetCheck` (or `setupSheets`) once from the editor and press Allow.

Memo rules (his words, short):
- Never handle, type or ask for the shop password, the owner password or any token/key.
- A memo never changes Trello; only Include & share (and a Return bill's Return & share) does. The green button works ONCE per bill,
  on any device: a bill with status `included` refuses it everywhere (21 Oct 2026); to send it again use Share PDF.
  A sold bill keeps what it sold in itself (`d.sold`: design, colour, pcs, rate) and always shows exactly that, on any device.
- Bill numbers are ONE series for the whole shop: at the green button / Send the relay confirms the number (`bills` op `next`, under a lock);
  a number another phone used or reserved is never given twice; a draft behind the shop's last number moves to the next free one.
- Nothing goes to a Slack group unless its button is pressed. #godown gets only the godown part.
- Work in progress must never reset. Costs and 50-50 are never shown to staff. Customer balances: staff may look and copy
  statements (20 Oct 2026); only the owner phone deletes lines/customers or changes an opening balance.
- Every order has one screen: preview with photos, 4 steps with ticks, Make / Continue bill, and two chats —
  📦 #godown (thread under its pick-list post) and 👤 #customer (thread under its memo post).
- A return line's colour is the card's colour NUMBER (1, 2, 3…), never a name.
- Two READY cards with one design number: the NEWEST keeps the plain number (same as the catalogue builder / stock job). Every saved key
  (memo marks, drafts, orders, bills, `d.sold`) carries its Trello card id and follows that CARD (`cardsOf` / `keyRemap`), never the number.
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
- 2026-10-20: memo 2026-10-20e — employees can open Customer balances (look + copy statement, ＋Receipt/＋Invoice); delete / change opening stay owner-only.
- 2026-10-20: relaycode.html — phone page to copy the newest relay code (loads tools/relay.gs fresh; like fastcode.html for the worker).
- 2026-10-20: SJ Stock 🔔 "Send a test" (relay `cchat` `ntfytest`) now shows ntfy's real reason when it refuses (was "ntfy did not answer"). NEEDS relay deploy.
- 2026-10-20: memo 2026-10-20f — "very laggy": off-screen designs not drawn (`content-visibility`), live update re-uses unchanged designs, design lookup indexed (`byNo`), tap only touches changed price boxes, memo/bill PDF + preview encoded in the background (`toBlob`), memo/bill/order photos load first, chat list / last chats / orders kept on the phone (`sj_c_list`, `sj_c_mc`, `sj_c_ord`) so they show at once. Phone-speed freeze: tap 0.4 s → 0.06 s, live update 1.8 s → 0.2 s, scroll 1.4 s → 0, first screen 3.8 s → 0.8 s.
- 2026-10-20: memo 2026-10-20g — chats: each person has their own colour (me = orange, right side; others get the most different colour on that phone, kept in `sj_cc_cols`) with an initial circle; a redraw keeps unchanged bubbles (no flicker, photos/players stay) and the order panel; reading one chat never waits for another chat's read (`CC.busyK`); a tick shows at once (open order re-pointed after every list answer); saved bills list kept on the phone (`sj_c_bills`); chats with news pre-read in the background (`ccPrefetch`, 3 per poll, never marks seen); coming back to the app asks the site with ETag instead of re-downloading 430 KB. walk.js: tick 2.2 s → 0.17 s, 2nd order tab 4.3 s → 2.2 s (one round trip), front-again download 432 KB → 0.
- 2026-10-21: memo 2026-10-20h — INV-0021 / SJ-85974 showed 4 pcs instead of 12 when opened again: a saved bill was re-checked against today's READY, and the two colours the sale itself had emptied were silently dropped (then auto-saved). Now a bill that took its pieces (`status included` or its stock job ok) is never cut down (`billLocked` in `reapply`); at Include, "All" marks become exact pcs; the phone that sold repairs a bill whose saved copy lost lines from `STK[].lines`; a draft that really lost stock gets a per-colour alert instead of a silent cut.
- 2026-10-21: memo 2026-10-20i — the green button is refused on ANY device for a bill already included (was only remembered on the phone that pressed it; another phone/laptop opening the saved bill — e.g. INV-0018 from "Continue bill" — could take its pieces off Trello a second time).
- 2026-10-21: memo 2026-10-20j — (order showed "Continue bill INV-0018" with 4 pcs while INV-0021 was the real 12-pc sale) the green button now stores what the bill sold inside the bill (`d.sold`, saved to BILLS) and every device opening it shows exactly that (sold-out designs become typed lines with the sold pcs/price); the bill is linked to its own order at the green button (`d.oid` / `sj_oid` → `link`) and "Bill made" is ticked on that order, not on whatever order the phone opened last (`ordBillMade(ref, oid)`).
- 2026-10-21: memo 2026-10-21a — (a) ONE bill-number series for the whole shop: `bsNext` at the green button / Send asks relay `bills` op `next` (lock; reserves the number; the phone's old draft row is cleared) — INV-0018/0021 could never happen again; the phone's counter also jumps past every number in the saved-bills list. NEEDS relay deploy (136 functions, unchanged). (b) Home Screen app: `memo-sw.js` + `memo.webmanifest` + icons — opens at once / offline, ETag background refresh, `checkVer` also 4 s after boot. Tests: t_bills (6), t_sw (5).
- 2026-10-21: memo 2026-10-21b — tidy-up ("less code, less bugs"): old Trello-direct photo code removed (`auth`, `authHeader`, `apiUrl`, `imgSrcs`, `srcs`, `API`, one-entry retry loop), 7 dead style rules (.gdsh/.gdt), 164 style declarations that could never win (earlier copies of the same selector, 66 rules) — cascade-safe, proven by the screenshot diff (24 screens identical) + every test. Only 2 functions were dead: the code is almost all live.
- 2026-10-21 (VER 2026-10-21a) Abbas: (1) work per worker on every card — the 10 workers listed with a pieces box, ▶ Give starts the timer,
  ✓ Done stops it (Trello comment + chat line + worker field); More → Workers = pieces, time and ≈ pieces/day per worker over 7/30/90 days.
  (2) production report in the chat when a card reaches FINISH: days in START, CUTTING, IN LINE, hand work, IRON/CHECKING … until READY,
  plus the workers; also by hand (⋯ → Production report). Day-count badge untouched. Slack *bold* shown bold. NEEDS: relay deploy.
- 2026-10-21 (VER 2026-10-21b) Abbas: "messed up the worker's names" — the WORK box now lists the factory's own people (Arif, Rifat, Nahid …
  from the Google Sheet), not Usman hand-work's; the list is editable in the app (More → Workers → ✏️ Edit). NEEDS: relay deploy.
- 2026-10-21 (VER 2026-10-21c) Abbas: duty hours 8 am – 10 pm, Friday 8 – 12 — pieces per day (worker rows, Workers screen, chat line,
  production report) are counted over working hours, not the clock. NEEDS: relay deploy.
- 2026-10-21: memo 2026-10-21c — (Abbas, video: the order list's 2×2 collage was unreadable) the Orders list shows each design as a tile — photo, number, pcs (first 5, then +N), same tiles as the order screen (`ordTileRow(o, mini)`); the collage stays only inside "Complete order".
- 2026-10-21: memo 2026-10-21d — (Abbas) a PDF shared on WhatsApp carries only its number as the message (`shareText`: "INVOICE INV-0021", "RECEIPT VOUCHER RV-…", memo: "Order memo · name"); the long typed copy stays behind the Copy button and the no-PDF WhatsApp fallback.
- 2026-10-21: memo 2026-10-21e — (Abbas, video: "same design, the colours changed" from order → bill) marks/prices/godown choices now follow their Trello CARD: `cardsOf()` saved with the work, drafts, orders (`drSnap`), bills (`bsSnap`, `d.sold.card`, order items `card`), remapped on restore and on every live update (`keyRemap`); the plain number goes back to the NEWEST duplicate card (20 Oct flip undone — it moved old orders to the other card). Catalogue: Send link / Copy link appear only when the page AND its preview picture answer on the site (`siteLive`, +8 s), and a shared link is always slightly new (`freshUrl`) so WhatsApp fetches the picture again.
- 2026-10-21: memo 2026-10-21f — catalogue "not opening": GitHub Pages cancels a publish when another push lands (sj-1021 went live 11 min after its commit). The app now waits up to 15 min with a clock (was 3) before offering the link; Send/Copy stay hidden until page + picture answer. Repo is 406 MB (vid/ 257 MB) — watch the 1 GB Pages limit.
- 2026-10-21: `.nojekyll` added — 5 Pages publishes in a row were cancelled (catalogue, photo sync, catalogue…), the Ahmad Al Wasta catalogues of 18:30/18:34 were not on the site 10 min later; a plain-copy publish is much faster.
- 2026-10-21: catalogue order PDF (`tools/catalog/sheet.js`, inlined in every catalogue page): the chosen dresses used to be CUT out of the line-up by guessed column edges (half dresses). Now the whole line-up photo is drawn, chosen colours clear with number badge + set count under them, the others faded — same idea as the memo PDF. All 18 catalogue pages in the repo re-patched in place (same links).
- 2026-10-21: note — GitHub Pages publishes at most ~10 times per hour per site (soft limit). Every push to main = one publish (memo-bot catalogue/stock/photo jobs included): 12 publishes 14:00–14:46 → the next pushes (3bcaa44 14:47, e2c36be 15:08) were silently never published. Check the Actions list for a "pages build and deployment" of the new commit; if none appears, wait until fewer than 10 fall in the last hour and push a real follow-up commit. Long-term: make the bots push less often (batch).
- 2026-10-21: (Abbas) catalogue page: the feed's per-photo Share buttons (z-index 3) painted THROUGH the order page and the bottom bar and stayed in place while scrolling — `.done,.bar{z-index:10}` in `tools/catalog/share1.js` (inlined in 21 pages, all re-patched). (Abbas: "make the bots save less often") the costing bot is now a step inside memo-thumbs with ONE commit (`memo-costing.yml` removed): a sale = 2 pushes (stock result + photo/costing sync) instead of 3; every bot already pushes only when something changed. `tools/costing.py` runs in the memo-thumbs job.
- 2026-10-21 (VER 2026-10-21d) Abbas's way of working: a worker can hold several designs at once (batches are per card), several workers can
  hold the same design, and ▶ More adds pieces to a worker who still has some of that design (one timer, "24 pcs (20+4)"); ✓ Done with the
  box empty = all his pieces came back. Works whatever list the card is in (e.g. still in CUTTING). NEEDS: relay deploy.
- 2026-10-21 (VER 2026-10-21e) Abbas: #cash and #expenses (ChatGPT workspace) as chats in the Chats tab — Abbas only; the bot joins the
  public channel by itself (a private one: /invite @SJ Orders). NEEDS: relay deploy.
- 2026-10-21 (VER 2026-10-21g) Abbas: "#cash / #expenses appear and disappear" — the fast-lane card-list refresh rebuilt the data without
  `rooms`, so they vanished until the next ping; fixed (test: rooms stay through 4 refreshes). The swipe-to-reply of 2026-10-21f was
  reverted on Abbas's request (the ↩ button stays as it is). No relay deploy needed for this.
- 2026-10-21 (VER 2026-10-21h) Abbas, screenshot: blank white rows in the Chats list after scrolling (iOS Safari did not paint rows that
  were "off-screen" by the browser's own reckoning): `content-visibility:auto` removed from the chat and card rows. No relay deploy.
- 2026-10-21 (VER 2026-10-21i) Abbas: "it is buggy" (screenshot: the tab bar in the middle of the screen, empty rows under it) — on iPhone the
  fixed bar follows the keyboard up and Safari left it there after the search box closed. Now: keyboard open on the home screen → bar hidden
  (`body.kb`, `kbFit`); keyboard closed / tab switched → input blurred, page scrolled to the top, bar back. No relay deploy.
- 2026-10-21 (VER 2026-10-21j) Abbas (SJ-46594: "mention the time in the chat — when he got the work, when we pressed Done, how long he took"):
  the WORK chat lines now carry the Dubai time: Give = "👷 Rifat ← 5 pcs given · 🕒 Wed 21 Oct 14:05" (+ "now 8 pcs in hand (first 5 on …)");
  Done = "✓ 7 pcs done of 8 given / 🕒 got … (+3 on …) → back … / ⏱ 1 d 2 h on the clock · 1.1 work days (8 am – 10 pm, Fri 8 – 12) ·
  ≈ 6 pcs / day" + Bengali. Trello comments get the times too (after "(factory app)", parser untouched). Card rows show "since Tue 21/10
  14:05" and "got → back". NEEDS: relay deploy.
- 2026-10-21 (VER 2026-10-21k) Abbas: "a complete dashboard for the workers — which design is with whom, at a glance": More → 👷 Workers is a
  full screen (`.dash`, `wksDraw`): tiles (working / free / pcs in hand / pcs done), By worker (green dot = busy; each design in hand with
  photo, pcs, since, running time; done pcs + ≈/day over 7/30/90 d) and By design (each design in work with worker chips); tap = the
  card; refreshes every 30 s. Relay `workrep` now reads 120 days back and returns `hand` (open batches) per worker; the `work` op's cached
  answer never carries a stale workers list. NEEDS: relay deploy.
- 2026-10-21 (VER 2026-10-21l) Abbas: the dashboard is reached from a small 👷 Workers icon in the bottom bar (nothing else changed; More →
  Workers still works). Added: "Today · আজ: N pcs done by M workers" line and an amber "⚠ long" on a batch held 2+ work days. NEEDS: relay deploy.
- 2026-10-22: Abbas: "the app is laggy, no messages, no workers list" — checked from here: the relay was alive (Ibrahim's gives/moves at 08:43–10:17), the site serves the newest version, the owner path costs ≈6 Slack calls per check; could not reach the live relay/site from the container (network policy). Asked for the "Last requests · speed" screenshot (tap the status line). Arif's and Islam's test work history cleared (Trello comments edited to "🧪 test, cleared"; the two test #report comments too, so SJ-46594 still gets its real report at FINISH).
- 2026-10-23 (VER 2026-10-23c) Abbas: "if a worker is given 20 and is done with 2, how do we track it?" — PART deliveries: ✓ Part with a number (less than what he holds) = Trello comment `👷 PART · NAME · 2 pcs · who (factory app) · time · 18 pcs still in hand` + chat line, the batch stays open (row: "18 pcs in hand · ✓ 2 done so far"); ■ All done (box empty = all the rest, or a number) closes it, the OUT comment carries `total N pcs` and the chat line "(13 now + 5 before)". `facWkParse`: PART → `pd`/`parts`; OUT `d` = parts + final. Dashboard / remaining strip / report / daily closing count each delivery on its own day (`facWorkRep` events), in hand = given − parts. NEEDS: relay deploy (186 functions).
- 2026-10-23 (VER 2026-10-23b) Abbas: "Ibrahim is management, Ram is checking, Arif is the iron man, Waris is not working any more" — a list entry can carry a job in brackets ("Ram (checking)", `facWorkerSplit`, roles in `work`/`list`/`att`/`workrep` answers): such a person is on attendance and salary but is not a machine worker — listed after a divider in the WORK box, job chip on the dashboard, never counted as free. The saved list is brought up to date once by the relay (`facWorkersMigrate`, `FAC_WORKERS_V=2`: Ibraheem/Ibrahim and Waris removed, Ram → checking, Arif → iron); the default list too. NEEDS: relay deploy (186 functions).
- 2026-10-23 (VER 2026-10-23a) Abbas: "at the top of the workers dashboard: when a design has gone IN LINE, say how many pieces are still remaining — 150 pcs, 20 given, 130 remaining": a 📐 IN LINE · REMAINING strip under the tiles (`wkRemain`/`wkRemainHtml`): every card in IN LINE / IN LINE (2) plus any design with pieces in hand — total (card name) − given (⏳ in hand + ✓ done) = remaining, with a bar; tap = the card. No relay change. Also cleared every worker-history comment on the board except SJ-41862's (50 Trello comments on SJ-46594, SJ-59318 and the two SJ-17841 cards prefixed "🧪 cleared 23 Oct").
- 2026-10-22 (VER 2026-10-22d) Abbas: "my workers are on salary, not piece rates" — the piece-rate Wages block and its relay ops (`rates`/`ratesset`, `facRates`) removed; the Factory screen points to 🗓 Month (salary, days, absent, late, hours, pay estimate). 183 functions. NEEDS: relay deploy (with the breaks of 22c, one deploy).
- 2026-10-22 (VER 2026-10-22c) Abbas: "we have breaks: 9–9:20, lunch 1–2, 7–7:20" — breaks count for nothing in pieces per day (work rows, dashboard, chat lines, production report; 1 work day = 12 h 20 min net) and in the clock hours (Factory → Month). NEEDS: relay deploy (184 functions).
- 2026-10-22 (VER 2026-10-22b) Abbas: "when a worker comes in we click his name = logged in; when he leaves we press again; at the end of the month I give the salaries and we see what to pay": More → 🏭 Factory → ATTENDANCE · CLOCK: ▶ In / ■ Out / ✗ absent per worker per day (`FAC_ATT_<date>` = `{NAME: {in, out, late}}`, late = minutes after 08:00 when past 15 min grace; typed times `at` = Abbas only; op `attset` kind in/out/absent/present/clear), 🗓 Month screen (op `attmonth`: days, absent, late, hours In→Out, ⚠ no Out; tap a worker = his days; Share) + salaries for Abbas only (`FAC_SAL`, ops `sal`/`salset`, pay estimate = salary − absent × salary ÷ 30); the daily closing lists late and "no Out yet". Nothing added to the polling. NEEDS: relay deploy (183 functions).
- 2026-10-22 (VER 2026-10-22a) Abbas: "a complete factory app — redo the workers overview, add the rest as options, change nothing old": Workers dashboard redone (tiles that filter, coloured initials, status chips Working / ⚠ Long / Free / Idle, sort, By design with progress bars done / in hand / left, Week table with ✗ absent + Share); WORK box progress bar; card 📋 SHEET (cut, rejected, packed, to/from hand work, first piece approved, due date → late badge); More → 🏭 Factory: attendance, late / due soon, materials with low alert, wages (Abbas only, rates on the relay), daily closing at 10 pm into the Direct chat (on/off, preview, post now). Tests +4 (sheet, dashboard, Factory screen incl. the 10 pm tick, staff limits). NEEDS: relay deploy (177 functions after the memo chat's direct-chat work).
- 2026-10-21 (VER 2026-10-21m) Abbas: "what does this whole thing mean?" — worker row reads "⏱ 2 h since Wed 21 Oct 21:55 · 4 min work time · 5 pcs · given by Md ibrahimmiah" (month name, 'work time', 'given by'). No relay deploy.
- 2026-10-22: memo 2026-10-21g — (Abbas: "a personal dashboard, just like an AI assistant in the app") **Today tab** (first tab, owner phones): counts (new chats, open orders, WhatsApp, blocks done); the running Timo block with ring, start → end, time left, its steps tickable right there, Focus / Open block; Needs you = chats with new lines (tap → that chat), open orders ranked (bill today / ready to send / waiting, tap → order), WhatsApp follow-ups typed by hand (synced through Timo's state); the day as colour blocks start → end. Timo: **Ends** time in the sheet (typed end → length; chip → end), each block row shows its next step, driven from the Today tab by postMessage. Tests: t_today (21); all memo tests green.
- 2026-10-22: catalogue builder (Abbas, 57026 / 48188 in ahmad-al-wasta-1022 + sz-1022: "it's messed up, half dresses, very confusing"): a sold-out colour was CUT out of the line-up photo by guessed edges and the rest renumbered — 57026 (0/14/16/0/4/8) lost half the gold and half the green dress and the numbers no longer matched. Now `keep_columns` never cuts: the whole photo stays, each 0 dress gets a faded "Sold out · نفذ" veil (`sold_html`, `.photo .sold`) and a greyed number, and every colour keeps the CARD's own number (the order rows, the PDF and the sizes catalogue all use it). Same for the sizes catalogue (`cs` = card numbers). Existing pages are not rebuilt — make the catalogue again from the app. Test: t_cat (12).
- 2026-10-22: catalogue builder, Abbas: "it has to be cut precisely, just like before, and the remaining combine into a clean photo — keep the numbers perfect". The faded-veil version of this morning is gone. New cutter `find_cuts` in build.py: every column of the dress band gets its colour (Lab) and how much dress stands in it (a dress fills chest AND skirt band — a vase or flowers only one, so they never count); an exact dynamic programme places the n-1 cuts where the colour changes (each dress 0.45–1.75× the average width), then a cut snaps to a real wall gap next to it; shop photos (no clean wall) also lean on even spacing. Checked by eye on 114 real line-ups from the catalogue pages (all studio photos on the dress edges). `keep_columns` cuts the 0 dresses out and joins the rest with a 1 %-feathered seam; the kept dresses keep the CARD's colour numbers (2, 3, 5, 6 — not renumbered: what the customer orders = the colour number in the Stock app). Same in the sizes catalogue. Make the catalogue again from the app.
- 2026-10-22: (Abbas: "it's been 23 minutes and it's still going on") the catalogue job sat in its first step: `apt-get install fonts-noto-core` on the GitHub runner hung (today's apt mirror), the builder never started. Now the Arabic font for the cover picture is in the repo (`tools/catalog/fonts/NotoNaskhArabic-Regular.ttf`, @font-face in `og_cover`), no font download at all, and the Tools step has `timeout-minutes: 4` so a hang fails fast and the app says so. Normal run ≈ 1–3 min.
- 2026-10-22: memo 2026-10-22a + Timo (Abbas, four asks): (1) a repeating block asks "Only this day / Every day" when its steps change (task screen add/remove, Edit sheet) — `S.over` keeps that day's own steps; (2) every block row in Timo has a ▾ arrow: its steps open under it and tick there (`XO`, `[data-x]/[data-xst]`); (3) the Today tab does the same for every block of the day (`TD.x`, `[data-tdx]/[data-tdxst]`), the Now card already ticked; (4) + = Block or Task, in Timo and on the Today tab: a task is one typed line — `#T1` = first block of that day, `#name` = block by name, a date word (tomorrow, Fri, 25 Oct, 25/10), "20 min" = timer; lands as a step inside that block on that day only (never every day); no block → To-do. Tests: t_today 30, all memo tests green. No relay deploy.
- 2026-10-22: Timo (Abbas): tap a to-do → "Where does it go?" sheet (`openPlace`): 7-day strip + that day's blocks (#T1, time, steps); tap a block → the to-do (and its own steps) become steps of that block on that day only (per-day `S.over` on a repeating block), the to-do leaves the list; Edit / New block from it stay as buttons. Test: t_today 32. No app version bump needed (timo.html only, loaded with ?v= of the memo VER — bumped to 2026-10-22b so phones fetch the new Timo).
- 2026-10-22: memo 2026-10-22c + relay (Abbas: "a direct chat between me and Muhammad, and me and Imran, in this app"): **Direct chats** in the Chats tab — the relay makes a private Slack channel #sj-direct with one thread per person; Abbas's phone lists Muhammad and Imran, each person's phone lists only "Abbas" (by the name set on the phone, first name); new lines show in the New-messages box, the badge, the Today tab and as ntfy notifications (💬 Name · direct); photos / voice notes work like every other chat. Nobody else can read them (relay refuses). More people later: relay op `dmpeople` (owner). NEEDS: relay deploy (162 functions). Tests: t_dm (11, real relay), t_dmapp (8); factory harness 66/66; all memo tests green.
- 2026-10-22: memo 2026-10-22d (Abbas: "keep everything the same; when I press Chats, at the top I must have Muhammad and Imran"): the Direct rows are the first thing in the Chats tab, above the search box; nothing else moved. Catch up already walks the direct chats with new lines together with the rest (`CC.un` D-keys).
- 2026-10-22: memo 2026-10-22e + relay (Abbas: "deployed since 5 mins, still can't see the chats"): the relay no longer swallows the Slack reason when #sj-direct cannot be listed/made (`dmerr` in the list answer) — the Chats tab shows it at the top with Fix A (add groups:read + groups:write + groups:history to the SJ Memo bot, Reinstall) and Fix B (make the private channel sj-direct yourself, invite @SJ Memo, paste its Channel ID → relay op `dmset`, owner chk, roots re-made). NEEDS: relay deploy (164 functions). t_dm 14.
- 2026-10-22: memo 2026-10-22f + relay (Abbas: "I've created a private channel called Muhammad and added SJ Memo there"): a person's direct chat lives in HIS OWN channel when one exists — the relay finds a channel named like the person (muhammad / sj-muhammad / muhammad-direct; `dmChFor`, kept in `CC_DM_CH_<NAME>`), else the shared #sj-direct; per-channel history/unread (`DM_HIST_<ch>`); `dmset` takes an optional person name ("Muhammad C0ABC12DEF" in the app's box) to pin that channel for him; Slack events from any direct channel nudge the phones. NEEDS: relay deploy (165 functions). t_dm 17, t_dmapp 9, factory harness 66/66.
- 2026-10-23: (Abbas: "WHY DID IT STOP MAKING MY CATALOGUE") the catalogue job failed in its Tools step: the GitHub runner has NO ffmpeg (my 22 Oct note was wrong), so it fell to `apt-get install ffmpeg`, which took > 4 min today and hit the 4-min limit → "The GitHub job stopped (failure)". Now no apt at all: `pip install imageio-ffmpeg` (PyPI, seconds) carries its own ffmpeg; `ffmpeg_bin()` in build.py uses a system ffmpeg when there is one, else that bundled one. Tools step limit 5 min.
- 2026-10-23: memo 2026-10-23a + catalogue builder (Abbas: "6668 has 20 cards with different prints — how do I make a catalogue of all of them?"): type `6668 all` (or `6668 *`) in the catalogue box → every READY card with that number, each its own design `6668_01, 6668_02 …` (oldest card first, so the numbers stay the same next time); the app's list says "N cards in READY, each its own design"; a plain `6668` still = the newest card (flag now says: type "6668 all" for every card). More than 8 cards → videos left out of that page (one page would take too long / be too big), said in the flags. t_cat 15.
