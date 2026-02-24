import { Client, GatewayIntentBits } from 'discord.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import 'dotenv/config';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

// Per-user cooldown (10 seconds)
const cooldowns = new Map();
const COOLDOWN_MS = 10_000;

client.once('ready', () => {
  console.log(`Ready: ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.mentions.has(client.user)) return;

  const now = Date.now();
  const last = cooldowns.get(message.author.id) || 0;
  if (now - last < COOLDOWN_MS) {
    return message.reply('Please wait a moment before asking again.');
  }
  cooldowns.set(message.author.id, now);

  const prompt = message.content.replace(/<@!?\d+>/g, '').trim();
  if (!prompt) return message.reply('Ask me anything!');

  try {
    await message.channel.sendTyping();
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    // Discord messages have a 2000-char limit
    if (text.length <= 2000) {
      return message.reply(text);
    }
    // Split long responses
    return message.reply(text.slice(0, 1997) + '…');
  } catch (err) {
    console.error('Gemini error:', err.message);
    return message.reply('Sorry, I ran into an error. Please try again later.');
  }
});

client.login(process.env.DISCORD_TOKEN);
