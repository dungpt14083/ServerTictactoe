const ClientMessageType = {
  JOIN_QUEUE: 'join_queue',
  LEAVE_QUEUE: 'leave_queue',
  SEND_INPUT: 'send_input',
  PING: 'ping',
};

const ServerMessageType = {
  QUEUE_JOINED: 'queue_joined',
  QUEUE_LEFT: 'queue_left',
  MATCH_FOUND: 'match_found',
  GAME_START: 'game_start',
  STATE_UPDATE: 'state_update',
  GAME_END: 'game_end',
  ERROR: 'error',
  PONG: 'pong',
};

module.exports = { ClientMessageType, ServerMessageType };
