console.log('=== SERVER STARTING ===');
console.log('CWD:', process.cwd());
console.log('PORT env:', process.env.PORT);
console.log('Node version:', process.version);

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

console.log('Modules loaded, creating app...');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname)));

console.log('Loading game logic...');

let gameLogic;
try {
  gameLogic = require('./js/game-logic');
} catch (e) {
  console.error('FAILED to load game logic:', e.message);
  process.exit(1);
}

console.log('Game logic loaded successfully');

function roomEmit(code, event, data) {
  io.to(code).emit(event, data);
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('createRoom', (data) => {
    try {
      const { name, avatar, mode } = data;
      const code = gameLogic.generateRoomCode();
      const room = gameLogic.createRoom(code, socket.id, name, avatar, mode);
      gameLogic.rooms[code] = room;
      socket.join(code);
      socket.emit('roomCreated', { code, room: gameLogic.getRoomPublic(code) });
    } catch (e) {
      socket.emit('error', 'فشل إنشاء الغرفة');
      console.error('createRoom error:', e.message);
    }
  });

  socket.on('joinRoom', (data) => {
    try {
      const { code, name, avatar } = data;
      const result = gameLogic.joinRoom(code, socket.id, name, avatar);
      if (result.error) {
        socket.emit('error', result.error);
        return;
      }
      socket.join(code);
      const room = gameLogic.getRoomPublic(code);
      roomEmit(code, 'roomUpdated', room);
    } catch (e) {
      socket.emit('error', 'فشل الانضمام');
      console.error('joinRoom error:', e.message);
    }
  });

  socket.on('switchTeam', (data) => {
    try {
      gameLogic.switchTeam(data.code, socket.id, data.team);
      const room = gameLogic.getRoomPublic(data.code);
      if (room) roomEmit(data.code, 'roomUpdated', room);
    } catch (e) {
      console.error('switchTeam error:', e.message);
    }
  });

  socket.on('pickCodenamesTeam', (data) => {
    try {
      gameLogic.pickCodenamesTeam(data.code, socket.id, data.team);
      const room = gameLogic.getRoomPublic(data.code);
      if (room) roomEmit(data.code, 'codenamesTeamPicked', room);
    } catch (e) {
      console.error('pickCodenamesTeam error:', e.message);
    }
  });

  socket.on('startGame', (data) => {
    try {
      const result = gameLogic.startGame(data.code, socket.id);
      if (result.error) {
        socket.emit('error', result.error);
        return;
      }
      roomEmit(data.code, 'gameStarted', {});
      const q = gameLogic.rooms[data.code].game.questions[0];
      roomEmit(data.code, 'newQuestion', {
        category: result.category,
        question: result.question,
        index: 0,
        total: gameLogic.rooms[data.code].game.questions.length
      });
    } catch (e) {
      console.error('startGame error:', e.message);
    }
  });

  socket.on('submitTrapAnswer', (data) => {
    try {
      const result = gameLogic.submitTrapAnswer(data.code, socket.id, data.answer);
      if (result.allAnswered) {
        const optionsData = gameLogic.buildOptions(data.code);
        roomEmit(data.code, 'showOptions', { options: optionsData.options });
      }
    } catch (e) {
      console.error('submitTrapAnswer error:', e.message);
    }
  });

  socket.on('submitOption', (data) => {
    try {
      const result = gameLogic.submitOption(data.code, socket.id, data.optionIndex);
      if (result.allChosen) {
        const results = gameLogic.calculateQuestionResults(data.code);
        roomEmit(data.code, 'questionResults', results);
      }
    } catch (e) {
      console.error('submitOption error:', e.message);
    }
  });

  socket.on('requestNextQuestion', (data) => {
    try {
      const result = gameLogic.resetForNextQuestion(data.code);
      if (result.finished) {
        const final = gameLogic.calculateFinalResults(data.code);
        roomEmit(data.code, 'finalResults', final);
        return;
      }
      const game = gameLogic.rooms[data.code].game;
      const q = game.questions[game.currentQuestionIndex];
      roomEmit(data.code, 'newQuestion', {
        category: result.category,
        question: q.s,
        index: game.currentQuestionIndex,
        total: game.questions.length
      });
    } catch (e) {
      console.error('requestNextQuestion error:', e.message);
    }
  });

  socket.on('startMafiaGame', (data) => {
    try {
      const result = gameLogic.startMafiaGame(data.code, socket.id);
      if (result.error) {
        socket.emit('error', result.error);
        return;
      }
      roomEmit(data.code, 'mafiaGameStarted', {});
      gameLogic.startMafiaNight(data.code);
      setTimeout(() => {
        gameLogic.isMafiaNightComplete = () => true;
        gameLogic.resolveMafiaNight(data.code);
        const room = gameLogic.rooms[data.code];
        if (room && room.game) {
          const deaths = room.game.nightDeaths || [];
          roomEmit(data.code, 'mafiaDayStart', { deaths: deaths.map(id => room.players.find(p => p.id === id)?.name).filter(Boolean), duration: 60 });
          room.game.phase = 'day';
        }
      }, 5000);
    } catch (e) {
      console.error('startMafiaGame error:', e.message);
    }
  });

  socket.on('mafiaKill', (data) => {
    try {
      const result = gameLogic.mafiaKill(data.code, socket.id, data.targetId);
      if (result && result.success && result.voted) {
        gameLogic.resolveMafiaNight(data.code);
        const room = gameLogic.rooms[data.code];
        if (room && room.game) {
          const deaths = room.game.nightDeaths || [];
          roomEmit(data.code, 'mafiaDayStart', { deaths: deaths.map(id => room.players.find(p => p.id === id)?.name).filter(Boolean), duration: 60 });
          room.game.phase = 'day';
        }
      }
    } catch (e) {
      console.error('mafiaKill error:', e.message);
    }
  });

  socket.on('doctorSave', (data) => {
    try {
      gameLogic.doctorSave(data.code, socket.id, data.targetId);
    } catch (e) {
      console.error('doctorSave error:', e.message);
    }
  });

  socket.on('policeCheck', (data) => {
    try {
      const result = gameLogic.policeCheck(data.code, socket.id, data.targetId);
      if (result) socket.emit('policeResult', result);
    } catch (e) {
      console.error('policeCheck error:', e.message);
    }
  });

  socket.on('mafiaNominate', (data) => {
    try {
      const result = gameLogic.nominatePlayer(data.code, socket.id, data.targetId);
      if (result.success) {
        roomEmit(data.code, 'mafiaDayResult', { message: `${result.nominator} رشح ${result.target}` });
      }
    } catch (e) {
      console.error('mafiaNominate error:', e.message);
    }
  });

  socket.on('mafiaVote', (data) => {
    try {
      const result = gameLogic.mafiaVoteDay(data.code, socket.id, data.targetId);
      if (result && result.allVoted) {
        const resolved = gameLogic.resolveDayPhase(data.code);
        const winner = gameLogic.checkMafiaWin(data.code);
        if (winner) {
          roomEmit(data.code, 'mafiaGameOver', { winner });
        } else {
          roomEmit(data.code, 'mafiaDayResult', { ejected: resolved.ejected, ejectedName: resolved.ejectedName });
          gameLogic.startMafiaNight(data.code);
          roomEmit(data.code, 'mafiaNightStart', { duration: 30 });
        }
      }
    } catch (e) {
      console.error('mafiaVote error:', e.message);
    }
  });

  socket.on('mafiaChat', (data) => {
    try {
      const msg = gameLogic.addMafiaChatMessage(data.code, socket.id, data.message);
      if (msg) {
        roomEmit(data.code, 'mafiaChatMessage', msg);
      }
    } catch (e) {
      console.error('mafiaChat error:', e.message);
    }
  });

  socket.on('startCodenamesStandalone', (data) => {
    try {
      const result = gameLogic.startCodenamesStandalone(data.code, socket.id);
      if (result.error) {
        socket.emit('error', result.error);
        return;
      }
      roomEmit(data.code, 'codenamesStarted', { state: gameLogic.rooms[data.code].game.codenamesState });
    } catch (e) {
      console.error('startCodenamesStandalone error:', e.message);
    }
  });

  socket.on('submitClue', (data) => {
    try {
      gameLogic.submitClue(data.code, socket.id, data.word, data.count);
      roomEmit(data.code, 'clueSubmitted', { word: data.word, count: data.count });
    } catch (e) {
      console.error('submitClue error:', e.message);
    }
  });

  socket.on('guessCodenamesWord', (data) => {
    try {
      const result = gameLogic.guessCodenamesWord(data.code, socket.id, data.index);
      roomEmit(data.code, 'codenamesWordGuessed', result);
    } catch (e) {
      console.error('guessCodenamesWord error:', e.message);
    }
  });

  socket.on('endCodenamesTurn', (data) => {
    try {
      const result = gameLogic.endCodenamesTurn(data.code);
      if (result.success) {
        roomEmit(data.code, 'codenamesTurnEnded', { currentTeam: result.currentTeam });
      }
    } catch (e) {
      console.error('endCodenamesTurn error:', e.message);
    }
  });

  socket.on('updateMafiaConfig', (data) => {
    try {
      gameLogic.updateMafiaConfig(data.code, data.config);
    } catch (e) {
      console.error('updateMafiaConfig error:', e.message);
    }
  });

  socket.on('kickPlayer', (data) => {
    try {
      const result = gameLogic.kickPlayer(data.code, socket.id, data.targetId);
      if (result.success) {
        const targetSocket = io.sockets.sockets.get(result.kickedSocket);
        if (targetSocket) {
          targetSocket.leave(data.code);
          targetSocket.emit('kicked');
        }
        const room = gameLogic.getRoomPublic(data.code);
        if (room) roomEmit(data.code, 'roomUpdated', room);
      }
    } catch (e) {
      console.error('kickPlayer error:', e.message);
    }
  });

  socket.on('disconnect', () => {
    try {
      for (const code in gameLogic.rooms) {
        if (gameLogic.rooms[code].players.some(p => p.socketId === socket.id)) {
          const result = gameLogic.disconnectPlayer(code, socket.id);
          if (result.roomDeleted) {
            delete gameLogic.rooms[code];
          } else {
            const room = gameLogic.getRoomPublic(code);
            if (room) roomEmit(code, 'roomUpdated', room);
          }
          break;
        }
      }
    } catch (e) {
      console.error('disconnect error:', e.message);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('OK port ' + PORT);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught:', err.message);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled:', err.message);
});
