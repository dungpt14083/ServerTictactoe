const { v4: uuidv4 } = require('uuid');

const PlayerState = {
  CONNECTED: 'connected',
  IN_QUEUE: 'in_queue',
  IN_MATCH: 'in_match',
  DISCONNECTED: 'disconnected',
};

class PlayerSession {
  constructor(ws, req) {
    this.id = uuidv4();
    this.ws = ws;
    this.remoteAddress = req.socket.remoteAddress;
    this.state = PlayerState.CONNECTED;
    this.matchId = null;
    this.entityId = null;
    this.inputQueue = [];
    this.lastInputSequence = 0;
    this.connectedAt = Date.now();
    this.lastHeartbeat = Date.now();
  }

  send(message) {
    if (this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(message));
    }
  }

  enqueueInput(input) {
    if (this.inputQueue.length >= 64) {
      this.inputQueue.shift();
    }
    this.inputQueue.push(input);
  }

  drainInputs() {
    const inputs = this.inputQueue.slice();
    this.inputQueue = [];
    return inputs;
  }

  assignToMatch(matchId, entityId) {
    this.matchId = matchId;
    this.entityId = entityId;
    this.state = PlayerState.IN_MATCH;
  }

  setInQueue() {
    this.state = PlayerState.IN_QUEUE;
    this.matchId = null;
    this.entityId = null;
  }

  setConnected() {
    this.state = PlayerState.CONNECTED;
    this.matchId = null;
    this.entityId = null;
  }

  setDisconnected() {
    this.state = PlayerState.DISCONNECTED;
  }

  isAlive() {
    return this.ws.readyState === 1;
  }
}

module.exports = { PlayerSession, PlayerState };
