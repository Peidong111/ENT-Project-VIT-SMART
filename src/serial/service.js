const { EventEmitter } = require("node:events");
const { SerialPort } = require("serialport");

const DEFAULT_BAUD_RATE = 115200;
const MAX_LOG_ENTRIES = 1000;
const PARTIAL_FLUSH_MS = 120;
const MAX_BUFFERED_CHARS = 4096;

class SerialService extends EventEmitter {
  constructor() {
    super();
    this.port = null;
    this.readBuffer = "";
    this.partialFlushTimer = null;
    this.logs = [];
    this.logSeq = 0;
  }

  async listPorts() {
    const ports = await SerialPort.list();
    return ports.map((item) => ({
      path: item.path,
      manufacturer: item.manufacturer || "",
      serialNumber: item.serialNumber || "",
      vendorId: item.vendorId || "",
      productId: item.productId || "",
      pnpId: item.pnpId || "",
      isLikelyCh340: isLikelyCh340(item)
    }));
  }

  getStatus() {
    return {
      connected: Boolean(this.port && this.port.isOpen),
      path: this.port?.path || null,
      baudRate: this.port?.baudRate || null
    };
  }

  getLogs({ limit = 200 } = {}) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 200, MAX_LOG_ENTRIES));
    return this.logs.slice(-safeLimit);
  }

  async connect(options = {}) {
    const path = String(options.path || "").trim();
    const baudRate = Number(options.baudRate || DEFAULT_BAUD_RATE);

    if (!path) {
      throw new Error("Serial path is required.");
    }
    if (!Number.isFinite(baudRate) || baudRate <= 0) {
      throw new Error("Invalid baudRate.");
    }

    if (this.port && this.port.isOpen) {
      await this.disconnect();
    }

    const port = new SerialPort({
      path,
      baudRate,
      autoOpen: false,
      dataBits: normalizeDataBits(options.dataBits),
      stopBits: normalizeStopBits(options.stopBits),
      parity: normalizeParity(options.parity)
    });

    await new Promise((resolve, reject) => {
      port.open((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    this.port = port;
    this.readBuffer = "";

    port.on("data", (chunk) => {
      this.handleData(chunk);
    });

    port.on("error", (error) => {
      this.pushLog("error", `Serial error: ${error.message}`);
    });

    port.on("close", () => {
      this.pushLog("system", "Serial disconnected.");
    });

    this.pushLog("system", `Connected ${path} @ ${baudRate}`);
    return this.getStatus();
  }

  async disconnect() {
    if (!this.port) {
      return this.getStatus();
    }

    const port = this.port;
    this.port = null;
    this.clearPartialFlushTimer();

    if (!port.isOpen) {
      return this.getStatus();
    }

    await new Promise((resolve) => {
      port.close(() => resolve());
    });

    return this.getStatus();
  }

  async write(data, options = {}) {
    if (!this.port || !this.port.isOpen) {
      throw new Error("Serial port is not connected.");
    }

    const text = String(data || "");
    const payload = options.appendNewline ? `${text}\n` : text;

    await new Promise((resolve, reject) => {
      this.port.write(payload, (error) => {
        if (error) {
          reject(error);
          return;
        }
        this.port.drain((drainError) => {
          if (drainError) {
            reject(drainError);
            return;
          }
          resolve();
        });
      });
    });

    this.pushLog("out", payload.replace(/\n$/, ""));
    return { ok: true };
  }

  handleData(chunk) {
    const text = chunk.toString("utf8");
    this.readBuffer += text;

    let index = findLineBreakIndex(this.readBuffer);
    while (index !== -1) {
      const delimiter = this.readBuffer[index];
      const rawLine = this.readBuffer.slice(0, index);
      const line = rawLine.trim();
      if (line.length > 0) {
        this.pushLog("in", line);
      }

      let nextStart = index + 1;
      if (
        (delimiter === "\r" && this.readBuffer[nextStart] === "\n") ||
        (delimiter === "\n" && this.readBuffer[nextStart] === "\r")
      ) {
        nextStart += 1;
      }
      this.readBuffer = this.readBuffer.slice(nextStart);
      index = findLineBreakIndex(this.readBuffer);
    }

    if (this.readBuffer.length > MAX_BUFFERED_CHARS) {
      this.pushLog("in", this.readBuffer.slice(0, MAX_BUFFERED_CHARS));
      this.readBuffer = "";
      this.clearPartialFlushTimer();
      return;
    }

    this.schedulePartialFlush();
  }

  schedulePartialFlush() {
    if (!this.readBuffer.trim()) {
      this.clearPartialFlushTimer();
      return;
    }

    this.clearPartialFlushTimer();
    this.partialFlushTimer = setTimeout(() => {
      this.flushBufferedData();
    }, PARTIAL_FLUSH_MS);
    if (typeof this.partialFlushTimer.unref === "function") {
      this.partialFlushTimer.unref();
    }
  }

  flushBufferedData() {
    this.clearPartialFlushTimer();
    const line = this.readBuffer.trim();
    this.readBuffer = "";
    if (line.length > 0) {
      this.pushLog("in", line);
    }
  }

  clearPartialFlushTimer() {
    if (this.partialFlushTimer) {
      clearTimeout(this.partialFlushTimer);
      this.partialFlushTimer = null;
    }
  }

  pushLog(direction, text) {
    this.logSeq += 1;
    const entry = {
      id: this.logSeq,
      ts: new Date().toISOString(),
      direction,
      text: String(text || "")
    };

    this.logs.push(entry);
    if (this.logs.length > MAX_LOG_ENTRIES) {
      this.logs = this.logs.slice(-MAX_LOG_ENTRIES);
    }

    this.emit("log", entry);
  }
}

function findLineBreakIndex(text) {
  const crIndex = text.indexOf("\r");
  const lfIndex = text.indexOf("\n");

  if (crIndex === -1) {
    return lfIndex;
  }
  if (lfIndex === -1) {
    return crIndex;
  }
  return Math.min(crIndex, lfIndex);
}

function normalizeDataBits(value) {
  const bits = Number(value);
  return bits === 7 || bits === 8 ? bits : 8;
}

function normalizeStopBits(value) {
  const bits = Number(value);
  return bits === 2 ? 2 : 1;
}

function normalizeParity(value) {
  const parity = String(value || "none").toLowerCase();
  return ["none", "even", "odd", "mark", "space"].includes(parity) ? parity : "none";
}

function isLikelyCh340(portInfo) {
  const manufacturer = String(portInfo.manufacturer || "").toLowerCase();
  const vendorId = String(portInfo.vendorId || "").toLowerCase();
  const productId = String(portInfo.productId || "").toLowerCase();

  return (
    manufacturer.includes("wch") ||
    manufacturer.includes("ch340") ||
    (vendorId === "1a86" && (productId === "7523" || productId === "55d4"))
  );
}

module.exports = {
  SerialService,
  DEFAULT_BAUD_RATE
};
