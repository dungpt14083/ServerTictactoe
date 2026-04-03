const BOT_NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'];
const DIRECTION_CHANGE_INTERVAL_MS = 2000;
const BOT_WANDER_SPEED = 0.7;

class BotController {
  constructor(entityId) {
    this.entityId = entityId;
    this.name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
    this.dirX = (Math.random() * 2 - 1);
    this.dirY = (Math.random() * 2 - 1);
    this.lastDirectionChange = Date.now();
    this.targetEntityId = null;
  }

  update(entity, allEntities, deltaTime) {
    const now = Date.now();

    if (now - this.lastDirectionChange > DIRECTION_CHANGE_INTERVAL_MS) {
      this._chooseNewDirection(entity, allEntities);
      this.lastDirectionChange = now;
    }

    entity.applyInput(this.dirX * BOT_WANDER_SPEED, this.dirY * BOT_WANDER_SPEED, deltaTime);
  }

  _chooseNewDirection(entity, allEntities) {
    const nearEdgeX = Math.abs(entity.x) > 40;
    const nearEdgeY = Math.abs(entity.y) > 40;

    if (nearEdgeX || nearEdgeY) {
      this.dirX = nearEdgeX ? -Math.sign(entity.x) : (Math.random() * 2 - 1);
      this.dirY = nearEdgeY ? -Math.sign(entity.y) : (Math.random() * 2 - 1);
      return;
    }

    const candidates = allEntities.filter(
      (e) => e.id !== entity.id && e.alive && e.type === 'player'
    );

    if (candidates.length > 0 && Math.random() > 0.4) {
      const target = candidates[Math.floor(Math.random() * candidates.length)];
      const dx = target.x - entity.x;
      const dy = target.y - entity.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      this.dirX = len > 0 ? dx / len : 0;
      this.dirY = len > 0 ? dy / len : 0;
    } else {
      this.dirX = Math.random() * 2 - 1;
      this.dirY = Math.random() * 2 - 1;
    }
  }
}

module.exports = { BotController };
