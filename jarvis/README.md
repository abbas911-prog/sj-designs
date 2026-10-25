# Jarvis for Abbas — setup (25 Oct 2026)

What this is: Claude Code on Abbas's PC (via jaredrhod's fullstack-agent: memory + push-to-talk voice + face) + this folder, which gives it his business brain and a tool to read and act through the SJ Assistant backend.

## One-time setup on the PC (10 minutes)
1. PowerShell: `irm https://claude.ai/install.ps1 | iex` → then `claude` → sign in with the Claude account.
2. github.com/jaredrhod/fullstack-agent → copy the Windows install line → run it in PowerShell → the wizard: choose memory + voice + face, skip hands.
3. Copy this whole `jarvis` folder into `C:\Users\<you>\my-agent\` (next to `fullstack-agent`). Copy `jarvis\CLAUDE.md` to `C:\Users\<you>\my-agent\CLAUDE.md` as well (Claude Code reads that file at start).
4. In `my-agent\jarvis\`, copy `config.example.json` → `config.json` and fill in: the Assistant link (…/exec), the Assistant password, your name. (Same two things the Assistant app asked for.)
5. Open https://abbas911-prog.github.io/sj-designs/assistant.html once in the PC's browser and sign in (link + password) — that is where `show` pops chats on screen.
6. In PowerShell: `cd $env:USERPROFILE\my-agent` → `claude` → say "what's on my plate".

## Daily use
Hold the push-to-talk key, speak, release. Examples: "what's on my plate" · "what's going on in the factory" · "status of 48188" · "show me the last two invoices of Matiullah" · "balance of Nadeem" · "open the chat" · "reply: lace comes tomorrow" (it reads it back → "yes") · "remember: keep 48188 at 100".

## Not yet
- WhatsApp from Jarvis (needs a bridge or desktop control — next step once this runs).
- Hands-free listening (the base is push-to-talk).
