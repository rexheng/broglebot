# Broglebot — Technical Architecture

## File Map

```
discord-example-app/
├── app.js              # Discord client, event handlers, quiz orchestration
├── commands.js         # Slash command definitions + one-shot registration
├── personalities.js    # Personality config (label + systemInstruction per preset)
├── quiz.js             # Quiz session state machine
├── game.js             # RPS game logic
├── utils.js            # InstallGlobalCommands, capitalize
└── package.json        # Dependencies: discord.js, @google/generative-ai, dotenv
```

## Data Flow

### @mention Chat

```
User @mentions bot
  → messageCreate fires
  → Skip if bot, skip quiz-answer check first
  → Cooldown check (per user, 10s)
  → Strip mention from prompt text
  → getChat(channelId) → returns existing ChatSession or creates new one
      └─ getModel() → genAI.getGenerativeModel({ systemInstruction: PERSONALITIES[activePersonality] })
      └─ model.startChat({ history: [] })
  → chat.sendMessage(prompt) → Gemini API
  → message.reply(response text)
```

### `/personality` Command

```
/personality preset:pirate
  → interactionCreate fires
  → activePersonality = 'pirate'   (module-level variable)
  → clearAllChats()                (wipes chatSessions Map)
  → interaction.reply(confirmation)
```

### `/quiz` Command

```
/quiz topic:"geography" questions:5
  → interactionCreate fires
  → handleQuizCommand(interaction)
    → interaction.deferReply()
    → genAI.generateContent(prompt requesting JSON array of questions)
    → JSON.parse response
    → createQuizSession(channelId, questions)   (stored in quizSessions Map)
    → interaction.editReply(first question)
    → scheduleQuizTimeout(channelId, channel)   (setTimeout 30s)
```

### Quiz Answer Handling

```
User sends "B" in channel
  → messageCreate fires
  → getQuizSession(channelId) → active session found
  → answer is A/B/C/D → handleQuizAnswer(message, "B")
    → recordAnswer(channelId, userId, "B") → { correct: bool, points: int }
    if correct:
      → clearTimeout (cancel 30s timer)
      → reply "Correct! +1 point"
      → advanceQuestion(channelId)
        if more questions → channel.send(next question) + reschedule timeout
        if finished      → channel.send(leaderboard) + endQuizSession(channelId)
    if wrong:
      → reply "Wrong answer!"
```

## Key Patterns

### Personality System

`activePersonality` is a module-level string in `app.js`. `getModel()` reads it each time to build a fresh `GenerativeModel` with the correct `systemInstruction`. When personality changes, `clearAllChats()` wipes the `chatSessions` Map so old conversation history (tied to the old model config) is discarded.

### Chat Session Management

`chatSessions` is a `Map<channelId, ChatSession>`. `getChat(channelId)` lazily creates a session on first use. Sessions persist for the lifetime of the process — there is no eviction policy. For memory-constrained deployments, consider an LRU cache with a cap of ~100 channels.

### Quiz State Machine

`quiz.js` owns all mutable quiz state in a `Map<channelId, QuizSession>`. `app.js` drives the state machine by calling quiz.js functions and scheduling timeouts. State transitions:

```
[idle]
  → createQuizSession()  → [active, question 0]
  → recordAnswer() correct → advanceQuestion()
      → [active, question N+1]   (more questions remain)
      → [finished]               (all questions done)
  → timeout fires               → advanceQuestion() same path
  → endQuizSession()            → [idle]
```

### Slash Command Registration

`commands.js` is a standalone script (not imported by `app.js`). Run it once manually with `node commands.js` whenever commands change. It calls Discord's REST API via `InstallGlobalCommands`. The bot itself only handles `interactionCreate` events — it does not re-register commands on startup.

## Extension Points

| Feature | Where to add |
|---------|-------------|
| New personality | `personalities.js` — add key to PERSONALITIES object |
| New slash command | `commands.js` (define) + `app.js` interactionCreate handler |
| Per-channel personality | Replace `activePersonality` string with a `Map<channelId, string>` |
| Quiz difficulty | Add `difficulty` option to QUIZ_COMMAND, pass to Gemini prompt |
| Persistent chat history | Serialise `chatSessions` to a DB; restore on startup |
| Chat history eviction | Wrap `chatSessions` Map in an LRU with a configurable max size |
