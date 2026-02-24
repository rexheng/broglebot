# Broglebot — Project Overview

## What It Is

Broglebot is a Discord bot powered by Google Gemini (gemini-2.5-flash). It responds to @mentions in any channel and supports slash commands. The bot has a swappable personality system, per-channel conversation memory, and an AI-generated trivia quiz feature.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Discord API | discord.js v14 |
| LLM | Google Gemini via `@google/generative-ai` |
| Runtime | Node.js (ES modules) |
| Config | dotenv |
| Hosting | Railway (`railway.toml` present) |

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `DISCORD_TOKEN` | Bot login token |
| `GEMINI_API_KEY` | Google Generative AI key |
| `APP_ID` | Discord application ID (used by `commands.js` to register slash commands) |

## How to Run

```bash
# Install dependencies
npm install

# Register slash commands once (re-run when commands change)
node commands.js

# Start the bot
node app.js
```

## Key Behaviours

### @mention Chat
- Users @mention the bot to chat with it
- Each channel maintains its own conversation history (Gemini `startChat`)
- 10-second per-user cooldown to prevent spam
- Responses longer than 2000 chars are truncated (Discord limit)

### `/personality <preset>` Slash Command
- Switches the bot's system instruction server-wide
- Clears all channel chat histories when personality changes
- Available presets: Default, Sarcastic, Pirate, Professor, Hype Beast

### `/quiz <topic> [questions]` Slash Command
- Generates 1–10 trivia questions on any topic using Gemini
- Questions have A/B/C/D multiple-choice answers
- Users answer by typing A, B, C, or D in the channel
- First correct answer per question scores a point
- 30-second timeout per question auto-advances if no one answers
- Displays a leaderboard at the end
- Multiple channels can run quizzes simultaneously

## Files at a Glance

| File | Role |
|------|------|
| `app.js` | Main entry point — Discord client, all event handlers |
| `commands.js` | Slash command definitions + registration script |
| `personalities.js` | Personality presets (system instructions) |
| `quiz.js` | Quiz state management (per-channel sessions) |
| `game.js` | Rock-paper-scissors game logic (original feature) |
| `utils.js` | Shared utilities (InstallGlobalCommands, capitalize) |
