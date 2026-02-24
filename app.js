import { Client, GatewayIntentBits } from 'discord.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import 'dotenv/config';
import { PERSONALITIES, DEFAULT_PERSONALITY } from './personalities.js';
import {
  createQuizSession,
  getQuizSession,
  endQuizSession,
  recordAnswer,
  advanceQuestion,
  buildLeaderboard,
} from './quiz.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Active personality (server-wide)
let activePersonality = DEFAULT_PERSONALITY;

// Per-channel Gemini chat sessions
const chatSessions = new Map();

// Per-user cooldown (10 seconds)
const cooldowns = new Map();
const COOLDOWN_MS = 10_000;

// Quiz answer timeout (30 seconds per question)
const QUIZ_TIMEOUT_MS = 30_000;

function getModel() {
  return genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: PERSONALITIES[activePersonality].systemInstruction,
  });
}

function getChat(channelId) {
  if (!chatSessions.has(channelId)) {
    chatSessions.set(channelId, getModel().startChat({ history: [] }));
  }
  return chatSessions.get(channelId);
}

function clearAllChats() {
  chatSessions.clear();
}

// ── Quiz helpers ──────────────────────────────────────────────────────────────

function formatQuestion(session) {
  const q = session.questions[session.currentIndex];
  const total = session.questions.length;
  const num = session.currentIndex + 1;
  const opts = Object.entries(q.options)
    .map(([k, v]) => `**${k}:** ${v}`)
    .join('\n');
  return `**Question ${num}/${total}**\n${q.question}\n\n${opts}\n\n*Reply with A, B, C, or D — first correct answer scores a point!*`;
}

function scheduleQuizTimeout(channelId, channel) {
  const session = getQuizSession(channelId);
  if (!session) return;

  if (session.timeoutId) clearTimeout(session.timeoutId);

  session.timeoutId = setTimeout(async () => {
    const s = getQuizSession(channelId);
    if (!s || !s.active) return;

    const current = s.questions[s.currentIndex];
    await channel.send(
      `⏰ Time's up! The answer was **${current.answer}: ${current.options[current.answer]}**.`,
    );

    const next = advanceQuestion(channelId);
    if (next === -1) {
      const leaderboard = buildLeaderboard(channelId);
      await channel.send(`🏁 Quiz over!\n\n${leaderboard}`);
      endQuizSession(channelId);
    } else {
      const nextSession = getQuizSession(channelId);
      await channel.send(formatQuestion(nextSession));
      scheduleQuizTimeout(channelId, channel);
    }
  }, QUIZ_TIMEOUT_MS);
}

async function handleQuizCommand(interaction) {
  const topic = interaction.options.getString('topic');
  const numQuestions = Math.min(10, Math.max(1, interaction.options.getInteger('questions') ?? 5));

  // End any existing quiz in this channel
  if (getQuizSession(interaction.channelId)) {
    endQuizSession(interaction.channelId);
  }

  await interaction.deferReply();

  const prompt =
    `Generate exactly ${numQuestions} trivia quiz questions about "${topic}". ` +
    'Return ONLY a valid JSON array with no markdown, no explanation, no code fences. ' +
    'Format: [{"question":"...","options":{"A":"...","B":"...","C":"...","D":"..."},"answer":"A"}]';

  try {
    const result = await genAI
      .getGenerativeModel({ model: 'gemini-2.5-flash' })
      .generateContent(prompt);
    const raw = result.response.text().trim();

    // Strip any accidental markdown fences
    const json = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const questions = JSON.parse(json);

    if (!Array.isArray(questions) || questions.length === 0) {
      return interaction.editReply('Failed to generate quiz questions. Please try again.');
    }

    const session = createQuizSession(interaction.channelId, questions);
    await interaction.editReply(
      `🎯 **Quiz started!** Topic: **${topic}** — ${questions.length} question${questions.length !== 1 ? 's' : ''}\n\n` +
      formatQuestion(session),
    );

    scheduleQuizTimeout(interaction.channelId, interaction.channel);
  } catch (err) {
    console.error('Quiz generation error:', err.message);
    return interaction.editReply('Sorry, I could not generate the quiz. Please try again.');
  }
}

async function handleQuizAnswer(message, answer) {
  const session = getQuizSession(message.channelId);
  if (!session || !session.active) return;

  const result = recordAnswer(message.channelId, message.author.id, answer);
  if (!result) return;

  const current = session.questions[session.currentIndex];

  if (result.correct) {
    // Clear the timeout — we got an answer
    if (session.timeoutId) {
      clearTimeout(session.timeoutId);
      session.timeoutId = null;
    }

    await message.reply(
      `✅ Correct! The answer was **${current.answer}: ${current.options[current.answer]}**. +1 point for you!`,
    );

    const next = advanceQuestion(message.channelId);
    if (next === -1) {
      const leaderboard = buildLeaderboard(message.channelId);
      await message.channel.send(`🏁 Quiz over!\n\n${leaderboard}`);
      endQuizSession(message.channelId);
    } else {
      const nextSession = getQuizSession(message.channelId);
      await message.channel.send(formatQuestion(nextSession));
      scheduleQuizTimeout(message.channelId, message.channel);
    }
  } else {
    await message.reply(`❌ Wrong answer! Keep trying.`);
  }
}

// ── Event: ready ──────────────────────────────────────────────────────────────

client.once('ready', () => {
  console.log(`Ready: ${client.user.tag}`);
});

// ── Event: interactionCreate (slash commands) ─────────────────────────────────

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'personality') {
    const preset = interaction.options.getString('preset');
    activePersonality = preset;
    clearAllChats();
    await interaction.reply(
      `Personality set to **${PERSONALITIES[preset].label}**! Chat history cleared.`,
    );
    return;
  }

  if (interaction.commandName === 'quiz') {
    await handleQuizCommand(interaction);
    return;
  }
});

// ── Event: messageCreate (@ mentions + quiz answers) ─────────────────────────

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Quiz answer interception — check before anything else
  const quizSession = getQuizSession(message.channelId);
  if (quizSession && quizSession.active) {
    const answer = message.content.trim().toUpperCase();
    if (['A', 'B', 'C', 'D'].includes(answer)) {
      await handleQuizAnswer(message, answer);
      return;
    }
  }

  // Only respond to @mentions for normal chat
  if (!message.mentions.has(client.user)) return;

  const now = Date.now();
  const last = cooldowns.get(message.author.id) ?? 0;
  if (now - last < COOLDOWN_MS) {
    return message.reply('Please wait a moment before asking again.');
  }
  cooldowns.set(message.author.id, now);

  const prompt = message.content.replace(/<@!?\d+>/g, '').trim();
  if (!prompt) return message.reply('Ask me anything!');

  try {
    await message.channel.sendTyping();
    const chat = getChat(message.channelId);
    const result = await chat.sendMessage(prompt);
    const text = result.response.text();

    if (text.length <= 2000) {
      return message.reply(text);
    }
    return message.reply(text.slice(0, 1997) + '…');
  } catch (err) {
    console.error('Gemini error:', err.message);
    return message.reply('Sorry, I ran into an error. Please try again later.');
  }
});

client.login(process.env.DISCORD_TOKEN);
