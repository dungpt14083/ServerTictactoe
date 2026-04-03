# WebSocket Game Server — Unity Client Integration Guide

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Connecting to the Server](#connecting-to-the-server)
3. [Message Protocol](#message-protocol)
4. [Match Flow](#match-flow)
5. [Sending Input](#sending-input)
6. [Receiving State Updates](#receiving-state-updates)
7. [Movement Interpolation](#movement-interpolation)
8. [Handling Disconnections](#handling-disconnections)
9. [Complete Message Reference](#complete-message-reference)
10. [Unity C# Code Examples](#unity-c-code-examples)

---

## Architecture Overview

```
Unity Client                     Game Server
─────────────────────────────────────────────────────
connect()               ──────►  ConnectionManager
send(join_queue)        ──────►  MatchmakingQueue
                                    │
                                    ▼ (group players or fill with bots)
                        ◄──────  match_found
                        ◄──────  game_start
send(send_input) x N    ──────►  Match.handlePlayerInput()
                                    │
                        ◄──────  state_update  (20 ticks/sec)
                        ◄──────  game_end
```

The server is **fully authoritative**. Your client:
- Sends raw input (direction only)
- Renders whatever the server says
- Does local interpolation for smoothness

---

## Connecting to the Server

**WebSocket URL:**
```
ws://<host>:<port>
```

The server accepts connections immediately. There is no authentication handshake — the connection itself creates a session. The server assigns each player a unique UUID that is returned in `match_found`.

**Recommended Unity library:** `NativeWebSocket` or `WebSocketSharp`

```csharp
// Example using NativeWebSocket
WebSocket ws = new WebSocket("ws://localhost:8080");
await ws.Connect();
```

---

## Message Protocol

All messages are **JSON objects** with this top-level structure:

```json
{
  "type": "<message_type>",
  "payload": { ... }
}
```

This structure is intentionally simple so it can later be replaced with a binary protocol (e.g., MessagePack, FlatBuffers) without changing game logic.

### Client → Server Messages

| type | when to send |
|---|---|
| `join_queue` | Player taps "Play" |
| `leave_queue` | Player cancels matchmaking |
| `send_input` | Every frame (30–60 Hz) |
| `ping` | Every 5 seconds for latency measurement |

### Server → Client Messages

| type | when received |
|---|---|
| `queue_joined` | Confirmed entry into matchmaking queue |
| `queue_left` | Confirmed queue exit |
| `match_found` | A match was created for this player |
| `game_start` | Match has started; includes full initial state |
| `state_update` | Game tick snapshot (20 Hz) |
| `game_end` | Match finished; includes results |
| `error` | Something went wrong |
| `pong` | Response to client ping |

---

## Match Flow

```
CLIENT                                    SERVER
  │                                          │
  │──── connect() ──────────────────────────►│
  │                                          │  session created
  │──── join_queue ─────────────────────────►│
  │◄─── queue_joined { position: 1 } ────────│
  │                                          │  waiting for more players
  │                                          │  (up to 8 seconds timeout)
  │◄─── match_found { matchId, playerId } ───│
  │◄─── game_start { entities, tickRate } ───│
  │                                          │
  │──── send_input (every frame) ───────────►│
  │◄─── state_update (20/sec) ───────────────│
  │◄─── state_update ────────────────────────│
  │◄─── state_update ────────────────────────│
  │                                          │
  │◄─── game_end { results } ────────────────│
  │                                          │
```

### Key transitions
- After `match_found` → show a "Match found!" UI, prepare your scene
- After `game_start` → spawn all entities at their initial positions, start your game loop
- After `game_end` → show results screen, enable "Play again" which sends `join_queue` again

---

## Sending Input

Send input **every frame** regardless of whether the direction changed. The server uses the most recent input per tick.

```json
{
  "type": "send_input",
  "payload": {
    "seq": 1042,
    "dirX": 0.707,
    "dirY": -0.707
  }
}
```

| field | type | description |
|---|---|---|
| `seq` | int | Auto-incrementing sequence number for ordering |
| `dirX` | float [-1, 1] | Horizontal movement direction |
| `dirY` | float [-1, 1] | Vertical movement direction |

**Direction conventions:**
- `dirX = 1` → move right
- `dirX = -1` → move left
- `dirY = 1` → move up
- `dirY = -1` → move down
- `{ dirX: 0, dirY: 0 }` → stop

The server normalizes the vector automatically. Diagonal movement (`0.707, 0.707`) is safe to send.

---

## Receiving State Updates

The server broadcasts a full entity snapshot every tick (~50ms at 20 Hz).

```json
{
  "type": "state_update",
  "payload": {
    "tick": 283,
    "timestamp": 1712100234567,
    "entities": [
      {
        "id": "e1a2b3c4-...",
        "type": "player",
        "ownerId": "f5e6d7c8-...",
        "x": 12.453,
        "y": -7.821,
        "vx": 3.536,
        "vy": -3.536,
        "alive": true,
        "health": 85,
        "score": 3
      },
      {
        "id": "a9b8c7d6-...",
        "type": "bot",
        "ownerId": null,
        "x": -23.1,
        "y": 14.2,
        "vx": -1.5,
        "vy": 2.0,
        "alive": true,
        "health": 100,
        "score": 0
      }
    ],
    "events": []
  }
}
```

### Entity fields

| field | type | description |
|---|---|---|
| `id` | string | Stable entity UUID (same across all ticks) |
| `type` | `"player"` or `"bot"` | Entity kind |
| `ownerId` | string or null | Player session ID for players; null for bots |
| `x`, `y` | float | World position |
| `vx`, `vy` | float | Current velocity |
| `alive` | bool | False if entity is dead |
| `health` | int | 0–100 |
| `score` | int | Current score |

**Identify your own entity:** In `match_found`, you receive your `playerId`. In `game_start` entities list, find the entity where `ownerId === playerId` — that is your character.

---

## Movement Interpolation

The server sends at 20 Hz. Your client renders at 60+ Hz. You must interpolate to avoid choppy movement.

### Recommended approach: Buffer + Lerp

Maintain a ring buffer of the last 2–3 received snapshots per entity. Render each entity at a point slightly behind the latest received snapshot (interpolation buffer of ~100ms).

```csharp
public class EntityInterpolator
{
    private struct Snapshot
    {
        public float x, y, vx, vy;
        public long serverTimestamp;
    }

    private Snapshot prev, next;
    private float interpDuration = 0.05f; // 50ms between ticks

    public void ReceiveSnapshot(float x, float y, float vx, float vy, long serverTimestamp)
    {
        prev = next;
        next = new Snapshot { x = x, y = y, vx = vx, vy = vy, serverTimestamp = serverTimestamp };
    }

    public Vector3 GetInterpolatedPosition(long renderTime)
    {
        if (next.serverTimestamp == 0) return Vector3.zero;
        
        long elapsed = renderTime - prev.serverTimestamp;
        float t = Mathf.Clamp01(elapsed / (float)(next.serverTimestamp - prev.serverTimestamp));
        
        return new Vector3(
            Mathf.Lerp(prev.x, next.x, t),
            Mathf.Lerp(prev.y, next.y, t),
            0f
        );
    }
}
```

**Render time** should be: `serverTime - 100ms` — always render slightly behind to have two frames to interpolate between.

### Dead reckoning (optional enhancement)

When a state update is late, extrapolate using velocity:
```csharp
float extrapolatedX = lastX + vx * timeSinceLastUpdate;
float extrapolatedY = lastY + vy * timeSinceLastUpdate;
```

---

## Handling Disconnections

### On unexpected disconnect
1. Show reconnect UI immediately
2. Attempt reconnect with exponential backoff (0.5s, 1s, 2s, 4s…)
3. If reconnect succeeds, send `join_queue` again (the old session is lost)

> **Note:** The server does not currently support session resumption. A reconnected player starts fresh in the queue.

### On server-initiated close
The server will close your connection if no messages are received for 30 seconds. Keep-alive with `ping` every 5 seconds.

```csharp
IEnumerator PingLoop()
{
    while (ws.State == WebSocketState.Open)
    {
        yield return new WaitForSeconds(5f);
        var ping = new { type = "ping", payload = new { clientTime = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() }};
        ws.SendText(JsonUtility.ToJson(ping));
    }
}
```

---

## Complete Message Reference

### Client → Server

#### join_queue
```json
{ "type": "join_queue" }
```

#### leave_queue
```json
{ "type": "leave_queue" }
```

#### send_input
```json
{
  "type": "send_input",
  "payload": {
    "seq": 1042,
    "dirX": 0.0,
    "dirY": -1.0
  }
}
```

#### ping
```json
{
  "type": "ping",
  "payload": { "clientTime": 1712100234000 }
}
```

---

### Server → Client

#### queue_joined
```json
{
  "type": "queue_joined",
  "payload": { "position": 1 }
}
```

#### match_found
```json
{
  "type": "match_found",
  "payload": {
    "matchId": "a1b2c3d4-e5f6-...",
    "playerId": "f5e6d7c8-a9b0-...",
    "playerCount": 3,
    "botCount": 1
  }
}
```

#### game_start
```json
{
  "type": "game_start",
  "payload": {
    "matchId": "a1b2c3d4-e5f6-...",
    "tickRate": 20,
    "mapConfig": {
      "width": 100,
      "height": 100,
      "originX": -50,
      "originY": -50
    },
    "entities": [
      {
        "id": "e1a2b3c4-...",
        "type": "player",
        "ownerId": "f5e6d7c8-...",
        "x": 20.0, "y": 0.0,
        "vx": 0.0, "vy": 0.0,
        "alive": true, "health": 100, "score": 0
      }
    ]
  }
}
```

#### state_update
```json
{
  "type": "state_update",
  "payload": {
    "tick": 283,
    "timestamp": 1712100234567,
    "entities": [ ...entity objects... ],
    "events": [
      { "type": "player_disconnected", "entityId": "abc..." }
    ]
  }
}
```

#### game_end
```json
{
  "type": "game_end",
  "payload": {
    "matchId": "a1b2c3d4-...",
    "reason": "time_up",
    "results": [
      { "entityId": "...", "type": "player", "ownerId": "...", "score": 5, "alive": true },
      { "entityId": "...", "type": "bot",    "ownerId": null,  "score": 2, "alive": false }
    ]
  }
}
```
`reason` values: `"time_up"` | `"all_disconnected"`

#### error
```json
{
  "type": "error",
  "payload": {
    "code": "INVALID_STATE",
    "message": "Cannot join queue in current state"
  }
}
```

#### pong
```json
{
  "type": "pong",
  "payload": {
    "clientTime": 1712100234000,
    "serverTime": 1712100234012
  }
}
```
RTT = `Date.now() - clientTime`. Server time offset = `serverTime - clientTime - RTT/2`.

---

## Unity C# Code Examples

### Minimal WebSocket Manager

```csharp
using System;
using System.Collections.Generic;
using UnityEngine;
using NativeWebSocket;

public class GameNetworkManager : MonoBehaviour
{
    private WebSocket ws;
    private int inputSeq = 0;

    public string myPlayerId { get; private set; }
    public string myEntityId { get; private set; }

    public event Action<string> OnMatchFound;
    public event Action<string> OnGameStart;
    public event Action<StateUpdatePayload> OnStateUpdate;
    public event Action<string> OnGameEnd;

    async void Start()
    {
        ws = new WebSocket("ws://localhost:8080");
        ws.OnMessage += OnMessage;
        ws.OnError   += e => Debug.LogError("WS Error: " + e);
        ws.OnClose   += c => Debug.Log("WS Closed: " + c);
        await ws.Connect();
    }

    void Update()
    {
#if !UNITY_WEBGL || UNITY_EDITOR
        ws.DispatchMessageQueue();
#endif
    }

    void OnMessage(byte[] bytes)
    {
        var json = System.Text.Encoding.UTF8.GetString(bytes);
        var msg = JsonUtility.FromJson<ServerMessage>(json);
        switch (msg.type)
        {
            case "match_found":
                var mf = JsonUtility.FromJson<MatchFoundPayload>(msg.rawPayload);
                myPlayerId = mf.playerId;
                OnMatchFound?.Invoke(mf.matchId);
                break;
            case "game_start":
                OnGameStart?.Invoke(json);
                break;
            case "state_update":
                var su = JsonUtility.FromJson<StateUpdatePayload>(msg.rawPayload);
                OnStateUpdate?.Invoke(su);
                break;
            case "game_end":
                OnGameEnd?.Invoke(json);
                break;
        }
    }

    public async void JoinQueue() =>
        await ws.SendText("{\"type\":\"join_queue\"}");

    public async void SendInput(float dirX, float dirY)
    {
        inputSeq++;
        var payload = $"{{\"seq\":{inputSeq},\"dirX\":{dirX:F4},\"dirY\":{dirY:F4}}}";
        await ws.SendText($"{{\"type\":\"send_input\",\"payload\":{payload}}}");
    }

    async void OnApplicationQuit() => await ws.Close();
}
```

### Input Sender (runs every FixedUpdate at 50Hz)
```csharp
public class PlayerInputSender : MonoBehaviour
{
    private GameNetworkManager net;

    void Start() => net = FindObjectOfType<GameNetworkManager>();

    void FixedUpdate()
    {
        float h = Input.GetAxisRaw("Horizontal");
        float v = Input.GetAxisRaw("Vertical");
        net.SendInput(h, v);
    }
}
```

### Entity Renderer with Interpolation
```csharp
public class RemoteEntity : MonoBehaviour
{
    private Vector3 previousPos;
    private Vector3 targetPos;
    private float lerpTime;
    private const float TickInterval = 0.05f; // 1/20 Hz

    public void ApplySnapshot(float x, float y)
    {
        previousPos = transform.position;
        targetPos = new Vector3(x, y, 0f);
        lerpTime = 0f;
    }

    void Update()
    {
        lerpTime += Time.deltaTime;
        float t = Mathf.Clamp01(lerpTime / TickInterval);
        transform.position = Vector3.Lerp(previousPos, targetPos, t);
    }
}
```

---

## Server Configuration

Environment variables for the server:

| variable | default | description |
|---|---|---|
| `PORT` | `8080` | WebSocket port |
| `PLAYERS_PER_MATCH` | `4` | Players required to start a match |
| `QUEUE_TIMEOUT_MS` | `8000` | Wait time before filling with bots |

Start the server:
```bash
npm start
# or with custom config:
PORT=9000 PLAYERS_PER_MATCH=2 QUEUE_TIMEOUT_MS=5000 npm start
```
