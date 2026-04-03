const { v4: uuidv4 } = require('uuid');

const EntityType = {
  PLAYER: 'player',
  BOT: 'bot',
};

const MOVE_SPEED = 5.0;
const WORLD_BOUNDS = { minX: -50, maxX: 50, minY: -50, maxY: 50 };

class Entity {
  constructor(type, ownerId, spawnX, spawnY) {
    this.id = uuidv4();
    this.type = type;
    this.ownerId = ownerId;
    this.x = spawnX;
    this.y = spawnY;
    this.vx = 0;
    this.vy = 0;
    this.alive = true;
    this.health = 100;
    this.score = 0;
    this.lastDirX = 0;
    this.lastDirY = 0;
  }

  applyInput(dirX, dirY, deltaTime) {
    const len = Math.sqrt(dirX * dirX + dirY * dirY);
    if (len > 0) {
      this.lastDirX = dirX / len;
      this.lastDirY = dirY / len;
    } else {
      this.lastDirX = 0;
      this.lastDirY = 0;
    }
    this.vx = this.lastDirX * MOVE_SPEED;
    this.vy = this.lastDirY * MOVE_SPEED;
  }

  tick(deltaTime) {
    if (!this.alive) return;
    this.x += this.vx * deltaTime;
    this.y += this.vy * deltaTime;
    this.x = Math.max(WORLD_BOUNDS.minX, Math.min(WORLD_BOUNDS.maxX, this.x));
    this.y = Math.max(WORLD_BOUNDS.minY, Math.min(WORLD_BOUNDS.maxY, this.y));
  }

  takeDamage(amount) {
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) {
      this.alive = false;
    }
  }

  serialize() {
    return {
      id: this.id,
      type: this.type,
      ownerId: this.ownerId,
      x: parseFloat(this.x.toFixed(3)),
      y: parseFloat(this.y.toFixed(3)),
      vx: parseFloat(this.vx.toFixed(3)),
      vy: parseFloat(this.vy.toFixed(3)),
      alive: this.alive,
      health: this.health,
      score: this.score,
    };
  }
}

module.exports = { Entity, EntityType, WORLD_BOUNDS };
