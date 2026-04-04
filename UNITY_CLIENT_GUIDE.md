# Unity Client Integration Guide For WebSocket Game Server

This document is written as an implementation-first guide so the client team can integrate, test, and debug end-to-end against the current server behavior.

## 1. Scope And Goals

Current server behavior:
- Communication uses WebSocket + JSON.
- The server is fully authoritative (client only sends input, server owns the game state).
- A match starts with 3 players by default (`PLAYERS_PER_MATCH = 3`).
- If queue wait time exceeds `QUEUE_TIMEOUT_MS = 8000` ms, server fills remaining slots with bots.
- Match tick rate is 20 ticks/sec.
- Match ends after 120 seconds, or when all players disconnect.

This guide includes:
- Connection architecture.
- Full message protocol.
- Recommended client state machine.
- Matchmaking, match start, in-match, and match end flows.
- Unity C# implementation skeletons.
- Testing checklist and troubleshooting notes.

## 2. Architecture Overview

```text
Unity Client                         Game Server
-------------------------------------------------------------
Connect WebSocket        ------->    ConnectionManager
join_queue               ------->    MatchmakingQueue
                                     (3 players or timeout + bots)
match_found              <-------
game_start               <-------
send_input (30-60Hz)     ------->    Match.handlePlayerInput
state_update (20Hz)      <-------    Match + GameLoop
game_end                 <-------
```

Important principles:
- Client must not treat local simulation as source of truth.
- Client renders server snapshots.
- Client uses interpolation for smooth visuals.

## 3. Server Config The Client Must Know

- WebSocket URL: `ws://<host>:<port>`
- Default environment variables:

| Variable | Default | Meaning |
|---|---:|---|
| `PORT` | `8080` | WebSocket port |
| `PLAYERS_PER_MATCH` | `3` | Players required to start a match |
| `QUEUE_TIMEOUT_MS` | `8000` | Queue timeout before bot fill |

Matchmaking rules:
- If queue has 3 players, match is created immediately.
- If timeout occurs before 3 players, server creates match with current players plus bots to reach 3.

Examples:
- 1 player waits 8s -> enters with 2 bots.
- 2 players wait 8s -> enter with 1 bot.

## 4. Protocol Message List

All JSON messages follow:

```json
{
  "type": "<message_type>",
  "payload": {}
}
```

### 4.1 Client -> Server

| Type | Required Payload | When To Send |
|---|---|---|
| `join_queue` | No | User presses Play |
| `leave_queue` | No | User cancels matchmaking |
| `send_input` | Yes (`seq`, `dirX`, `dirY`) | Every frame / fixed tick |
| `ping` | Recommended (`clientTime`) | Every 5s for keep-alive and latency |

### 4.2 Server -> Client

| Type | Meaning |
|---|---|
| `queue_joined` | Queue join acknowledged, returns queue position |
| `queue_left` | Queue leave acknowledged |
| `match_found` | Match assigned for this player |
| `game_start` | Match started, initial state included |
| `state_update` | Tick snapshot (20Hz) |
| `game_end` | Match finished, results included |
| `error` | Protocol/state error |
| `pong` | Response to ping |

## 5. Detailed Message Schemas

## 5.1 Client -> Server

### `join_queue`

```json
{ "type": "join_queue" }
```

### `leave_queue`

```json
{ "type": "leave_queue" }
```

### `send_input`

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

Rules:
- `seq`: monotonically increasing input sequence number.
- `dirX`, `dirY`: expected range is [-1, 1].
- Server clamps values into [-1, 1].

### `ping`

```json
{
  "type": "ping",
  "payload": {
    "clientTime": 1712100234000
  }
}
```

## 5.2 Server -> Client

### `queue_joined`

```json
{
  "type": "queue_joined",
  "payload": {
    "position": 1
  }
}
```

### `queue_left`

```json
{
  "type": "queue_left",
  "payload": {}
}
```

### `match_found`

```json
{
  "type": "match_found",
  "payload": {
    "matchId": "a1b2c3d4-e5f6-...",
    "playerId": "f5e6d7c8-a9b0-...",
    "playerCount": 2,
    "botCount": 1
  }
}
```

Notes:
- `playerCount`: number of real players currently in match.
- `botCount`: bots added by server.
- Total slots: `playerCount + botCount = 3`.

### `game_start`

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
        "id": "entity-uuid",
        "type": "player",
        "ownerId": "player-session-uuid",
        "x": 20.0,
        "y": 0.0,
        "vx": 0.0,
        "vy": 0.0,
        "alive": true,
        "health": 100,
        "score": 0
      }
    ]
  }
}
```

### `state_update`

```json
{
  "type": "state_update",
  "payload": {
    "tick": 283,
    "timestamp": 1712100234567,
    "entities": [
      {
        "id": "entity-uuid",
        "type": "player",
        "ownerId": "player-session-uuid",
        "x": 12.453,
        "y": -7.821,
        "vx": 3.536,
        "vy": -3.536,
        "alive": true,
        "health": 85,
        "score": 3
      }
    ],
    "events": [
      { "type": "player_disconnected", "entityId": "entity-uuid" }
    ]
  }
}
```

### `game_end`

```json
{
  "type": "game_end",
  "payload": {
    "matchId": "a1b2c3d4-e5f6-...",
    "reason": "time_up",
    "results": [
      {
        "entityId": "entity-uuid",
        "type": "player",
        "ownerId": "player-session-uuid",
        "score": 5,
        "alive": true
      }
    ]
  }
}
```

`reason` can be:
- `time_up`
- `all_disconnected`

### `error`

```json
{
  "type": "error",
  "payload": {
    "code": "INVALID_STATE",
    "message": "Cannot join queue in current state"
  }
}
```

### `pong`

```json
{
  "type": "pong",
  "payload": {
    "clientTime": 1712100234000,
    "serverTime": 1712100234012
  }
}
```

RTT formula:
- `RTT = nowClientReceivedPong - clientTime`

## 6. Recommended Client State Machine

Use a strict state machine to prevent invalid sends:

```text
Disconnected
  -> (connect ok) Connected

Connected
  -> (send join_queue) Queueing

Queueing
  -> (queue_left) Connected
  -> (match_found) MatchFound

MatchFound
  -> (game_start) InMatch

InMatch
  -> (game_end) Connected

Any
  -> (socket close/error) Disconnected
```

Key rules:
- Send `join_queue` only when state is `Connected`.
- Send `leave_queue` only when state is `Queueing`.
- Send `send_input` only when state is `InMatch`.

If violated, server may return `error` with `INVALID_STATE`.

## 7. Integration Steps For Client Team

## Step 1: Build network layer

Create a `NetworkClient` class responsible for:
- WebSocket connect/disconnect.
- Message parsing and dispatch.
- Event callbacks for UI/gameplay.
- Send helpers (`JoinQueue`, `LeaveQueue`, `SendInput`, `Ping`).

## Step 2: Define shared DTO models

Use DTOs for robust parsing:
- `BaseMessage { type, payloadRaw }`
- `MatchFoundPayload`, `GameStartPayload`, `StateUpdatePayload`, `GameEndPayload`, etc.

Recommendation:
- Use Newtonsoft.Json in Unity for flexible payload handling.
- Avoid JsonUtility for this dynamic protocol.

## Step 3: Implement matchmaking UI

- Play button -> `JoinQueue()`
- Show queue status on `queue_joined`
- Cancel button -> `LeaveQueue()`

## Step 4: Enter match

On `match_found`:
- Save `myPlayerId` and `matchId`.
- Transition to match loading state/screen.

On `game_start`:
- Spawn all entities from payload.
- Identify local entity using:
  - `entity.ownerId == myPlayerId`
- Start input loop and rendering pipeline.

## Step 5: During match

- Send `send_input` in `FixedUpdate` (50Hz recommended).
- Consume `state_update` snapshots (20Hz).
- Interpolate for smooth render.

## Step 6: End match

On `game_end`:
- Stop input loop.
- Show result screen using `results`.
- Support "Play again" -> `JoinQueue()`.

## 8. Unity C# Reference Skeleton

The following skeleton is production-oriented and can be split into multiple files as needed.

```csharp
using System;
using System.Collections.Generic;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NativeWebSocket;
using UnityEngine;

public enum ClientNetState
{
    Disconnected,
    Connected,
    Queueing,
    MatchFound,
    InMatch
}

public class NetworkClient : MonoBehaviour
{
    [SerializeField] private string serverUrl = "ws://localhost:8080";

    private WebSocket ws;
    private int inputSeq;
    private float pingTimer;

    public ClientNetState State { get; private set; } = ClientNetState.Disconnected;
    public string MyPlayerId { get; private set; }
    public string CurrentMatchId { get; private set; }

    public event Action<int> OnQueueJoined;
    public event Action OnQueueLeft;
    public event Action<MatchFoundPayload> OnMatchFound;
    public event Action<GameStartPayload> OnGameStart;
    public event Action<StateUpdatePayload> OnStateUpdate;
    public event Action<GameEndPayload> OnGameEnd;
    public event Action<string, string> OnServerError;

    public async void Connect()
    {
        if (State != ClientNetState.Disconnected) return;

        ws = new WebSocket(serverUrl);
        ws.OnOpen += () => { State = ClientNetState.Connected; Debug.Log("WS connected"); };
        ws.OnError += (e) => Debug.LogError("WS error: " + e);
        ws.OnClose += (c) =>
        {
            Debug.Log("WS close: " + c);
            State = ClientNetState.Disconnected;
            CurrentMatchId = null;
            MyPlayerId = null;
        };
        ws.OnMessage += OnSocketMessage;

        await ws.Connect();
    }

    public async void Disconnect()
    {
        if (ws != null)
        {
            await ws.Close();
        }
        State = ClientNetState.Disconnected;
    }

    public async void JoinQueue()
    {
        if (State != ClientNetState.Connected) return;
        await SendObjAsync(new { type = "join_queue" });
        State = ClientNetState.Queueing;
    }

    public async void LeaveQueue()
    {
        if (State != ClientNetState.Queueing) return;
        await SendObjAsync(new { type = "leave_queue" });
    }

    public async void SendInput(float dirX, float dirY)
    {
        if (State != ClientNetState.InMatch) return;

        inputSeq++;
        var payload = new
        {
            seq = inputSeq,
            dirX = Mathf.Clamp(dirX, -1f, 1f),
            dirY = Mathf.Clamp(dirY, -1f, 1f)
        };

        await SendObjAsync(new
        {
            type = "send_input",
            payload
        });
    }

    private async void Update()
    {
#if !UNITY_WEBGL || UNITY_EDITOR
        ws?.DispatchMessageQueue();
#endif

        if (ws == null || State == ClientNetState.Disconnected) return;

        pingTimer += Time.deltaTime;
        if (pingTimer >= 5f)
        {
            pingTimer = 0f;
            long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            await SendObjAsync(new { type = "ping", payload = new { clientTime = now } });
        }
    }

    private async System.Threading.Tasks.Task SendObjAsync(object obj)
    {
        if (ws == null || ws.State != WebSocketState.Open) return;
        string json = JsonConvert.SerializeObject(obj);
        await ws.SendText(json);
    }

    private void OnSocketMessage(byte[] bytes)
    {
        string json = Encoding.UTF8.GetString(bytes);
        JObject root = JObject.Parse(json);
        string type = root.Value<string>("type");
        JToken payload = root["payload"];

        switch (type)
        {
            case "queue_joined":
            {
                int pos = payload?.Value<int>("position") ?? -1;
                OnQueueJoined?.Invoke(pos);
                break;
            }
            case "queue_left":
            {
                State = ClientNetState.Connected;
                OnQueueLeft?.Invoke();
                break;
            }
            case "match_found":
            {
                var mf = payload.ToObject<MatchFoundPayload>();
                CurrentMatchId = mf.matchId;
                MyPlayerId = mf.playerId;
                State = ClientNetState.MatchFound;
                OnMatchFound?.Invoke(mf);
                break;
            }
            case "game_start":
            {
                var gs = payload.ToObject<GameStartPayload>();
                State = ClientNetState.InMatch;
                OnGameStart?.Invoke(gs);
                break;
            }
            case "state_update":
            {
                var su = payload.ToObject<StateUpdatePayload>();
                OnStateUpdate?.Invoke(su);
                break;
            }
            case "game_end":
            {
                var ge = payload.ToObject<GameEndPayload>();
                State = ClientNetState.Connected;
                CurrentMatchId = null;
                OnGameEnd?.Invoke(ge);
                break;
            }
            case "error":
            {
                string code = payload?.Value<string>("code") ?? "UNKNOWN";
                string message = payload?.Value<string>("message") ?? "Unknown server error";
                OnServerError?.Invoke(code, message);
                break;
            }
            case "pong":
            {
                long clientTime = payload?.Value<long>("clientTime") ?? 0;
                long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                long rtt = Math.Max(0, now - clientTime);
                Debug.Log("RTT ms = " + rtt);
                break;
            }
        }
    }
}

[Serializable]
public class MatchFoundPayload
{
    public string matchId;
    public string playerId;
    public int playerCount;
    public int botCount;
}

[Serializable]
public class GameStartPayload
{
    public string matchId;
    public int tickRate;
    public MapConfig mapConfig;
    public List<EntitySnapshot> entities;
}

[Serializable]
public class StateUpdatePayload
{
    public int tick;
    public long timestamp;
    public List<EntitySnapshot> entities;
    public List<GameEvent> events;
}

[Serializable]
public class GameEndPayload
{
    public string matchId;
    public string reason;
    public List<GameResult> results;
}

[Serializable]
public class MapConfig
{
    public float width;
    public float height;
    public float originX;
    public float originY;
}

[Serializable]
public class EntitySnapshot
{
    public string id;
    public string type;
    public string ownerId;
    public float x;
    public float y;
    public float vx;
    public float vy;
    public bool alive;
    public int health;
    public int score;
}

[Serializable]
public class GameEvent
{
    public string type;
    public string entityId;
}

[Serializable]
public class GameResult
{
    public string entityId;
    public string type;
    public string ownerId;
    public int score;
    public bool alive;
}
```

## 9. Recommended Input Loop

Send input in `FixedUpdate`:

```csharp
public class PlayerInputSender : MonoBehaviour
{
    [SerializeField] private NetworkClient net;

    private void FixedUpdate()
    {
        if (net == null) return;
        float h = Input.GetAxisRaw("Horizontal");
        float v = Input.GetAxisRaw("Vertical");
        net.SendInput(h, v);
    }
}
```

Notes:
- Send continuously, including zero input, so server always has latest intent.
- Optional local deadzone can reduce joystick noise.

## 10. Render Interpolation

Server sends at 20Hz while client renders at 60Hz+, so interpolation is required.

Recommendation:
- Keep at least 2 snapshots per entity.
- Render about 100ms behind server time.

```csharp
using System;
using UnityEngine;

public class EntityInterpolator : MonoBehaviour
{
    private Vector3 prevPos;
    private Vector3 nextPos;
    private long prevTs;
    private long nextTs;

    public void PushSnapshot(float x, float y, long ts)
    {
        prevPos = nextPos;
        prevTs = nextTs;
        nextPos = new Vector3(x, y, 0f);
        nextTs = ts;

        if (prevTs == 0)
        {
            prevPos = nextPos;
            prevTs = nextTs;
        }
    }

    private void Update()
    {
        if (nextTs <= prevTs) return;

        long renderTs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - 100;
        float t = Mathf.InverseLerp(prevTs, nextTs, renderTs);
        t = Mathf.Clamp01(t);
        transform.position = Vector3.Lerp(prevPos, nextPos, t);
    }
}
```

## 11. Disconnect, Reconnect, And Keep-Alive

Server heartbeat timeout is 30 seconds if no message is received.

Client should:
- Send `ping` every 5 seconds.
- Show "Reconnecting..." on unexpected close.
- Retry with exponential backoff: 0.5s -> 1s -> 2s -> 4s -> max 8s.
- After reconnect, user should join queue again (old session is not resumed).

## 12. Possible Error Codes

| Code | Common Cause | Client Action |
|---|---|---|
| `PARSE_ERROR` | Invalid JSON | Validate serializer and payload |
| `MISSING_TYPE` | Missing `type` field | Fix message envelope |
| `UNKNOWN_TYPE` | Unsupported message type | Sync type constants |
| `INVALID_STATE` | Message sent in wrong state | Fix state machine guards |

## 13. QA And Dev Validation Checklist

Matchmaking:
- Connection succeeds.
- Play sends `join_queue` and receives `queue_joined`.
- 3 players start immediately (`match_found` + `game_start`).
- 1 or 2 players still enter after 8s with bot fill.

In-match:
- Input sends continuously.
- `state_update` arrives around 20Hz.
- Local/remote movement direction matches expected behavior.
- Health/score UI follows snapshot values.

End-match:
- Around 120s receives `game_end` with reason `time_up`.
- Result board shows sorted outcomes correctly.
- Play again can re-enter queue.

Network robustness:
- Forced disconnect leads to disconnected state.
- Reconnect works and allows queue re-entry.
- Ping/pong RTT logs are reasonable.

## 14. Suggested Unity Script Structure

For maintainability, split responsibilities:
- `NetworkClient`: transport + protocol.
- `MatchFlowController`: UI/scene transitions.
- `EntityRegistry`: `entityId -> GameObject` lookup.
- `EntityView`: snapshot apply + interpolation.
- `InputSender`: local input sampling and send.

## 15. Production Notes

- Add telemetry for connect time, queue wait, RTT median, and packet anomalies.
- Consider input send rate limiting on battery-sensitive platforms.
- Keep protocol constants in one shared source to prevent typos.
- Prepare binary protocol migration path if bandwidth optimization is needed.

---

Optional next protocol improvement: include a protocol version field so server/client rollouts remain backward-compatible.
