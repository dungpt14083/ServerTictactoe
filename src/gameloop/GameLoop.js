class GameLoop {
  constructor(tickRate, onTick, onStop) {
    this.tickRate = tickRate;
    this.tickIntervalMs = 1000 / tickRate;
    this.onTick = onTick;
    this.onStop = onStop;
    this.running = false;
    this.tick = 0;
    this.timer = null;
    this.lastTickTime = 0;
  }

  start() {
    this.running = true;
    this.lastTickTime = Date.now();
    this.timer = setInterval(() => this._step(), this.tickIntervalMs);
  }

  _step() {
    if (!this.running) return;
    const now = Date.now();
    const deltaTime = (now - this.lastTickTime) / 1000;
    this.lastTickTime = now;
    this.tick++;
    this.onTick(this.tick, deltaTime, now);
  }

  stop() {
    this.running = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.onStop) {
      this.onStop();
    }
  }
}

module.exports = { GameLoop };
