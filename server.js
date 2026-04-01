const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;

const wss = new WebSocket.Server({ port: PORT });

const waitingPlayers = [];
const rooms = new Map();
let roomCounter = 0;
let connectionCounter = 0;

function log(level, ...args) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${level.toUpperCase()}]`, ...args);
}

function generateRoomId() {
  return `room_${++roomCounter}_${Date.now()}`;
}

function createRoom(player1, player2) {
  const roomId = generateRoomId();
  log("info", `Room created: ${roomId} | Player 0 (conn#${player1.connId}) vs Player 1 (conn#${player2.connId})`);
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
  return room;
}

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

function broadcast(room, message) {
  const data = JSON.stringify(message);
  for (const player of room.players) {
    if (player && player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(data);
    }
  }
}

function sendTo(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
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
  log("info", `[${room.id}] Move by Player ${player.playerIndex} (conn#${player.connId}) at cell ${cellIndex} (move #${room.moveCount})`);

  const winner = checkWinner(room.board);
  if (winner !== 0) {
    room.status = "finished";
    log("info", `[${room.id}] Game over — Winner: Player ${winner - 1}`);
    broadcast(room, buildStatePayload(room, "game_over", { winner: winner - 1 }));
    rooms.delete(room.id);
    return;
  }
  if (room.moveCount === 9) {
    room.status = "finished";
    log("info", `[${room.id}] Game over — Draw`);
    broadcast(room, buildStatePayload(room, "game_over", { winner: -1 }));
    rooms.delete(room.id);
    return;
  }
  room.currentTurn = 1 - room.currentTurn;
  broadcast(room, buildStatePayload(room, "move_made"));
}

function handleDisconnect(player) {
  log("info", `Player disconnected: conn#${player.connId} | roomId=${player.roomId ?? "none"}`);
  const idx = waitingPlayers.indexOf(player);
  if (idx !== -1) {
    waitingPlayers.splice(idx, 1);
    log("info", `conn#${player.connId} removed from waiting queue`);
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
  rooms.delete(player.roomId);
}

wss.on("connection", (ws) => {
  const connId = ++connectionCounter;
  const player = { ws, connId, roomId: null, playerIndex: null };
  log("info", `New connection: conn#${connId} | total rooms=${rooms.size}, waiting=${waitingPlayers.length}`);

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
    if (type === "find_match") {
      if (waitingPlayers.length > 0) {
        const opponent = waitingPlayers.shift();
        const room = createRoom(opponent, player);
        log("info", `[${room.id}] Match started — conn#${opponent.connId} (P0) vs conn#${connId} (P1)`);
        const stateMsg = buildStatePayload(room, "game_start");
        sendTo(opponent.ws, {
          ...stateMsg,
          payload: { ...stateMsg.payload, playerIndex: 0 },
        });
        sendTo(player.ws, {
          ...stateMsg,
          payload: { ...stateMsg.payload, playerIndex: 1 },
        });
      } else {
        waitingPlayers.push(player);
        log("info", `conn#${connId} added to waiting queue (queue size=${waitingPlayers.length})`);
        sendTo(ws, { type: "waiting", payload: { message: "Waiting for opponent..." } });
      }
    } else if (type === "make_move") {
      handleMove(player, payload || {});
    } else if (type === "rematch_request") {
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
        broadcast(room, buildStatePayload(room, "game_start"));
      } else {
        log("info", `[${room.id}] Rematch requested by conn#${connId} (${room.rematchVotes.size}/2 votes)`);
        const opponent = room.players.find((p) => p && p !== player);
        if (opponent) {
          sendTo(opponent.ws, { type: "rematch_requested", payload: {} });
        }
      }
    }
  });

  ws.on("close", () => handleDisconnect(player));
  ws.on("error", () => handleDisconnect(player));
});

log("info", `TicTacToe WebSocket server running on ws://localhost:${PORT}`);
