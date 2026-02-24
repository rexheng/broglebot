import { Client, GatewayIntentBits } from 'discord.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import 'dotenv/config';
import { PERSONALITIES, DEFAULT_PERSONALITY } from './personalities.js';
import {
  createQuizSession,
  getQuizSession,
  endQuizSession,
  checkAnswer,
  advanceQuestion,
  getResult,
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
  return `**Question ${num}/${total}**\n${q.question}\n\n*Type your answer in the chat — 30 seconds!*`;
}

function scheduleQuizTimeout(channelId, channel) {
  const session = getQuizSession(channelId);
  if (!session) return;

  if (session.timeoutId) clearTimeout(session.timeoutId);

  session.timeoutId = setTimeout(async () => {
    const s = getQuizSession(channelId);
    if (!s || !s.active) return;

    const current = s.questions[s.currentIndex];
    await channel.send(`⏰ Time's up! The answer was **${current.answer}**.`);

    const next = advanceQuestion(channelId);
    if (next === -1) {
      const { score, total, userId } = getResult(channelId);
      await channel.send(`🏁 Quiz over! <@${userId}> scored **${score}/${total}**`);
      endQuizSession(channelId);
    } else {
      const nextSession = getQuizSession(channelId);
      await channel.send(formatQuestion(nextSession));
      scheduleQuizTimeout(channelId, channel);
    }
  }, QUIZ_TIMEOUT_MS);
}

async function handleQuizCommand(interaction) {
  // Guard: reject if a quiz is already running
  if (getQuizSession(interaction.channelId)) {
    return interaction.reply({ content: 'A quiz is already running in this channel.', ephemeral: true });
  }

  const topic = interaction.options.getString('topic');
  const rounds = interaction.options.getInteger('rounds');

  await interaction.deferReply();

  const prompt =
    `Generate exactly ${rounds} trivia questions about "${topic}". ` +
    'Return ONLY a valid JSON array with no markdown, no code fences. ' +
    'Each element: {"question":"...","answer":"..."}. ' +
    'The answer must be a single short unambiguous phrase (1-2 words). ' +
    'Write questions that have exactly one obvious short answer.';

  try {
    const result = await genAI
      .getGenerativeModel({ model: 'gemini-1.5-flash' })
      .generateContent(prompt);
    const raw = result.response.text().trim();

    // Strip any accidental markdown fences
    const json = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const questions = JSON.parse(json);

    if (!Array.isArray(questions) || questions.length === 0) {
      return interaction.editReply('Failed to generate quiz questions. Please try again.');
    }

    const session = createQuizSession(interaction.channelId, questions, interaction.user.id);
    await interaction.editReply(
      `🎯 Quiz started! Topic: **${topic}** — ${questions.length} round${questions.length !== 1 ? 's' : ''}. Good luck!`,
    );

    await interaction.channel.send(formatQuestion(session));
    scheduleQuizTimeout(interaction.channelId, interaction.channel);
  } catch (err) {
    console.error('Quiz generation error:', err.message);
    return interaction.editReply('Sorry, I could not generate the quiz. Please try again.');
  }
}

async function handleQuizAnswer(message) {
  const session = getQuizSession(message.channelId);
  if (!session || !session.active) return;

  const result = checkAnswer(message.channelId, message.author.id, message.content);
  if (!result) return;

  if (result.correct) {
    // Clear the timeout — correct answer received
    if (session.timeoutId) {
      clearTimeout(session.timeoutId);
      session.timeoutId = null;
    }

    await message.reply(`✅ <@${message.author.id}> got it! The answer was **${result.answer}**.`);

    const next = advanceQuestion(message.channelId);
    if (next === -1) {
      const { score, total, userId } = getResult(message.channelId);
      await message.channel.send(`🏁 Quiz over! <@${userId}> scored **${score}/${total}**`);
      endQuizSession(message.channelId);
    } else {
      const nextSession = getQuizSession(message.channelId);
      await message.channel.send(formatQuestion(nextSession));
      scheduleQuizTimeout(message.channelId, message.channel);
    }
  }
  // Wrong answer: stay silent
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
    await handleQuizAnswer(message);
    return;
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
