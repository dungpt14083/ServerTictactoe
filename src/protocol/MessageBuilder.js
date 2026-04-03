const { ServerMessageType } = require('./MessageTypes');

function buildQueueJoined(position) {
  return { type: ServerMessageType.QUEUE_JOINED, payload: { position } };
}

function buildQueueLeft() {
  return { type: ServerMessageType.QUEUE_LEFT, payload: {} };
}

function buildMatchFound(matchId, playerId, playerCount, botCount) {
  return {
    type: ServerMessageType.MATCH_FOUND,
    payload: { matchId, playerId, playerCount, botCount },
  };
}

function buildGameStart(matchId, entities, tickRate, mapConfig) {
  return {
    type: ServerMessageType.GAME_START,
    payload: { matchId, entities, tickRate, mapConfig },
  };
}

function buildStateUpdate(tick, timestamp, entities, events) {
  return {
    type: ServerMessageType.STATE_UPDATE,
    payload: { tick, timestamp, entities, events },
  };
}

function buildGameEnd(matchId, results, reason) {
  return {
    type: ServerMessageType.GAME_END,
    payload: { matchId, results, reason },
  };
}

function buildError(code, message) {
  return { type: ServerMessageType.ERROR, payload: { code, message } };
}

function buildPong(clientTime) {
  return { type: ServerMessageType.PONG, payload: { clientTime, serverTime: Date.now() } };
}

module.exports = {
  buildQueueJoined,
  buildQueueLeft,
  buildMatchFound,
  buildGameStart,
  buildStateUpdate,
  buildGameEnd,
  buildError,
  buildPong,
};
