const { PlayerSession } = require('../player/PlayerSession');

const HEARTBEAT_INTERVAL_MS = 10000;
const HEARTBEAT_TIMEOUT_MS = 30000;

class ConnectionManager {
  constructor() {
    this.sessions = new Map();
    this.heartbeatTimer = null;
  }

  start() {
    this.heartbeatTimer = setInterval(() => this._checkHeartbeats(), HEARTBEAT_INTERVAL_MS);
  }

  stop() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  createSession(ws, req) {
    const session = new PlayerSession(ws, req);
    this.sessions.set(session.id, session);
    return session;
  }

  removeSession(sessionId) {
    this.sessions.delete(sessionId);
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  updateHeartbeat(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastHeartbeat = Date.now();
    }
  }

  _checkHeartbeats() {
    const now = Date.now();
    this.sessions.forEach((session, id) => {
      if (now - session.lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
        session.ws.terminate();
        this.sessions.delete(id);
      }
    });
  }

  getStats() {
    return { connectedPlayers: this.sessions.size };
  }
}

module.exports = { ConnectionManager };
