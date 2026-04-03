const WebSocket = require('ws');
const { ConnectionManager } = require('./ConnectionManager');
const { MessageHandler } = require('./MessageHandler');
const { MatchmakingQueue } = require('../matchmaking/MatchmakingQueue');
const { MatchManager } = require('../match/MatchManager');

class GameServer {
  constructor(options = {}) {
    this.port = options.port || 8080;
    this.playersPerMatch = options.playersPerMatch || 4;
    this.queueTimeoutMs = options.queueTimeoutMs || 8000;
    this.wss = null;
    this.connectionManager = new ConnectionManager();
    this.matchManager = new MatchManager();
    this.matchmakingQueue = new MatchmakingQueue(
      (sessions, botsNeeded) => this.matchManager.createMatch(sessions, botsNeeded),
      { playersPerMatch: this.playersPerMatch, queueTimeoutMs: this.queueTimeoutMs }
    );
    this.messageHandler = new MessageHandler(
      this.connectionManager,
      this.matchmakingQueue,
      this.matchManager
    );
  }

  start() {
    this.wss = new WebSocket.Server({ port: this.port });
    this.connectionManager.start();
    this.matchmakingQueue.start();
    this.wss.on('connection', (ws, req) => this._onConnection(ws, req));
    this.wss.on('error', (err) => console.error('[Server] Error:', err));
    console.log(`[Server] Running on ws://localhost:${this.port}`);
  }

  stop() {
    this.matchmakingQueue.stop();
    this.connectionManager.stop();
    if (this.wss) {
      this.wss.close();
    }
    console.log('[Server] Stopped');
  }

  _onConnection(ws, req) {
    const session = this.connectionManager.createSession(ws, req);
    console.log(`[Server] Player connected: ${session.id}`);

    ws.on('message', (data) => {
      this.messageHandler.handle(session, data);
    });

    ws.on('close', () => {
      this._onDisconnect(session);
    });

    ws.on('error', (err) => {
      console.error(`[Server] Socket error for ${session.id}:`, err.message);
    });
  }

  _onDisconnect(session) {
    console.log(`[Server] Player disconnected: ${session.id}`);
    this.matchmakingQueue.removeSession(session.id);
    this.matchManager.handlePlayerDisconnect(session.id);
    this.connectionManager.removeSession(session.id);
  }

  getStats() {
    return {
      ...this.connectionManager.getStats(),
      ...this.matchManager.getStats(),
      queueSize: this.matchmakingQueue.getQueueSize(),
    };
  }
}

module.exports = { GameServer };
