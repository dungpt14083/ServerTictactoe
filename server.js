const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;

const wss = new WebSocket.Server({ port: PORT });

const rooms = new Map();
let roomCounter = 0;
let connectionCounter = 0;

// ── Logging ───────────────────────────────────────────────────────────────────
function log(level, ...args) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${level.toUpperCase()}]`, ...args);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sendTo(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function broadcast(room, message) {
  const data = JSON.stringify(message);
  for (const player of room.players) {
    if (player && player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(data);
    }
  }
}

// ── Centralized Matchmaking Queue ─────────────────────────────────────────────
const matchmakingQueue = (() => {
  const queue = [];

  function enqueue(player) {
    if (queue.includes(player)) return false;
    queue.push(player);
    player.status = "in_queue";
    player.queueJoinedAt = Date.now();
    log("info", `conn#${player.connId} joined matchmaking queue (queue=${queue.length})`);
    return true;
  }

  function remove(player) {
    const idx = queue.indexOf(player);
    if (idx === -1) return false;
    queue.splice(idx, 1);
    player.status = "idle";
    delete player.queueJoinedAt;
    log("info", `conn#${player.connId} removed from matchmaking queue (queue=${queue.length})`);
    return true;
  }

  function tryMatch() {
    if (queue.length < 2) return null;
    const p1 = queue.shift();
    const p2 = queue.shift();
    p1.status = "in_game";
    p2.status = "in_game";
    return [p1, p2];
  }

  function broadcastPositions() {
    queue.forEach((player, idx) => {
      sendTo(player.ws, {
        type: "queue_update",
        payload: { position: idx + 1, queueSize: queue.length },
      });
    });
  }

  function size() { return queue.length; }
  function indexOf(player) { return queue.indexOf(player) + 1; } // 1-indexed

  return { enqueue, remove, tryMatch, broadcastPositions, size, indexOf };
})();

// ── Room management ───────────────────────────────────────────────────────────
function generateRoomId() {
  return `room_${++roomCounter}_${Date.now()}`;
}

function createRoom(player1, player2) {
  const roomId = generateRoomId();
  const room = {
    id: roomId,
    players: [player1, player2],
    board: Array(9).fill(0),
    currentTurn: 0,
    status: "playing",
    moveCount: 0,
  };
  rooms.set(roomId, room);
  player1.roomId = roomId;
  player1.playerIndex = 0;
  player2.roomId = roomId;
  player2.playerIndex = 1;
  log("info", `[${roomId}] Room created: conn#${player1.connId} (P0) vs conn#${player2.connId} (P1)`);
  return room;
}

function closeRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const player of room.players) {
    if (player) {
      player.roomId = null;
      player.playerIndex = null;
      player.status = "idle";
    }
  }
  rooms.delete(roomId);
}

// ── Game logic ────────────────────────────────────────────────────────────────
function checkWinner(board) {
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
  ];
  for (const [a, b, c] of lines) {
    if (board[a] !== 0 && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }
  return 0;
}

function buildStatePayload(room, event, extra = {}) {
  return {
    type: "game_state",
    payload: {
      event,
      board: room.board,
      currentTurn: room.currentTurn,
      status: room.status,
      ...extra,
    },
  };
}

// ── Message handlers ──────────────────────────────────────────────────────────
function handleJoinQueue(player) {
  if (player.status === "in_game") {
    sendTo(player.ws, { type: "error", payload: { message: "Already in a game." } });
    return;
  }
  if (player.status === "in_queue") {
    sendTo(player.ws, { type: "error", payload: { message: "Already in matchmaking queue." } });
    return;
  }

  matchmakingQueue.enqueue(player);
  sendTo(player.ws, {
    type: "queue_joined",
    payload: { position: matchmakingQueue.indexOf(player), queueSize: matchmakingQueue.size() },
  });

  const match = matchmakingQueue.tryMatch();
  if (match) {
    const [p1, p2] = match;
    const room = createRoom(p1, p2);
    log("info", `[${room.id}] Match found — conn#${p1.connId} (P0) vs conn#${p2.connId} (P1)`);

    sendTo(p1.ws, { type: "match_found", payload: { roomId: room.id } });
    sendTo(p2.ws, { type: "match_found", payload: { roomId: room.id } });

    const stateMsg = buildStatePayload(room, "game_start");
    sendTo(p1.ws, { ...stateMsg, payload: { ...stateMsg.payload, playerIndex: 0 } });
    sendTo(p2.ws, { ...stateMsg, payload: { ...stateMsg.payload, playerIndex: 1 } });
  } else {
    matchmakingQueue.broadcastPositions();
  }
}

function handleCancelQueue(player) {
  const removed = matchmakingQueue.remove(player);
  if (!removed) {
    sendTo(player.ws, { type: "error", payload: { message: "Not in matchmaking queue." } });
    return;
  }
  sendTo(player.ws, { type: "queue_cancelled", payload: { message: "Left matchmaking queue." } });
  matchmakingQueue.broadcastPositions();
}

function handleMove(player, payload) {
  const room = rooms.get(player.roomId);
  if (!room) return;
  if (room.status !== "playing") {
    sendTo(player.ws, { type: "error", payload: { message: "Game is not active." } });
    return;
  }
  if (room.currentTurn !== player.playerIndex) {
    sendTo(player.ws, { type: "error", payload: { message: "Not your turn." } });
    return;
  }
  const { cellIndex } = payload;
  if (typeof cellIndex !== "number" || cellIndex < 0 || cellIndex > 8) {
    sendTo(player.ws, { type: "error", payload: { message: "Invalid cell index." } });
    return;
  }
  if (room.board[cellIndex] !== 0) {
    sendTo(player.ws, { type: "error", payload: { message: "Cell already occupied." } });
    return;
  }
  room.board[cellIndex] = player.playerIndex + 1;
  room.moveCount++;
  log("info", `[${room.id}] Move by P${player.playerIndex} (conn#${player.connId}) at cell ${cellIndex} (move #${room.moveCount})`);

  const winner = checkWinner(room.board);
  if (winner !== 0) {
    room.status = "finished";
    log("info", `[${room.id}] Game over — Winner: P${winner - 1}`);
    broadcast(room, buildStatePayload(room, "game_over", { winner: winner - 1 }));
    closeRoom(room.id);
    return;
  }
  if (room.moveCount === 9) {
    room.status = "finished";
    log("info", `[${room.id}] Game over — Draw`);
    broadcast(room, buildStatePayload(room, "game_over", { winner: -1 }));
    closeRoom(room.id);
    return;
  }
  room.currentTurn = 1 - room.currentTurn;
  broadcast(room, buildStatePayload(room, "move_made"));
}

function handleRematch(player) {
  const room = rooms.get(player.roomId);
  if (!room) return;
  if (!room.rematchVotes) room.rematchVotes = new Set();
  room.rematchVotes.add(player.playerIndex);
  if (room.rematchVotes.size === 2) {
    room.board = Array(9).fill(0);
    room.currentTurn = 0;
    room.status = "playing";
    room.moveCount = 0;
    room.rematchVotes = new Set();
    log("info", `[${room.id}] Rematch started`);
    const stateMsg = buildStatePayload(room, "game_start");
    sendTo(room.players[0].ws, { ...stateMsg, payload: { ...stateMsg.payload, playerIndex: 0 } });
    sendTo(room.players[1].ws, { ...stateMsg, payload: { ...stateMsg.payload, playerIndex: 1 } });
  } else {
    log("info", `[${room.id}] Rematch requested by conn#${player.connId} (${room.rematchVotes.size}/2 votes)`);
    const opponent = room.players.find((p) => p && p !== player);
    if (opponent) sendTo(opponent.ws, { type: "rematch_requested", payload: {} });
  }
}

function handleDisconnect(player) {
  log("info", `Disconnected: conn#${player.connId} | status=${player.status} | roomId=${player.roomId ?? "none"}`);
  if (player.status === "in_queue") {
    matchmakingQueue.remove(player);
    matchmakingQueue.broadcastPositions();
    return;
  }
  if (!player.roomId) return;
  const room = rooms.get(player.roomId);
  if (!room) return;
  room.status = "abandoned";
  log("info", `[${room.id}] Abandoned — conn#${player.connId} left mid-game`);
  const opponent = room.players.find((p) => p && p !== player);
  if (opponent && opponent.ws.readyState === WebSocket.OPEN) {
    sendTo(opponent.ws, {
      type: "game_state",
      payload: {
        event: "opponent_disconnected",
        board: room.board,
        currentTurn: room.currentTurn,
        status: "abandoned",
      },
    });
  }
  closeRoom(room.id);
}

// ── WebSocket server ──────────────────────────────────────────────────────────
wss.on("connection", (ws) => {
  const connId = ++connectionCounter;
  const player = { ws, connId, roomId: null, playerIndex: null, status: "idle" };
  log("info", `New connection: conn#${connId} | rooms=${rooms.size} | queue=${matchmakingQueue.size()}`);

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      log("warn", `conn#${connId} sent invalid JSON`);
      sendTo(ws, { type: "error", payload: { message: "Invalid JSON." } });
      return;
    }
    const { type, payload } = msg;
    switch (type) {
      case "join_queue":      handleJoinQueue(player); break;
      case "cancel_queue":    handleCancelQueue(player); break;
      case "make_move":       handleMove(player, payload || {}); break;
      case "rematch_request": handleRematch(player); break;
      default:
        log("warn", `conn#${connId} sent unknown type: ${type}`);
        sendTo(ws, { type: "error", payload: { message: `Unknown message type: ${type}` } });
    }
  });

  ws.on("close", () => handleDisconnect(player));
  ws.on("error", () => handleDisconnect(player));
});

log("info", `TicTacToe WebSocket server running on ws://localhost:${PORT}`);
