let WebSocketServer = require("ws").Server;
let events = require("events");
let util = require("util");
let errorCb = (rtc) => {
  return (error) => {
    if (error) {
      rtc.emit("error", error);
    }
  };
};

let UUID = () => {
  let d = Date.now();

  if (
    typeof performance !== "undefined" &&
    typeof performance.now === "function"
  ) {
    d += performance.now(); //use high-precision timer if available
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    let r = (d + Math.random() * 16) % 16 | 0;
    d = Math.floor(d / 16);

    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
};

class TRTC {
  constructor() {
    this.sockets = [];
    this.rooms = {};

    this.on("__join", (data, socket) => {
      let ids = [];
      let room = data.room || "__default";

      let curRoom = (this.rooms[room] = this.rooms[room] || []);

      for (let i = 0, m = curRoom.length; i < m; i++) {
        let curSocket = curRoom[i];

        if (curSocket.id === socket.id) {
          continue;
        }

        ids.push(curSocket.id);
        curSocket.send(
          JSON.stringify({
            eventName: "_new_peer",
            data: {
              socketId: socket.id,
            },
          }),
          errorCb
        );
      }

      curRoom.push(socket);
      socket.room = room;

      socket.send(
        JSON.stringify({
          eventName: "_peers",
          data: {
            connections: ids,
            you: socket.id,
          },
        }),
        errorCb
      );

      this.emit("new_peer", socket, room);
    });

    this.on("__ice_candidate", (data, socket) => {
      let soc = this.getSocket(data.socketId);

      if (soc) {
        soc.send(
          JSON.stringify({
            eventName: "_ice_candidate",
            data: {
              label: data.label,
              candidate: data.candidate,
              socketId: socket.id,
            },
          }),
          errorCb
        );

        this.emit("ice_candidate", socket, data);
      }
    });

    this.on("__offer", (data, socket) => {
      let soc = this.getSocket(data.socketId);

      if (soc) {
        soc.send(
          JSON.stringify({
            eventName: "_offer",
            data: {
              sdp: data.sdp,
              socketId: socket.id,
            },
          }),
          errorCb
        );
      }

      this.emit("offer", socket, data);
    });

    this.on("__answer", (data, socket) => {
      let soc = this.getSocket(data.socketId);

      if (soc) {
        soc.send(
          JSON.stringify({
            eventName: "_answer",
            data: {
              sdp: data.sdp,
              socketId: socket.id,
            },
          }),
          errorCb
        );

        this.emit("answer", socket, data);
      }
    });
  }

  addSocket(socket) {
    this.sockets.push(socket);
  }

  removeSocket(socket) {
    let i = this.sockets.indexOf(socket);
    let room = socket.room;

    this.sockets.splice(i, 1);

    if (room) {
      i = this.rooms[room].indexOf(socket);
      this.rooms[room].splice(i, 1);

      if (this.rooms[room].length === 0) {
        delete this.rooms[room];
      }
    }
  }

  broadcast(data, errorCb) {
    for (let i = this.sockets.length; i--; ) {
      this.sockets[i].send(data, errorCb);
    }
  }

  broadcastInRoom(room, data, errorCb) {
    let curRoom = this.rooms[room];

    if (curRoom) {
      for (let i = curRoom.length; i--; ) {
        curRoom[i].send(data, errorCb);
      }
    }
  }

  getRooms() {
    let room;
    let rooms = [];

    for (room in this.rooms) {
      rooms.push(room);
    }

    return rooms;
  }

  getSocket(id) {
    if (!this.sockets) {
      return;
    }
    for (let i = this.sockets.length; i--; ) {
      let curSocket = this.sockets[i];

      if (id === curSocket.id) {
        return curSocket;
      }
    }
    return;
  }

  init(socket) {
    let that = this;

    socket.id = UUID();
    that.addSocket(socket);
    // bind event handlers for new connections

    socket.on("message", (data) => {
      let json = JSON.parse(data);

      if (json.eventName) {
        that.emit(json.eventName, json.data, socket);
      } else {
        that.emit("socket_message", socket, data);
      }
    });

    // after the connection is closed, remove the link from the TRTC instance and notify other connections
    socket.on("close", () => {
      let room = socket.room;

      if (room) {
        let curRoom = that.rooms[room];

        for (let i = curRoom.length; i--; ) {
          if (curRoom[i].id === socket.id) {
            continue;
          }

          curRoom[i].send(
            JSON.stringify({
              eventName: "_remove_peer",
              data: {
                socketId: socket.id,
              },
            }),
            errorCb
          );
        }
      }

      that.removeSocket(socket);
      that.emit("remove_peer", socket.id, that);
    });

    that.emit("new_connect", socket);
  }
}

util.inherits(TRTC, events.EventEmitter);

module.exports.listen = (server) => {
  // using WebSocketServer as middleware in express.js must provide "path" !!!
  // otherwise it'll show "must specific path or it shows 'Error: RSV1 must be clear'"
  let TRTCServer;

  if (typeof server === "number") {
    TRTCServer = new WebSocketServer({
      port: server,
      path: "/",
    });
  } else {
    TRTCServer = new WebSocketServer({
      server: server,
      path: "/",
      verifyClient: (info, done) => {
        // if (err) return done(false, 403, 'Not valid token');
        done(true);
      },
    });
  }

  TRTCServer.rtc = new TRTC();

  TRTCServer.on("connection", function (socket) {
    this.rtc.init(socket);
  });

  return TRTCServer;
};