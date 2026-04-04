const { GameServer } = require('./src/server/GameServer');

const server = new GameServer({
  port: parseInt(process.env.PORT || '8080'),
  playersPerMatch: parseInt(process.env.PLAYERS_PER_MATCH || '3'),
  queueTimeoutMs: parseInt(process.env.QUEUE_TIMEOUT_MS || '8000'),
});

server.start();

const statsInterval = setInterval(() => {
  console.log('[Stats]', JSON.stringify(server.getStats()));
}, 30000);

process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down...');
  clearInterval(statsInterval);
  server.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  clearInterval(statsInterval);
  server.stop();
  process.exit(0);
});
