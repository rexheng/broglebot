import 'dotenv/config';
import { getRPSChoices } from './game.js';
import { capitalize, InstallGlobalCommands } from './utils.js';

// Get the game choices from game.js
function createCommandChoices() {
  const choices = getRPSChoices();
  const commandChoices = [];

  for (let choice of choices) {
    commandChoices.push({
      name: capitalize(choice),
      value: choice.toLowerCase(),
    });
  }

  return commandChoices;
}

// AI chat command
const AI_COMMAND = {
  name: 'ai',
  description: 'Chat with Gemini AI',
  options: [
    {
      type: 3, // STRING
      name: 'prompt',
      description: 'What do you want to ask the AI?',
      required: true,
    },
  ],
  type: 1,
  integration_types: [0, 1],
  contexts: [0, 1, 2],
};

const PERSONALITY_COMMAND = {
  name: 'personality',
  description: 'Change the bot personality',
  options: [
    {
      type: 3,
      name: 'preset',
      description: 'Choose a personality preset',
      required: true,
      choices: [
        { name: 'Default', value: 'default' },
        { name: 'Brawlhalla', value: 'brawlhalla' },
        { name: 'Wogay', value: 'wogay' },
        { name: 'Scatterbrain', value: 'scatterbrain' },
      ],
    },
  ],
  type: 1,
  integration_types: [0, 1],
  contexts: [0, 1, 2],
};

const QUIZ_COMMAND = {
  name: 'quiz',
  description: 'Start an AI-generated quiz on any topic',
  options: [
    {
      type: 3,          // STRING
      name: 'topic',
      description: 'Quiz topic',
      required: true,
    },
    {
      type: 4,          // INTEGER
      name: 'rounds',
      description: 'Number of rounds',
      required: true,
      choices: [
        { name: '5',  value: 5  },
        { name: '10', value: 10 },
        { name: '20', value: 20 },
      ],
    },
  ],
  type: 1,
  integration_types: [0, 1],
  contexts: [0, 1, 2],
};

const ALL_COMMANDS = [TEST_COMMAND, CHALLENGE_COMMAND, AI_COMMAND, PERSONALITY_COMMAND, QUIZ_COMMAND];

InstallGlobalCommands(process.env.APP_ID, ALL_COMMANDS);
