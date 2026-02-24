// Quiz session state, keyed by channelId.
// QuizSession shape:
//   { questions: [{question, answer}], currentIndex, score, userId, active, timeoutId }

const quizSessions = new Map();

export function createQuizSession(channelId, questions, userId) {
  const session = {
    questions,
    currentIndex: 0,
    score: 0,
    userId,
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
 * Check an answer attempt.
 * If correct AND from the quiz runner, increment score.
 * Returns { correct: bool, answer: string } or null if no active session.
 */
export function checkAnswer(channelId, userId, rawAnswer) {
  const session = quizSessions.get(channelId);
  if (!session || !session.active) return null;

  const current = session.questions[session.currentIndex];
  const correct = rawAnswer.trim().toLowerCase() === current.answer.trim().toLowerCase();

  if (correct && userId === session.userId) {
    session.score += 1;
  }

  return { correct, answer: current.answer };
}

/**
 * Advance to the next question.
 * Returns the new currentIndex, or -1 if the quiz is finished.
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
 * Returns { score, total, userId } for the final score message.
 */
export function getResult(channelId) {
  const session = quizSessions.get(channelId);
  if (!session) return null;
  return { score: session.score, total: session.questions.length, userId: session.userId };
}
