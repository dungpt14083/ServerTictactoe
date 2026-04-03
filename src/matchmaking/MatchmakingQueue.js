const { buildQueueJoined, buildQueueLeft } = require('../protocol/MessageBuilder');

const DEFAULT_PLAYERS_PER_MATCH = 4;
const DEFAULT_QUEUE_TIMEOUT_MS = 8000;
const QUEUE_CHECK_INTERVAL_MS = 1000;

class MatchmakingQueue {
  constructor(onCreateMatch, options = {}) {
    this.queue = [];
    this.onCreateMatch = onCreateMatch;
    this.playersPerMatch = options.playersPerMatch || DEFAULT_PLAYERS_PER_MATCH;
    this.queueTimeoutMs = options.queueTimeoutMs || DEFAULT_QUEUE_TIMEOUT_MS;
    this.timer = null;
  }

  start() {
    this.timer = setInterval(() => this._process(), QUEUE_CHECK_INTERVAL_MS);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  enqueue(session) {
    if (this.queue.find((entry) => entry.session.id === session.id)) {
      return false;
    }
    const entry = { session, joinedAt: Date.now() };
    this.queue.push(entry);
    session.setInQueue();
    session.send(buildQueueJoined(this.queue.length));
    return true;
  }

  dequeue(sessionId) {
    const index = this.queue.findIndex((e) => e.session.id === sessionId);
    if (index === -1) return false;
    const [removed] = this.queue.splice(index, 1);
    removed.session.setConnected();
    removed.session.send(buildQueueLeft());
    return true;
  }

  removeSession(sessionId) {
    const index = this.queue.findIndex((e) => e.session.id === sessionId);
    if (index !== -1) {
      this.queue.splice(index, 1);
    }
  }

  _process() {
    if (this.queue.length === 0) return;

    const now = Date.now();
    const oldestEntry = this.queue[0];
    const waitTime = now - oldestEntry.joinedAt;
    const hasEnoughPlayers = this.queue.length >= this.playersPerMatch;
    const timedOut = waitTime >= this.queueTimeoutMs;

    if (!hasEnoughPlayers && !timedOut) return;

    const slots = Math.min(this.queue.length, this.playersPerMatch);
    const entries = this.queue.splice(0, slots);
    const sessions = entries.map((e) => e.session);
    const botsNeeded = this.playersPerMatch - sessions.length;

    this.onCreateMatch(sessions, botsNeeded);
  }

  getQueueSize() {
    return this.queue.length;
  }
}

module.exports = { MatchmakingQueue };
