const { Match } = require('../match/Match');
const { buildMatchFound } = require('../protocol/MessageBuilder');

class MatchManager {
  constructor() {
    this.matches = new Map();
  }

  createMatch(playerSessions, botsNeeded) {
    const match = new Match(playerSessions, (matchId) => {
      this.matches.delete(matchId);
    });

    const totalEntities = playerSessions.length + botsNeeded;
    let index = playerSessions.length;

    for (let i = 0; i < botsNeeded; i++) {
      match.addBot(index, totalEntities);
      index++;
    }

    this.matches.set(match.id, match);

    playerSessions.forEach((session) => {
      session.send(
        buildMatchFound(match.id, session.id, playerSessions.length, botsNeeded)
      );
    });

    match.start();

    return match;
  }

  getMatch(matchId) {
    return this.matches.get(matchId) || null;
  }

  getMatchByPlayerId(playerId) {
    for (const match of this.matches.values()) {
      if (match.players.has(playerId)) return match;
    }
    return null;
  }

  handlePlayerDisconnect(playerId) {
    const match = this.getMatchByPlayerId(playerId);
    if (match) {
      match.handlePlayerDisconnect(playerId);
    }
  }

  getStats() {
    return {
      activeMatches: this.matches.size,
      totalPlayers: Array.from(this.matches.values()).reduce(
        (sum, m) => sum + m.players.size,
        0
      ),
    };
  }
}

module.exports = { MatchManager };
