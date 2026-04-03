const { ClientMessageType } = require('../protocol/MessageTypes');
const { buildError, buildPong } = require('../protocol/MessageBuilder');
const { PlayerState } = require('../player/PlayerSession');

class MessageHandler {
  constructor(connectionManager, matchmakingQueue, matchManager) {
    this.connectionManager = connectionManager;
    this.matchmakingQueue = matchmakingQueue;
    this.matchManager = matchManager;
  }

  handle(session, rawData) {
    let message;
    try {
      message = JSON.parse(rawData);
    } catch {
      session.send(buildError('PARSE_ERROR', 'Invalid JSON'));
      return;
    }

    if (!message.type) {
      session.send(buildError('MISSING_TYPE', 'Message type is required'));
      return;
    }

    session.lastHeartbeat = Date.now();

    switch (message.type) {
      case ClientMessageType.JOIN_QUEUE:
        this._handleJoinQueue(session);
        break;
      case ClientMessageType.LEAVE_QUEUE:
        this._handleLeaveQueue(session);
        break;
      case ClientMessageType.SEND_INPUT:
        this._handleSendInput(session, message.payload);
        break;
      case ClientMessageType.PING:
        session.send(buildPong(message.payload?.clientTime));
        break;
      default:
        session.send(buildError('UNKNOWN_TYPE', `Unknown message type: ${message.type}`));
    }
  }

  _handleJoinQueue(session) {
    if (session.state !== PlayerState.CONNECTED) {
      session.send(buildError('INVALID_STATE', 'Cannot join queue in current state'));
      return;
    }
    this.matchmakingQueue.enqueue(session);
  }

  _handleLeaveQueue(session) {
    if (session.state !== PlayerState.IN_QUEUE) {
      session.send(buildError('INVALID_STATE', 'Player is not in queue'));
      return;
    }
    this.matchmakingQueue.dequeue(session.id);
  }

  _handleSendInput(session, payload) {
    if (session.state !== PlayerState.IN_MATCH) {
      return;
    }
    if (!payload) return;

    const input = {
      seq: payload.seq || 0,
      dirX: clamp(payload.dirX || 0, -1, 1),
      dirY: clamp(payload.dirY || 0, -1, 1),
      timestamp: Date.now(),
    };

    const match = this.matchManager.getMatch(session.matchId);
    if (match) {
      match.handlePlayerInput(session.id, input);
    }
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

module.exports = { MessageHandler };
