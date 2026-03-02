/**
 * Yeelight Device Handling.
 */

import { EventEmitter } from "node:events";
import net from "node:net";

export interface DeviceInfo {
  location: string;
  id: string;
  model: string;
  support: string;
  power: boolean;
  bright: number;
  color_mode: number;
  ct: number;
  rgb: string;
  hue: number;
  sat: number;
  host: string;
  port: number;
  debug: boolean;
  trackedAttributes: string[];
  fw_ver: string;
  name: string;
}

export const EMPTY_DEVICEINFO: DeviceInfo = {
  location: "",
  id: "",
  model: "string",
  support: "string",
  power: false,
  bright: 0,
  color_mode: -1,
  ct: 0,
  rgb: "string",
  hue: 0,
  sat: 0,
  host: "string",
  port: 0,
  debug: false,
  trackedAttributes: [],
  fw_ver: "0.0.0",
  name: "string"
};

export interface Command {
  id: number;
  method: string;
  params: Array<number | string | boolean>;
}

/**
 * Handles the connection to a concrete Yee light.
 */
export class Device extends EventEmitter {
  info: DeviceInfo;
  debug: boolean;
  connected: boolean;
  forceDisconnect: boolean;
  retryTimer?: NodeJS.Timeout;
  socket?: net.Socket;
  rest = "";
  private lastSocketError?: NodeJS.ErrnoException;
  constructor(info: DeviceInfo) {
    super();
    this.info = info;
    this.debug = this.info.debug || false;
    this.connected = false;
    this.forceDisconnect = false;
  }

  reconnect() {
    this.connect();
  }

  connect() {
    try {
      this.forceDisconnect = false;
      if (this.socket && !this.socket.destroyed && this.socket.readyState !== "closed") {
        return;
      }
      if (this.socket && !this.socket.destroyed) {
        this.socket.removeAllListeners();
        this.socket.destroy();
      }
      const socket = new net.Socket({ allowHalfOpen: false });
      this.socket = socket;
      this.bindSocket(socket);
      socket.connect({ host: this.info.host, port: this.info.port }, () => {
        if (this.socket !== socket) {
          return;
        }
        this.didConnect();
        this.emit("connected");
      });
    } catch (error: any) {
      this.socketClosed(error, this.socket);
    }
  }

  disconnect(forceDisconnect = true) {
    this.forceDisconnect = forceDisconnect;
    this.connected = false;
    this.socket?.destroy();
    delete this.socket;
    this.emit("disconnected");
    if (this.forceDisconnect && this.retryTimer) {
      clearTimeout(this.retryTimer);
      delete this.retryTimer;
    }
  }

  bindSocket(socket: net.Socket) {
    socket.on("data", (data) => {
      this.didReceiveResponse(data);
    });

    socket.on("error", (error: NodeJS.ErrnoException) => {
      if (this.socket !== socket) {
        return;
      }
      this.lastSocketError = error;
      this.emit("socketError", error);
      this.emit("deviceError", error);
    });

    socket.on("end", () => {
      if (this.socket !== socket) {
        return;
      }
      this.emit("socketEnd");
    });

    socket.on("close", () => {
      if (this.socket !== socket) {
        return;
      }
      this.emit("socketClose");
      const error = this.lastSocketError;
      this.lastSocketError = undefined;
      this.socketClosed(error, socket);
    });
  }

  socketClosed(error?: Error, socket?: net.Socket) {
    if (this.forceDisconnect) {
      return;
    }
    if (socket && this.socket !== socket) {
      return;
    }

    if (error) {
      if (error.message.includes("EHOSTUNREACH")) {
        // unreachable, no need to retry
        this.disconnect(true);
      } else {
        console.log(`Socket Closed with error "${error.name}, retrying to connect in 5s"`, error.message);
        this.disconnect(false);
        if (this.retryTimer) {
          clearTimeout(this.retryTimer);
          delete this.retryTimer;
        }
        this.retryTimer = setTimeout(this.connect.bind(this), 5000);
      }
    } else {
      this.disconnect(false);
      if (this.retryTimer) {
        clearTimeout(this.retryTimer);
        delete this.retryTimer;
      }
      this.retryTimer = setTimeout(this.connect.bind(this), 5000);
    }
  }

  didConnect() {
    this.connected = true;
  }

  didReceiveResponse(data) {
    const combined = this.rest + data.toString("utf8");
    const dataArray = combined.split("\r\n");
    this.rest = dataArray.pop() || "";
    for (const dataString of dataArray) {
      if (dataString.length === 0) {
        continue;
      }
      try {
        const response = JSON.parse(dataString);
        if (response.id) {
          this.emit("deviceUpdate", response);
        } else {
          // invalid message (disabled logging since this seems to happen regularly for some lights)
        }
      } catch (error) {
        console.error(error, dataString);
      }
    }
  }

  sendCommand(data) {
    const cmd = JSON.stringify(data);
    if (this.connected && this.socket) {
      try {
        this.socket.write(cmd + "\r\n");
      } catch (error: any) {
        this.socketClosed(error, this.socket);
      }
    }
  }

  updateDevice(device) {
    this.info = device;
  }
}
