// Quiz session state, keyed by channelId.
// QuizSession shape:
//   { questions: [{question, options, answer}], currentIndex: int, scores: Map<userId, int>, active: bool, timeoutId: TimeoutId|null }

const quizSessions = new Map();

export function createQuizSession(channelId, questions) {
  const session = {
    questions,
    currentIndex: 0,
    scores: new Map(),
    active: true,
    timeoutId: null,
  };
  quizSessions.set(channelId, session);
  return session;
}

export function getQuizSession(channelId) {
  return quizSessions.get(channelId) ?? null;
}

export function endQuizSession(channelId) {
  const session = quizSessions.get(channelId);
  if (session?.timeoutId) clearTimeout(session.timeoutId);
  quizSessions.delete(channelId);
}

/**
 * Record an answer attempt.
 * Returns { correct: bool, points: int, alreadyAnswered: bool }
 * Only the FIRST correct answer per question scores a point.
 */
export function recordAnswer(channelId, userId, answer) {
  const session = quizSessions.get(channelId);
  if (!session || !session.active) return null;

  const current = session.questions[session.currentIndex];
  const correct = answer.toUpperCase() === current.answer.toUpperCase();

  if (correct) {
    session.scores.set(userId, (session.scores.get(userId) ?? 0) + 1);
  }

  return { correct, points: correct ? 1 : 0 };
}

/**
 * Advance to the next question. Returns the new currentIndex,
 * or -1 if the quiz is finished.
 */
export function advanceQuestion(channelId) {
  const session = quizSessions.get(channelId);
  if (!session) return -1;
  session.currentIndex += 1;
  if (session.currentIndex >= session.questions.length) {
    session.active = false;
    return -1;
  }
  return session.currentIndex;
}

/**
 * Build a leaderboard string from the current session scores.
 */
export function buildLeaderboard(channelId, guild) {
  const session = quizSessions.get(channelId);
  if (!session || session.scores.size === 0) return 'No one scored any points!';

  const sorted = [...session.scores.entries()].sort((a, b) => b[1] - a[1]);
  const lines = sorted.map(([userId, pts], i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    return `${medal} <@${userId}> — **${pts}** pt${pts !== 1 ? 's' : ''}`;
  });
  return lines.join('\n');
}
