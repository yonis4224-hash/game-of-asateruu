const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const gameLogic = require('./js/game-logic');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const roomTimers = {};

function clearTimers(code) {
  if (roomTimers[code]) {
    roomTimers[code].forEach(t => clearTimeout(t));
    roomTimers[code] = [];
  }
}

function addTimer(code, fn, ms) {
  if (!roomTimers[code]) roomTimers[code] = [];
  const t = setTimeout(() => {
    roomTimers[code] = roomTimers[code].filter(x => x !== t);
    fn();
  }, ms);
  roomTimers[code].push(t);
  return t;
}

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('createRoom', (data) => {
    const { name, avatar, mode } = data;
    const code = gameLogic.generateRoomCode();
    gameLogic.rooms[code] = gameLogic.createRoom(code, socket.id, name, avatar, mode);
    socket.join(code);
    socket.roomCode = code;
    socket.emit('roomCreated', { code, room: gameLogic.getRoomPublic(code) });
  });

  socket.on('joinRoom', (data) => {
    const { code, name, avatar } = data;
    const result = gameLogic.joinRoom(code, socket.id, name, avatar);
    if (result.error) return socket.emit('error', result.error);
    socket.join(code);
    socket.roomCode = code;
    io.to(code).emit('roomUpdated', gameLogic.getRoomPublic(code));
  });

  socket.on('switchTeam', (data) => {
    const { code, team } = data;
    const result = gameLogic.switchTeam(code, socket.id, team);
    if (result.error) return socket.emit('error', result.error);
    io.to(code).emit('roomUpdated', gameLogic.getRoomPublic(code));
  });

  socket.on('kickPlayer', (data) => {
    const { code, targetId } = data;
    const result = gameLogic.kickPlayer(code, socket.id, targetId);
    if (result.error) return socket.emit('error', result.error);
    io.to(code).emit('roomUpdated', gameLogic.getRoomPublic(code));
    if (result.kickedSocket) io.to(result.kickedSocket).emit('kicked');
  });

  socket.on('setLeader', (data) => {
    const { code, targetId } = data;
    const result = gameLogic.setLeader(code, socket.id, targetId);
    if (result.error) return socket.emit('error', result.error);
    io.to(code).emit('roomUpdated', gameLogic.getRoomPublic(code));
  });

  socket.on('startGame', (data) => {
    const { code } = data;
    const result = gameLogic.startGame(code, socket.id);
    if (result.error) return socket.emit('error', result.error);
    io.to(code).emit('gameStarted', result);
    startQuestionFlow(code);
  });

  socket.on('submitTrapAnswer', (data) => {
    const { code, answer } = data;
    const result = gameLogic.submitTrapAnswer(code, socket.id, answer);
    if (result.error) return socket.emit('error', result.error);
    io.to(code).emit('trapAnswered', { playerId: socket.id, count: result.count });
    if (result.allAnswered) {
      addTimer(code, () => {
        const options = gameLogic.buildOptions(code);
        io.to(code).emit('showOptions', options);
      }, 1000);
    }
  });

  socket.on('submitOption', (data) => {
    const { code, optionIndex } = data;
    const result = gameLogic.submitOption(code, socket.id, optionIndex);
    if (result.error) return socket.emit('error', result.error);
    io.to(code).emit('optionChosen', { playerId: socket.id, count: result.count });
    if (result.allChosen) {
      addTimer(code, () => {
        const results = gameLogic.calculateQuestionResults(code);
        io.to(code).emit('questionResults', results);
      }, 1000);
    }
  });

  socket.on('requestNextQuestion', (data) => {
    const { code } = data;
    const next = gameLogic.resetForNextQuestion(code);
    if (next.finished) {
      handleNextPhase(code);
    } else {
      startQuestionFlow(code);
    }
  });

  socket.on('submitDrawGuess', (data) => {
    const { code, guess } = data;
    const result = gameLogic.submitDrawGuess(code, socket.id, guess);
    if (result.error) return socket.emit('error', result.error);
    io.to(code).emit('drawGuessResult', result);
  });

  socket.on('endDrawRound', (data) => {
    const { code } = data;
    const result = gameLogic.endDrawRound(code);
    io.to(code).emit('drawRoundResults', result);
  });

  socket.on('submitClue', (data) => {
    const { code, word, count } = data;
    const result = gameLogic.submitClue(code, socket.id, word, count);
    if (result.error) return socket.emit('error', result.error);
    io.to(code).emit('clueSubmitted', { word, count });
  });

  socket.on('guessCodenamesWord', (data) => {
    const { code, index } = data;
    const result = gameLogic.guessCodenamesWord(code, socket.id, index);
    if (result.error) return socket.emit('error', result.error);
    io.to(code).emit('codenamesWordGuessed', result);
    if (result.gameOver) {
      io.to(code).emit('codenamesGameOver', { winner: result.winner });
    }
  });

  socket.on('endCodenamesTurn', (data) => {
    const { code } = data;
    const result = gameLogic.endCodenamesTurn(code);
    io.to(code).emit('codenamesTurnEnded', result);
  });

  socket.on('startCodenamesStandalone', (data) => {
    const { code } = data;
    const result = gameLogic.startCodenamesStandalone(code, socket.id);
    if (result.error) return socket.emit('error', result.error);
    io.to(code).emit('codenamesStarted', result);
  });

  socket.on('pickCodenamesTeam', (data) => {
    const { code, team } = data;
    const result = gameLogic.pickCodenamesTeam(code, socket.id, team);
    if (result.error) return socket.emit('error', result.error);
    io.to(code).emit('codenamesTeamPicked', gameLogic.getRoomPublic(code));
  });

  socket.on('startMafiaGame', (data) => {
    const { code } = data;
    const result = gameLogic.startMafiaGame(code, socket.id);
    if (result.error) return socket.emit('error', result.error);
    io.to(code).emit('mafiaGameStarted', result);
    sendMafiaPrivateState(code);
    startMafiaNight(code);
  });

  socket.on('updateMafiaConfig', (data) => {
    const { code, config } = data;
    gameLogic.updateMafiaConfig(code, config);
    io.to(code).emit('roomUpdated', gameLogic.getRoomPublic(code));
  });

  socket.on('mafiaKill', (data) => {
    const { code, targetId } = data;
    const result = gameLogic.mafiaKill(code, socket.id, targetId);
    if (result.error) return socket.emit('error', result.error);
    checkMafiaNightComplete(code);
  });

  socket.on('doctorSave', (data) => {
    const { code, targetId } = data;
    const result = gameLogic.doctorSave(code, socket.id, targetId);
    if (result.error) return socket.emit('error', result.error);
    checkMafiaNightComplete(code);
  });

  socket.on('policeCheck', (data) => {
    const { code, targetId } = data;
    const result = gameLogic.policeCheck(code, socket.id, targetId);
    if (result.error) return socket.emit('error', result.error);
    socket.emit('policeResult', result);
    checkMafiaNightComplete(code);
  });

  socket.on('mafiaNominate', (data) => {
    const { code, targetId } = data;
    const result = gameLogic.nominatePlayer(code, socket.id, targetId);
    if (result.error) return socket.emit('error', result.error);
    io.to(code).emit('nominationUpdate', result);
  });

  socket.on('mafiaVote', (data) => {
    const { code, targetId } = data;
    const result = gameLogic.mafiaVoteDay(code, socket.id, targetId);
    if (result.error) return socket.emit('error', result.error);
    checkMafiaDayComplete(code);
  });

  socket.on('mafiaChat', (data) => {
    const { code, message } = data;
    const result = gameLogic.addMafiaChatMessage(code, socket.id, message);
    if (result.error) return socket.emit('error', result.error);
    io.to(code).emit('mafiaChatMessage', result);
  });

  socket.on('disconnect', () => {
    const code = socket.roomCode;
    if (!code) return;
    const result = gameLogic.disconnectPlayer(code, socket.id);
    if (result.roomDeleted) {
      clearTimers(code);
      delete roomTimers[code];
      return;
    }
    io.to(code).emit('roomUpdated', gameLogic.getRoomPublic(code));
  });
});

function startQuestionFlow(code) {
  const room = gameLogic.rooms[code];
  if (!room || !room.game) return;
  const q = room.game.questions[room.game.currentQuestionIndex];
  io.to(code).emit('newQuestion', {
    question: q.s,
    category: room.game.currentCategory,
    index: room.game.currentQuestionIndex,
    total: room.game.questions.length
  });
}

function handleNextPhase(code) {
  const room = gameLogic.rooms[code];
  if (!room || !room.game) return;
  const game = room.game;

  if (room.mode === 'solo') {
    io.to(code).emit('finalResults', gameLogic.calculateFinalResults(code));
    return;
  }

  if (room.mode === 'team') {
    if (game.currentRound === 1) {
      game.currentRound = 2;
      gameLogic.startDrawRound(code);
      io.to(code).emit('drawRoundStart', gameLogic.getDrawState(code));
    } else if (game.currentRound === 2) {
      gameLogic.transitionToRound3(code);
      io.to(code).emit('round3Start', { category: game.currentCategory });
      startQuestionFlow(code);
    } else if (game.currentRound === 3) {
      game.currentRound = 4;
      io.to(code).emit('codenamesRoundStart', gameLogic.getCodenamesRoundState(code));
    } else {
      io.to(code).emit('finalResults', gameLogic.calculateFinalResults(code));
    }
  }
}

function startMafiaNight(code) {
  const room = gameLogic.rooms[code];
  if (!room || !room.game) return;
  gameLogic.startMafiaNight(code);
  sendMafiaPrivateState(code);
  io.to(code).emit('mafiaNightStart', { duration: 30 });
  addTimer(code, () => {
    gameLogic.resolveMafiaNight(code);
    sendMafiaPrivateState(code);
    const win = gameLogic.checkMafiaWin(code);
    if (win) {
      io.to(code).emit('mafiaGameOver', { winner: win });
      return;
    }
    startMafiaDay(code);
  }, 30000);
}

function startMafiaDay(code) {
  const room = gameLogic.rooms[code];
  if (!room || !room.game) return;
  gameLogic.startMafiaDay(code);
  io.to(code).emit('mafiaDayStart', { duration: 60, deaths: room.game.nightDeaths });
  addTimer(code, () => {
    startMafiaVoting(code);
  }, 60000);
}

function startMafiaVoting(code) {
  const room = gameLogic.rooms[code];
  if (!room || !room.game) return;
  gameLogic.startMafiaVoting(code);
  io.to(code).emit('mafiaVotingStart', { duration: 30 });
  addTimer(code, () => {
    const result = gameLogic.resolveDayPhase(code);
    io.to(code).emit('mafiaDayResult', result);
    const win = gameLogic.checkMafiaWin(code);
    if (win) {
      io.to(code).emit('mafiaGameOver', { winner: win });
      return;
    }
    startMafiaNight(code);
  }, 30000);
}

function checkMafiaNightComplete(code) {
  const room = gameLogic.rooms[code];
  if (!room || !room.game) return;
  if (gameLogic.isMafiaNightComplete(code)) {
    clearTimers(code);
    gameLogic.resolveMafiaNight(code);
    sendMafiaPrivateState(code);
    const win = gameLogic.checkMafiaWin(code);
    if (win) {
      io.to(code).emit('mafiaGameOver', { winner: win });
      return;
    }
    startMafiaDay(code);
  }
}

function checkMafiaDayComplete(code) {
  const room = gameLogic.rooms[code];
  if (!room || !room.game) return;
  if (gameLogic.isMafiaDayComplete(code)) {
    clearTimers(code);
    const result = gameLogic.resolveDayPhase(code);
    io.to(code).emit('mafiaDayResult', result);
    const win = gameLogic.checkMafiaWin(code);
    if (win) {
      io.to(code).emit('mafiaGameOver', { winner: win });
      return;
    }
    startMafiaNight(code);
  }
}

function sendMafiaPrivateState(code) {
  const room = gameLogic.rooms[code];
  if (!room || !room.game) return;
  room.players.forEach(p => {
    const state = gameLogic.getMafiaGameState(code, p.id);
    io.to(p.socketId).emit('mafiaStateUpdate', state);
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
