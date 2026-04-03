const { v4: uuidv4 } = require('uuid');
const { Entity, EntityType } = require('../entity/Entity');
const { BotController } = require('../bot/BotController');
const { GameLoop } = require('../gameloop/GameLoop');
const { buildGameStart, buildStateUpdate, buildGameEnd } = require('../protocol/MessageBuilder');

const TICK_RATE = 20;
const MATCH_DURATION_MS = 120000;
const SPAWN_RADIUS = 20;

const MatchState = {
  WAITING: 'waiting',
  RUNNING: 'running',
  FINISHED: 'finished',
};

function getSpawnPosition(index, total) {
  const angle = (index / total) * Math.PI * 2;
  return {
    x: Math.cos(angle) * SPAWN_RADIUS,
    y: Math.sin(angle) * SPAWN_RADIUS,
  };
}

const MAP_CONFIG = {
  width: 100,
  height: 100,
  originX: -50,
  originY: -50,
};

class Match {
  constructor(playerSessions, onMatchEnd) {
    this.id = uuidv4();
    this.state = MatchState.WAITING;
    this.players = new Map();
    this.entities = new Map();
    this.bots = new Map();
    this.events = [];
    this.onMatchEnd = onMatchEnd;
    this.startedAt = null;
    this.loop = null;

    const total = playerSessions.length;
    playerSessions.forEach((session, index) => {
      const pos = getSpawnPosition(index, total);
      const entity = new Entity(EntityType.PLAYER, session.id, pos.x, pos.y);
      this.players.set(session.id, session);
      this.entities.set(entity.id, entity);
      session.assignToMatch(this.id, entity.id);
    });
  }

  addBot(index, total) {
    const pos = getSpawnPosition(index, total);
    const entity = new Entity(EntityType.BOT, null, pos.x, pos.y);
    const bot = new BotController(entity.id);
    this.entities.set(entity.id, entity);
    this.bots.set(entity.id, bot);
    return entity;
  }

  start() {
    this.state = MatchState.RUNNING;
    this.startedAt = Date.now();

    const entityList = Array.from(this.entities.values()).map((e) => e.serialize());

    this.players.forEach((session) => {
      session.send(
        buildGameStart(this.id, entityList, TICK_RATE, MAP_CONFIG)
      );
    });

    this.loop = new GameLoop(TICK_RATE, this._tick.bind(this), null);
    this.loop.start();
  }

  _tick(tick, deltaTime, now) {
    const entityArray = Array.from(this.entities.values());

    this.bots.forEach((bot, entityId) => {
      const entity = this.entities.get(entityId);
      if (entity && entity.alive) {
        bot.update(entity, entityArray, deltaTime);
      }
    });

    this.players.forEach((session) => {
      const entity = this.entities.get(session.entityId);
      if (!entity || !entity.alive) return;
      const inputs = session.drainInputs();
      if (inputs.length > 0) {
        const latest = inputs[inputs.length - 1];
        entity.applyInput(latest.dirX || 0, latest.dirY || 0, deltaTime);
      } else {
        entity.applyInput(0, 0, deltaTime);
      }
    });

    this.entities.forEach((entity) => entity.tick(deltaTime));

    const snapshot = this._buildSnapshot(tick, now);
    this.players.forEach((session) => {
      if (session.isAlive()) {
        session.send(snapshot);
      }
    });

    this.events = [];

    if (now - this.startedAt >= MATCH_DURATION_MS) {
      this._endMatch('time_up');
    }
  }

  _buildSnapshot(tick, now) {
    const entities = Array.from(this.entities.values()).map((e) => e.serialize());
    const events = this.events.slice();
    return buildStateUpdate(tick, now, entities, events);
  }

  handlePlayerInput(playerId, input) {
    const session = this.players.get(playerId);
    if (session) {
      session.enqueueInput(input);
    }
  }

  handlePlayerDisconnect(playerId) {
    const session = this.players.get(playerId);
    if (!session) return;
    const entity = this.entities.get(session.entityId);
    if (entity) {
      entity.alive = false;
    }
    this.events.push({ type: 'player_disconnected', entityId: session.entityId });
    this.players.delete(playerId);

    if (this.players.size === 0) {
      this._endMatch('all_disconnected');
    }
  }

  _endMatch(reason) {
    if (this.state === MatchState.FINISHED) return;
    this.state = MatchState.FINISHED;

    if (this.loop) {
      this.loop.stop();
    }

    const results = this._buildResults();
    const msg = buildGameEnd(this.id, results, reason);

    this.players.forEach((session) => {
      if (session.isAlive()) {
        session.send(msg);
      }
      session.setConnected();
    });

    if (this.onMatchEnd) {
      this.onMatchEnd(this.id);
    }
  }

  _buildResults() {
    const results = [];
    this.entities.forEach((entity) => {
      results.push({
        entityId: entity.id,
        type: entity.type,
        ownerId: entity.ownerId,
        score: entity.score,
        alive: entity.alive,
      });
    });
    return results.sort((a, b) => b.score - a.score);
  }
}

module.exports = { Match, MatchState };
