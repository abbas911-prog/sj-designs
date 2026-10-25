# Jarvis for Abbas — setup (25 Oct 2026)

What this is: Claude Code on Abbas's PC (via jaredrhod's fullstack-agent: memory + push-to-talk voice + face) + this folder, which gives it his business brain (`CLAUDE.md`) and a tool (`sj.py`) to read and act through the SJ Assistant backend.

## Setup on the PC = ONE line
Open PowerShell (Start → type `powershell` → Enter) and paste:

```
irm https://raw.githubusercontent.com/abbas911-prog/sj-designs/main/jarvis/setup.ps1 | iex
```

It does everything in order and skips what is already done, so it is safe to paste again:
1. Installs Claude Code (≈330 MB, prints nothing while downloading — leave the window alone).
2. Installs Python 3 if the PC has none.
3. Puts `CLAUDE.md`, `sj.py`, `config.json` in `C:\Users\<you>\my-agent\jarvis\` and opens `config.json` in Notepad — paste the Assistant link (…/exec) and the Assistant password, save, close.
4. Downloads fullstack-agent and starts its wizard — the first time it opens the browser to sign in to Claude. Answer the wizard: name **Jarvis**, pieces **memory + voice + face**, skip hands.

If the window says "Claude Code is not on this PC yet", close PowerShell, open a new one, paste the same line again.

Then open https://abbas911-prog.github.io/sj-designs/assistant.html once in the PC's browser and sign in (link + password) — that is where `show` pops chats on screen.

## Daily use
Double-click **Jarvis Talk** on the Desktop (the wizard makes it). Hold the push-to-talk key, speak, release — or type. Examples: "what's on my plate" · "what's going on in the factory" · "status of 48188" · "show me the last two invoices of Matiullah" · "balance of Nadeem" · "open the chat" · "reply: lace comes tomorrow" (it reads it back → "yes") · "remember: keep 48188 at 100".

## Not yet
- WhatsApp from Jarvis (needs a bridge or desktop control — next step once this runs).
- Hands-free listening (the base is push-to-talk).
