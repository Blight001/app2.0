(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // node_modules/engine.io-parser/build/esm/commons.js
  var PACKET_TYPES = /* @__PURE__ */ Object.create(null);
  PACKET_TYPES["open"] = "0";
  PACKET_TYPES["close"] = "1";
  PACKET_TYPES["ping"] = "2";
  PACKET_TYPES["pong"] = "3";
  PACKET_TYPES["message"] = "4";
  PACKET_TYPES["upgrade"] = "5";
  PACKET_TYPES["noop"] = "6";
  var PACKET_TYPES_REVERSE = /* @__PURE__ */ Object.create(null);
  Object.keys(PACKET_TYPES).forEach((key) => {
    PACKET_TYPES_REVERSE[PACKET_TYPES[key]] = key;
  });
  var ERROR_PACKET = { type: "error", data: "parser error" };

  // node_modules/engine.io-parser/build/esm/encodePacket.browser.js
  var withNativeBlob = typeof Blob === "function" || typeof Blob !== "undefined" && Object.prototype.toString.call(Blob) === "[object BlobConstructor]";
  var withNativeArrayBuffer = typeof ArrayBuffer === "function";
  var isView = (obj) => {
    return typeof ArrayBuffer.isView === "function" ? ArrayBuffer.isView(obj) : obj && obj.buffer instanceof ArrayBuffer;
  };
  var encodePacket = ({ type, data }, supportsBinary, callback) => {
    if (withNativeBlob && data instanceof Blob) {
      if (supportsBinary) {
        return callback(data);
      } else {
        return encodeBlobAsBase64(data, callback);
      }
    } else if (withNativeArrayBuffer && (data instanceof ArrayBuffer || isView(data))) {
      if (supportsBinary) {
        return callback(data);
      } else {
        return encodeBlobAsBase64(new Blob([data]), callback);
      }
    }
    return callback(PACKET_TYPES[type] + (data || ""));
  };
  var encodeBlobAsBase64 = (data, callback) => {
    const fileReader = new FileReader();
    fileReader.onload = function() {
      const content = fileReader.result.split(",")[1];
      callback("b" + (content || ""));
    };
    return fileReader.readAsDataURL(data);
  };
  function toArray(data) {
    if (data instanceof Uint8Array) {
      return data;
    } else if (data instanceof ArrayBuffer) {
      return new Uint8Array(data);
    } else {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
  }
  var TEXT_ENCODER;
  function encodePacketToBinary(packet, callback) {
    if (withNativeBlob && packet.data instanceof Blob) {
      return packet.data.arrayBuffer().then(toArray).then(callback);
    } else if (withNativeArrayBuffer && (packet.data instanceof ArrayBuffer || isView(packet.data))) {
      return callback(toArray(packet.data));
    }
    encodePacket(packet, false, (encoded) => {
      if (!TEXT_ENCODER) {
        TEXT_ENCODER = new TextEncoder();
      }
      callback(TEXT_ENCODER.encode(encoded));
    });
  }

  // node_modules/engine.io-parser/build/esm/contrib/base64-arraybuffer.js
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var lookup = typeof Uint8Array === "undefined" ? [] : new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) {
    lookup[chars.charCodeAt(i)] = i;
  }
  var decode = (base64) => {
    let bufferLength = base64.length * 0.75, len = base64.length, i, p = 0, encoded1, encoded2, encoded3, encoded4;
    if (base64[base64.length - 1] === "=") {
      bufferLength--;
      if (base64[base64.length - 2] === "=") {
        bufferLength--;
      }
    }
    const arraybuffer = new ArrayBuffer(bufferLength), bytes = new Uint8Array(arraybuffer);
    for (i = 0; i < len; i += 4) {
      encoded1 = lookup[base64.charCodeAt(i)];
      encoded2 = lookup[base64.charCodeAt(i + 1)];
      encoded3 = lookup[base64.charCodeAt(i + 2)];
      encoded4 = lookup[base64.charCodeAt(i + 3)];
      bytes[p++] = encoded1 << 2 | encoded2 >> 4;
      bytes[p++] = (encoded2 & 15) << 4 | encoded3 >> 2;
      bytes[p++] = (encoded3 & 3) << 6 | encoded4 & 63;
    }
    return arraybuffer;
  };

  // node_modules/engine.io-parser/build/esm/decodePacket.browser.js
  var withNativeArrayBuffer2 = typeof ArrayBuffer === "function";
  var decodePacket = (encodedPacket, binaryType) => {
    if (typeof encodedPacket !== "string") {
      return {
        type: "message",
        data: mapBinary(encodedPacket, binaryType)
      };
    }
    const type = encodedPacket.charAt(0);
    if (type === "b") {
      return {
        type: "message",
        data: decodeBase64Packet(encodedPacket.substring(1), binaryType)
      };
    }
    const packetType = PACKET_TYPES_REVERSE[type];
    if (!packetType) {
      return ERROR_PACKET;
    }
    return encodedPacket.length > 1 ? {
      type: PACKET_TYPES_REVERSE[type],
      data: encodedPacket.substring(1)
    } : {
      type: PACKET_TYPES_REVERSE[type]
    };
  };
  var decodeBase64Packet = (data, binaryType) => {
    if (withNativeArrayBuffer2) {
      const decoded = decode(data);
      return mapBinary(decoded, binaryType);
    } else {
      return { base64: true, data };
    }
  };
  var mapBinary = (data, binaryType) => {
    switch (binaryType) {
      case "blob":
        if (data instanceof Blob) {
          return data;
        } else {
          return new Blob([data]);
        }
      case "arraybuffer":
      default:
        if (data instanceof ArrayBuffer) {
          return data;
        } else {
          return data.buffer;
        }
    }
  };

  // node_modules/engine.io-parser/build/esm/index.js
  var SEPARATOR = String.fromCharCode(30);
  var encodePayload = (packets, callback) => {
    const length = packets.length;
    const encodedPackets = new Array(length);
    let count = 0;
    packets.forEach((packet, i) => {
      encodePacket(packet, false, (encodedPacket) => {
        encodedPackets[i] = encodedPacket;
        if (++count === length) {
          callback(encodedPackets.join(SEPARATOR));
        }
      });
    });
  };
  var decodePayload = (encodedPayload, binaryType) => {
    const encodedPackets = encodedPayload.split(SEPARATOR);
    const packets = [];
    for (let i = 0; i < encodedPackets.length; i++) {
      const decodedPacket = decodePacket(encodedPackets[i], binaryType);
      packets.push(decodedPacket);
      if (decodedPacket.type === "error") {
        break;
      }
    }
    return packets;
  };
  function createPacketEncoderStream() {
    return new TransformStream({
      transform(packet, controller) {
        encodePacketToBinary(packet, (encodedPacket) => {
          const payloadLength = encodedPacket.length;
          let header;
          if (payloadLength < 126) {
            header = new Uint8Array(1);
            new DataView(header.buffer).setUint8(0, payloadLength);
          } else if (payloadLength < 65536) {
            header = new Uint8Array(3);
            const view = new DataView(header.buffer);
            view.setUint8(0, 126);
            view.setUint16(1, payloadLength);
          } else {
            header = new Uint8Array(9);
            const view = new DataView(header.buffer);
            view.setUint8(0, 127);
            view.setBigUint64(1, BigInt(payloadLength));
          }
          if (packet.data && typeof packet.data !== "string") {
            header[0] |= 128;
          }
          controller.enqueue(header);
          controller.enqueue(encodedPacket);
        });
      }
    });
  }
  var TEXT_DECODER;
  function totalLength(chunks) {
    return chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  }
  function concatChunks(chunks, size) {
    if (chunks[0].length === size) {
      return chunks.shift();
    }
    const buffer = new Uint8Array(size);
    let j = 0;
    for (let i = 0; i < size; i++) {
      buffer[i] = chunks[0][j++];
      if (j === chunks[0].length) {
        chunks.shift();
        j = 0;
      }
    }
    if (chunks.length && j < chunks[0].length) {
      chunks[0] = chunks[0].slice(j);
    }
    return buffer;
  }
  function createPacketDecoderStream(maxPayload, binaryType) {
    if (!TEXT_DECODER) {
      TEXT_DECODER = new TextDecoder();
    }
    const chunks = [];
    let state = 0;
    let expectedLength = -1;
    let isBinary2 = false;
    return new TransformStream({
      transform(chunk, controller) {
        chunks.push(chunk);
        while (true) {
          if (state === 0) {
            if (totalLength(chunks) < 1) {
              break;
            }
            const header = concatChunks(chunks, 1);
            isBinary2 = (header[0] & 128) === 128;
            expectedLength = header[0] & 127;
            if (expectedLength < 126) {
              state = 3;
            } else if (expectedLength === 126) {
              state = 1;
            } else {
              state = 2;
            }
          } else if (state === 1) {
            if (totalLength(chunks) < 2) {
              break;
            }
            const headerArray = concatChunks(chunks, 2);
            expectedLength = new DataView(headerArray.buffer, headerArray.byteOffset, headerArray.length).getUint16(0);
            state = 3;
          } else if (state === 2) {
            if (totalLength(chunks) < 8) {
              break;
            }
            const headerArray = concatChunks(chunks, 8);
            const view = new DataView(headerArray.buffer, headerArray.byteOffset, headerArray.length);
            const n = view.getUint32(0);
            if (n > Math.pow(2, 53 - 32) - 1) {
              controller.enqueue(ERROR_PACKET);
              break;
            }
            expectedLength = n * Math.pow(2, 32) + view.getUint32(4);
            state = 3;
          } else {
            if (totalLength(chunks) < expectedLength) {
              break;
            }
            const data = concatChunks(chunks, expectedLength);
            controller.enqueue(decodePacket(isBinary2 ? data : TEXT_DECODER.decode(data), binaryType));
            state = 0;
          }
          if (expectedLength === 0 || expectedLength > maxPayload) {
            controller.enqueue(ERROR_PACKET);
            break;
          }
        }
      }
    });
  }
  var protocol = 4;

  // node_modules/@socket.io/component-emitter/lib/esm/index.js
  function Emitter(obj) {
    if (obj)
      return mixin(obj);
  }
  function mixin(obj) {
    for (var key in Emitter.prototype) {
      obj[key] = Emitter.prototype[key];
    }
    return obj;
  }
  Emitter.prototype.on = Emitter.prototype.addEventListener = function(event, fn) {
    this._callbacks = this._callbacks || {};
    (this._callbacks["$" + event] = this._callbacks["$" + event] || []).push(fn);
    return this;
  };
  Emitter.prototype.once = function(event, fn) {
    function on2() {
      this.off(event, on2);
      fn.apply(this, arguments);
    }
    on2.fn = fn;
    this.on(event, on2);
    return this;
  };
  Emitter.prototype.off = Emitter.prototype.removeListener = Emitter.prototype.removeAllListeners = Emitter.prototype.removeEventListener = function(event, fn) {
    this._callbacks = this._callbacks || {};
    if (0 == arguments.length) {
      this._callbacks = {};
      return this;
    }
    var callbacks = this._callbacks["$" + event];
    if (!callbacks)
      return this;
    if (1 == arguments.length) {
      delete this._callbacks["$" + event];
      return this;
    }
    var cb;
    for (var i = 0; i < callbacks.length; i++) {
      cb = callbacks[i];
      if (cb === fn || cb.fn === fn) {
        callbacks.splice(i, 1);
        break;
      }
    }
    if (callbacks.length === 0) {
      delete this._callbacks["$" + event];
    }
    return this;
  };
  Emitter.prototype.emit = function(event) {
    this._callbacks = this._callbacks || {};
    var args = new Array(arguments.length - 1), callbacks = this._callbacks["$" + event];
    for (var i = 1; i < arguments.length; i++) {
      args[i - 1] = arguments[i];
    }
    if (callbacks) {
      callbacks = callbacks.slice(0);
      for (var i = 0, len = callbacks.length; i < len; ++i) {
        callbacks[i].apply(this, args);
      }
    }
    return this;
  };
  Emitter.prototype.emitReserved = Emitter.prototype.emit;
  Emitter.prototype.listeners = function(event) {
    this._callbacks = this._callbacks || {};
    return this._callbacks["$" + event] || [];
  };
  Emitter.prototype.hasListeners = function(event) {
    return !!this.listeners(event).length;
  };

  // node_modules/engine.io-client/build/esm/globals.js
  var nextTick = (() => {
    const isPromiseAvailable = typeof Promise === "function" && typeof Promise.resolve === "function";
    if (isPromiseAvailable) {
      return (cb) => Promise.resolve().then(cb);
    } else {
      return (cb, setTimeoutFn) => setTimeoutFn(cb, 0);
    }
  })();
  var globalThisShim = (() => {
    if (typeof self !== "undefined") {
      return self;
    } else if (typeof window !== "undefined") {
      return window;
    } else {
      return Function("return this")();
    }
  })();
  var defaultBinaryType = "arraybuffer";
  function createCookieJar() {
  }

  // node_modules/engine.io-client/build/esm/util.js
  function pick(obj, ...attr) {
    return attr.reduce((acc, k) => {
      if (obj.hasOwnProperty(k)) {
        acc[k] = obj[k];
      }
      return acc;
    }, {});
  }
  var NATIVE_SET_TIMEOUT = globalThisShim.setTimeout;
  var NATIVE_CLEAR_TIMEOUT = globalThisShim.clearTimeout;
  function installTimerFunctions(obj, opts) {
    if (opts.useNativeTimers) {
      obj.setTimeoutFn = NATIVE_SET_TIMEOUT.bind(globalThisShim);
      obj.clearTimeoutFn = NATIVE_CLEAR_TIMEOUT.bind(globalThisShim);
    } else {
      obj.setTimeoutFn = globalThisShim.setTimeout.bind(globalThisShim);
      obj.clearTimeoutFn = globalThisShim.clearTimeout.bind(globalThisShim);
    }
  }
  var BASE64_OVERHEAD = 1.33;
  function byteLength(obj) {
    if (typeof obj === "string") {
      return utf8Length(obj);
    }
    return Math.ceil((obj.byteLength || obj.size) * BASE64_OVERHEAD);
  }
  function utf8Length(str) {
    let c = 0, length = 0;
    for (let i = 0, l = str.length; i < l; i++) {
      c = str.charCodeAt(i);
      if (c < 128) {
        length += 1;
      } else if (c < 2048) {
        length += 2;
      } else if (c < 55296 || c >= 57344) {
        length += 3;
      } else {
        i++;
        length += 4;
      }
    }
    return length;
  }
  function randomString() {
    return Date.now().toString(36).substring(3) + Math.random().toString(36).substring(2, 5);
  }

  // node_modules/engine.io-client/build/esm/contrib/parseqs.js
  function encode(obj) {
    let str = "";
    for (let i in obj) {
      if (obj.hasOwnProperty(i)) {
        if (str.length)
          str += "&";
        str += encodeURIComponent(i) + "=" + encodeURIComponent(obj[i]);
      }
    }
    return str;
  }
  function decode2(qs) {
    let qry = {};
    let pairs = qs.split("&");
    for (let i = 0, l = pairs.length; i < l; i++) {
      let pair = pairs[i].split("=");
      qry[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1]);
    }
    return qry;
  }

  // node_modules/engine.io-client/build/esm/transport.js
  var TransportError = class extends Error {
    constructor(reason, description, context) {
      super(reason);
      this.description = description;
      this.context = context;
      this.type = "TransportError";
    }
  };
  var Transport = class extends Emitter {
    /**
     * Transport abstract constructor.
     *
     * @param {Object} opts - options
     * @protected
     */
    constructor(opts) {
      super();
      this.writable = false;
      installTimerFunctions(this, opts);
      this.opts = opts;
      this.query = opts.query;
      this.socket = opts.socket;
      this.supportsBinary = !opts.forceBase64;
    }
    /**
     * Emits an error.
     *
     * @param {String} reason
     * @param description
     * @param context - the error context
     * @return {Transport} for chaining
     * @protected
     */
    onError(reason, description, context) {
      super.emitReserved("error", new TransportError(reason, description, context));
      return this;
    }
    /**
     * Opens the transport.
     */
    open() {
      this.readyState = "opening";
      this.doOpen();
      return this;
    }
    /**
     * Closes the transport.
     */
    close() {
      if (this.readyState === "opening" || this.readyState === "open") {
        this.doClose();
        this.onClose();
      }
      return this;
    }
    /**
     * Sends multiple packets.
     *
     * @param {Array} packets
     */
    send(packets) {
      if (this.readyState === "open") {
        this.write(packets);
      } else {
      }
    }
    /**
     * Called upon open
     *
     * @protected
     */
    onOpen() {
      this.readyState = "open";
      this.writable = true;
      super.emitReserved("open");
    }
    /**
     * Called with data.
     *
     * @param {String} data
     * @protected
     */
    onData(data) {
      const packet = decodePacket(data, this.socket.binaryType);
      this.onPacket(packet);
    }
    /**
     * Called with a decoded packet.
     *
     * @protected
     */
    onPacket(packet) {
      super.emitReserved("packet", packet);
    }
    /**
     * Called upon close.
     *
     * @protected
     */
    onClose(details) {
      this.readyState = "closed";
      super.emitReserved("close", details);
    }
    /**
     * Pauses the transport, in order not to lose packets during an upgrade.
     *
     * @param onPause
     */
    pause(onPause) {
    }
    createUri(schema, query = {}) {
      return schema + "://" + this._hostname() + this._port() + this.opts.path + this._query(query);
    }
    _hostname() {
      const hostname = this.opts.hostname;
      return hostname.indexOf(":") === -1 ? hostname : "[" + hostname + "]";
    }
    _port() {
      if (this.opts.port && (this.opts.secure && Number(this.opts.port) !== 443 || !this.opts.secure && Number(this.opts.port) !== 80)) {
        return ":" + this.opts.port;
      } else {
        return "";
      }
    }
    _query(query) {
      const encodedQuery = encode(query);
      return encodedQuery.length ? "?" + encodedQuery : "";
    }
  };

  // node_modules/engine.io-client/build/esm/transports/polling.js
  var Polling = class extends Transport {
    constructor() {
      super(...arguments);
      this._polling = false;
    }
    get name() {
      return "polling";
    }
    /**
     * Opens the socket (triggers polling). We write a PING message to determine
     * when the transport is open.
     *
     * @protected
     */
    doOpen() {
      this._poll();
    }
    /**
     * Pauses polling.
     *
     * @param {Function} onPause - callback upon buffers are flushed and transport is paused
     * @package
     */
    pause(onPause) {
      this.readyState = "pausing";
      const pause = () => {
        this.readyState = "paused";
        onPause();
      };
      if (this._polling || !this.writable) {
        let total = 0;
        if (this._polling) {
          total++;
          this.once("pollComplete", function() {
            --total || pause();
          });
        }
        if (!this.writable) {
          total++;
          this.once("drain", function() {
            --total || pause();
          });
        }
      } else {
        pause();
      }
    }
    /**
     * Starts polling cycle.
     *
     * @private
     */
    _poll() {
      this._polling = true;
      this.doPoll();
      this.emitReserved("poll");
    }
    /**
     * Overloads onData to detect payloads.
     *
     * @protected
     */
    onData(data) {
      const callback = (packet) => {
        if ("opening" === this.readyState && packet.type === "open") {
          this.onOpen();
        }
        if ("close" === packet.type) {
          this.onClose({ description: "transport closed by the server" });
          return false;
        }
        this.onPacket(packet);
      };
      decodePayload(data, this.socket.binaryType).forEach(callback);
      if ("closed" !== this.readyState) {
        this._polling = false;
        this.emitReserved("pollComplete");
        if ("open" === this.readyState) {
          this._poll();
        } else {
        }
      }
    }
    /**
     * For polling, send a close packet.
     *
     * @protected
     */
    doClose() {
      const close = () => {
        this.write([{ type: "close" }]);
      };
      if ("open" === this.readyState) {
        close();
      } else {
        this.once("open", close);
      }
    }
    /**
     * Writes a packets payload.
     *
     * @param {Array} packets - data packets
     * @protected
     */
    write(packets) {
      this.writable = false;
      encodePayload(packets, (data) => {
        this.doWrite(data, () => {
          this.writable = true;
          this.emitReserved("drain");
        });
      });
    }
    /**
     * Generates uri for connection.
     *
     * @private
     */
    uri() {
      const schema = this.opts.secure ? "https" : "http";
      const query = this.query || {};
      if (false !== this.opts.timestampRequests) {
        query[this.opts.timestampParam] = randomString();
      }
      if (!this.supportsBinary && !query.sid) {
        query.b64 = 1;
      }
      return this.createUri(schema, query);
    }
  };

  // node_modules/engine.io-client/build/esm/contrib/has-cors.js
  var value = false;
  try {
    value = typeof XMLHttpRequest !== "undefined" && "withCredentials" in new XMLHttpRequest();
  } catch (err) {
  }
  var hasCORS = value;

  // node_modules/engine.io-client/build/esm/transports/polling-xhr.js
  function empty() {
  }
  var BaseXHR = class extends Polling {
    /**
     * XHR Polling constructor.
     *
     * @param {Object} opts
     * @package
     */
    constructor(opts) {
      super(opts);
      if (typeof location !== "undefined") {
        const isSSL = "https:" === location.protocol;
        let port = location.port;
        if (!port) {
          port = isSSL ? "443" : "80";
        }
        this.xd = typeof location !== "undefined" && opts.hostname !== location.hostname || port !== opts.port;
      }
    }
    /**
     * Sends data.
     *
     * @param {String} data - data to send.
     * @param {Function} fn - called upon flush.
     * @private
     */
    doWrite(data, fn) {
      const req = this.request({
        method: "POST",
        data
      });
      req.on("success", fn);
      req.on("error", (xhrStatus, context) => {
        this.onError("xhr post error", xhrStatus, context);
      });
    }
    /**
     * Starts a poll cycle.
     *
     * @private
     */
    doPoll() {
      const req = this.request();
      req.on("data", this.onData.bind(this));
      req.on("error", (xhrStatus, context) => {
        this.onError("xhr poll error", xhrStatus, context);
      });
      this.pollXhr = req;
    }
  };
  var Request = class _Request extends Emitter {
    /**
     * Request constructor
     *
     * @param {Object} options
     * @package
     */
    constructor(createRequest, uri, opts) {
      super();
      this.createRequest = createRequest;
      installTimerFunctions(this, opts);
      this._opts = opts;
      this._method = opts.method || "GET";
      this._uri = uri;
      this._data = void 0 !== opts.data ? opts.data : null;
      this._create();
    }
    /**
     * Creates the XHR object and sends the request.
     *
     * @private
     */
    _create() {
      var _a;
      const opts = pick(this._opts, "agent", "pfx", "key", "passphrase", "cert", "ca", "ciphers", "rejectUnauthorized", "autoUnref");
      opts.xdomain = !!this._opts.xd;
      const xhr = this._xhr = this.createRequest(opts);
      try {
        xhr.open(this._method, this._uri, true);
        try {
          if (this._opts.extraHeaders) {
            xhr.setDisableHeaderCheck && xhr.setDisableHeaderCheck(true);
            for (let i in this._opts.extraHeaders) {
              if (this._opts.extraHeaders.hasOwnProperty(i)) {
                xhr.setRequestHeader(i, this._opts.extraHeaders[i]);
              }
            }
          }
        } catch (e) {
        }
        if ("POST" === this._method) {
          try {
            xhr.setRequestHeader("Content-type", "text/plain;charset=UTF-8");
          } catch (e) {
          }
        }
        try {
          xhr.setRequestHeader("Accept", "*/*");
        } catch (e) {
        }
        (_a = this._opts.cookieJar) === null || _a === void 0 ? void 0 : _a.addCookies(xhr);
        if ("withCredentials" in xhr) {
          xhr.withCredentials = this._opts.withCredentials;
        }
        if (this._opts.requestTimeout) {
          xhr.timeout = this._opts.requestTimeout;
        }
        xhr.onreadystatechange = () => {
          var _a2;
          if (xhr.readyState === 3) {
            (_a2 = this._opts.cookieJar) === null || _a2 === void 0 ? void 0 : _a2.parseCookies(
              // @ts-ignore
              xhr.getResponseHeader("set-cookie")
            );
          }
          if (4 !== xhr.readyState)
            return;
          if (200 === xhr.status || 1223 === xhr.status) {
            this._onLoad();
          } else {
            this.setTimeoutFn(() => {
              this._onError(typeof xhr.status === "number" ? xhr.status : 0);
            }, 0);
          }
        };
        xhr.send(this._data);
      } catch (e) {
        this.setTimeoutFn(() => {
          this._onError(e);
        }, 0);
        return;
      }
      if (typeof document !== "undefined") {
        this._index = _Request.requestsCount++;
        _Request.requests[this._index] = this;
      }
    }
    /**
     * Called upon error.
     *
     * @private
     */
    _onError(err) {
      this.emitReserved("error", err, this._xhr);
      this._cleanup(true);
    }
    /**
     * Cleans up house.
     *
     * @private
     */
    _cleanup(fromError) {
      if ("undefined" === typeof this._xhr || null === this._xhr) {
        return;
      }
      this._xhr.onreadystatechange = empty;
      if (fromError) {
        try {
          this._xhr.abort();
        } catch (e) {
        }
      }
      if (typeof document !== "undefined") {
        delete _Request.requests[this._index];
      }
      this._xhr = null;
    }
    /**
     * Called upon load.
     *
     * @private
     */
    _onLoad() {
      const data = this._xhr.responseText;
      if (data !== null) {
        this.emitReserved("data", data);
        this.emitReserved("success");
        this._cleanup();
      }
    }
    /**
     * Aborts the request.
     *
     * @package
     */
    abort() {
      this._cleanup();
    }
  };
  Request.requestsCount = 0;
  Request.requests = {};
  if (typeof document !== "undefined") {
    if (typeof attachEvent === "function") {
      attachEvent("onunload", unloadHandler);
    } else if (typeof addEventListener === "function") {
      const terminationEvent = "onpagehide" in globalThisShim ? "pagehide" : "unload";
      addEventListener(terminationEvent, unloadHandler, false);
    }
  }
  function unloadHandler() {
    for (let i in Request.requests) {
      if (Request.requests.hasOwnProperty(i)) {
        Request.requests[i].abort();
      }
    }
  }
  var hasXHR2 = function() {
    const xhr = newRequest({
      xdomain: false
    });
    return xhr && xhr.responseType !== null;
  }();
  var XHR = class extends BaseXHR {
    constructor(opts) {
      super(opts);
      const forceBase64 = opts && opts.forceBase64;
      this.supportsBinary = hasXHR2 && !forceBase64;
    }
    request(opts = {}) {
      Object.assign(opts, { xd: this.xd }, this.opts);
      return new Request(newRequest, this.uri(), opts);
    }
  };
  function newRequest(opts) {
    const xdomain = opts.xdomain;
    try {
      if ("undefined" !== typeof XMLHttpRequest && (!xdomain || hasCORS)) {
        return new XMLHttpRequest();
      }
    } catch (e) {
    }
    if (!xdomain) {
      try {
        return new globalThisShim[["Active"].concat("Object").join("X")]("Microsoft.XMLHTTP");
      } catch (e) {
      }
    }
  }

  // node_modules/engine.io-client/build/esm/transports/websocket.js
  var isReactNative = typeof navigator !== "undefined" && typeof navigator.product === "string" && navigator.product.toLowerCase() === "reactnative";
  var BaseWS = class extends Transport {
    get name() {
      return "websocket";
    }
    doOpen() {
      const uri = this.uri();
      const protocols = this.opts.protocols;
      const opts = isReactNative ? {} : pick(this.opts, "agent", "perMessageDeflate", "pfx", "key", "passphrase", "cert", "ca", "ciphers", "rejectUnauthorized", "localAddress", "protocolVersion", "origin", "maxPayload", "family", "checkServerIdentity");
      if (this.opts.extraHeaders) {
        opts.headers = this.opts.extraHeaders;
      }
      try {
        this.ws = this.createSocket(uri, protocols, opts);
      } catch (err) {
        return this.emitReserved("error", err);
      }
      this.ws.binaryType = this.socket.binaryType;
      this.addEventListeners();
    }
    /**
     * Adds event listeners to the socket
     *
     * @private
     */
    addEventListeners() {
      this.ws.onopen = () => {
        if (this.opts.autoUnref) {
          this.ws._socket.unref();
        }
        this.onOpen();
      };
      this.ws.onclose = (closeEvent) => this.onClose({
        description: "websocket connection closed",
        context: closeEvent
      });
      this.ws.onmessage = (ev) => this.onData(ev.data);
      this.ws.onerror = (e) => this.onError("websocket error", e);
    }
    write(packets) {
      this.writable = false;
      for (let i = 0; i < packets.length; i++) {
        const packet = packets[i];
        const lastPacket = i === packets.length - 1;
        encodePacket(packet, this.supportsBinary, (data) => {
          try {
            this.doWrite(packet, data);
          } catch (e) {
          }
          if (lastPacket) {
            nextTick(() => {
              this.writable = true;
              this.emitReserved("drain");
            }, this.setTimeoutFn);
          }
        });
      }
    }
    doClose() {
      if (typeof this.ws !== "undefined") {
        this.ws.onerror = () => {
        };
        this.ws.close();
        this.ws = null;
      }
    }
    /**
     * Generates uri for connection.
     *
     * @private
     */
    uri() {
      const schema = this.opts.secure ? "wss" : "ws";
      const query = this.query || {};
      if (this.opts.timestampRequests) {
        query[this.opts.timestampParam] = randomString();
      }
      if (!this.supportsBinary) {
        query.b64 = 1;
      }
      return this.createUri(schema, query);
    }
  };
  var WebSocketCtor = globalThisShim.WebSocket || globalThisShim.MozWebSocket;
  var WS = class extends BaseWS {
    createSocket(uri, protocols, opts) {
      return !isReactNative ? protocols ? new WebSocketCtor(uri, protocols) : new WebSocketCtor(uri) : new WebSocketCtor(uri, protocols, opts);
    }
    doWrite(_packet, data) {
      this.ws.send(data);
    }
  };

  // node_modules/engine.io-client/build/esm/transports/webtransport.js
  var WT = class extends Transport {
    get name() {
      return "webtransport";
    }
    doOpen() {
      try {
        this._transport = new WebTransport(this.createUri("https"), this.opts.transportOptions[this.name]);
      } catch (err) {
        return this.emitReserved("error", err);
      }
      this._transport.closed.then(() => {
        this.onClose();
      }).catch((err) => {
        this.onError("webtransport error", err);
      });
      this._transport.ready.then(() => {
        this._transport.createBidirectionalStream().then((stream) => {
          const decoderStream = createPacketDecoderStream(Number.MAX_SAFE_INTEGER, this.socket.binaryType);
          const reader = stream.readable.pipeThrough(decoderStream).getReader();
          const encoderStream = createPacketEncoderStream();
          encoderStream.readable.pipeTo(stream.writable);
          this._writer = encoderStream.writable.getWriter();
          const read = () => {
            reader.read().then(({ done, value: value2 }) => {
              if (done) {
                return;
              }
              this.onPacket(value2);
              read();
            }).catch((err) => {
            });
          };
          read();
          const packet = { type: "open" };
          if (this.query.sid) {
            packet.data = `{"sid":"${this.query.sid}"}`;
          }
          this._writer.write(packet).then(() => this.onOpen());
        });
      });
    }
    write(packets) {
      this.writable = false;
      for (let i = 0; i < packets.length; i++) {
        const packet = packets[i];
        const lastPacket = i === packets.length - 1;
        this._writer.write(packet).then(() => {
          if (lastPacket) {
            nextTick(() => {
              this.writable = true;
              this.emitReserved("drain");
            }, this.setTimeoutFn);
          }
        });
      }
    }
    doClose() {
      var _a;
      (_a = this._transport) === null || _a === void 0 ? void 0 : _a.close();
    }
  };

  // node_modules/engine.io-client/build/esm/transports/index.js
  var transports = {
    websocket: WS,
    webtransport: WT,
    polling: XHR
  };

  // node_modules/engine.io-client/build/esm/contrib/parseuri.js
  var re = /^(?:(?![^:@\/?#]+:[^:@\/]*@)(http|https|ws|wss):\/\/)?((?:(([^:@\/?#]*)(?::([^:@\/?#]*))?)?@)?((?:[a-f0-9]{0,4}:){2,7}[a-f0-9]{0,4}|[^:\/?#]*)(?::(\d*))?)(((\/(?:[^?#](?![^?#\/]*\.[^?#\/.]+(?:[?#]|$)))*\/?)?([^?#\/]*))(?:\?([^#]*))?(?:#(.*))?)/;
  var parts = [
    "source",
    "protocol",
    "authority",
    "userInfo",
    "user",
    "password",
    "host",
    "port",
    "relative",
    "path",
    "directory",
    "file",
    "query",
    "anchor"
  ];
  function parse(str) {
    if (str.length > 8e3) {
      throw "URI too long";
    }
    const src = str, b = str.indexOf("["), e = str.indexOf("]");
    if (b != -1 && e != -1) {
      str = str.substring(0, b) + str.substring(b, e).replace(/:/g, ";") + str.substring(e, str.length);
    }
    let m = re.exec(str || ""), uri = {}, i = 14;
    while (i--) {
      uri[parts[i]] = m[i] || "";
    }
    if (b != -1 && e != -1) {
      uri.source = src;
      uri.host = uri.host.substring(1, uri.host.length - 1).replace(/;/g, ":");
      uri.authority = uri.authority.replace("[", "").replace("]", "").replace(/;/g, ":");
      uri.ipv6uri = true;
    }
    uri.pathNames = pathNames(uri, uri["path"]);
    uri.queryKey = queryKey(uri, uri["query"]);
    return uri;
  }
  function pathNames(obj, path) {
    const regx = /\/{2,9}/g, names = path.replace(regx, "/").split("/");
    if (path.slice(0, 1) == "/" || path.length === 0) {
      names.splice(0, 1);
    }
    if (path.slice(-1) == "/") {
      names.splice(names.length - 1, 1);
    }
    return names;
  }
  function queryKey(uri, query) {
    const data = {};
    query.replace(/(?:^|&)([^&=]*)=?([^&]*)/g, function($0, $1, $2) {
      if ($1) {
        data[$1] = $2;
      }
    });
    return data;
  }

  // node_modules/engine.io-client/build/esm/socket.js
  var withEventListeners = typeof addEventListener === "function" && typeof removeEventListener === "function";
  var OFFLINE_EVENT_LISTENERS = [];
  if (withEventListeners) {
    addEventListener("offline", () => {
      OFFLINE_EVENT_LISTENERS.forEach((listener) => listener());
    }, false);
  }
  var SocketWithoutUpgrade = class _SocketWithoutUpgrade extends Emitter {
    /**
     * Socket constructor.
     *
     * @param {String|Object} uri - uri or options
     * @param {Object} opts - options
     */
    constructor(uri, opts) {
      super();
      this.binaryType = defaultBinaryType;
      this.writeBuffer = [];
      this._prevBufferLen = 0;
      this._pingInterval = -1;
      this._pingTimeout = -1;
      this._maxPayload = -1;
      this._pingTimeoutTime = Infinity;
      if (uri && "object" === typeof uri) {
        opts = uri;
        uri = null;
      }
      if (uri) {
        const parsedUri = parse(uri);
        opts.hostname = parsedUri.host;
        opts.secure = parsedUri.protocol === "https" || parsedUri.protocol === "wss";
        opts.port = parsedUri.port;
        if (parsedUri.query)
          opts.query = parsedUri.query;
      } else if (opts.host) {
        opts.hostname = parse(opts.host).host;
      }
      installTimerFunctions(this, opts);
      this.secure = null != opts.secure ? opts.secure : typeof location !== "undefined" && "https:" === location.protocol;
      if (opts.hostname && !opts.port) {
        opts.port = this.secure ? "443" : "80";
      }
      this.hostname = opts.hostname || (typeof location !== "undefined" ? location.hostname : "localhost");
      this.port = opts.port || (typeof location !== "undefined" && location.port ? location.port : this.secure ? "443" : "80");
      this.transports = [];
      this._transportsByName = {};
      opts.transports.forEach((t) => {
        const transportName = t.prototype.name;
        this.transports.push(transportName);
        this._transportsByName[transportName] = t;
      });
      this.opts = Object.assign({
        path: "/engine.io",
        agent: false,
        withCredentials: false,
        upgrade: true,
        timestampParam: "t",
        rememberUpgrade: false,
        addTrailingSlash: true,
        rejectUnauthorized: true,
        perMessageDeflate: {
          threshold: 1024
        },
        transportOptions: {},
        closeOnBeforeunload: false
      }, opts);
      this.opts.path = this.opts.path.replace(/\/$/, "") + (this.opts.addTrailingSlash ? "/" : "");
      if (typeof this.opts.query === "string") {
        this.opts.query = decode2(this.opts.query);
      }
      if (withEventListeners) {
        if (this.opts.closeOnBeforeunload) {
          this._beforeunloadEventListener = () => {
            if (this.transport) {
              this.transport.removeAllListeners();
              this.transport.close();
            }
          };
          addEventListener("beforeunload", this._beforeunloadEventListener, false);
        }
        if (this.hostname !== "localhost") {
          this._offlineEventListener = () => {
            this._onClose("transport close", {
              description: "network connection lost"
            });
          };
          OFFLINE_EVENT_LISTENERS.push(this._offlineEventListener);
        }
      }
      if (this.opts.withCredentials) {
        this._cookieJar = createCookieJar();
      }
      this._open();
    }
    /**
     * Creates transport of the given type.
     *
     * @param {String} name - transport name
     * @return {Transport}
     * @private
     */
    createTransport(name) {
      const query = Object.assign({}, this.opts.query);
      query.EIO = protocol;
      query.transport = name;
      if (this.id)
        query.sid = this.id;
      const opts = Object.assign({}, this.opts, {
        query,
        socket: this,
        hostname: this.hostname,
        secure: this.secure,
        port: this.port
      }, this.opts.transportOptions[name]);
      return new this._transportsByName[name](opts);
    }
    /**
     * Initializes transport to use and starts probe.
     *
     * @private
     */
    _open() {
      if (this.transports.length === 0) {
        this.setTimeoutFn(() => {
          this.emitReserved("error", "No transports available");
        }, 0);
        return;
      }
      const transportName = this.opts.rememberUpgrade && _SocketWithoutUpgrade.priorWebsocketSuccess && this.transports.indexOf("websocket") !== -1 ? "websocket" : this.transports[0];
      this.readyState = "opening";
      const transport = this.createTransport(transportName);
      transport.open();
      this.setTransport(transport);
    }
    /**
     * Sets the current transport. Disables the existing one (if any).
     *
     * @private
     */
    setTransport(transport) {
      if (this.transport) {
        this.transport.removeAllListeners();
      }
      this.transport = transport;
      transport.on("drain", this._onDrain.bind(this)).on("packet", this._onPacket.bind(this)).on("error", this._onError.bind(this)).on("close", (reason) => this._onClose("transport close", reason));
    }
    /**
     * Called when connection is deemed open.
     *
     * @private
     */
    onOpen() {
      this.readyState = "open";
      _SocketWithoutUpgrade.priorWebsocketSuccess = "websocket" === this.transport.name;
      this.emitReserved("open");
      this.flush();
    }
    /**
     * Handles a packet.
     *
     * @private
     */
    _onPacket(packet) {
      if ("opening" === this.readyState || "open" === this.readyState || "closing" === this.readyState) {
        this.emitReserved("packet", packet);
        this.emitReserved("heartbeat");
        switch (packet.type) {
          case "open":
            this.onHandshake(JSON.parse(packet.data));
            break;
          case "ping":
            this._sendPacket("pong");
            this.emitReserved("ping");
            this.emitReserved("pong");
            this._resetPingTimeout();
            break;
          case "error":
            const err = new Error("server error");
            err.code = packet.data;
            this._onError(err);
            break;
          case "message":
            this.emitReserved("data", packet.data);
            this.emitReserved("message", packet.data);
            break;
        }
      } else {
      }
    }
    /**
     * Called upon handshake completion.
     *
     * @param {Object} data - handshake obj
     * @private
     */
    onHandshake(data) {
      this.emitReserved("handshake", data);
      this.id = data.sid;
      this.transport.query.sid = data.sid;
      this._pingInterval = data.pingInterval;
      this._pingTimeout = data.pingTimeout;
      this._maxPayload = data.maxPayload;
      this.onOpen();
      if ("closed" === this.readyState)
        return;
      this._resetPingTimeout();
    }
    /**
     * Sets and resets ping timeout timer based on server pings.
     *
     * @private
     */
    _resetPingTimeout() {
      this.clearTimeoutFn(this._pingTimeoutTimer);
      const delay2 = this._pingInterval + this._pingTimeout;
      this._pingTimeoutTime = Date.now() + delay2;
      this._pingTimeoutTimer = this.setTimeoutFn(() => {
        this._onClose("ping timeout");
      }, delay2);
      if (this.opts.autoUnref) {
        this._pingTimeoutTimer.unref();
      }
    }
    /**
     * Called on `drain` event
     *
     * @private
     */
    _onDrain() {
      this.writeBuffer.splice(0, this._prevBufferLen);
      this._prevBufferLen = 0;
      if (0 === this.writeBuffer.length) {
        this.emitReserved("drain");
      } else {
        this.flush();
      }
    }
    /**
     * Flush write buffers.
     *
     * @private
     */
    flush() {
      if ("closed" !== this.readyState && this.transport.writable && !this.upgrading && this.writeBuffer.length) {
        const packets = this._getWritablePackets();
        this.transport.send(packets);
        this._prevBufferLen = packets.length;
        this.emitReserved("flush");
      }
    }
    /**
     * Ensure the encoded size of the writeBuffer is below the maxPayload value sent by the server (only for HTTP
     * long-polling)
     *
     * @private
     */
    _getWritablePackets() {
      const shouldCheckPayloadSize = this._maxPayload && this.transport.name === "polling" && this.writeBuffer.length > 1;
      if (!shouldCheckPayloadSize) {
        return this.writeBuffer;
      }
      let payloadSize = 1;
      for (let i = 0; i < this.writeBuffer.length; i++) {
        const data = this.writeBuffer[i].data;
        if (data) {
          payloadSize += byteLength(data);
        }
        if (i > 0 && payloadSize > this._maxPayload) {
          return this.writeBuffer.slice(0, i);
        }
        payloadSize += 2;
      }
      return this.writeBuffer;
    }
    /**
     * Checks whether the heartbeat timer has expired but the socket has not yet been notified.
     *
     * Note: this method is private for now because it does not really fit the WebSocket API, but if we put it in the
     * `write()` method then the message would not be buffered by the Socket.IO client.
     *
     * @return {boolean}
     * @private
     */
    /* private */
    _hasPingExpired() {
      if (!this._pingTimeoutTime)
        return true;
      const hasExpired = Date.now() > this._pingTimeoutTime;
      if (hasExpired) {
        this._pingTimeoutTime = 0;
        nextTick(() => {
          this._onClose("ping timeout");
        }, this.setTimeoutFn);
      }
      return hasExpired;
    }
    /**
     * Sends a message.
     *
     * @param {String} msg - message.
     * @param {Object} options.
     * @param {Function} fn - callback function.
     * @return {Socket} for chaining.
     */
    write(msg, options, fn) {
      this._sendPacket("message", msg, options, fn);
      return this;
    }
    /**
     * Sends a message. Alias of {@link Socket#write}.
     *
     * @param {String} msg - message.
     * @param {Object} options.
     * @param {Function} fn - callback function.
     * @return {Socket} for chaining.
     */
    send(msg, options, fn) {
      this._sendPacket("message", msg, options, fn);
      return this;
    }
    /**
     * Sends a packet.
     *
     * @param {String} type - packet type.
     * @param {String} data.
     * @param {Object} options.
     * @param {Function} fn - callback function.
     * @private
     */
    _sendPacket(type, data, options, fn) {
      if ("function" === typeof data) {
        fn = data;
        data = void 0;
      }
      if ("function" === typeof options) {
        fn = options;
        options = null;
      }
      if ("closing" === this.readyState || "closed" === this.readyState) {
        return;
      }
      options = options || {};
      options.compress = false !== options.compress;
      const packet = {
        type,
        data,
        options
      };
      this.emitReserved("packetCreate", packet);
      this.writeBuffer.push(packet);
      if (fn)
        this.once("flush", fn);
      this.flush();
    }
    /**
     * Closes the connection.
     */
    close() {
      const close = () => {
        this._onClose("forced close");
        this.transport.close();
      };
      const cleanupAndClose = () => {
        this.off("upgrade", cleanupAndClose);
        this.off("upgradeError", cleanupAndClose);
        close();
      };
      const waitForUpgrade = () => {
        this.once("upgrade", cleanupAndClose);
        this.once("upgradeError", cleanupAndClose);
      };
      if ("opening" === this.readyState || "open" === this.readyState) {
        this.readyState = "closing";
        if (this.writeBuffer.length) {
          this.once("drain", () => {
            if (this.upgrading) {
              waitForUpgrade();
            } else {
              close();
            }
          });
        } else if (this.upgrading) {
          waitForUpgrade();
        } else {
          close();
        }
      }
      return this;
    }
    /**
     * Called upon transport error
     *
     * @private
     */
    _onError(err) {
      _SocketWithoutUpgrade.priorWebsocketSuccess = false;
      if (this.opts.tryAllTransports && this.transports.length > 1 && this.readyState === "opening") {
        this.transports.shift();
        return this._open();
      }
      this.emitReserved("error", err);
      this._onClose("transport error", err);
    }
    /**
     * Called upon transport close.
     *
     * @private
     */
    _onClose(reason, description) {
      if ("opening" === this.readyState || "open" === this.readyState || "closing" === this.readyState) {
        this.clearTimeoutFn(this._pingTimeoutTimer);
        this.transport.removeAllListeners("close");
        this.transport.close();
        this.transport.removeAllListeners();
        if (withEventListeners) {
          if (this._beforeunloadEventListener) {
            removeEventListener("beforeunload", this._beforeunloadEventListener, false);
          }
          if (this._offlineEventListener) {
            const i = OFFLINE_EVENT_LISTENERS.indexOf(this._offlineEventListener);
            if (i !== -1) {
              OFFLINE_EVENT_LISTENERS.splice(i, 1);
            }
          }
        }
        this.readyState = "closed";
        this.id = null;
        this.emitReserved("close", reason, description);
        this.writeBuffer = [];
        this._prevBufferLen = 0;
      }
    }
  };
  SocketWithoutUpgrade.protocol = protocol;
  var SocketWithUpgrade = class extends SocketWithoutUpgrade {
    constructor() {
      super(...arguments);
      this._upgrades = [];
    }
    onOpen() {
      super.onOpen();
      if ("open" === this.readyState && this.opts.upgrade) {
        for (let i = 0; i < this._upgrades.length; i++) {
          this._probe(this._upgrades[i]);
        }
      }
    }
    /**
     * Probes a transport.
     *
     * @param {String} name - transport name
     * @private
     */
    _probe(name) {
      let transport = this.createTransport(name);
      let failed = false;
      SocketWithoutUpgrade.priorWebsocketSuccess = false;
      const onTransportOpen = () => {
        if (failed)
          return;
        transport.send([{ type: "ping", data: "probe" }]);
        transport.once("packet", (msg) => {
          if (failed)
            return;
          if ("pong" === msg.type && "probe" === msg.data) {
            this.upgrading = true;
            this.emitReserved("upgrading", transport);
            if (!transport)
              return;
            SocketWithoutUpgrade.priorWebsocketSuccess = "websocket" === transport.name;
            this.transport.pause(() => {
              if (failed)
                return;
              if ("closed" === this.readyState)
                return;
              cleanup();
              this.setTransport(transport);
              transport.send([{ type: "upgrade" }]);
              this.emitReserved("upgrade", transport);
              transport = null;
              this.upgrading = false;
              this.flush();
            });
          } else {
            const err = new Error("probe error");
            err.transport = transport.name;
            this.emitReserved("upgradeError", err);
          }
        });
      };
      function freezeTransport() {
        if (failed)
          return;
        failed = true;
        cleanup();
        transport.close();
        transport = null;
      }
      const onerror = (err) => {
        const error = new Error("probe error: " + err);
        error.transport = transport.name;
        freezeTransport();
        this.emitReserved("upgradeError", error);
      };
      function onTransportClose() {
        onerror("transport closed");
      }
      function onclose() {
        onerror("socket closed");
      }
      function onupgrade(to) {
        if (transport && to.name !== transport.name) {
          freezeTransport();
        }
      }
      const cleanup = () => {
        transport.removeListener("open", onTransportOpen);
        transport.removeListener("error", onerror);
        transport.removeListener("close", onTransportClose);
        this.off("close", onclose);
        this.off("upgrading", onupgrade);
      };
      transport.once("open", onTransportOpen);
      transport.once("error", onerror);
      transport.once("close", onTransportClose);
      this.once("close", onclose);
      this.once("upgrading", onupgrade);
      if (this._upgrades.indexOf("webtransport") !== -1 && name !== "webtransport") {
        this.setTimeoutFn(() => {
          if (!failed) {
            transport.open();
          }
        }, 200);
      } else {
        transport.open();
      }
    }
    onHandshake(data) {
      this._upgrades = this._filterUpgrades(data.upgrades);
      super.onHandshake(data);
    }
    /**
     * Filters upgrades, returning only those matching client transports.
     *
     * @param {Array} upgrades - server upgrades
     * @private
     */
    _filterUpgrades(upgrades) {
      const filteredUpgrades = [];
      for (let i = 0; i < upgrades.length; i++) {
        if (~this.transports.indexOf(upgrades[i]))
          filteredUpgrades.push(upgrades[i]);
      }
      return filteredUpgrades;
    }
  };
  var Socket = class extends SocketWithUpgrade {
    constructor(uri, opts = {}) {
      const o = typeof uri === "object" ? uri : opts;
      if (!o.transports || o.transports && typeof o.transports[0] === "string") {
        o.transports = (o.transports || ["polling", "websocket", "webtransport"]).map((transportName) => transports[transportName]).filter((t) => !!t);
      }
      super(uri, o);
    }
  };

  // node_modules/engine.io-client/build/esm/index.js
  var protocol2 = Socket.protocol;

  // node_modules/socket.io-client/build/esm/url.js
  function url(uri, path = "", loc) {
    let obj = uri;
    loc = loc || typeof location !== "undefined" && location;
    if (null == uri)
      uri = loc.protocol + "//" + loc.host;
    if (typeof uri === "string") {
      if ("/" === uri.charAt(0)) {
        if ("/" === uri.charAt(1)) {
          uri = loc.protocol + uri;
        } else {
          uri = loc.host + uri;
        }
      }
      if (!/^(https?|wss?):\/\//.test(uri)) {
        if ("undefined" !== typeof loc) {
          uri = loc.protocol + "//" + uri;
        } else {
          uri = "https://" + uri;
        }
      }
      obj = parse(uri);
    }
    if (!obj.port) {
      if (/^(http|ws)$/.test(obj.protocol)) {
        obj.port = "80";
      } else if (/^(http|ws)s$/.test(obj.protocol)) {
        obj.port = "443";
      }
    }
    obj.path = obj.path || "/";
    const ipv6 = obj.host.indexOf(":") !== -1;
    const host = ipv6 ? "[" + obj.host + "]" : obj.host;
    obj.id = obj.protocol + "://" + host + ":" + obj.port + path;
    obj.href = obj.protocol + "://" + host + (loc && loc.port === obj.port ? "" : ":" + obj.port);
    return obj;
  }

  // node_modules/socket.io-parser/build/esm/index.js
  var esm_exports = {};
  __export(esm_exports, {
    Decoder: () => Decoder,
    Encoder: () => Encoder,
    PacketType: () => PacketType,
    isPacketValid: () => isPacketValid,
    protocol: () => protocol3
  });

  // node_modules/socket.io-parser/build/esm/is-binary.js
  var withNativeArrayBuffer3 = typeof ArrayBuffer === "function";
  var isView2 = (obj) => {
    return typeof ArrayBuffer.isView === "function" ? ArrayBuffer.isView(obj) : obj.buffer instanceof ArrayBuffer;
  };
  var toString = Object.prototype.toString;
  var withNativeBlob2 = typeof Blob === "function" || typeof Blob !== "undefined" && toString.call(Blob) === "[object BlobConstructor]";
  var withNativeFile = typeof File === "function" || typeof File !== "undefined" && toString.call(File) === "[object FileConstructor]";
  function isBinary(obj) {
    return withNativeArrayBuffer3 && (obj instanceof ArrayBuffer || isView2(obj)) || withNativeBlob2 && obj instanceof Blob || withNativeFile && obj instanceof File;
  }
  function hasBinary(obj, toJSON) {
    if (!obj || typeof obj !== "object") {
      return false;
    }
    if (Array.isArray(obj)) {
      for (let i = 0, l = obj.length; i < l; i++) {
        if (hasBinary(obj[i])) {
          return true;
        }
      }
      return false;
    }
    if (isBinary(obj)) {
      return true;
    }
    if (obj.toJSON && typeof obj.toJSON === "function" && arguments.length === 1) {
      return hasBinary(obj.toJSON(), true);
    }
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key) && hasBinary(obj[key])) {
        return true;
      }
    }
    return false;
  }

  // node_modules/socket.io-parser/build/esm/binary.js
  function deconstructPacket(packet) {
    const buffers = [];
    const packetData = packet.data;
    const pack = packet;
    pack.data = _deconstructPacket(packetData, buffers);
    pack.attachments = buffers.length;
    return { packet: pack, buffers };
  }
  function _deconstructPacket(data, buffers) {
    if (!data)
      return data;
    if (isBinary(data)) {
      const placeholder = { _placeholder: true, num: buffers.length };
      buffers.push(data);
      return placeholder;
    } else if (Array.isArray(data)) {
      const newData = new Array(data.length);
      for (let i = 0; i < data.length; i++) {
        newData[i] = _deconstructPacket(data[i], buffers);
      }
      return newData;
    } else if (typeof data === "object" && !(data instanceof Date)) {
      const newData = {};
      for (const key in data) {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
          newData[key] = _deconstructPacket(data[key], buffers);
        }
      }
      return newData;
    }
    return data;
  }
  function reconstructPacket(packet, buffers) {
    packet.data = _reconstructPacket(packet.data, buffers);
    delete packet.attachments;
    return packet;
  }
  function _reconstructPacket(data, buffers) {
    if (!data)
      return data;
    if (data && data._placeholder === true) {
      const isIndexValid = typeof data.num === "number" && data.num >= 0 && data.num < buffers.length;
      if (isIndexValid) {
        return buffers[data.num];
      } else {
        throw new Error("illegal attachments");
      }
    } else if (Array.isArray(data)) {
      for (let i = 0; i < data.length; i++) {
        data[i] = _reconstructPacket(data[i], buffers);
      }
    } else if (typeof data === "object") {
      for (const key in data) {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
          data[key] = _reconstructPacket(data[key], buffers);
        }
      }
    }
    return data;
  }

  // node_modules/socket.io-parser/build/esm/index.js
  var RESERVED_EVENTS = [
    "connect",
    // used on the client side
    "connect_error",
    // used on the client side
    "disconnect",
    // used on both sides
    "disconnecting",
    // used on the server side
    "newListener",
    // used by the Node.js EventEmitter
    "removeListener"
    // used by the Node.js EventEmitter
  ];
  var protocol3 = 5;
  var PacketType;
  (function(PacketType2) {
    PacketType2[PacketType2["CONNECT"] = 0] = "CONNECT";
    PacketType2[PacketType2["DISCONNECT"] = 1] = "DISCONNECT";
    PacketType2[PacketType2["EVENT"] = 2] = "EVENT";
    PacketType2[PacketType2["ACK"] = 3] = "ACK";
    PacketType2[PacketType2["CONNECT_ERROR"] = 4] = "CONNECT_ERROR";
    PacketType2[PacketType2["BINARY_EVENT"] = 5] = "BINARY_EVENT";
    PacketType2[PacketType2["BINARY_ACK"] = 6] = "BINARY_ACK";
  })(PacketType || (PacketType = {}));
  var Encoder = class {
    /**
     * Encoder constructor
     *
     * @param {function} replacer - custom replacer to pass down to JSON.parse
     */
    constructor(replacer) {
      this.replacer = replacer;
    }
    /**
     * Encode a packet as a single string if non-binary, or as a
     * buffer sequence, depending on packet type.
     *
     * @param {Object} obj - packet object
     */
    encode(obj) {
      if (obj.type === PacketType.EVENT || obj.type === PacketType.ACK) {
        if (hasBinary(obj)) {
          return this.encodeAsBinary({
            type: obj.type === PacketType.EVENT ? PacketType.BINARY_EVENT : PacketType.BINARY_ACK,
            nsp: obj.nsp,
            data: obj.data,
            id: obj.id
          });
        }
      }
      return [this.encodeAsString(obj)];
    }
    /**
     * Encode packet as string.
     */
    encodeAsString(obj) {
      let str = "" + obj.type;
      if (obj.type === PacketType.BINARY_EVENT || obj.type === PacketType.BINARY_ACK) {
        str += obj.attachments + "-";
      }
      if (obj.nsp && "/" !== obj.nsp) {
        str += obj.nsp + ",";
      }
      if (null != obj.id) {
        str += obj.id;
      }
      if (null != obj.data) {
        str += JSON.stringify(obj.data, this.replacer);
      }
      return str;
    }
    /**
     * Encode packet as 'buffer sequence' by removing blobs, and
     * deconstructing packet into object with placeholders and
     * a list of buffers.
     */
    encodeAsBinary(obj) {
      const deconstruction = deconstructPacket(obj);
      const pack = this.encodeAsString(deconstruction.packet);
      const buffers = deconstruction.buffers;
      buffers.unshift(pack);
      return buffers;
    }
  };
  var Decoder = class _Decoder extends Emitter {
    /**
     * Decoder constructor
     */
    constructor(opts) {
      super();
      this.opts = Object.assign({
        reviver: void 0,
        maxAttachments: 10
      }, typeof opts === "function" ? { reviver: opts } : opts);
    }
    /**
     * Decodes an encoded packet string into packet JSON.
     *
     * @param {String} obj - encoded packet
     */
    add(obj) {
      let packet;
      if (typeof obj === "string") {
        if (this.reconstructor) {
          throw new Error("got plaintext data when reconstructing a packet");
        }
        packet = this.decodeString(obj);
        const isBinaryEvent = packet.type === PacketType.BINARY_EVENT;
        if (isBinaryEvent || packet.type === PacketType.BINARY_ACK) {
          packet.type = isBinaryEvent ? PacketType.EVENT : PacketType.ACK;
          this.reconstructor = new BinaryReconstructor(packet);
          if (packet.attachments === 0) {
            super.emitReserved("decoded", packet);
          }
        } else {
          super.emitReserved("decoded", packet);
        }
      } else if (isBinary(obj) || obj.base64) {
        if (!this.reconstructor) {
          throw new Error("got binary data when not reconstructing a packet");
        } else {
          packet = this.reconstructor.takeBinaryData(obj);
          if (packet) {
            this.reconstructor = null;
            super.emitReserved("decoded", packet);
          }
        }
      } else {
        throw new Error("Unknown type: " + obj);
      }
    }
    /**
     * Decode a packet String (JSON data)
     *
     * @param {String} str
     * @return {Object} packet
     */
    decodeString(str) {
      let i = 0;
      const p = {
        type: Number(str.charAt(0))
      };
      if (PacketType[p.type] === void 0) {
        throw new Error("unknown packet type " + p.type);
      }
      if (p.type === PacketType.BINARY_EVENT || p.type === PacketType.BINARY_ACK) {
        const start = i + 1;
        while (str.charAt(++i) !== "-" && i != str.length) {
        }
        const buf = str.substring(start, i);
        if (buf != Number(buf) || str.charAt(i) !== "-") {
          throw new Error("Illegal attachments");
        }
        const n = Number(buf);
        if (!isInteger(n) || n < 0) {
          throw new Error("Illegal attachments");
        } else if (n > this.opts.maxAttachments) {
          throw new Error("too many attachments");
        }
        p.attachments = n;
      }
      if ("/" === str.charAt(i + 1)) {
        const start = i + 1;
        while (++i) {
          const c = str.charAt(i);
          if ("," === c)
            break;
          if (i === str.length)
            break;
        }
        p.nsp = str.substring(start, i);
      } else {
        p.nsp = "/";
      }
      const next = str.charAt(i + 1);
      if ("" !== next && Number(next) == next) {
        const start = i + 1;
        while (++i) {
          const c = str.charAt(i);
          if (null == c || Number(c) != c) {
            --i;
            break;
          }
          if (i === str.length)
            break;
        }
        p.id = Number(str.substring(start, i + 1));
      }
      if (str.charAt(++i)) {
        const payload = this.tryParse(str.substr(i));
        if (_Decoder.isPayloadValid(p.type, payload)) {
          p.data = payload;
        } else {
          throw new Error("invalid payload");
        }
      }
      return p;
    }
    tryParse(str) {
      try {
        return JSON.parse(str, this.opts.reviver);
      } catch (e) {
        return false;
      }
    }
    static isPayloadValid(type, payload) {
      switch (type) {
        case PacketType.CONNECT:
          return isObject(payload);
        case PacketType.DISCONNECT:
          return payload === void 0;
        case PacketType.CONNECT_ERROR:
          return typeof payload === "string" || isObject(payload);
        case PacketType.EVENT:
        case PacketType.BINARY_EVENT:
          return Array.isArray(payload) && (typeof payload[0] === "number" || typeof payload[0] === "string" && RESERVED_EVENTS.indexOf(payload[0]) === -1);
        case PacketType.ACK:
        case PacketType.BINARY_ACK:
          return Array.isArray(payload);
      }
    }
    /**
     * Deallocates a parser's resources
     */
    destroy() {
      if (this.reconstructor) {
        this.reconstructor.finishedReconstruction();
        this.reconstructor = null;
      }
    }
  };
  var BinaryReconstructor = class {
    constructor(packet) {
      this.packet = packet;
      this.buffers = [];
      this.reconPack = packet;
    }
    /**
     * Method to be called when binary data received from connection
     * after a BINARY_EVENT packet.
     *
     * @param {Buffer | ArrayBuffer} binData - the raw binary data received
     * @return {null | Object} returns null if more binary data is expected or
     *   a reconstructed packet object if all buffers have been received.
     */
    takeBinaryData(binData) {
      this.buffers.push(binData);
      if (this.buffers.length === this.reconPack.attachments) {
        const packet = reconstructPacket(this.reconPack, this.buffers);
        this.finishedReconstruction();
        return packet;
      }
      return null;
    }
    /**
     * Cleans up binary packet reconstruction variables.
     */
    finishedReconstruction() {
      this.reconPack = null;
      this.buffers = [];
    }
  };
  function isNamespaceValid(nsp) {
    return typeof nsp === "string";
  }
  var isInteger = Number.isInteger || function(value2) {
    return typeof value2 === "number" && isFinite(value2) && Math.floor(value2) === value2;
  };
  function isAckIdValid(id) {
    return id === void 0 || isInteger(id);
  }
  function isObject(value2) {
    return Object.prototype.toString.call(value2) === "[object Object]";
  }
  function isDataValid(type, payload) {
    switch (type) {
      case PacketType.CONNECT:
        return payload === void 0 || isObject(payload);
      case PacketType.DISCONNECT:
        return payload === void 0;
      case PacketType.EVENT:
        return Array.isArray(payload) && (typeof payload[0] === "number" || typeof payload[0] === "string" && RESERVED_EVENTS.indexOf(payload[0]) === -1);
      case PacketType.ACK:
        return Array.isArray(payload);
      case PacketType.CONNECT_ERROR:
        return typeof payload === "string" || isObject(payload);
      default:
        return false;
    }
  }
  function isPacketValid(packet) {
    return isNamespaceValid(packet.nsp) && isAckIdValid(packet.id) && isDataValid(packet.type, packet.data);
  }

  // node_modules/socket.io-client/build/esm/on.js
  function on(obj, ev, fn) {
    obj.on(ev, fn);
    return function subDestroy() {
      obj.off(ev, fn);
    };
  }

  // node_modules/socket.io-client/build/esm/socket.js
  var RESERVED_EVENTS2 = Object.freeze({
    connect: 1,
    connect_error: 1,
    disconnect: 1,
    disconnecting: 1,
    // EventEmitter reserved events: https://nodejs.org/api/events.html#events_event_newlistener
    newListener: 1,
    removeListener: 1
  });
  var Socket2 = class extends Emitter {
    /**
     * `Socket` constructor.
     */
    constructor(io, nsp, opts) {
      super();
      this.connected = false;
      this.recovered = false;
      this.receiveBuffer = [];
      this.sendBuffer = [];
      this._queue = [];
      this._queueSeq = 0;
      this.ids = 0;
      this.acks = {};
      this.flags = {};
      this.io = io;
      this.nsp = nsp;
      if (opts && opts.auth) {
        this.auth = opts.auth;
      }
      this._opts = Object.assign({}, opts);
      if (this.io._autoConnect)
        this.open();
    }
    /**
     * Whether the socket is currently disconnected
     *
     * @example
     * const socket = io();
     *
     * socket.on("connect", () => {
     *   console.log(socket.disconnected); // false
     * });
     *
     * socket.on("disconnect", () => {
     *   console.log(socket.disconnected); // true
     * });
     */
    get disconnected() {
      return !this.connected;
    }
    /**
     * Subscribe to open, close and packet events
     *
     * @private
     */
    subEvents() {
      if (this.subs)
        return;
      const io = this.io;
      this.subs = [
        on(io, "open", this.onopen.bind(this)),
        on(io, "packet", this.onpacket.bind(this)),
        on(io, "error", this.onerror.bind(this)),
        on(io, "close", this.onclose.bind(this))
      ];
    }
    /**
     * Whether the Socket will try to reconnect when its Manager connects or reconnects.
     *
     * @example
     * const socket = io();
     *
     * console.log(socket.active); // true
     *
     * socket.on("disconnect", (reason) => {
     *   if (reason === "io server disconnect") {
     *     // the disconnection was initiated by the server, you need to manually reconnect
     *     console.log(socket.active); // false
     *   }
     *   // else the socket will automatically try to reconnect
     *   console.log(socket.active); // true
     * });
     */
    get active() {
      return !!this.subs;
    }
    /**
     * "Opens" the socket.
     *
     * @example
     * const socket = io({
     *   autoConnect: false
     * });
     *
     * socket.connect();
     */
    connect() {
      if (this.connected)
        return this;
      this.subEvents();
      if (!this.io["_reconnecting"])
        this.io.open();
      if ("open" === this.io._readyState)
        this.onopen();
      return this;
    }
    /**
     * Alias for {@link connect()}.
     */
    open() {
      return this.connect();
    }
    /**
     * Sends a `message` event.
     *
     * This method mimics the WebSocket.send() method.
     *
     * @see https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/send
     *
     * @example
     * socket.send("hello");
     *
     * // this is equivalent to
     * socket.emit("message", "hello");
     *
     * @return self
     */
    send(...args) {
      args.unshift("message");
      this.emit.apply(this, args);
      return this;
    }
    /**
     * Override `emit`.
     * If the event is in `events`, it's emitted normally.
     *
     * @example
     * socket.emit("hello", "world");
     *
     * // all serializable datastructures are supported (no need to call JSON.stringify)
     * socket.emit("hello", 1, "2", { 3: ["4"], 5: Uint8Array.from([6]) });
     *
     * // with an acknowledgement from the server
     * socket.emit("hello", "world", (val) => {
     *   // ...
     * });
     *
     * @return self
     */
    emit(ev, ...args) {
      var _a, _b, _c;
      if (RESERVED_EVENTS2.hasOwnProperty(ev)) {
        throw new Error('"' + ev.toString() + '" is a reserved event name');
      }
      args.unshift(ev);
      if (this._opts.retries && !this.flags.fromQueue && !this.flags.volatile) {
        this._addToQueue(args);
        return this;
      }
      const packet = {
        type: PacketType.EVENT,
        data: args
      };
      packet.options = {};
      packet.options.compress = this.flags.compress !== false;
      if ("function" === typeof args[args.length - 1]) {
        const id = this.ids++;
        const ack = args.pop();
        this._registerAckCallback(id, ack);
        packet.id = id;
      }
      const isTransportWritable = (_b = (_a = this.io.engine) === null || _a === void 0 ? void 0 : _a.transport) === null || _b === void 0 ? void 0 : _b.writable;
      const isConnected = this.connected && !((_c = this.io.engine) === null || _c === void 0 ? void 0 : _c._hasPingExpired());
      const discardPacket = this.flags.volatile && !isTransportWritable;
      if (discardPacket) {
      } else if (isConnected) {
        this.notifyOutgoingListeners(packet);
        this.packet(packet);
      } else {
        this.sendBuffer.push(packet);
      }
      this.flags = {};
      return this;
    }
    /**
     * @private
     */
    _registerAckCallback(id, ack) {
      var _a;
      const timeout = (_a = this.flags.timeout) !== null && _a !== void 0 ? _a : this._opts.ackTimeout;
      if (timeout === void 0) {
        this.acks[id] = ack;
        return;
      }
      const timer = this.io.setTimeoutFn(() => {
        delete this.acks[id];
        for (let i = 0; i < this.sendBuffer.length; i++) {
          if (this.sendBuffer[i].id === id) {
            this.sendBuffer.splice(i, 1);
          }
        }
        ack.call(this, new Error("operation has timed out"));
      }, timeout);
      const fn = (...args) => {
        this.io.clearTimeoutFn(timer);
        ack.apply(this, args);
      };
      fn.withError = true;
      this.acks[id] = fn;
    }
    /**
     * Emits an event and waits for an acknowledgement
     *
     * @example
     * // without timeout
     * const response = await socket.emitWithAck("hello", "world");
     *
     * // with a specific timeout
     * try {
     *   const response = await socket.timeout(1000).emitWithAck("hello", "world");
     * } catch (err) {
     *   // the server did not acknowledge the event in the given delay
     * }
     *
     * @return a Promise that will be fulfilled when the server acknowledges the event
     */
    emitWithAck(ev, ...args) {
      return new Promise((resolve, reject) => {
        const fn = (arg1, arg2) => {
          return arg1 ? reject(arg1) : resolve(arg2);
        };
        fn.withError = true;
        args.push(fn);
        this.emit(ev, ...args);
      });
    }
    /**
     * Add the packet to the queue.
     * @param args
     * @private
     */
    _addToQueue(args) {
      let ack;
      if (typeof args[args.length - 1] === "function") {
        ack = args.pop();
      }
      const packet = {
        id: this._queueSeq++,
        tryCount: 0,
        pending: false,
        args,
        flags: Object.assign({ fromQueue: true }, this.flags)
      };
      args.push((err, ...responseArgs) => {
        if (packet !== this._queue[0]) {
        }
        const hasError = err !== null;
        if (hasError) {
          if (packet.tryCount > this._opts.retries) {
            this._queue.shift();
            if (ack) {
              ack(err);
            }
          }
        } else {
          this._queue.shift();
          if (ack) {
            ack(null, ...responseArgs);
          }
        }
        packet.pending = false;
        return this._drainQueue();
      });
      this._queue.push(packet);
      this._drainQueue();
    }
    /**
     * Send the first packet of the queue, and wait for an acknowledgement from the server.
     * @param force - whether to resend a packet that has not been acknowledged yet
     *
     * @private
     */
    _drainQueue(force = false) {
      if (!this.connected || this._queue.length === 0) {
        return;
      }
      const packet = this._queue[0];
      if (packet.pending && !force) {
        return;
      }
      packet.pending = true;
      packet.tryCount++;
      this.flags = packet.flags;
      this.emit.apply(this, packet.args);
    }
    /**
     * Sends a packet.
     *
     * @param packet
     * @private
     */
    packet(packet) {
      packet.nsp = this.nsp;
      this.io._packet(packet);
    }
    /**
     * Called upon engine `open`.
     *
     * @private
     */
    onopen() {
      if (typeof this.auth == "function") {
        this.auth((data) => {
          this._sendConnectPacket(data);
        });
      } else {
        this._sendConnectPacket(this.auth);
      }
    }
    /**
     * Sends a CONNECT packet to initiate the Socket.IO session.
     *
     * @param data
     * @private
     */
    _sendConnectPacket(data) {
      this.packet({
        type: PacketType.CONNECT,
        data: this._pid ? Object.assign({ pid: this._pid, offset: this._lastOffset }, data) : data
      });
    }
    /**
     * Called upon engine or manager `error`.
     *
     * @param err
     * @private
     */
    onerror(err) {
      if (!this.connected) {
        this.emitReserved("connect_error", err);
      }
    }
    /**
     * Called upon engine `close`.
     *
     * @param reason
     * @param description
     * @private
     */
    onclose(reason, description) {
      this.connected = false;
      delete this.id;
      this.emitReserved("disconnect", reason, description);
      this._clearAcks();
    }
    /**
     * Clears the acknowledgement handlers upon disconnection, since the client will never receive an acknowledgement from
     * the server.
     *
     * @private
     */
    _clearAcks() {
      Object.keys(this.acks).forEach((id) => {
        const isBuffered = this.sendBuffer.some((packet) => String(packet.id) === id);
        if (!isBuffered) {
          const ack = this.acks[id];
          delete this.acks[id];
          if (ack.withError) {
            ack.call(this, new Error("socket has been disconnected"));
          }
        }
      });
    }
    /**
     * Called with socket packet.
     *
     * @param packet
     * @private
     */
    onpacket(packet) {
      const sameNamespace = packet.nsp === this.nsp;
      if (!sameNamespace)
        return;
      switch (packet.type) {
        case PacketType.CONNECT:
          if (packet.data && packet.data.sid) {
            this.onconnect(packet.data.sid, packet.data.pid);
          } else {
            this.emitReserved("connect_error", new Error("It seems you are trying to reach a Socket.IO server in v2.x with a v3.x client, but they are not compatible (more information here: https://socket.io/docs/v3/migrating-from-2-x-to-3-0/)"));
          }
          break;
        case PacketType.EVENT:
        case PacketType.BINARY_EVENT:
          this.onevent(packet);
          break;
        case PacketType.ACK:
        case PacketType.BINARY_ACK:
          this.onack(packet);
          break;
        case PacketType.DISCONNECT:
          this.ondisconnect();
          break;
        case PacketType.CONNECT_ERROR:
          this.destroy();
          const err = new Error(packet.data.message);
          err.data = packet.data.data;
          this.emitReserved("connect_error", err);
          break;
      }
    }
    /**
     * Called upon a server event.
     *
     * @param packet
     * @private
     */
    onevent(packet) {
      const args = packet.data || [];
      if (null != packet.id) {
        args.push(this.ack(packet.id));
      }
      if (this.connected) {
        this.emitEvent(args);
      } else {
        this.receiveBuffer.push(Object.freeze(args));
      }
    }
    emitEvent(args) {
      if (this._anyListeners && this._anyListeners.length) {
        const listeners = this._anyListeners.slice();
        for (const listener of listeners) {
          listener.apply(this, args);
        }
      }
      super.emit.apply(this, args);
      if (this._pid && args.length && typeof args[args.length - 1] === "string") {
        this._lastOffset = args[args.length - 1];
      }
    }
    /**
     * Produces an ack callback to emit with an event.
     *
     * @private
     */
    ack(id) {
      const self2 = this;
      let sent = false;
      return function(...args) {
        if (sent)
          return;
        sent = true;
        self2.packet({
          type: PacketType.ACK,
          id,
          data: args
        });
      };
    }
    /**
     * Called upon a server acknowledgement.
     *
     * @param packet
     * @private
     */
    onack(packet) {
      const ack = this.acks[packet.id];
      if (typeof ack !== "function") {
        return;
      }
      delete this.acks[packet.id];
      if (ack.withError) {
        packet.data.unshift(null);
      }
      ack.apply(this, packet.data);
    }
    /**
     * Called upon server connect.
     *
     * @private
     */
    onconnect(id, pid) {
      this.id = id;
      this.recovered = pid && this._pid === pid;
      this._pid = pid;
      this.connected = true;
      this.emitBuffered();
      this._drainQueue(true);
      this.emitReserved("connect");
    }
    /**
     * Emit buffered events (received and emitted).
     *
     * @private
     */
    emitBuffered() {
      this.receiveBuffer.forEach((args) => this.emitEvent(args));
      this.receiveBuffer = [];
      this.sendBuffer.forEach((packet) => {
        this.notifyOutgoingListeners(packet);
        this.packet(packet);
      });
      this.sendBuffer = [];
    }
    /**
     * Called upon server disconnect.
     *
     * @private
     */
    ondisconnect() {
      this.destroy();
      this.onclose("io server disconnect");
    }
    /**
     * Called upon forced client/server side disconnections,
     * this method ensures the manager stops tracking us and
     * that reconnections don't get triggered for this.
     *
     * @private
     */
    destroy() {
      if (this.subs) {
        this.subs.forEach((subDestroy) => subDestroy());
        this.subs = void 0;
      }
      this.io["_destroy"](this);
    }
    /**
     * Disconnects the socket manually. In that case, the socket will not try to reconnect.
     *
     * If this is the last active Socket instance of the {@link Manager}, the low-level connection will be closed.
     *
     * @example
     * const socket = io();
     *
     * socket.on("disconnect", (reason) => {
     *   // console.log(reason); prints "io client disconnect"
     * });
     *
     * socket.disconnect();
     *
     * @return self
     */
    disconnect() {
      if (this.connected) {
        this.packet({ type: PacketType.DISCONNECT });
      }
      this.destroy();
      if (this.connected) {
        this.onclose("io client disconnect");
      }
      return this;
    }
    /**
     * Alias for {@link disconnect()}.
     *
     * @return self
     */
    close() {
      return this.disconnect();
    }
    /**
     * Sets the compress flag.
     *
     * @example
     * socket.compress(false).emit("hello");
     *
     * @param compress - if `true`, compresses the sending data
     * @return self
     */
    compress(compress) {
      this.flags.compress = compress;
      return this;
    }
    /**
     * Sets a modifier for a subsequent event emission that the event message will be dropped when this socket is not
     * ready to send messages.
     *
     * @example
     * socket.volatile.emit("hello"); // the server may or may not receive it
     *
     * @returns self
     */
    get volatile() {
      this.flags.volatile = true;
      return this;
    }
    /**
     * Sets a modifier for a subsequent event emission that the callback will be called with an error when the
     * given number of milliseconds have elapsed without an acknowledgement from the server:
     *
     * @example
     * socket.timeout(5000).emit("my-event", (err) => {
     *   if (err) {
     *     // the server did not acknowledge the event in the given delay
     *   }
     * });
     *
     * @returns self
     */
    timeout(timeout) {
      this.flags.timeout = timeout;
      return this;
    }
    /**
     * Adds a listener that will be fired when any event is emitted. The event name is passed as the first argument to the
     * callback.
     *
     * @example
     * socket.onAny((event, ...args) => {
     *   console.log(`got ${event}`);
     * });
     *
     * @param listener
     */
    onAny(listener) {
      this._anyListeners = this._anyListeners || [];
      this._anyListeners.push(listener);
      return this;
    }
    /**
     * Adds a listener that will be fired when any event is emitted. The event name is passed as the first argument to the
     * callback. The listener is added to the beginning of the listeners array.
     *
     * @example
     * socket.prependAny((event, ...args) => {
     *   console.log(`got event ${event}`);
     * });
     *
     * @param listener
     */
    prependAny(listener) {
      this._anyListeners = this._anyListeners || [];
      this._anyListeners.unshift(listener);
      return this;
    }
    /**
     * Removes the listener that will be fired when any event is emitted.
     *
     * @example
     * const catchAllListener = (event, ...args) => {
     *   console.log(`got event ${event}`);
     * }
     *
     * socket.onAny(catchAllListener);
     *
     * // remove a specific listener
     * socket.offAny(catchAllListener);
     *
     * // or remove all listeners
     * socket.offAny();
     *
     * @param listener
     */
    offAny(listener) {
      if (!this._anyListeners) {
        return this;
      }
      if (listener) {
        const listeners = this._anyListeners;
        for (let i = 0; i < listeners.length; i++) {
          if (listener === listeners[i]) {
            listeners.splice(i, 1);
            return this;
          }
        }
      } else {
        this._anyListeners = [];
      }
      return this;
    }
    /**
     * Returns an array of listeners that are listening for any event that is specified. This array can be manipulated,
     * e.g. to remove listeners.
     */
    listenersAny() {
      return this._anyListeners || [];
    }
    /**
     * Adds a listener that will be fired when any event is emitted. The event name is passed as the first argument to the
     * callback.
     *
     * Note: acknowledgements sent to the server are not included.
     *
     * @example
     * socket.onAnyOutgoing((event, ...args) => {
     *   console.log(`sent event ${event}`);
     * });
     *
     * @param listener
     */
    onAnyOutgoing(listener) {
      this._anyOutgoingListeners = this._anyOutgoingListeners || [];
      this._anyOutgoingListeners.push(listener);
      return this;
    }
    /**
     * Adds a listener that will be fired when any event is emitted. The event name is passed as the first argument to the
     * callback. The listener is added to the beginning of the listeners array.
     *
     * Note: acknowledgements sent to the server are not included.
     *
     * @example
     * socket.prependAnyOutgoing((event, ...args) => {
     *   console.log(`sent event ${event}`);
     * });
     *
     * @param listener
     */
    prependAnyOutgoing(listener) {
      this._anyOutgoingListeners = this._anyOutgoingListeners || [];
      this._anyOutgoingListeners.unshift(listener);
      return this;
    }
    /**
     * Removes the listener that will be fired when any event is emitted.
     *
     * @example
     * const catchAllListener = (event, ...args) => {
     *   console.log(`sent event ${event}`);
     * }
     *
     * socket.onAnyOutgoing(catchAllListener);
     *
     * // remove a specific listener
     * socket.offAnyOutgoing(catchAllListener);
     *
     * // or remove all listeners
     * socket.offAnyOutgoing();
     *
     * @param [listener] - the catch-all listener (optional)
     */
    offAnyOutgoing(listener) {
      if (!this._anyOutgoingListeners) {
        return this;
      }
      if (listener) {
        const listeners = this._anyOutgoingListeners;
        for (let i = 0; i < listeners.length; i++) {
          if (listener === listeners[i]) {
            listeners.splice(i, 1);
            return this;
          }
        }
      } else {
        this._anyOutgoingListeners = [];
      }
      return this;
    }
    /**
     * Returns an array of listeners that are listening for any event that is specified. This array can be manipulated,
     * e.g. to remove listeners.
     */
    listenersAnyOutgoing() {
      return this._anyOutgoingListeners || [];
    }
    /**
     * Notify the listeners for each packet sent
     *
     * @param packet
     *
     * @private
     */
    notifyOutgoingListeners(packet) {
      if (this._anyOutgoingListeners && this._anyOutgoingListeners.length) {
        const listeners = this._anyOutgoingListeners.slice();
        for (const listener of listeners) {
          listener.apply(this, packet.data);
        }
      }
    }
  };

  // node_modules/socket.io-client/build/esm/contrib/backo2.js
  function Backoff(opts) {
    opts = opts || {};
    this.ms = opts.min || 100;
    this.max = opts.max || 1e4;
    this.factor = opts.factor || 2;
    this.jitter = opts.jitter > 0 && opts.jitter <= 1 ? opts.jitter : 0;
    this.attempts = 0;
  }
  Backoff.prototype.duration = function() {
    var ms = this.ms * Math.pow(this.factor, this.attempts++);
    if (this.jitter) {
      var rand = Math.random();
      var deviation = Math.floor(rand * this.jitter * ms);
      ms = (Math.floor(rand * 10) & 1) == 0 ? ms - deviation : ms + deviation;
    }
    return Math.min(ms, this.max) | 0;
  };
  Backoff.prototype.reset = function() {
    this.attempts = 0;
  };
  Backoff.prototype.setMin = function(min) {
    this.ms = min;
  };
  Backoff.prototype.setMax = function(max) {
    this.max = max;
  };
  Backoff.prototype.setJitter = function(jitter) {
    this.jitter = jitter;
  };

  // node_modules/socket.io-client/build/esm/manager.js
  var Manager = class extends Emitter {
    constructor(uri, opts) {
      var _a;
      super();
      this.nsps = {};
      this.subs = [];
      if (uri && "object" === typeof uri) {
        opts = uri;
        uri = void 0;
      }
      opts = opts || {};
      opts.path = opts.path || "/socket.io";
      this.opts = opts;
      installTimerFunctions(this, opts);
      this.reconnection(opts.reconnection !== false);
      this.reconnectionAttempts(opts.reconnectionAttempts || Infinity);
      this.reconnectionDelay(opts.reconnectionDelay || 1e3);
      this.reconnectionDelayMax(opts.reconnectionDelayMax || 5e3);
      this.randomizationFactor((_a = opts.randomizationFactor) !== null && _a !== void 0 ? _a : 0.5);
      this.backoff = new Backoff({
        min: this.reconnectionDelay(),
        max: this.reconnectionDelayMax(),
        jitter: this.randomizationFactor()
      });
      this.timeout(null == opts.timeout ? 2e4 : opts.timeout);
      this._readyState = "closed";
      this.uri = uri;
      const _parser = opts.parser || esm_exports;
      this.encoder = new _parser.Encoder();
      this.decoder = new _parser.Decoder();
      this._autoConnect = opts.autoConnect !== false;
      if (this._autoConnect)
        this.open();
    }
    reconnection(v) {
      if (!arguments.length)
        return this._reconnection;
      this._reconnection = !!v;
      if (!v) {
        this.skipReconnect = true;
      }
      return this;
    }
    reconnectionAttempts(v) {
      if (v === void 0)
        return this._reconnectionAttempts;
      this._reconnectionAttempts = v;
      return this;
    }
    reconnectionDelay(v) {
      var _a;
      if (v === void 0)
        return this._reconnectionDelay;
      this._reconnectionDelay = v;
      (_a = this.backoff) === null || _a === void 0 ? void 0 : _a.setMin(v);
      return this;
    }
    randomizationFactor(v) {
      var _a;
      if (v === void 0)
        return this._randomizationFactor;
      this._randomizationFactor = v;
      (_a = this.backoff) === null || _a === void 0 ? void 0 : _a.setJitter(v);
      return this;
    }
    reconnectionDelayMax(v) {
      var _a;
      if (v === void 0)
        return this._reconnectionDelayMax;
      this._reconnectionDelayMax = v;
      (_a = this.backoff) === null || _a === void 0 ? void 0 : _a.setMax(v);
      return this;
    }
    timeout(v) {
      if (!arguments.length)
        return this._timeout;
      this._timeout = v;
      return this;
    }
    /**
     * Starts trying to reconnect if reconnection is enabled and we have not
     * started reconnecting yet
     *
     * @private
     */
    maybeReconnectOnOpen() {
      if (!this._reconnecting && this._reconnection && this.backoff.attempts === 0) {
        this.reconnect();
      }
    }
    /**
     * Sets the current transport `socket`.
     *
     * @param {Function} fn - optional, callback
     * @return self
     * @public
     */
    open(fn) {
      if (~this._readyState.indexOf("open"))
        return this;
      this.engine = new Socket(this.uri, this.opts);
      const socket2 = this.engine;
      const self2 = this;
      this._readyState = "opening";
      this.skipReconnect = false;
      const openSubDestroy = on(socket2, "open", function() {
        self2.onopen();
        fn && fn();
      });
      const onError = (err) => {
        this.cleanup();
        this._readyState = "closed";
        this.emitReserved("error", err);
        if (fn) {
          fn(err);
        } else {
          this.maybeReconnectOnOpen();
        }
      };
      const errorSub = on(socket2, "error", onError);
      if (false !== this._timeout) {
        const timeout = this._timeout;
        const timer = this.setTimeoutFn(() => {
          openSubDestroy();
          onError(new Error("timeout"));
          socket2.close();
        }, timeout);
        if (this.opts.autoUnref) {
          timer.unref();
        }
        this.subs.push(() => {
          this.clearTimeoutFn(timer);
        });
      }
      this.subs.push(openSubDestroy);
      this.subs.push(errorSub);
      return this;
    }
    /**
     * Alias for open()
     *
     * @return self
     * @public
     */
    connect(fn) {
      return this.open(fn);
    }
    /**
     * Called upon transport open.
     *
     * @private
     */
    onopen() {
      this.cleanup();
      this._readyState = "open";
      this.emitReserved("open");
      const socket2 = this.engine;
      this.subs.push(
        on(socket2, "ping", this.onping.bind(this)),
        on(socket2, "data", this.ondata.bind(this)),
        on(socket2, "error", this.onerror.bind(this)),
        on(socket2, "close", this.onclose.bind(this)),
        // @ts-ignore
        on(this.decoder, "decoded", this.ondecoded.bind(this))
      );
    }
    /**
     * Called upon a ping.
     *
     * @private
     */
    onping() {
      this.emitReserved("ping");
    }
    /**
     * Called with data.
     *
     * @private
     */
    ondata(data) {
      try {
        this.decoder.add(data);
      } catch (e) {
        this.onclose("parse error", e);
      }
    }
    /**
     * Called when parser fully decodes a packet.
     *
     * @private
     */
    ondecoded(packet) {
      nextTick(() => {
        this.emitReserved("packet", packet);
      }, this.setTimeoutFn);
    }
    /**
     * Called upon socket error.
     *
     * @private
     */
    onerror(err) {
      this.emitReserved("error", err);
    }
    /**
     * Creates a new socket for the given `nsp`.
     *
     * @return {Socket}
     * @public
     */
    socket(nsp, opts) {
      let socket2 = this.nsps[nsp];
      if (!socket2) {
        socket2 = new Socket2(this, nsp, opts);
        this.nsps[nsp] = socket2;
      } else if (this._autoConnect && !socket2.active) {
        socket2.connect();
      }
      return socket2;
    }
    /**
     * Called upon a socket close.
     *
     * @param socket
     * @private
     */
    _destroy(socket2) {
      const nsps = Object.keys(this.nsps);
      for (const nsp of nsps) {
        const socket3 = this.nsps[nsp];
        if (socket3.active) {
          return;
        }
      }
      this._close();
    }
    /**
     * Writes a packet.
     *
     * @param packet
     * @private
     */
    _packet(packet) {
      const encodedPackets = this.encoder.encode(packet);
      for (let i = 0; i < encodedPackets.length; i++) {
        this.engine.write(encodedPackets[i], packet.options);
      }
    }
    /**
     * Clean up transport subscriptions and packet buffer.
     *
     * @private
     */
    cleanup() {
      this.subs.forEach((subDestroy) => subDestroy());
      this.subs.length = 0;
      this.decoder.destroy();
    }
    /**
     * Close the current socket.
     *
     * @private
     */
    _close() {
      this.skipReconnect = true;
      this._reconnecting = false;
      this.onclose("forced close");
    }
    /**
     * Alias for close()
     *
     * @private
     */
    disconnect() {
      return this._close();
    }
    /**
     * Called when:
     *
     * - the low-level engine is closed
     * - the parser encountered a badly formatted packet
     * - all sockets are disconnected
     *
     * @private
     */
    onclose(reason, description) {
      var _a;
      this.cleanup();
      (_a = this.engine) === null || _a === void 0 ? void 0 : _a.close();
      this.backoff.reset();
      this._readyState = "closed";
      this.emitReserved("close", reason, description);
      if (this._reconnection && !this.skipReconnect) {
        this.reconnect();
      }
    }
    /**
     * Attempt a reconnection.
     *
     * @private
     */
    reconnect() {
      if (this._reconnecting || this.skipReconnect)
        return this;
      const self2 = this;
      if (this.backoff.attempts >= this._reconnectionAttempts) {
        this.backoff.reset();
        this.emitReserved("reconnect_failed");
        this._reconnecting = false;
      } else {
        const delay2 = this.backoff.duration();
        this._reconnecting = true;
        const timer = this.setTimeoutFn(() => {
          if (self2.skipReconnect)
            return;
          this.emitReserved("reconnect_attempt", self2.backoff.attempts);
          if (self2.skipReconnect)
            return;
          self2.open((err) => {
            if (err) {
              self2._reconnecting = false;
              self2.reconnect();
              this.emitReserved("reconnect_error", err);
            } else {
              self2.onreconnect();
            }
          });
        }, delay2);
        if (this.opts.autoUnref) {
          timer.unref();
        }
        this.subs.push(() => {
          this.clearTimeoutFn(timer);
        });
      }
    }
    /**
     * Called upon successful reconnect.
     *
     * @private
     */
    onreconnect() {
      const attempt = this.backoff.attempts;
      this._reconnecting = false;
      this.backoff.reset();
      this.emitReserved("reconnect", attempt);
    }
  };

  // node_modules/socket.io-client/build/esm/index.js
  var cache = {};
  function lookup2(uri, opts) {
    if (typeof uri === "object") {
      opts = uri;
      uri = void 0;
    }
    opts = opts || {};
    const parsed = url(uri, opts.path || "/socket.io");
    const source = parsed.source;
    const id = parsed.id;
    const path = parsed.path;
    const sameNamespace = cache[id] && path in cache[id]["nsps"];
    const newConnection = opts.forceNew || opts["force new connection"] || false === opts.multiplex || sameNamespace;
    let io;
    if (newConnection) {
      io = new Manager(source, opts);
    } else {
      if (!cache[id]) {
        cache[id] = new Manager(source, opts);
      }
      io = cache[id];
    }
    if (parsed.query && !opts.query) {
      opts.query = parsed.queryKey;
    }
    return io.socket(parsed.path, opts);
  }
  Object.assign(lookup2, {
    Manager,
    Socket: Socket2,
    io: lookup2,
    connect: lookup2
  });

  // src/lib/types.ts
  var SETTING_DEFAULTS = {
    serverUrl: "http://localhost:3000",
    agentSocketUrl: "",
    agentToken: "",
    deviceId: "",
    agentName: "\u6D4F\u89C8\u5668\u63D2\u4EF6",
    agentGroup: "",
    aiKey: "",
    aiBaseUrl: "https://api.anthropic.com",
    aiModel: "claude-sonnet-4-5",
    offlineMode: false,
    offlinePrompt: "\u4F60\u662F HeySure AI\uFF0C\u8FD0\u884C\u5728\u6D4F\u89C8\u5668\u63D2\u4EF6\u7684\u672C\u5730\u5BF9\u8BDD\u7A97\u53E3\u4E2D\u3002\u4F60\u53EF\u4EE5\u76F4\u63A5\u56DE\u7B54\u7528\u6237\uFF0C\u4E5F\u53EF\u4EE5\u8C03\u7528\u672C\u673A\u6D4F\u89C8\u5668 MCP \u5DE5\u5177\u5B8C\u6210\u7F51\u9875\u6D4F\u89C8\u3001\u70B9\u51FB\u3001\u8F93\u5165\u3001\u622A\u56FE\u3001\u63D0\u53D6\u6570\u636E\u3001\u7BA1\u7406\u6807\u7B7E\u9875\u7B49\u4EFB\u52A1\u3002\u9700\u8981\u64CD\u4F5C\u6D4F\u89C8\u5668\u65F6\u4F18\u5148\u4F7F\u7528\u5DE5\u5177\uFF0C\u5E76\u7528\u548C\u7528\u6237\u76F8\u540C\u7684\u8BED\u8A00\u56DE\u590D\u3002",
    mouseFx: true,
    theme: "dark",
    selectedAiConfigId: null
  };

  // src/lib/storage.ts
  async function getSettings() {
    const keys = Object.keys(SETTING_DEFAULTS);
    const stored = await chrome.storage.local.get(keys);
    return { ...SETTING_DEFAULTS, ...stored };
  }
  async function saveSettings(partial) {
    await chrome.storage.local.set(partial);
  }
  var ACT_KEY = "_activity_buffer";
  var MAX_ACT = 100;
  async function pushActivity(entry) {
    const r = await chrome.storage.session.get(ACT_KEY).catch(() => ({}));
    const buf = r[ACT_KEY] || [];
    buf.push(entry);
    if (buf.length > MAX_ACT)
      buf.splice(0, buf.length - MAX_ACT);
    await chrome.storage.session.set({ [ACT_KEY]: buf }).catch(() => {
    });
  }
  async function getActivity() {
    const r = await chrome.storage.session.get(ACT_KEY).catch(() => ({}));
    return r[ACT_KEY] || [];
  }
  var AUTH_KEY = "_auth_state";
  var AUTH_DEFAULT = {
    token: "",
    account: "",
    password: "",
    rememberLogin: false,
    userId: null,
    userName: "",
    avatar: ""
  };
  async function getAuth() {
    const r = await chrome.storage.local.get(AUTH_KEY);
    return { ...AUTH_DEFAULT, ...r[AUTH_KEY] || {} };
  }
  var TOOL_DESC_KEY = "_tool_desc_overrides";
  async function getToolDescOverrides() {
    const r = await chrome.storage.local.get(TOOL_DESC_KEY);
    const v = r[TOOL_DESC_KEY];
    return v && typeof v === "object" ? v : {};
  }
  async function clearToolDescOverrides(names) {
    const all = await getToolDescOverrides();
    let changed = false;
    for (const raw of names) {
      const name = String(raw || "").trim();
      if (name && all[name]) {
        delete all[name];
        changed = true;
      }
    }
    if (changed)
      await chrome.storage.local.set({ [TOOL_DESC_KEY]: all });
  }

  // src/lib/client.ts
  var trimUrl = (u) => String(u || "").replace(/\/+$/, "");
  var authHeaders = (token, withJson = false) => {
    const h = { Authorization: `Bearer ${token}` };
    if (withJson)
      h["Content-Type"] = "application/json";
    return h;
  };
  var ApiError = class extends Error {
    status;
    constructor(message, status) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  };
  async function parseError(res, fallback) {
    try {
      const data = await res.json();
      return String(data?.detail || data?.error || fallback);
    } catch {
      return `${fallback} (HTTP ${res.status})`;
    }
  }
  async function requestJson(url2, init, fallback) {
    const res = await fetch(url2, { ...init, signal: init.signal ?? AbortSignal.timeout(2e4) });
    if (!res.ok)
      throw new ApiError(await parseError(res, fallback), res.status);
    return await res.json();
  }
  async function getAgentEndpoint(serverUrl, token) {
    const data = await requestJson(
      `${trimUrl(serverUrl)}/api/auth/agent-endpoint`,
      { headers: authHeaders(token) },
      "\u83B7\u53D6 Agent \u8FDE\u63A5\u5730\u5740\u5931\u8D25"
    );
    const agentSocketUrl = trimUrl(data.agent_socket_url || "");
    if (!agentSocketUrl)
      throw new Error("\u670D\u52A1\u5668\u672A\u8FD4\u56DE Agent \u8FDE\u63A5\u5730\u5740");
    return agentSocketUrl;
  }
  var DEFAULT_ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];
  async function getIceServers(serverUrl, token) {
    try {
      const data = await requestJson(
        `${trimUrl(serverUrl)}/api/rtc/ice-servers`,
        { headers: authHeaders(token) },
        "\u83B7\u53D6 ICE \u670D\u52A1\u5668\u914D\u7F6E\u5931\u8D25"
      );
      const list = Array.isArray(data.ice_servers) ? data.ice_servers : [];
      return list.length ? list : DEFAULT_ICE_SERVERS;
    } catch {
      return DEFAULT_ICE_SERVERS;
    }
  }

  // src/lib/tools/definitions.ts
  var BROWSER_TOOLS = [
    // ───── 页面观察 ───────────────────────────────────────────────────────
    {
      name: "browser_observe",
      description: '\u611F\u77E5\u5F53\u524D\u89C6\u53E3\u91CC\u7528\u6237\u80FD\u770B\u5230\u7684\u5185\u5BB9\uFF0C\u533A\u5206\u666E\u901A\u53EF\u89C1\u6587\u672C\u3001\u56FE\u7247/\u89C6\u9891/\u97F3\u9891\u3001iframe \u8FB9\u754C\u4E0E\u53EF\u4EA4\u4E92\u5143\u7D20\uFF1A\u8FD4\u56DE\u5355\u4E00 items \u6DF7\u6392\u5217\u8868\uFF08\u5DF2\u53BB\u91CD\uFF0C\u4E0D\u518D\u53E6\u9644 texts/elements/frames \u6570\u7EC4\uFF0C\u5168\u90E8\u5185\u5BB9\u90FD\u5728 items \u91CC\u7528 kind \u533A\u5206\uFF09\uFF0C\u5176\u4E2D kind=text \u662F\u9875\u9762\u6587\u5B57\uFF08\u4E0D\u53EF\u70B9\u51FB\uFF09\uFF0Ckind=media \u662F\u56FE\u7247/\u89C6\u9891/\u97F3\u9891\uFF08category=image/video/audio\uFF09\uFF0Ckind=frame \u662F\u9875\u9762\u5185 iframe \u8FB9\u754C\uFF08accessible=true \u8868\u793A\u540C\u6E90\u5DF2\u626B\u63CF\uFF0C\u5B50\u63A7\u4EF6\u89C1 inFrame=true \u7684 interactive\uFF1Baccessible=false \u4E3A\u8DE8\u57DF\u4E0D\u53EF\u7528\u5750\u6807\u70B9\u51FB\uFF09\uFF0Ckind=interactive \u662F\u6700\u9876\u5C42\u3001\u672A\u88AB\u906E\u6321\u7684\u6309\u94AE/\u94FE\u63A5/\u8F93\u5165\u6846/\u4E0B\u62C9/\u83DC\u5355\u9879\u7B49\uFF0C\u6BCF\u4E2A interactive \u90FD\u5E26\u72EC\u7ACB id\u3002\u4E3A\u8282\u7701\u4E0A\u4E0B\u6587\uFF0C\u6BCF\u6761\u5DF2\u7701\u7565 selector/rect/tag\uFF0C\u4EC5\u4FDD\u7559 id/role/category/text/center\u2014\u2014\u8BF7\u7528 ref:id \u70B9\u51FB\uFF0C\u4E0D\u8981\u4F9D\u8D56 selector\u3002\u540C\u6E90 iframe \u5185\u7684\u5143\u7D20\u4F1A\u4E00\u5E76\u626B\u63CF\uFF0CinFrame=true \u4E14 center/rect \u5DF2\u6362\u7B97\u4E3A\u9875\u9762\u89C6\u53E3\u5750\u6807\uFF0CframeSelector \u6307\u5411\u6240\u5C5E iframe\uFF0C\u70B9\u51FB\u4ECD\u7528 browser_action {action:"click", ref:id}\u3002\u8DE8\u57DF iframe \u5185\u5BB9\u73B0\u4E5F\u4F1A\u88AB\u626B\u63CF\u5E76\u5408\u5E76\u8FDB\u6765\uFF1A\u8FD9\u4E9B items \u5E26 crossOrigin=true\u3001frameId \u548C\u5F62\u5982 "3:5" \u7684 id\uFF0C\u5176 center/rect \u662F\u8BE5 iframe \u5185\u90E8\u5750\u6807\uFF08coordsLocalToFrame=true\uFF0C\u52FF\u4E0E\u4E3B\u9875\u9762\u5750\u6807\u6216\u622A\u56FE\u5750\u6807\u6DF7\u7528\uFF09\uFF0C\u70B9\u51FB/\u8F93\u5165\u76F4\u63A5\u628A\u8BE5 id \u5F53 ref \u56DE\u4F20\u5373\u53EF\u3002\u82E5\u5339\u914D\u6761\u76EE\u8D85\u8FC7 limit/max_items\uFF0C\u9ED8\u8BA4\u4E0D\u8FD4\u56DE items\uFF0C\u53EA\u8FD4\u56DE tooMany=true \u4E0E categoryCounts\uFF0C\u63D0\u793A\u7EE7\u7EED\u7528 filter/tag/keyword \u7F29\u5C0F\u8303\u56F4\u3002\u7528\u9014\uFF1A\u65E2\u80FD\u8BFB\u53D6\u9875\u9762\u6587\u5B57\uFF0C\u53C8\u80FD\u4F5C\u4E3A\u70B9\u51FB/\u8F93\u5165\u524D\u7684\u9996\u9009\u89C2\u5BDF\u624B\u6BB5\uFF0C\u914D\u5408 browser_screenshot \u5F62\u6210\u300C\u770B\u56FE\u2014\u6309 id \u70B9\u51FB\u300D\u95ED\u73AF\u3002\u573A\u666F\uFF1A\u5148 observe \u7406\u89E3\u9875\u9762\uFF0C\u518D browser_action {action:"click", ref:id} \u7CBE\u786E\u70B9\u51FB\uFF1B\u5143\u7D20\u592A\u591A\u65F6\u7528 filter \u53EA\u770B\u67D0\u7C7B\uFF08\u5982 filter:"button" \u6216 filter:"image"\uFF09\u3001tag \u6307\u5B9A HTML \u6807\u7B7E\u3001keyword \u67E5\u5173\u952E\u8BCD\uFF1B\u9875\u9762\u53D8\u5316\u540E\u91CD\u65B0 observe \u4EE5\u5237\u65B0 id\u3002\u52FF\u7528 Playwright \u8BED\u6CD5\uFF08\u5982 button:has-text\uFF09\uFF1B\u7528 text \u53C2\u6570\u6216 observe \u8FD4\u56DE\u7684 ref/selector\u3002',
      input_schema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "\u6700\u591A\u8FD4\u56DE\u7684\u53EF\u4EA4\u4E92\u5143\u7D20\u6761\u76EE\u6570\uFF1B\u8D85\u8FC7\u65F6\u9ED8\u8BA4\u4E0D\u8FD4\u56DE items\uFF0C\u53EA\u8FD4\u56DE tooMany/categoryCounts\uFF0C\u63D0\u793A\u7EE7\u7EED\u7B5B\u9009\u3002\u9ED8\u8BA4 120\uFF0C\u6700\u5927 200\u3002" },
          max_items: { type: "number", description: "\u6700\u7EC8 items \u6DF7\u6392\u5217\u8868\u5141\u8BB8\u8FD4\u56DE\u7684\u6700\u5927\u603B\u6761\u6570\uFF1B\u8D85\u8FC7\u65F6\u9ED8\u8BA4\u4E0D\u8FD4\u56DE items\uFF0C\u53EA\u8FD4\u56DE categoryCounts\u3002\u9ED8\u8BA4\u7EA6\u7B49\u4E8E limit + text_limit + 40\uFF0C\u6700\u5927 500\u3002" },
          filter: {
            type: ["string", "array"],
            items: { type: "string" },
            description: '\u6309\u7C7B\u522B\u7B5B\u9009\u53EA\u8FD4\u56DE\u60F3\u770B\u7684\u5143\u7D20\uFF0C\u7F29\u5C0F\u566A\u97F3\u3002\u53EF\u4F20\u5355\u4E2A\u5B57\u7B26\u4E32\u3001\u9017\u53F7\u5206\u9694\u5B57\u7B26\u4E32\u6216\u5B57\u7B26\u4E32\u6570\u7EC4\u3002\u53EF\u9009\u7C7B\u522B\uFF1Abutton\uFF08\u6309\u94AE\uFF09\u3001link\uFF08\u94FE\u63A5\uFF09\u3001input\uFF08\u8F93\u5165\u6846/\u6587\u672C\u57DF/\u53EF\u7F16\u8F91\u533A\uFF09\u3001select\uFF08\u4E0B\u62C9\u6846\uFF09\u3001checkbox\uFF08\u590D\u9009/\u5F00\u5173\uFF09\u3001radio\uFF08\u5355\u9009\uFF09\u3001tab\uFF08\u6807\u7B7E\u9875\uFF09\u3001menuitem\uFF08\u83DC\u5355\u9879\uFF09\u3001option\uFF08\u9009\u9879\uFF09\u3001label\uFF08\u6807\u7B7E\u5143\u7D20\uFF09\u3001image/img\uFF08\u56FE\u7247\uFF09\u3001video\uFF08\u89C6\u9891\uFF09\u3001audio\uFF08\u97F3\u9891\uFF09\u3001media\uFF08\u5168\u90E8\u56FE\u7247/\u89C6\u9891/\u97F3\u9891\uFF09\u3001text\uFF08\u666E\u901A\u53EF\u89C1\u6587\u672C\uFF09\u3001frame\uFF08iframe \u8FB9\u754C\uFF09\u3001interactive\uFF08\u6240\u6709\u53EF\u4EA4\u4E92\u5143\u7D20\uFF0C\u4E0D\u542B\u7EAF\u6587\u672C/\u5A92\u4F53\uFF09\u3002\u4F8B\uFF1Afilter:"button" \u53EA\u770B\u6309\u94AE\uFF1Bfilter:["input","select"] \u53EA\u770B\u8F93\u5165\u6846\u548C\u4E0B\u62C9\u6846\uFF1Bfilter:"image" \u53EA\u770B\u56FE\u7247\uFF1Bfilter:"text" \u53EA\u770B\u5168\u90E8\u6587\u5B57\u5143\u7D20\uFF1B\u4E0D\u4F20\u6216\u4F20 "all" \u5219\u8FD4\u56DE\u5168\u90E8\u3002\u8FD4\u56DE\u7684\u6BCF\u4E2A interactive \u9879\u90FD\u5E26 category \u5B57\u6BB5\u6807\u660E\u5176\u7C7B\u522B\u3002'
          },
          tag: { type: ["string", "array"], items: { type: "string" }, description: '\u6309 HTML \u6807\u7B7E\u540D\u8FDB\u4E00\u6B65\u7B5B\u9009\uFF0C\u53EF\u4F20 "img"\u3001"video"\u3001"button"\u3001"a"\u3001"input"\u3001"label"\u3001"iframe" \u7B49\uFF0C\u4E5F\u53EF\u4F20\u6570\u7EC4\u6216\u9017\u53F7\u5206\u9694\u5B57\u7B26\u4E32\u3002' },
          tags: { type: ["string", "array"], items: { type: "string" }, description: "tag \u7684\u522B\u540D\u3002" },
          keyword: { type: "string", description: "\u6309\u5173\u952E\u8BCD\u7B5B\u9009\uFF0C\u5339\u914D\u53EF\u89C1\u6587\u672C\u3001alt/title/aria-label\u3001name/id\u3001src/href \u7B49\u5E38\u7528\u5B57\u6BB5\uFF1B\u4E5F\u517C\u5BB9 query/text_filter\u3002" },
          query: { type: "string", description: "keyword \u7684\u517C\u5BB9\u522B\u540D\u3002" },
          text_filter: { type: "string", description: "keyword \u7684\u517C\u5BB9\u522B\u540D\u3002" },
          include_text: { type: "boolean", description: "\u662F\u5426\u540C\u65F6\u5305\u542B\u666E\u901A\u53EF\u89C1\u6587\u672C\uFF08items \u4E2D kind=text \u7684\u6761\u76EE\uFF09\u3002\u9ED8\u8BA4 true\uFF1B\u4F20 false \u65F6\u53EA\u8FD4\u56DE\u53EF\u4EA4\u4E92\u5143\u7D20\u3002" },
          text_limit: { type: "number", description: "\u6700\u591A\u8FD4\u56DE\u7684\u666E\u901A\u53EF\u89C1\u6587\u672C\u6761\u6570\u3002\u9ED8\u8BA4 200\uFF0C\u6700\u5927 500\u3002" },
          allow_truncate: { type: "boolean", description: "\u4E3A true \u65F6\u5373\u4F7F\u8D85\u8FC7 limit/max_items \u4E5F\u622A\u65AD\u8FD4\u56DE\uFF1B\u9ED8\u8BA4 false\uFF0C\u5373\u8D85\u91CF\u65F6\u4E0D\u8FD4\u56DE items\uFF0C\u53EA\u7ED9 categoryCounts \u548C\u7B5B\u9009\u63D0\u793A\u3002" },
          frame: { type: "string", description: "\u53EA\u89C2\u5BDF\u6307\u5B9A\u540C\u6E90 iframe \u5185\u90E8\uFF08\u542B\u5176\u5B50 iframe\uFF09\uFF1A\u4F20\u8BE5 iframe \u7684 CSS selector\uFF0C\u5373\u4E0A\u6B21 observe \u4E2D kind=frame \u6761\u76EE\u7684 frameSelector\u3002\u9875\u9762\u5143\u7D20\u592A\u591A\u3001\u8FD4\u56DE\u5185\u5BB9\u88AB\u622A\u65AD\u65F6\uFF0C\u7528\u5B83\u4E0B\u94BB\u5230\u76EE\u6807 iframe\uFF08\u5982\u5D4C\u5165\u7684\u5BCC\u6587\u672C\u7F16\u8F91\u5668\uFF09\uFF0C\u5355\u72EC\u62FF\u5B83\u5185\u90E8\u7684\u5B8C\u6574\u5143\u7D20\u5217\u8868\u3002" },
          frame_path: { type: "array", items: { type: "string" }, description: "\u5D4C\u5957 iframe \u7684\u9010\u5C42 selector \u8DEF\u5F84\uFF08\u5373 observe \u8FD4\u56DE\u7684 framePath\uFF09\uFF0C\u4ECE\u9876\u5C42\u6587\u6863\u5230\u76EE\u6807 iframe\u3002\u4E0E frame \u4E8C\u9009\u4E00\uFF0C\u5D4C\u5957\u591A\u5C42\u65F6\u7528\u5B83\u3002" },
          mark: { type: "boolean", description: "\u662F\u5426\u5728\u9875\u9762\u4E0A\u7ED8\u5236\u65E0\u5E8F\u53F7\u72B6\u6001\u8272\u6807\u8BB0\uFF0C\u4FBF\u4E8E\u968F\u540E\u622A\u56FE\u67E5\u770B\u3002\u9ED8\u8BA4 true\uFF1B\u7EFF\u8272=\u53EF\u70B9\u51FB\uFF0C\u7EA2\u8272=\u4E0D\u53EF\u70B9\u51FB/\u88AB\u7981\u7528/\u88AB\u906E\u6321\uFF1B\u4F20 false \u4EC5\u8FD4\u56DE\u5217\u8868\u5E76\u6E05\u9664\u5DF2\u6709\u6807\u8BB0\u3002\u6807\u8BB0\u4EC5\u4E3A\u89C6\u89C9\u53E0\u52A0\uFF0C\u4E0D\u5F71\u54CD\u5176\u4ED6\u53D6\u6570\u5DE5\u5177\u6216\u622A\u56FE\uFF0C\u4E5F\u4E0D\u62E6\u622A\u70B9\u51FB\u3002" },
          observe_timeout_ms: { type: "number", description: "\u672C\u6B21 observe \u7B49\u5F85/\u626B\u63CF\u7684\u6700\u5927\u65F6\u957F\uFF08\u6BEB\u79D2\uFF0C\u9ED8\u8BA4 8000\uFF0C\u4E0A\u9650 30000\uFF09\uFF1B\u5305\u62EC\u9876\u5C42\u9875\u9762\u4E0E\u8DE8\u57DF iframe \u7684\u89C2\u5BDF\uFF0C\u8D85\u65F6\u5219\u7ED3\u675F\u672C\u6B21\u8C03\u7528\u3002" },
          wait_timeout_ms: { type: "number", description: "observe_timeout_ms \u7684\u901A\u7528\u522B\u540D\uFF1A\u672C\u6B21 observe \u6700\u591A\u7B49\u5F85\u591A\u4E45\u3002" },
          max_wait_ms: { type: "number", description: "wait_timeout_ms \u7684\u517C\u5BB9\u522B\u540D\u3002" }
        }
      }
    },
    {
      name: "browser_screenshot",
      description: "\u5BF9\u5F53\u524D\u6807\u7B7E\u9875\u622A\u56FE\uFF1A\u53EF\u622A\u53EF\u89C6\u533A\u3001\u6574\u9875\u3001\u67D0\u4E2A CSS/\u6587\u672C\u5339\u914D\u7684\u5143\u7D20\uFF0C\u6216\u4E00\u5757\u77E9\u5F62\u533A\u57DF\uFF0C\u9ED8\u8BA4\u8FD4\u56DE\u5B8C\u6574 base64 \u56FE\u7247 dataUrl\uFF0C\u5E76\u4FDD\u5B58\u5230\u670D\u52A1\u5668\u7528\u4E8E\u53D1\u9001\u7ED9\u7528\u6237\uFF1B\u4F20 send_to_user:false \u53EF\u53EA\u7ED9 AI \u4F7F\u7528\uFF08\u622A\u56FE\u88AB\u7981\u7528\u6216\u65E0\u6743\u9650\u65F6\u8FD4\u56DE\u53EF\u8BFB\u7684\u9519\u8BEF\u8BF4\u660E\uFF09\u3002\u7528\u9014\uFF1A\u8BA9 AI\u300C\u770B\u89C1\u300D\u9875\u9762\u3002\u573A\u666F\uFF1A\u6838\u5BF9\u9875\u9762\u72B6\u6001\u3001\u5728\u65E0\u6CD5\u8BFB\u53D6\u6587\u672C\u65F6\u6539\u7528\u89C6\u89C9\u7406\u89E3\u3002",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "\u8981\u622A\u56FE\u7684\u5143\u7D20 CSS selector\u3002" },
          text: { type: "string", description: "\u5F53\u4E0D\u4F20 selector \u65F6\uFF0C\u7528\u53EF\u89C1\u6587\u672C\u5B9A\u4F4D\u8981\u622A\u56FE\u7684\u5143\u7D20\u3002" },
          full_page: { type: "boolean", description: "\u622A\u53D6\u6574\u4E2A\u53EF\u6EDA\u52A8\u9875\u9762\u3002" },
          x: { type: "number", description: "\u533A\u57DF\u5DE6\u4E0A\u89D2 X \u5750\u6807\uFF1B\u9664\u975E coordinate_space \u8BBE\u4E3A page\uFF0C\u5426\u5219\u6309\u89C6\u53E3\u5750\u6807\u3002" },
          y: { type: "number", description: "\u533A\u57DF\u5DE6\u4E0A\u89D2 Y \u5750\u6807\uFF1B\u9664\u975E coordinate_space \u8BBE\u4E3A page\uFF0C\u5426\u5219\u6309\u89C6\u53E3\u5750\u6807\u3002" },
          width: { type: "number", description: "\u533A\u57DF\u5BBD\u5EA6\uFF08CSS \u50CF\u7D20\uFF09\u3002" },
          height: { type: "number", description: "\u533A\u57DF\u9AD8\u5EA6\uFF08CSS \u50CF\u7D20\uFF09\u3002" },
          clip: { type: "object", description: "\u533A\u57DF\u5BF9\u8C61\u5199\u6CD5\uFF1A{x,y,width,height,coordinate_space?}\uFF0C\u4E0E x/y/width/height \u4E8C\u9009\u4E00\u3002" },
          coordinate_space: { type: "string", enum: ["viewport", "page"], description: "x/y/clip \u7684\u5750\u6807\u7CFB\uFF1Aviewport \u89C6\u53E3\u6216 page \u6574\u9875\u3002\u9ED8\u8BA4 viewport\u3002" },
          margin: { type: "number", description: "\u6309 selector/text \u622A\u5143\u7D20\u65F6\uFF0C\u5411\u56DB\u5468\u6269\u5C55\u7684\u989D\u5916 CSS \u50CF\u7D20\u3002" },
          scroll_into_view: { type: "boolean", description: "\u6D4B\u91CF\u524D\u5148\u628A\u76EE\u6807\u5143\u7D20\u6EDA\u52A8\u8FDB\u89C6\u53E3\u3002\u9ED8\u8BA4 true\u3002" },
          format: { type: "string", enum: ["png", "jpeg", "webp"], description: "\u56FE\u7247\u683C\u5F0F\u3002\u9ED8\u8BA4 png\u3002" },
          quality: { type: "number", description: "JPEG/WebP \u8D28\u91CF\uFF0C0-100\u3002" },
          scale: { type: "number", description: "CDP \u622A\u56FE\u7684\u7F29\u653E\u6BD4\u4F8B\u3002\u9ED8\u8BA4 1\u3002" },
          max_area: { type: "number", description: "\u5141\u8BB8\u7684\u6700\u5927\u622A\u56FE\u9762\u79EF\uFF08CSS \u50CF\u7D20\uFF09\u3002\u9ED8\u8BA4 25000000\u3002" },
          retries: { type: "number", description: "\u53EF\u89C6\u533A\u622A\u56FE\u9047\u5230\u6D3B\u52A8\u6807\u7B7E/\u9650\u6D41\u7B49\u4E34\u65F6\u5931\u8D25\u65F6\u7684\u91CD\u8BD5\u6B21\u6570\u3002\u9ED8\u8BA4 1\u3002" },
          timeout_ms: { type: "number", description: "\u5355\u9636\u6BB5\u622A\u56FE\u603B\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09\u3002\u53EF\u89C6\u622A\u56FE\u9ED8\u8BA4 8000\uFF0CCDP \u9ED8\u8BA4 12000\u3002" },
          visible_timeout_ms: { type: "number", description: "chrome.tabs.captureVisibleTab \u7684\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09\u3002\u9ED8\u8BA4 8000\u3002" },
          cdp_timeout_ms: { type: "number", description: "\u6BCF\u6761 Chrome DevTools Protocol \u622A\u56FE\u547D\u4EE4\u7684\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09\u3002\u9ED8\u8BA4 12000\u3002" },
          content_timeout_ms: { type: "number", description: "\u5728\u9875\u9762\u4E2D\u6D4B\u91CF selector/text \u76EE\u6807\u7684\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09\u3002\u9ED8\u8BA4 5000\u3002" },
          max_data_url_chars: { type: "number", description: "\u7ECF Socket.IO \u8FD4\u56DE\u7684 data URL \u6700\u5927\u957F\u5EA6\u3002\u9ED8\u8BA4 8000000\u3002" },
          allow_large_data_url: { type: "boolean", description: "\u5141\u8BB8\u8FD4\u56DE\u8D85\u8FC7 max_data_url_chars \u7684\u622A\u56FE\u3002\u9ED8\u8BA4 false\u3002" },
          send_to_user: { type: "boolean", description: "\u662F\u5426\u628A\u622A\u56FE\u901A\u8FC7\u5F53\u524D AI \u7684\u673A\u5668\u4EBA\u53D1\u9001\u7ED9\u7528\u6237\u3002\u9ED8\u8BA4 true\uFF1B\u4F20 false \u65F6\u53EA\u8FD4\u56DE\u7ED9 AI\uFF0C\u4E0D\u4E3B\u52A8\u53D1\u9001\u3002" },
          bot_send_to_user: { type: "boolean", description: "send_to_user \u7684\u517C\u5BB9\u522B\u540D\u3002\u9ED8\u8BA4 true\u3002" },
          deliver_to_user: { type: "boolean", description: "send_to_user \u7684\u517C\u5BB9\u522B\u540D\u3002\u9ED8\u8BA4 true\u3002" },
          save_to_server: { type: "boolean", description: "\u662F\u5426\u628A\u622A\u56FE\u4FDD\u5B58\u5230\u670D\u52A1\u5668\u5E76\u8FD4\u56DE\u670D\u52A1\u5668\u8DEF\u5F84/URL\u3002\u9ED8\u8BA4\u8DDF\u968F send_to_user\uFF1Bsend_to_user:true \u65F6\u4F1A\u81EA\u52A8\u4FDD\u5B58\u3002" },
          upload_to_server: { type: "boolean", description: "save_to_server \u7684\u517C\u5BB9\u522B\u540D\u3002\u9ED8\u8BA4\u8DDF\u968F send_to_user\u3002" },
          task_timeout_ms: { type: "number", description: "\u672C\u6B21\u622A\u56FE\u4EFB\u52A1\u5728\u7AEF\u70B9 agent \u4E0A\u7684\u786C\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09\u3002\u9ED8\u8BA4 35000\u3002" },
          fallback_visible: { type: "boolean", description: "\u5143\u7D20/\u533A\u57DF/\u6574\u9875\u622A\u56FE\u65F6\uFF0C\u82E5\u7CBE\u786E CDP \u622A\u56FE\u5931\u8D25\u5219\u56DE\u9000\u4E3A\u53EF\u89C6\u533A\u622A\u56FE\u3002\u9ED8\u8BA4 false\u3002" }
        }
      }
    },
    // ───── 页面交互 ───────────────────────────────────────────────────────
    {
      name: "browser_action",
      description: '\u9875\u9762\u4EA4\u4E92\u805A\u5408\u5DE5\u5177\uFF1A\u7528 action \u6307\u5B9A\u8981\u505A\u7684\u52A8\u4F5C\u2014\u2014\u70B9\u51FB click\uFF08\u5355\u51FB\uFF09\u3001\u53CC\u51FB double_click\u3001\u53F3\u952E right_click\u3001\u6EDA\u52A8 scroll\u3001\u8F93\u5165\u6587\u672C type\u3001\u952E\u76D8\u6309\u952E press_key\u3002\u5404\u52A8\u4F5C\u7684\u53C2\u6570\u4E0E\u539F browser_click/double_click/right_click/scroll/type/press_key \u4E00\u81F4\uFF0C\u6309 action \u53D6\u7528\u5BF9\u5E94\u5B57\u6BB5\u5373\u53EF\u3002\n\xB7 click\uFF1A\u6D3E\u53D1\u5B8C\u6574\u6307\u9488+\u9F20\u6807\u4E8B\u4EF6\u5E8F\u5217\uFF0C\u517C\u5BB9\u81EA\u5B9A\u4E49\u7EC4\u4EF6\uFF1B\u5B9A\u4F4D\u4F18\u5148\u7EA7 ref\uFF08browser_observe \u7F16\u53F7\uFF0C\u6700\u7A33\uFF09> selector > text > \u5750\u6807\uFF1B\u975E\u5750\u6807\u70B9\u51FB\u4F1A\u5148\u505A\u906E\u6321\u68C0\u6D4B\uFF0C\u88AB\u5F39\u7A97/\u906E\u7F69\u76D6\u4F4F\u65F6\u8FD4\u56DE occluded \u8BCA\u65AD\uFF08\u9700\u7A7F\u900F\u70B9\u51FB\u4F20 force:true\uFF09\u3002\n\xB7 double_click / right_click\uFF1A\u53CC\u51FB\u3001\u53F3\u952E\uFF08\u4E0A\u4E0B\u6587\u83DC\u5355\uFF09\uFF0C\u7528 selector / text / \u5750\u6807\u5B9A\u4F4D\u3002\n\xB7 scroll\uFF1A\u6EDA\u52A8\u9875\u9762\uFF0C\u8FD4\u56DE\u6EDA\u52A8\u540E\u7684\u4F4D\u7F6E\u3001\u79FB\u52A8\u50CF\u7D20\u6570\u4E0E\u8FDB\u5165\u89C6\u91CE\u7684\u5C0F\u8282/\u6807\u9898\u3002\n\xB7 type\uFF1A\u5411 input/textarea \u8F93\u5165\u6587\u672C\uFF08\u5355\u5B57\u6BB5\uFF1B\u591A\u5B57\u6BB5\u8BF7\u591A\u6B21 type \u6216\u914D\u5408 observe \u9010\u5B57\u6BB5\u64CD\u4F5C\uFF09\u3002\n\xB7 press_key\uFF1A\u5728\u7126\u70B9\u5143\u7D20\u6216\u6307\u5B9A selector \u4E0A\u6309\u952E\uFF0C\u53EF\u5E26 Ctrl/Shift/Alt/Meta \u4FEE\u9970\u952E\u3002\n\xB7 \u81EA\u52A8 observe\uFF1Aclick/double_click/right_click/type/press_key \u6267\u884C\u540E\u4F1A\u81EA\u52A8\u68C0\u6D4B\u9875\u9762\u662F\u5426\u53D8\u5316\u5E76\u7B49\u5F85\u52A0\u8F7D\u5B8C\u6BD5\uFF1B\u82E5\u53D8\u5316\uFF0C\u7ED3\u679C\u91CC\u9644\u5E26\u589E\u91CF observe\uFF08observe.delta=true\uFF09\uFF0C\u53EA\u8FD4\u56DE\u76F8\u5BF9\u4E0A\u4E00\u6B21 observe \u65B0\u589E/\u53D8\u5316/\u6D88\u5931\u7684\u5143\u7D20\uFF0C\u5B8C\u6574\u5FEB\u7167\u4E0D\u518D\u91CD\u590D\u8FD4\u56DE\uFF1B\u672A\u53D8\u5316\u5219 page_changed:false\u3002\u4E0D\u9700\u8981\u65F6\u4F20 observe_after:false \u5173\u95ED\u3002\n\u7528\u9014\uFF1A\u7EDF\u4E00\u7684\u70B9\u51FB/\u6EDA\u52A8/\u8F93\u5165/\u952E\u76D8\u5165\u53E3\u3002\u573A\u666F\uFF1A\u5148 browser_observe \u62FF\u5230\u7F16\u53F7\uFF0C\u518D browser_action {action:"click", ref:id} \u70B9\u51FB\uFF1B\u70B9\u51FB\u540E\u82E5\u9875\u9762\u53D8\u4E86\uFF0C\u76F4\u63A5\u8BFB observe.items / addedItems / changedItems / removedItems \u91CC\u7684\u53D8\u5316\u5143\u7D20\u7EE7\u7EED\u64CD\u4F5C\uFF1B\u9700\u8981\u5168\u91CF\u65F6\u518D\u8C03\u7528 browser_observe\u3002',
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["click", "double_click", "right_click", "scroll", "type", "press_key"], description: "\u8981\u6267\u884C\u7684\u4EA4\u4E92\u52A8\u4F5C\u3002" },
          // 通用定位（click/double_click/right_click 用；type/press_key 可用 selector 聚焦）
          ref: { type: ["number", "string"], description: 'browser_observe \u8FD4\u56DE\u7684\u5143\u7D20\u7F16\u53F7 id\uFF08click/double_click/right_click/type \u5747\u53EF\u7528\uFF09\uFF0C\u6700\u7A33\u7684\u5B9A\u4F4D\u65B9\u5F0F\uFF0C\u4F18\u5148\u4F7F\u7528\u3002\u4E3B\u9875\u9762\u5143\u7D20\u662F\u6570\u5B57\uFF1B\u8DE8\u57DF iframe \u5185\u7684\u5143\u7D20 id \u5F62\u5982 "3:5"\uFF08frameId:\u672C\u5730\u7F16\u53F7\uFF09\uFF0C\u539F\u6837\u56DE\u4F20\u5373\u53EF\uFF0C\u4F1A\u81EA\u52A8\u8DEF\u7531\u5230\u5BF9\u5E94\u6846\u67B6\u3002' },
          selector: { type: "string", description: "\u76EE\u6807\u5143\u7D20\u7684 CSS selector\uFF08click/double_click/right_click \u5B9A\u4F4D\uFF1Btype \u6307\u5B9A\u8F93\u5165\u6846\uFF1Bpress_key \u6307\u5B9A\u5148\u805A\u7126\u7684\u5143\u7D20\uFF1Bscroll \u53EF\u6307\u5B9A\u6EDA\u52A8\u8FDB\u89C6\u53E3\u7684\u5143\u7D20\uFF09\u3002" },
          text: { type: "string", description: "action=click/double_click/right_click \u65F6\u7528\u53EF\u89C1\u6587\u672C\u5B9A\u4F4D\u5143\u7D20\uFF1Baction=type \u65F6\u4E3A\u300C\u8981\u8F93\u5165\u7684\u6587\u672C\u300D\u3002" },
          x: { type: "number", description: "click/double_click/right_click \u7684 X \u5750\u6807\uFF08\u50CF\u7D20\uFF0C\u89C6\u53E3\u5750\u6807\uFF09\u3002" },
          y: { type: "number", description: "click/double_click/right_click \u7684 Y \u5750\u6807\uFF08\u50CF\u7D20\uFF0C\u89C6\u53E3\u5750\u6807\uFF09\u3002" },
          force: { type: "boolean", description: "action=click \u65F6\u4E3A true \u5373\u4F7F\u88AB\u906E\u6321\u4E5F\u5F3A\u5236\u70B9\u51FB\uFF1B\u9ED8\u8BA4 false\uFF1A\u88AB\u906E\u6321\u8FD4\u56DE occluded \u8BCA\u65AD\u3002" },
          // scroll
          direction: { type: "string", enum: ["up", "down", "top", "bottom"], description: "action=scroll \u7684\u65B9\u5411\uFF1Aup \u4E0A\u3001down \u4E0B\u3001top \u5230\u9876\u3001bottom \u5230\u5E95\u3002" },
          amount: { type: "number", description: "action=scroll \u7684\u6EDA\u52A8\u50CF\u7D20\u6570\u3002\u9ED8\u8BA4 400\u3002" },
          // type
          clear_first: { type: "boolean", description: "action=type \u65F6\u8F93\u5165\u524D\u5148\u6E05\u7A7A\u5B57\u6BB5\u3002\u9ED8\u8BA4 true\u3002" },
          submit: { type: "boolean", description: "action=type \u65F6\u8F93\u5165\u540E\u6309\u56DE\u8F66\u63D0\u4EA4\u3002" },
          // press_key
          key: { type: "string", description: 'action=press_key \u7684\u952E\u540D\uFF0C\u5982 "Enter"\u3001"Escape"\u3001"Tab"\u3001"ArrowDown"\u3001"a"\u3002' },
          ctrl: { type: "boolean", description: "action=press_key \u65F6\u6309\u4F4F Ctrl\u3002" },
          shift: { type: "boolean", description: "action=press_key \u65F6\u6309\u4F4F Shift\u3002" },
          alt: { type: "boolean", description: "action=press_key \u65F6\u6309\u4F4F Alt\u3002" },
          meta: { type: "boolean", description: "action=press_key \u65F6\u6309\u4F4F Meta/Cmd\u3002" },
          // 自动 observe（click/double_click/right_click/type/press_key 生效）
          observe_after: { type: "boolean", description: "\u70B9\u51FB/\u8F93\u5165/\u6309\u952E\u540E\u82E5\u9875\u9762\u53D8\u5316\uFF0C\u662F\u5426\u81EA\u52A8\u7B49\u5F85\u52A0\u8F7D\u5E76\u5728\u7ED3\u679C\u91CC\u9644\u5E26\u589E\u91CF observe\uFF08\u53EA\u663E\u793A\u76F8\u5BF9\u4E0A\u4E00\u6B21 observe \u7684\u53D8\u5316\u5143\u7D20\uFF09\u3002\u9ED8\u8BA4 true\uFF1B\u4F20 false \u5173\u95ED\u3002" },
          settle_timeout: { type: "number", description: "\u81EA\u52A8 observe\uFF1A\u7B49\u5F85\u9875\u9762\u53D8\u5316\u7A33\u5B9A\u7684\u6700\u957F\u65F6\u95F4\uFF08\u6BEB\u79D2\uFF0C\u9ED8\u8BA4 3000\uFF0C\u4E0A\u9650 8000\uFF09\uFF1B\u9047\u5230\u6301\u7EED\u52A0\u8F7D/\u52A8\u753B\u65F6\u5230\u6B64\u4E0A\u9650\u5373\u6536\u5C3E\u5E76 observe\u3002" },
          wait_timeout_ms: { type: "number", description: "\u672C\u6B21 action \u540E\u7F6E\u7B49\u5F85\u7684\u6700\u5927\u65F6\u957F\uFF08\u6BEB\u79D2\uFF0C\u9ED8\u8BA4 3000\uFF0C\u4E0A\u9650 8000\uFF09\uFF1B\u7528\u4E8E\u7B49\u5F85\u9875\u9762\u53D8\u5316\u7A33\u5B9A\u5E76\u9650\u5236\u81EA\u52A8 observe \u7684\u7B49\u5F85\u3002" },
          max_wait_ms: { type: "number", description: "wait_timeout_ms \u7684\u517C\u5BB9\u522B\u540D\u3002" },
          observe_timeout_ms: { type: "number", description: "action \u540E\u89E6\u53D1\u81EA\u52A8 observe \u65F6\uFF0Cobserve \u672C\u8EAB\u7684\u6700\u5927\u7B49\u5F85/\u626B\u63CF\u65F6\u957F\uFF08\u6BEB\u79D2\uFF09\uFF1B\u4E0D\u4F20\u65F6\u8DDF\u968F wait_timeout_ms / settle_timeout\u3002" }
        },
        required: ["action"]
      }
    },
    {
      name: "browser_wait",
      description: "\u7B49\u5F85\u67D0\u4E2A CSS selector \u51FA\u73B0\uFF0C\u6216\u56FA\u5B9A\u7B49\u5F85\u4E00\u6BB5\u65F6\u95F4\u3002\u7528\u9014\uFF1A\u7B49\u5F85\u9875\u9762/\u5143\u7D20\u5C31\u7EEA\u540E\u518D\u64CD\u4F5C\u3002\u573A\u666F\uFF1A\u7B49\u5F02\u6B65\u52A0\u8F7D\u7684\u6309\u94AE\u51FA\u73B0\u3001\u7B49\u52A8\u753B\u7ED3\u675F\u3001\u7ED9\u9875\u9762\u7559\u51FA\u6E32\u67D3\u65F6\u95F4\u3002",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "\u7B49\u5F85\u51FA\u73B0\u7684 CSS \u5143\u7D20\u3002" },
          ms: { type: "number", description: "\u56FA\u5B9A\u7B49\u5F85\u7684\u6BEB\u79D2\u6570\u3002" }
        }
      }
    },
    {
      name: "browser_drag",
      description: "\u4ECE\u6E90\u5143\u7D20/\u70B9\u62D6\u62FD drag \u5230\u76EE\u6807\u5143\u7D20/\u70B9\u5E76\u653E\u4E0B\uFF0C\u89E6\u53D1 HTML5\u3001pointer \u548C mouse \u4E8B\u4EF6\uFF0C\u5E76\u8FD4\u56DE\u6E90\u662F\u5426\u660E\u663E\u79FB\u52A8\u7684\u8BCA\u65AD\u4FE1\u606F\u3002\u7528\u9014\uFF1A\u62D6\u653E\u4EA4\u4E92\u3002\u573A\u666F\uFF1A\u62D6\u52A8\u6392\u5E8F\u3001\u628A\u5143\u7D20\u62D6\u5165\u6295\u653E\u533A\u3001\u6ED1\u5757\u64CD\u4F5C\u3002",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "\u6E90\u5143\u7D20 CSS selector\u3002" },
          text: { type: "string", description: "\u6E90\u5143\u7D20\u53EF\u89C1\u6587\u672C\u3002" },
          x: { type: "number", description: "\u6E90\u70B9 X \u5750\u6807\uFF08\u50CF\u7D20\uFF09\u3002" },
          y: { type: "number", description: "\u6E90\u70B9 Y \u5750\u6807\uFF08\u50CF\u7D20\uFF09\u3002" },
          to_selector: { type: "string", description: "\u76EE\u6807\u5143\u7D20 CSS selector\u3002" },
          to_text: { type: "string", description: "\u76EE\u6807\u5143\u7D20\u53EF\u89C1\u6587\u672C\u3002" },
          to_x: { type: "number", description: "\u76EE\u6807\u70B9 X \u5750\u6807\uFF08\u50CF\u7D20\uFF09\u3002" },
          to_y: { type: "number", description: "\u76EE\u6807\u70B9 Y \u5750\u6807\uFF08\u50CF\u7D20\uFF09\u3002" }
        }
      }
    },
    // ───── 数据与脚本 ─────────────────────────────────────────────────────
    {
      name: "browser_evaluate",
      description: "\u5728\u9875\u9762\u4E0A\u4E0B\u6587\u4E2D\u6267\u884C\u4EFB\u610F JavaScript \u5E76\u8FD4\u56DE\u7ED3\u679C\uFF1B\u53EF\u7528\u65F6\u8D70 Chrome DevTools Protocol\uFF0C\u56E0\u6B64\u5728 CSP \u53D7\u9650\u9875\u9762\u4E0A\u4E5F\u80FD\u8FD0\u884C\u3002\u7528\u9014\uFF1A\u9AD8\u7EA7\u53D6\u6570/\u64CD\u4F5C\u7684\u515C\u5E95\u624B\u6BB5\u3002\u573A\u666F\uFF1A\u5185\u7F6E\u5DE5\u5177\u65E0\u6CD5\u6EE1\u8DB3\u65F6\u8BFB\u53D6\u590D\u6742\u6570\u636E\u6216\u89E6\u53D1\u7279\u6B8A\u884C\u4E3A\uFF08\u8BF7\u8C28\u614E\u4F7F\u7528\uFF09\u3002",
      input_schema: {
        type: "object",
        properties: {
          code: { type: "string", description: "\u8981\u6267\u884C\u7684 JavaScript \u8868\u8FBE\u5F0F\u6216\u8BED\u53E5\u3002" },
          function: { type: "string", description: "code \u7684\u522B\u540D\uFF0C\u4FDD\u7559\u517C\u5BB9\u3002" },
          fn: { type: "string", description: "code \u7684\u522B\u540D\u3002" },
          expression: { type: "string", description: "code \u7684\u522B\u540D\u3002" },
          trace: { type: "boolean", description: "\u5931\u8D25\u65F6\u8FD4\u56DE\u7ED3\u6784\u5316\u7684 {error, code, suggestion, trace}\u3002" }
        }
      }
    },
    {
      name: "browser_extract",
      description: "\u4ECE\u5339\u914D selector \u7684\u5143\u7D20\u4E2D\u63D0\u53D6\u7ED3\u6784\u5316\u6570\u636E\uFF0C\u8FD4\u56DE\u5E26 tag\u3001selector\u3001\u6587\u672C\u3001\u5C5E\u6027\u53CA\u5E38\u7528\u5C5E\u6027\u522B\u540D\u7684\u5F52\u4E00\u5316\u6761\u76EE\u3002\u7528\u9014\uFF1A\u6279\u91CF\u6293\u53D6\u5217\u8868/\u8868\u683C\u3002\u573A\u666F\uFF1A\u6293\u53D6\u641C\u7D22\u7ED3\u679C\u3001\u5546\u54C1\u5217\u8868\u3001\u8868\u683C\u884C\u3002",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "\u8981\u67E5\u8BE2\u7684 CSS selector\u3002" },
          attributes: { type: "array", items: { type: "string" }, description: "\u6BCF\u4E2A\u5143\u7D20\u9700\u8981\u91C7\u96C6\u7684\u5C5E\u6027\u540D\u5217\u8868\u3002" },
          limit: { type: "number", description: "\u6700\u591A\u63D0\u53D6\u7684\u5143\u7D20\u6570\u3002\u9ED8\u8BA4 50\u3002" }
        },
        required: ["selector"]
      }
    },
    {
      name: "browser_clipboard_write",
      description: "\u628A\u6587\u672C\u5199\u5165\u7CFB\u7EDF\u526A\u8D34\u677F\u3002\u7528\u9014\uFF1A\u590D\u5236\u5185\u5BB9\u4F9B\u5176\u4ED6\u7A0B\u5E8F\u7C98\u8D34\u3002\u573A\u666F\uFF1A\u590D\u5236\u63D0\u53D6\u5230\u7684\u7ED3\u679C\u3001\u590D\u5236\u751F\u6210\u7684\u94FE\u63A5\u3002",
      input_schema: {
        type: "object",
        properties: { text: { type: "string", description: "\u8981\u590D\u5236\u5230\u526A\u8D34\u677F\u7684\u6587\u672C\u3002" } },
        required: ["text"]
      }
    },
    {
      name: "browser_file_upload",
      description: "\u7528\u5185\u5B58\u4E2D\u7684\u6587\u4EF6\u5185\u5BB9\u586B\u5145 <input type=file>\u3002\u6CE8\u610F\uFF1A\u6269\u5C55\u65E0\u6CD5\u8BFB\u53D6\u672C\u673A\u6587\u4EF6\u7CFB\u7EDF\u8DEF\u5F84\uFF0C\u5FC5\u987B\u76F4\u63A5\u63D0\u4F9B\u5185\u5BB9\u3002\u7528\u9014\uFF1A\u4E0A\u4F20\u6587\u4EF6\u3002\u573A\u666F\uFF1A\u628A\u4E00\u6BB5\u6587\u672C/base64 \u5185\u5BB9\u4F5C\u4E3A\u6587\u4EF6\u4E0A\u4F20\u5230\u7F51\u9875\u3002",
      input_schema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "\u6587\u4EF6\u8F93\u5165\u6846\u7684 CSS selector\u3002\u9ED8\u8BA4 input[type=file]\u3002" },
          files: {
            type: "array",
            description: '\u8981\u5408\u6210\u7684\u6587\u4EF6\uFF0C\u4F8B\u5982 [{name:"a.txt", content:"hello", type:"text/plain"}]\uFF0C\u6216\u8BBE\u7F6E encoding:"base64"\u3002',
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "\u6587\u4EF6\u540D\u3002" },
                content: { type: "string", description: "\u6587\u4EF6\u5185\u5BB9\uFF08\u6309 encoding \u89E3\u91CA\uFF09\u3002" },
                type: { type: "string", description: "MIME \u7C7B\u578B\uFF0C\u5982 text/plain\u3002" },
                encoding: { type: "string", enum: ["text", "base64"], description: "content \u7684\u7F16\u7801\uFF1Atext \u7EAF\u6587\u672C\u6216 base64\u3002" }
              },
              required: ["name", "content"]
            }
          }
        },
        required: ["files"]
      }
    },
    {
      name: "browser_download",
      description: "\u901A\u8FC7 chrome.downloads \u4ECE\u67D0\u4E2A URL \u53D1\u8D77\u6D4F\u89C8\u5668\u4E0B\u8F7D\u3002\u7528\u9014\uFF1A\u4FDD\u5B58\u6587\u4EF6\u5230\u672C\u5730\u4E0B\u8F7D\u76EE\u5F55\u3002\u573A\u666F\uFF1A\u4E0B\u8F7D\u5BFC\u51FA\u6587\u4EF6\u3001\u56FE\u7247\u3001\u9644\u4EF6\u3002",
      input_schema: {
        type: "object",
        properties: {
          url: { type: "string", description: "\u8981\u4E0B\u8F7D\u7684 URL\u3002" },
          filename: { type: "string", description: "\u53EF\u9009\uFF1A\u4E0B\u8F7D\u76EE\u5F55\u4E0B\u7684\u76F8\u5BF9\u6587\u4EF6\u540D\u3002" },
          save_as: { type: "boolean", description: "\u663E\u793A\u300C\u53E6\u5B58\u4E3A\u300D\u5BF9\u8BDD\u6846\u3002" }
        },
        required: ["url"]
      }
    },
    // ───── 浏览器状态（资源 + action）────────────────────────────────────
    {
      name: "browser_tab",
      description: "\u6D4F\u89C8\u5668\u6807\u7B7E\u9875\u7BA1\u7406\uFF1A\u5217\u51FA\u5DF2\u6253\u5F00\u9875\u9762\u3001\u5207\u6362\u6807\u7B7E\u3001\u5728\u5F53\u524D\u9875\u8986\u76D6\u8DF3\u8F6C\u3001\u65B0\u6807\u7B7E\u6253\u5F00\u94FE\u63A5\u3001\u5173\u95ED\u6807\u7B7E\u3001\u524D\u8FDB\u540E\u9000\u3002\u52A8\u4F5C\u4EC5 7 \u79CD\uFF1Alist \u83B7\u53D6\u5168\u90E8\u9875\u9762\u53CA\u5F53\u524D\u6FC0\u6D3B\u9875\uFF1Bswitch \u5207\u6362\u5230\u5DF2\u6709 tab_id\uFF1Breplace \u5728\u5F53\u524D\u9875\uFF08\u6216 tab_id\uFF09\u8986\u76D6\u8DF3\u8F6C\u5230 url\uFF1Bnavigate \u5728\u65B0\u6807\u7B7E\u9875\u6253\u5F00 url\uFF1Bclose \u5173\u95ED\u6807\u7B7E\uFF1Bback/forward \u5386\u53F2\u5BFC\u822A\u3002\u6D41\u7A0B\uFF1A\u5148 list\uFF0C\u76EE\u6807\u9875\u5DF2\u5F00\u5219 switch\uFF0C\u8981\u5728\u5F53\u524D\u9875\u6539\u5730\u5740\u7528 replace\uFF0C\u5E76\u884C\u4EFB\u52A1\u7528 navigate\u3002",
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "switch", "replace", "navigate", "close", "back", "forward"], description: "list \u5217\u51FA\u5168\u90E8\u6807\u7B7E\u5E76\u8FD4\u56DE activeTab\uFF1Bswitch \u5207\u6362\u5230 tab_id\uFF08\u4E0D\u6539 URL\uFF09\uFF1Breplace \u5728\u5F53\u524D/\u6307\u5B9A\u6807\u7B7E\u8986\u76D6\u8DF3\u8F6C\u5230 url\uFF1Bnavigate \u5728\u65B0\u6807\u7B7E\u6253\u5F00 url\uFF1Bclose \u5173\u95ED tab_id\uFF08\u9ED8\u8BA4\u5F53\u524D\u6807\u7B7E\uFF09\uFF1Bback/forward \u540E\u9000/\u524D\u8FDB\u4E00\u6B65\u3002" },
          url: { type: "string", description: "action=replace / navigate \u65F6\u8981\u6253\u5F00\u7684 URL\uFF08\u7F3A\u534F\u8BAE\u65F6\u6309 https \u8865\u5168\uFF09\u3002" },
          tab_id: { type: "number", description: "action=switch \u5FC5\u586B\uFF1Baction=close/replace/back/forward \u53EF\u9009\uFF0C\u6307\u5B9A\u76EE\u6807\u6807\u7B7E\uFF0C\u9ED8\u8BA4\u5F53\u524D\u6D3B\u52A8\u6807\u7B7E\u3002" },
          tabId: { type: "number", description: "tab_id \u7684\u517C\u5BB9\u522B\u540D\u3002" },
          id: { type: "number", description: "tab_id \u7684\u517C\u5BB9\u522B\u540D\u3002" }
        },
        required: ["action"]
      }
    },
    {
      name: "browser_cookie",
      description: "\u7BA1\u7406\u5F53\u524D\u6807\u7B7E\u9875 URL \u6216\u6307\u5B9A URL/\u57DF\u540D\u7684 cookie\uFF1A\u5217\u51FA\u3001\u8BFB\u53D6\u3001\u5199\u5165\u3001\u5220\u9664\u3002\u7528\u9014\uFF1A\u67E5\u770B\u6216\u64CD\u4F5C\u4F1A\u8BDD\u72B6\u6001\u3002\u573A\u666F\uFF1A\u68C0\u67E5\u767B\u5F55\u6001\uFF08list/get\uFF09\u3001\u6CE8\u5165\u767B\u5F55/\u504F\u597D cookie\uFF08set\uFF0C\u5199\u5165\uFF09\u3001\u9000\u51FA\u767B\u5F55\uFF08delete\uFF0C\u5199\u5165\uFF09\u3002",
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "get", "set", "delete"], description: "\u52A8\u4F5C\uFF1Alist \u5217\u51FA\u3001get \u6309 name \u53D6\u5355\u4E2A\u3001set \u5199\u5165\u3001delete \u5220\u9664\u3002" },
          url: { type: "string", description: "cookie \u6240\u5C5E URL\u3002\u9ED8\u8BA4\u5F53\u524D\u6807\u7B7E\u9875 URL\u3002" },
          domain: { type: "string", description: "action=list \u65F6\u53EF\u6309\u57DF\u540D\u8FC7\u6EE4\u3002" },
          name: { type: "string", description: "cookie \u540D\u79F0\uFF08get/set/delete \u5FC5\u586B\uFF09\u3002" },
          value: { type: "string", description: "action=set \u65F6\u7684 cookie \u503C\u3002" },
          path: { type: "string", description: "action=set \u65F6\u7684 cookie \u8DEF\u5F84\u3002" },
          secure: { type: "boolean", description: "action=set \u65F6\u662F\u5426\u4EC5 HTTPS \u4F20\u8F93\u3002" },
          http_only: { type: "boolean", description: "action=set \u65F6\u662F\u5426\u6807\u8BB0 HttpOnly\u3002" },
          expiration_date: { type: "number", description: "action=set \u65F6\u7684\u8FC7\u671F\u65F6\u95F4\uFF08Unix \u79D2\uFF09\u3002" }
        },
        required: ["action"]
      }
    },
    {
      name: "browser_storage",
      description: "\u8BFB\u5199\u5F53\u524D\u9875\u9762\u7684 localStorage / sessionStorage\uFF1A\u8BFB\u53D6\u3001\u5199\u5165\u3001\u5220\u9664\u3001\u5217\u51FA key\u3002\u7528\u9014\uFF1A\u67E5\u770B\u6216\u64CD\u4F5C\u524D\u7AEF\u5B58\u50A8\u72B6\u6001\u3002\u573A\u666F\uFF1A\u8BFB\u53D6 token/\u504F\u597D\uFF08get/list\uFF09\u3001\u6CE8\u5165\u6807\u8BB0\u4F4D\uFF08set\uFF0C\u5199\u5165\uFF09\u3001\u6E05\u9664\u7F13\u5B58\u9879\uFF08remove\uFF0C\u5199\u5165\uFF09\u3002",
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["get", "set", "remove", "list"], description: "\u52A8\u4F5C\uFF1Aget \u8BFB\u53D6 key\u3001set \u5199\u5165 key\u3001remove \u5220\u9664 key\u3001list \u5217\u51FA key\u3002" },
          type: { type: "string", enum: ["local", "session"], description: "\u5B58\u50A8\u7C7B\u578B\uFF1Alocal \u6216 session\u3002\u9ED8\u8BA4 local\u3002" },
          key: { type: "string", description: "\u5B58\u50A8\u952E\u540D\uFF08get/set/remove \u5FC5\u586B\uFF09\u3002" },
          value: { type: "string", description: "action=set \u65F6\u8981\u5B58\u50A8\u7684\u503C\u3002" },
          prefix: { type: "string", description: "action=list \u65F6\u6309\u952E\u540D\u524D\u7F00\u8FC7\u6EE4\u3002" },
          include_values: { type: "boolean", description: "action=list \u65F6\u5728\u7ED3\u679C\u4E2D\u5305\u542B value\u3002" },
          limit: { type: "number", description: "action=list \u65F6\u6700\u591A\u8FD4\u56DE\u7684 key/\u6761\u76EE\u6570\u3002\u9ED8\u8BA4 100\u3002" }
        },
        required: ["action"]
      }
    },
    {
      name: "browser_session",
      description: "\u7BA1\u7406\u8F7B\u91CF\u6D4F\u89C8\u5668\u4E0A\u4E0B\u6587\u5FEB\u7167\uFF08\u5F53\u524D URL/\u6807\u9898 + \u8BE5\u9875 localStorage/sessionStorage\uFF09\uFF1A\u4FDD\u5B58\u3001\u5217\u51FA\u3001\u6062\u590D\u3001\u5220\u9664\u3002\u7528\u9014\uFF1A\u7559\u5B58\u5E76\u56DE\u5230\u6B64\u524D\u7684\u4F1A\u8BDD\u73B0\u573A\u3002\u573A\u666F\uFF1A\u4FDD\u5B58\u767B\u5F55\u6001\u7A0D\u540E\u6062\u590D\uFF08save/restore\uFF09\u3001\u67E5\u770B\u53EF\u6062\u590D\u4F1A\u8BDD\uFF08list\uFF09\u3001\u6E05\u7406\u8FC7\u671F\u5FEB\u7167\uFF08delete\uFF09\u3002",
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["save", "list", "restore", "delete"], description: "\u52A8\u4F5C\uFF1Asave \u4FDD\u5B58\u5F53\u524D\u73B0\u573A\u3001list \u5217\u51FA\u5FEB\u7167\u3001restore \u6062\u590D\u5FEB\u7167\u3001delete \u5220\u9664\u5FEB\u7167\u3002" },
          id: { type: "string", description: "\u4F1A\u8BDD id\uFF08restore/delete \u7528\uFF0Csave \u53EF\u9009\uFF09\u3002" },
          name: { type: "string", description: "\u4FBF\u4E8E\u8BC6\u522B\u7684\u4F1A\u8BDD\u540D\u79F0\uFF08restore/delete \u4E5F\u53EF\u6309 name \u5B9A\u4F4D\uFF09\u3002" },
          new_tab: { type: "boolean", description: "action=restore \u65F6\u5728\u65B0\u6807\u7B7E\u9875\u4E2D\u6062\u590D\u3002" }
        },
        required: ["action"]
      }
    }
  ];
  var BROWSER_CAPABILITIES = BROWSER_TOOLS.map((t) => t.name);

  // src/lib/tools/browser.ts
  function isBrowserInternalUrl(url2) {
    const raw = String(url2 || "");
    return /^(chrome|edge|brave|vivaldi|opera|about|chrome-extension):/i.test(raw) || /^https:\/\/chromewebstore\.google\.com\//i.test(raw);
  }
  function isUsablePageTab(tab) {
    return !!tab?.id && !isBrowserInternalUrl(tab.url) && !tab.discarded;
  }
  async function getActiveTab() {
    const [lastFocused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const lastFocusedUrl = lastFocused?.url || "";
    if (isUsablePageTab(lastFocused))
      return lastFocused;
    const windows = await chrome.windows.getAll({ windowTypes: ["normal"], populate: true });
    const focusedWindow = windows.find((w) => w.focused);
    const focusedTab = focusedWindow?.tabs?.find((t) => t.active);
    const focusedTabUrl = focusedTab?.url || "";
    if (isUsablePageTab(focusedTab))
      return focusedTab;
    for (const win of windows) {
      const tab = win.tabs?.find((t) => t.active);
      if (isUsablePageTab(tab))
        return tab;
    }
    const tabs = await chrome.tabs.query({});
    const fallback = tabs.filter(isUsablePageTab).sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
    if (fallback)
      return fallback;
    const activeUrl = lastFocusedUrl || focusedTabUrl;
    const detail = activeUrl ? ` Current active URL is ${activeUrl}.` : "";
    const err = new Error(`No ordinary web page tab found.${detail}`);
    err.code = "NO_USABLE_PAGE_TAB";
    err.suggestion = "Open or switch to a normal http/https page, then retry.";
    throw err;
  }
  async function getAnyActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id)
      throw new Error("No active tab found");
    return tab;
  }
  async function isTabForeground(tab) {
    if (!tab.active)
      return false;
    try {
      const win = await chrome.windows.get(tab.windowId);
      return win.focused === true && win.state !== "minimized";
    } catch {
      return false;
    }
  }
  var CONTENT_MSG_TIMEOUT_MS = 15e3;
  function sendToContent(tabId, msg, frameId = 0) {
    const raw = new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, msg, { frameId }, (response) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(err);
          return;
        }
        resolve(response);
      });
    });
    return withTimeout(raw, CONTENT_MSG_TIMEOUT_MS, `content action "${msg?.action || "message"}"`);
  }
  function isNoReceiverError(err) {
    const m = err?.message || "";
    return m.includes("Could not establish connection") || m.includes("Receiving end does not exist");
  }
  function contentScriptFiles() {
    try {
      const manifest = chrome.runtime.getManifest();
      const files = [];
      for (const cs of manifest.content_scripts || []) {
        for (const js of cs.js || [])
          files.push(js);
      }
      if (files.length)
        return files;
    } catch {
    }
    return ["dist/content.js"];
  }
  async function injectContentScript(tabId, frameId) {
    try {
      await chrome.scripting.executeScript({
        // Inject into the specific frame when retrying a frame-targeted call,
        // otherwise cover every frame so cross-origin iframes also get the script.
        target: frameId !== void 0 ? { tabId, frameIds: [frameId] } : { tabId, allFrames: true },
        files: contentScriptFiles()
      });
      return true;
    } catch {
      return false;
    }
  }
  function unwrapContentResult(res) {
    if (res?.error) {
      const detail = typeof res.error === "object" ? res.error : { message: String(res.error), code: "CONTENT_ACTION_FAILED" };
      const err = new Error(detail.message || "Content action failed");
      err.code = detail.code || "CONTENT_ACTION_FAILED";
      err.suggestion = detail.suggestion;
      err.trace = res.trace;
      throw err;
    }
    return res;
  }
  async function contentMsg(tabId, msg, frameId = 0) {
    try {
      return unwrapContentResult(await sendToContent(tabId, msg, frameId));
    } catch (err) {
      if (!isNoReceiverError(err))
        throw err;
      const injected = await injectContentScript(tabId, frameId || void 0);
      if (injected) {
        try {
          return unwrapContentResult(await sendToContent(tabId, msg, frameId));
        } catch (retryErr) {
          if (!isNoReceiverError(retryErr))
            throw retryErr;
        }
      }
      const e = new Error("Content script unavailable on this page (try a normal web page, not chrome://).");
      e.code = "CONTENT_SCRIPT_UNAVAILABLE";
      e.suggestion = "Navigate to a normal http/https page and retry.";
      throw e;
    }
  }
  function originOf(url2) {
    try {
      if (!url2 || url2 === "about:blank" || url2 === "about:srcdoc")
        return "";
      return new URL(url2).origin;
    } catch {
      return "";
    }
  }
  async function listFrames(tabId) {
    try {
      const frames = await chrome.webNavigation.getAllFrames({ tabId });
      if (!frames)
        return [];
      return frames.map((f) => ({
        frameId: f.frameId,
        parentFrameId: f.parentFrameId,
        url: f.url || "",
        origin: originOf(f.url || "")
      }));
    } catch {
      return [];
    }
  }
  function frameRootsNeedingOwnPass(frames, reachedUrls) {
    const byId = /* @__PURE__ */ new Map();
    for (const f of frames)
      byId.set(f.frameId, f);
    const stripHash = (u) => u.split("#")[0];
    const reachedByTop = (f) => !!f && (f.frameId === 0 || reachedUrls.has(stripHash(f.url)));
    const roots = [];
    for (const f of frames) {
      if (f.frameId === 0)
        continue;
      if (!f.origin)
        continue;
      if (reachedUrls.has(stripHash(f.url)))
        continue;
      const parent = byId.get(f.parentFrameId);
      if (f.origin !== (parent?.origin ?? "")) {
        roots.push(f);
        continue;
      }
      if (reachedByTop(parent))
        roots.push(f);
    }
    return roots;
  }
  var MAX_CROSS_ORIGIN_FRAMES = 12;
  function parseRef(ref) {
    if (typeof ref === "string") {
      const m = /^(\d+):(.+)$/.exec(ref);
      if (m)
        return { frameId: Number(m[1]), ref: m[2] };
    }
    return { frameId: 0, ref };
  }
  function normalizeToolError(err, name, args) {
    return {
      message: err?.message || String(err),
      code: err?.code || "TOOL_FAILED",
      suggestion: err?.suggestion || suggestionForTool(name),
      trace: args?.trace ? {
        tool: name,
        args,
        cause: err?.trace || null,
        stack: err?.stack || "",
        timestamp: Date.now()
      } : void 0
    };
  }
  function suggestionForTool(name) {
    if (name.includes("click") || name.includes("select") || name.includes("drag"))
      return "Use browser_observe or browser_screenshot to verify the target, then retry.";
    if (name.includes("screenshot"))
      return "Confirm the tool is enabled by policy and the extension has permission for the current tab.";
    if (name.includes("cookie"))
      return "Confirm the cookies permission is enabled and the URL/domain is valid.";
    return "Check tool parameters and current page state, then retry with trace:true for details.";
  }
  async function waitForTabLoad(tabId, timeoutMs = 15e3) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete")
        return;
    } catch {
      throw new Error(`Tab ${tabId} not found`);
    }
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        chrome.tabs.get(tabId).then((tab) => {
          if (tab.status === "complete")
            resolve();
          else
            reject(new Error("Page load timed out"));
        }).catch(() => reject(new Error("Page load timed out")));
      }, timeoutMs);
      function listener(id, info) {
        if (id === tabId && info.status === "complete") {
          clearTimeout(t);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      }
      chrome.tabs.onUpdated.addListener(listener);
    });
  }
  function normalizePageUrl(raw) {
    const trimmed = String(raw || "").trim();
    if (!trimmed)
      throw new Error("url is required");
    if (trimmed === "about:blank")
      return trimmed;
    try {
      return new URL(trimmed).href;
    } catch {
      return new URL("https://" + trimmed).href;
    }
  }
  async function focusTab(tabId) {
    const tab = await chrome.tabs.get(tabId);
    await chrome.tabs.update(tabId, { active: true });
    if (tab.windowId !== void 0) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    return chrome.tabs.get(tabId);
  }
  function tabIdArg(args) {
    return Number(args?.tab_id ?? args?.tabId ?? args?.id);
  }
  var TAB_ACTIONS = ["list", "switch", "replace", "navigate", "close", "back", "forward"];
  function normalizeTabAction(args) {
    const action = String(args?.action || "").trim();
    if (action === "open" || action === "activate") {
      return action === "open" ? "navigate" : "switch";
    }
    if (action === "navigate" && (args?.replace_current === true || args?.current_tab === true || args?.same_tab === true)) {
      return "replace";
    }
    return action;
  }
  function tabSummary(tab) {
    return { id: tab.id, url: tab.url, title: tab.title, active: !!tab.active, windowId: tab.windowId };
  }
  async function resolveTargetTab(args) {
    const requested = tabIdArg(args);
    if (Number.isFinite(requested) && requested > 0)
      return chrome.tabs.get(requested);
    return getActiveTab();
  }
  async function toolTabNavigate(args) {
    const href = normalizePageUrl(args.url);
    const tab = await chrome.tabs.create({ url: href, active: true });
    await focusTab(tab.id);
    await waitForTabLoad(tab.id);
    const refreshed = await chrome.tabs.get(tab.id);
    return { success: true, action: "navigate", ...tabSummary(refreshed), url: refreshed.url || href };
  }
  async function toolTabReplace(args) {
    const href = normalizePageUrl(args.url);
    let tab;
    try {
      tab = await resolveTargetTab(args);
    } catch {
      const created = await chrome.tabs.create({ url: href, active: true });
      await waitForTabLoad(created.id);
      const refreshed2 = await chrome.tabs.get(created.id);
      return {
        success: true,
        action: "replace",
        ...tabSummary(refreshed2),
        url: refreshed2.url || href,
        note: "No usable target page tab; opened URL in a new tab instead."
      };
    }
    await chrome.tabs.update(tab.id, { url: href, active: true });
    await focusTab(tab.id);
    await waitForTabLoad(tab.id);
    const refreshed = await chrome.tabs.get(tab.id);
    return { success: true, action: "replace", ...tabSummary(refreshed), url: refreshed.url || href };
  }
  function unsupportedScreenshotReason(url2) {
    const raw = String(url2 || "");
    if (/^(chrome|edge|brave|vivaldi|opera|chrome-extension):\/\//i.test(raw)) {
      return "\u6D4F\u89C8\u5668\u5185\u90E8\u9875\u9762\u6216\u6269\u5C55\u9875\u9762\u4E0D\u5141\u8BB8\u6269\u5C55\u622A\u56FE\u3002\u8BF7\u5207\u6362\u5230\u666E\u901A http/https \u9875\u9762\u540E\u91CD\u8BD5\u3002";
    }
    if (/^https:\/\/chromewebstore\.google\.com\//i.test(raw)) {
      return "Chrome \u7F51\u4E0A\u5E94\u7528\u5E97\u9875\u9762\u4E0D\u5141\u8BB8\u6269\u5C55\u622A\u56FE\u3002";
    }
    return "";
  }
  function isRetryableCaptureError(message) {
    return /quota|too many|rate|active|visible|tab|capture|pending|loading/i.test(message);
  }
  async function delay(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
  async function playScreenshotFx(tab, msg) {
    try {
      await contentMsg(tab.id, { action: "screenshot_fx", ...msg });
    } catch {
    }
  }
  function wantsScreenshotFx(args) {
    return args.screenshot_fx !== false && args.fx !== false;
  }
  async function withTimeout(promise, ms, label) {
    let timer = null;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        })
      ]);
    } finally {
      if (timer)
        clearTimeout(timer);
    }
  }
  function boundedTimeout(value2, fallback, min = 1e3, max = 3e4) {
    const n = Number(value2);
    if (!Number.isFinite(n))
      return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  }
  function observeWaitTimeoutMs(args) {
    return boundedTimeout(
      args?.observe_timeout_ms ?? args?.wait_timeout_ms ?? args?.max_wait_ms ?? args?.timeout_ms,
      8e3,
      500,
      3e4
    );
  }
  function actionWaitTimeoutMs(args) {
    return boundedTimeout(
      args?.wait_timeout_ms ?? args?.max_wait_ms ?? args?.settle_timeout,
      3e3,
      200,
      8e3
    );
  }
  function screenshotFormat(args) {
    const format = String(args.format || "png").toLowerCase();
    return ["png", "jpeg", "webp"].includes(format) ? format : "png";
  }
  function screenshotQuality(args) {
    const quality = Number(args.quality);
    if (!Number.isFinite(quality))
      return void 0;
    return Math.min(100, Math.max(0, Math.round(quality)));
  }
  function maxDataUrlChars(args) {
    const n = Number(args.max_data_url_chars);
    if (Number.isFinite(n) && n > 0)
      return Math.min(2e7, Math.max(1e5, Math.round(n)));
    return 8e6;
  }
  function wantsServerSave(args) {
    return args?.save_to_server === true || args?.upload_to_server === true || wantsSendToUser(args);
  }
  function wantsSendToUser(args) {
    const values = [args?.send_to_user, args?.bot_send_to_user, args?.deliver_to_user].filter((value2) => value2 !== void 0);
    if (values.some((value2) => value2 === true))
      return true;
    if (values.some((value2) => value2 === false))
      return false;
    return true;
  }
  async function ensureScreenshotPayloadSize(dataUrl, args, retryCompressed) {
    const maxChars = maxDataUrlChars(args);
    if (dataUrl.length <= maxChars || args.allow_large_data_url === true) {
      return { dataUrl, warning: "" };
    }
    if (retryCompressed && screenshotFormat(args) !== "jpeg") {
      const compressed = await retryCompressed();
      if (compressed.length <= maxChars || args.allow_large_data_url === true) {
        return {
          dataUrl: compressed,
          warning: `Original screenshot payload was ${dataUrl.length} chars; returned compressed JPEG payload ${compressed.length} chars.`
        };
      }
      throw new Error(`Screenshot payload is too large after JPEG compression: ${compressed.length} chars > max_data_url_chars ${maxChars}`);
    }
    throw new Error(`Screenshot payload is too large: ${dataUrl.length} chars > max_data_url_chars ${maxChars}`);
  }
  function clipArea(clip) {
    return Math.max(0, clip.width) * Math.max(0, clip.height);
  }
  function assertValidClip(clip, maxArea) {
    if (!Number.isFinite(clip.x) || !Number.isFinite(clip.y) || !Number.isFinite(clip.width) || !Number.isFinite(clip.height)) {
      throw new Error("clip/x/y/width/height must be finite numbers");
    }
    if (clip.width <= 0 || clip.height <= 0)
      throw new Error("clip width and height must be greater than 0");
    if (clipArea(clip) > maxArea) {
      throw new Error(`Screenshot area is too large: ${Math.round(clipArea(clip))} CSS pixels > max_area ${maxArea}`);
    }
  }
  async function captureVisibleTab(windowId, args, retries = 1) {
    let lastErr;
    const timeoutMs = boundedTimeout(args.visible_timeout_ms ?? args.timeout_ms, 8e3);
    for (let i = 0; i <= retries; i++) {
      try {
        return await withTimeout(
          chrome.tabs.captureVisibleTab(windowId, {
            format: screenshotFormat(args) === "jpeg" ? "jpeg" : "png",
            quality: screenshotQuality(args)
          }),
          timeoutMs,
          "chrome.tabs.captureVisibleTab"
        );
      } catch (err) {
        lastErr = err;
        const message = err?.message || String(err);
        if (i >= retries || !isRetryableCaptureError(message))
          break;
        await delay(300);
      }
    }
    throw lastErr;
  }
  async function pageClipFromArgs(tab, args) {
    const maxArea = Math.max(1, Number(args.max_area || 25e6));
    const scale = Number(args.scale || 1);
    const contentTimeoutMs = boundedTimeout(args.content_timeout_ms ?? args.timeout_ms, 5e3);
    const cdpTimeoutMs = boundedTimeout(args.cdp_timeout_ms ?? args.timeout_ms, 12e3);
    if (args.selector || args.text) {
      const target = await withTimeout(
        contentMsg(tab.id, {
          action: "screenshot_target_info",
          selector: args.selector,
          text: args.text,
          margin: args.margin ?? args.padding,
          scroll_into_view: args.scroll_into_view,
          block: args.block,
          inline: args.inline
        }),
        contentTimeoutMs,
        "screenshot target measurement"
      );
      const rect = target?.rect?.page;
      const clip2 = {
        x: Number(rect?.x),
        y: Number(rect?.y),
        width: Number(rect?.width),
        height: Number(rect?.height),
        scale
      };
      assertValidClip(clip2, maxArea);
      return clip2;
    }
    const rawClip = args.clip && typeof args.clip === "object" ? args.clip : args;
    const hasRegion = rawClip.x !== void 0 && rawClip.y !== void 0 && rawClip.width !== void 0 && rawClip.height !== void 0;
    if (!hasRegion)
      return null;
    const coordinateSpace = String(args.coordinate_space || rawClip.coordinate_space || "viewport");
    let x = Number(rawClip.x);
    let y = Number(rawClip.y);
    if (coordinateSpace !== "page") {
      const metrics = await withTimeout(
        chrome.debugger.sendCommand({ tabId: tab.id }, "Page.getLayoutMetrics"),
        cdpTimeoutMs,
        "CDP Page.getLayoutMetrics"
      );
      const viewport = metrics?.cssLayoutViewport || metrics?.layoutViewport;
      x += Number(viewport?.pageX || 0);
      y += Number(viewport?.pageY || 0);
    }
    const clip = {
      x: Math.max(0, x),
      y: Math.max(0, y),
      width: Number(rawClip.width),
      height: Number(rawClip.height),
      scale
    };
    assertValidClip(clip, maxArea);
    return clip;
  }
  async function captureWithDebugger(tab, args = {}) {
    const target = { tabId: tab.id };
    let attached = false;
    const timeoutMs = boundedTimeout(args.cdp_timeout_ms ?? args.timeout_ms, 12e3);
    try {
      await withTimeout(chrome.debugger.attach(target, "1.3"), timeoutMs, "CDP attach");
      attached = true;
      await withTimeout(chrome.debugger.sendCommand(target, "Page.enable"), timeoutMs, "CDP Page.enable");
      const format = screenshotFormat(args);
      const params = { format, fromSurface: args.from_surface !== false };
      const quality = screenshotQuality(args);
      if (format !== "png" && quality !== void 0)
        params.quality = quality;
      const maxArea = Math.max(1, Number(args.max_area || 25e6));
      const clip = await pageClipFromArgs(tab, args);
      if (clip) {
        params.captureBeyondViewport = true;
        params.clip = clip;
      } else if (args.full_page) {
        const metrics = await withTimeout(
          chrome.debugger.sendCommand(target, "Page.getLayoutMetrics"),
          timeoutMs,
          "CDP Page.getLayoutMetrics"
        );
        const size = metrics?.cssContentSize || metrics?.contentSize;
        if (size?.width && size?.height) {
          const fullClip = {
            x: 0,
            y: 0,
            width: Math.ceil(size.width),
            height: Math.ceil(size.height),
            scale: Number(args.scale || 1)
          };
          assertValidClip(fullClip, maxArea);
          params.captureBeyondViewport = true;
          params.clip = fullClip;
        }
      }
      const result = await withTimeout(
        chrome.debugger.sendCommand(target, "Page.captureScreenshot", params),
        timeoutMs,
        "CDP Page.captureScreenshot"
      );
      if (!result?.data)
        throw new Error("CDP Page.captureScreenshot returned no image data");
      return `data:image/${format === "jpeg" ? "jpeg" : format};base64,${result.data}`;
    } finally {
      if (attached) {
        try {
          await chrome.debugger.detach(target);
        } catch {
        }
      }
    }
  }
  async function toolScreenshot(args = {}) {
    const tab = await getActiveTab();
    const unsupported = unsupportedScreenshotReason(tab.url);
    if (unsupported) {
      return {
        success: false,
        disabled: true,
        unsupported: true,
        error: unsupported,
        tabId: tab.id,
        url: tab.url,
        hint: unsupported
      };
    }
    const showFx = wantsScreenshotFx(args);
    const wantsDebuggerCapture = !!(args.full_page || args.selector || args.text || args.clip || args.x !== void 0 && args.y !== void 0 && args.width !== void 0 && args.height !== void 0);
    const attempts = [];
    const finishScreenshot = async (result) => {
      if (showFx && result?.success) {
        await playScreenshotFx(tab, { phase: "after" });
        await playScreenshotFx(tab, { phase: "clear" });
      }
      return result;
    };
    if (showFx) {
      await playScreenshotFx(tab, {
        phase: "before",
        selector: args.selector,
        text: args.text,
        margin: args.margin ?? args.padding ?? 8,
        full_page: !!args.full_page
      });
    }
    if (wantsDebuggerCapture) {
      try {
        const dataUrl = await captureWithDebugger(tab, args);
        const optimized = await ensureScreenshotPayloadSize(dataUrl, args, () => captureWithDebugger(tab, {
          ...args,
          format: "jpeg",
          quality: args.quality ?? 70
        }));
        return finishScreenshot({
          success: true,
          dataUrl: optimized.dataUrl,
          save_to_server: wantsServerSave(args),
          send_to_user: wantsSendToUser(args),
          tabId: tab.id,
          url: tab.url,
          method: args.full_page ? "debugger.Page.captureScreenshot.fullPage" : args.selector || args.text ? "debugger.Page.captureScreenshot.element" : "debugger.Page.captureScreenshot.clip",
          warning: optimized.warning || void 0
        });
      } catch (err) {
        attempts.push(`debugger.Page.captureScreenshot: ${err?.message || String(err)}`);
      }
      if (args.fallback_visible !== true) {
        const message2 = attempts.join("; ");
        return {
          success: false,
          disabled: /disabled|permission|not allowed|cannot|restricted|debugger/i.test(message2),
          error: message2,
          tabId: tab.id,
          url: tab.url,
          hint: "\u7CBE\u786E\u622A\u56FE\u5931\u8D25\u3002\u8BF7\u68C0\u67E5 selector/text/clip \u53C2\u6570\uFF1B\u82E5\u8981\u5931\u8D25\u65F6\u9000\u56DE\u53EF\u89C6\u533A\u57DF\u622A\u56FE\uFF0C\u8BF7\u4F20 fallback_visible:true\u3002"
        };
      }
    }
    const foreground = await isTabForeground(tab);
    if (foreground) {
      try {
        const dataUrl = await captureVisibleTab(tab.windowId, args, Number(args.retries ?? 1));
        const optimized = await ensureScreenshotPayloadSize(dataUrl, args, () => captureVisibleTab(tab.windowId, {
          ...args,
          format: "jpeg",
          quality: args.quality ?? 70,
          retries: 0
        }, 0));
        return finishScreenshot({
          success: true,
          dataUrl: optimized.dataUrl,
          save_to_server: wantsServerSave(args),
          send_to_user: wantsSendToUser(args),
          tabId: tab.id,
          url: tab.url,
          method: "captureVisibleTab",
          warning: [attempts.length ? attempts.join("; ") : "", optimized.warning].filter(Boolean).join("; ") || void 0
        });
      } catch (err) {
        attempts.push(`captureVisibleTab: ${err?.message || String(err)}`);
      }
    } else {
      attempts.push("captureVisibleTab: skipped (tab not in foreground \u2014 using CDP capture)");
    }
    if (!wantsDebuggerCapture) {
      try {
        const dataUrl = await captureWithDebugger(tab, args);
        const optimized = await ensureScreenshotPayloadSize(dataUrl, args, () => captureWithDebugger(tab, {
          ...args,
          format: "jpeg",
          quality: args.quality ?? 70
        }));
        return finishScreenshot({
          success: true,
          dataUrl: optimized.dataUrl,
          save_to_server: wantsServerSave(args),
          send_to_user: wantsSendToUser(args),
          tabId: tab.id,
          url: tab.url,
          method: "debugger.Page.captureScreenshot",
          warning: [attempts.join("; "), optimized.warning].filter(Boolean).join("; ")
        });
      } catch (err) {
        attempts.push(`debugger.Page.captureScreenshot: ${err?.message || String(err)}`);
      }
    }
    if (showFx)
      await playScreenshotFx(tab, { phase: "clear" });
    const message = attempts.join("; ");
    return {
      success: false,
      disabled: /disabled|permission|not allowed|cannot|restricted|debugger/i.test(message),
      error: message,
      tabId: tab.id,
      url: tab.url,
      hint: "\u622A\u56FE\u4E0D\u53EF\u7528\u3002\u8BF7\u786E\u8BA4\u6269\u5C55\u62E5\u6709\u5F53\u524D\u9875\u9762\u6743\u9650\uFF1B\u82E5\u9875\u9762\u662F\u6D4F\u89C8\u5668\u5185\u90E8\u9875\u3001\u6269\u5C55\u9875\u3001Chrome \u7F51\u4E0A\u5E94\u7528\u5E97\u6216\u53D7 DRM \u4FDD\u62A4\u5185\u5BB9\uFF0CChrome \u4F1A\u963B\u6B62\u622A\u56FE\u3002"
    };
  }
  async function toolTabList() {
    const tabs = await chrome.tabs.query({});
    const activeTab2 = tabs.find((t) => t.active) || null;
    return {
      success: true,
      action: "list",
      count: tabs.length,
      activeTabId: activeTab2?.id ?? null,
      activeTab: activeTab2 ? tabSummary(activeTab2) : null,
      tabs: tabs.map(tabSummary)
    };
  }
  async function toolTabSwitch(args) {
    const tabId = tabIdArg(args);
    if (!Number.isFinite(tabId) || tabId <= 0) {
      throw new Error("tab_id is required for switch action");
    }
    await focusTab(tabId);
    if ((await chrome.tabs.get(tabId)).status !== "complete") {
      await waitForTabLoad(tabId).catch(() => {
      });
    }
    const refreshed = await chrome.tabs.get(tabId);
    const [active] = await chrome.tabs.query({ active: true, windowId: refreshed.windowId });
    return {
      success: true,
      action: "switch",
      ...tabSummary(refreshed),
      focused: active?.id === tabId
    };
  }
  async function toolTabClose(args) {
    const requested = tabIdArg(args);
    const tabId = Number.isFinite(requested) && requested > 0 ? requested : (await getAnyActiveTab()).id;
    const closing = await chrome.tabs.get(tabId);
    await chrome.tabs.remove(tabId);
    return { success: true, action: "close", ...tabSummary(closing) };
  }
  async function toolHistoryBack(args = {}) {
    const tab = await resolveTargetTab(args);
    await focusTab(tab.id);
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => history.back() });
    await delay(250);
    await waitForTabLoad(tab.id).catch(() => {
    });
    const refreshed = await chrome.tabs.get(tab.id);
    return { success: true, action: "back", ...tabSummary(refreshed) };
  }
  async function toolHistoryForward(args = {}) {
    const tab = await resolveTargetTab(args);
    await focusTab(tab.id);
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => history.forward() });
    await delay(250);
    await waitForTabLoad(tab.id).catch(() => {
    });
    const refreshed = await chrome.tabs.get(tab.id);
    return { success: true, action: "forward", ...tabSummary(refreshed) };
  }
  async function toolClipboardWrite(args) {
    const text = String(args.text ?? "");
    const tab = await getActiveTab();
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (t) => navigator.clipboard.writeText(t),
      args: [text]
    });
    return { success: true, length: text.length };
  }
  function routeTarget(args) {
    const { frameId, ref } = parseRef(args.ref ?? args.mark ?? args.id);
    if (frameId !== 0)
      return { frameId, ref, selector: args.selector, text: args.text };
    return { frameId, ref, selector: args.selector, text: args.text, x: args.x, y: args.y };
  }
  var observeCacheByTab = /* @__PURE__ */ new Map();
  function rememberObserveSnapshot(tabId, observe) {
    if (observe?.success && Array.isArray(observe.items) && !observe.delta) {
      observeCacheByTab.set(tabId, {
        url: observe.url,
        title: observe.title,
        scroll: observe.scroll,
        itemCount: observe.itemCount,
        count: observe.count,
        textCount: observe.textCount,
        frameCount: observe.frameCount,
        categoryCounts: observe.categoryCounts,
        items: observe.items
      });
    }
    return observe;
  }
  function normalizedObserveText(value2) {
    return String(value2 ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
  }
  function roundedPointKey(point, bucket = 12) {
    if (!point || typeof point.x !== "number" || typeof point.y !== "number")
      return "";
    return `${Math.round(point.x / bucket)}:${Math.round(point.y / bucket)}`;
  }
  function observeIdentityKey(item) {
    const frame = item?.frameId ?? item?.frameSelector ?? (Array.isArray(item?.framePath) ? item.framePath.join(">") : "");
    const parts2 = [
      item?.kind || "",
      item?.category || "",
      item?.role || "",
      item?.tag || "",
      frame,
      normalizedObserveText(item?.text),
      item?.kind === "interactive" ? "" : roundedPointKey(item?.center)
    ];
    return parts2.join("|");
  }
  function observeFingerprint(item) {
    const center = roundedPointKey(item?.center, 4);
    return JSON.stringify({
      kind: item?.kind || null,
      category: item?.category || null,
      role: item?.role || null,
      text: normalizedObserveText(item?.text),
      center,
      inFrame: !!item?.inFrame,
      frameId: item?.frameId ?? null,
      frameSelector: item?.frameSelector ?? null,
      crossOrigin: !!item?.crossOrigin,
      coordsLocalToFrame: !!item?.coordsLocalToFrame,
      accessible: item?.accessible ?? null
    });
  }
  function observeDelta(previous, current) {
    const previousItems = Array.isArray(previous?.items) ? previous.items : [];
    const currentItems = Array.isArray(current?.items) ? current.items : [];
    const previousByKey = /* @__PURE__ */ new Map();
    const currentByKey = /* @__PURE__ */ new Map();
    for (const item of previousItems) {
      const key = observeIdentityKey(item);
      if (!previousByKey.has(key))
        previousByKey.set(key, item);
    }
    for (const item of currentItems) {
      const key = observeIdentityKey(item);
      if (!currentByKey.has(key))
        currentByKey.set(key, item);
    }
    const addedItems = [];
    const changedItems = [];
    const removedItems = [];
    for (const [key, item] of currentByKey) {
      const before = previousByKey.get(key);
      if (!before) {
        addedItems.push(item);
      } else if (observeFingerprint(before) !== observeFingerprint(item)) {
        changedItems.push({ before, after: item });
      }
    }
    for (const [key, item] of previousByKey) {
      if (!currentByKey.has(key))
        removedItems.push(item);
    }
    const changedAfterItems = changedItems.map((item) => item.after);
    const deltaItems = [...addedItems, ...changedAfterItems];
    const changedCount = addedItems.length + changedItems.length + removedItems.length;
    return {
      success: true,
      source: "browser_observe_delta",
      delta: true,
      url: current?.url,
      title: current?.title,
      page: {
        previousUrl: previous?.url ?? null,
        url: current?.url,
        previousTitle: previous?.title ?? null,
        title: current?.title,
        previousScroll: previous?.scroll ?? null,
        scroll: current?.scroll ?? null,
        previousItemCount: previous?.itemCount ?? previousItems.length,
        itemCount: current?.itemCount ?? currentItems.length,
        previousCategoryCounts: previous?.categoryCounts ?? null,
        categoryCounts: current?.categoryCounts ?? null
      },
      counts: {
        added: addedItems.length,
        changed: changedItems.length,
        removed: removedItems.length,
        totalChanged: changedCount,
        unchanged: Math.max(0, currentItems.length - addedItems.length - changedItems.length)
      },
      items: deltaItems,
      addedItems,
      changedItems,
      removedItems,
      fullObserveOmitted: true,
      hint: changedCount ? "\u81EA\u52A8 observe \u4EC5\u8FD4\u56DE\u76F8\u5BF9\u4E0A\u4E00\u6B21 observe \u7684\u53D8\u5316\uFF1Aitems=\u65B0\u589E\u548C\u53D8\u5316\u540E\u7684\u53EF\u7EE7\u7EED\u70B9\u51FB\u5143\u7D20\uFF1BaddedItems/changedItems/removedItems \u5206\u522B\u5217\u51FA\u65B0\u589E\u3001\u53D8\u5316\u3001\u6D88\u5931\u6761\u76EE\u3002\u5B8C\u6574\u5FEB\u7167\u5DF2\u7701\u7565\uFF0C\u9700\u8981\u5168\u91CF\u65F6\u518D\u8C03\u7528 browser_observe\u3002" : "\u81EA\u52A8 observe \u68C0\u6D4B\u5230\u9875\u9762\u4E8B\u4EF6\uFF0C\u4F46\u76F8\u5BF9\u4E0A\u4E00\u6B21 observe \u6CA1\u6709\u53EF\u89C1\u6761\u76EE\u53D8\u5316\uFF1B\u5B8C\u6574\u5FEB\u7167\u5DF2\u7701\u7565\uFF0C\u9700\u8981\u5168\u91CF\u65F6\u518D\u8C03\u7528 browser_observe\u3002"
    };
  }
  function wantsAutoObserve(args) {
    return args?.observe_after !== false && args?.auto_observe !== false;
  }
  async function autoObserveAfterAction(tab, args, frameId = 0) {
    const tabId = tab.id;
    const waitTimeoutMs = actionWaitTimeoutMs(args);
    let changed = false;
    let navigated = false;
    try {
      const settle = await contentMsg(tabId, {
        action: "await_settle",
        timeout: waitTimeoutMs,
        quiet: args.settle_quiet,
        idle_window: args.settle_idle_window
      }, frameId);
      changed = !!settle?.changed;
      navigated = !!settle?.navigating;
    } catch (err) {
      const message = err?.message || "";
      if (isNoReceiverError(err) || /message channel closed|context invalidated|frame (was )?removed|No tab with id/i.test(message)) {
        changed = true;
        navigated = true;
      } else {
        return null;
      }
    }
    if (navigated)
      await waitForTabLoad(tabId).catch(() => {
      });
    if (!changed)
      return null;
    try {
      const previousObserve = observeCacheByTab.get(tabId);
      return { observe: await toolObserve({ ...args, observe_timeout_ms: args.observe_timeout_ms ?? waitTimeoutMs }), previousObserve };
    } catch {
      return null;
    }
  }
  async function withAutoObserve(tab, args, result, frameId = 0) {
    if (!wantsAutoObserve(args))
      return result;
    if (result && result.success === false)
      return result;
    const observed = await autoObserveAfterAction(tab, args, frameId);
    if (!observed)
      return { ...result, page_changed: false };
    const observe = observeDelta(observed.previousObserve, observed.observe);
    return {
      ...result,
      page_changed: true,
      observe,
      observe_hint: "\u6B64\u64CD\u4F5C\u89E6\u53D1\u4E86\u9875\u9762\u53D8\u5316\uFF0Cobserve \u5B57\u6BB5\u53EA\u9644\u5E26\u76F8\u5BF9\u4E0A\u4E00\u6B21 observe \u7684\u53D8\u5316\u5143\u7D20\uFF08delta:true\uFF1Bitems=\u65B0\u589E/\u53D8\u5316\u540E\u7684\u6761\u76EE\uFF0CremovedItems=\u6D88\u5931\u6761\u76EE\uFF09\uFF0C\u5B8C\u6574\u5FEB\u7167\u5DF2\u7701\u7565\u3002\u9700\u8981\u5168\u91CF\u65F6\u518D\u8C03\u7528 browser_observe\u3002"
    };
  }
  async function toolClick(args) {
    const tab = await getActiveTab();
    const t = routeTarget(args);
    const clickMsg = {
      action: "click",
      ref: t.ref,
      selector: t.selector,
      text: t.text,
      x: t.x,
      y: t.y,
      force: !!args.force
    };
    if (t.frameId !== 0) {
      const result = await contentMsg(tab.id, clickMsg, t.frameId);
      return withAutoObserve(tab, args, result, t.frameId);
    }
    try {
      await contentMsg(tab.id, { action: "hover", ref: t.ref, selector: t.selector, text: t.text, x: t.x, y: t.y }, t.frameId).catch(() => {
      });
      await contentMsg(tab.id, { action: "focus_target", ref: t.ref, selector: t.selector }, t.frameId).catch(() => {
      });
    } catch {
    }
    const resolved = await contentMsg(tab.id, { ...clickMsg, resolveOnly: true }, t.frameId);
    if (!resolved?.resolved || resolved.success === false) {
      return withAutoObserve(tab, args, resolved, t.frameId);
    }
    try {
      const cdp2 = await debuggerClick(tab.id, resolved.x, resolved.y);
      const result = { success: true, tag: resolved.tag, text: resolved.text, click_method: cdp2.method };
      return withAutoObserve(tab, args, result, t.frameId);
    } catch (debuggerErr) {
      const fallback = await contentMsg(tab.id, clickMsg, t.frameId);
      return withAutoObserve(tab, args, {
        ...fallback,
        click_method: "synthetic",
        warning: `Native CDP click failed, fell back to synthetic dispatch: ${debuggerErr?.message || String(debuggerErr)}`
      }, t.frameId);
    }
  }
  function observeMsg(args) {
    return {
      action: "observe",
      limit: args.limit,
      max_items: args.max_items,
      mark: args.mark,
      include_text: args.include_text,
      text_limit: args.text_limit,
      filter: args.filter,
      tag: args.tag,
      tags: args.tags,
      keyword: args.keyword,
      query: args.query,
      text_filter: args.text_filter,
      allow_truncate: args.allow_truncate,
      frame: args.frame,
      frame_selector: args.frame_selector,
      frame_path: args.frame_path
    };
  }
  function observeIsFrameScoped(args) {
    return !!(args?.frame || args?.frame_selector || Array.isArray(args?.frame_path) && args.frame_path.length);
  }
  function tagFrameObserveResult(res, frame) {
    const fid = frame.frameId;
    const reId = (id) => `${fid}:${id}`;
    const tag = (item) => ({
      ...item,
      ...item.kind === "interactive" && item.id !== void 0 ? { id: reId(item.id) } : {},
      inFrame: true,
      crossOrigin: true,
      frameId: fid,
      frameUrl: frame.url,
      coordsLocalToFrame: true
    });
    return {
      items: Array.isArray(res?.items) ? res.items.map(tag) : []
    };
  }
  function observeItemCategory(item) {
    if (item?.kind === "text")
      return "text";
    if (item?.kind === "frame")
      return "frame";
    return String(item?.category || item?.kind || "other");
  }
  function observeCategoryCounts(items) {
    const counts = {};
    for (const item of items) {
      const key = observeItemCategory(item);
      counts[key] = (counts[key] || 0) + 1;
    }
    return Object.fromEntries(Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0])));
  }
  async function toolObserve(args) {
    const timeoutMs = observeWaitTimeoutMs(args);
    return withTimeout(toolObserveWithin(args, timeoutMs), timeoutMs, "browser_observe");
  }
  async function toolObserveWithin(args, timeoutMs) {
    const startedAt = Date.now();
    const remainingMs = () => Math.max(250, timeoutMs - (Date.now() - startedAt));
    const tab = await getActiveTab();
    const base = await withTimeout(
      contentMsg(tab.id, observeMsg(args), 0),
      remainingMs(),
      "browser_observe top frame"
    );
    if (base?.tooMany)
      return rememberObserveSnapshot(tab.id, base);
    if (observeIsFrameScoped(args))
      return rememberObserveSnapshot(tab.id, base);
    const reachedUrls = new Set(
      (Array.isArray(base?.accessibleFrameUrls) ? base.accessibleFrameUrls : []).map((u) => String(u || "").split("#")[0]).filter(Boolean)
    );
    const roots = frameRootsNeedingOwnPass(await listFrames(tab.id), reachedUrls);
    const observed = roots.slice(0, MAX_CROSS_ORIGIN_FRAMES);
    const frameResults = await Promise.all(observed.map(async (frame) => {
      try {
        const res = await withTimeout(
          contentMsg(tab.id, observeMsg(args), frame.frameId),
          Math.min(3e3, remainingMs()),
          `browser_observe frame ${frame.frameId}`
        );
        return { frame, ...tagFrameObserveResult(res, frame) };
      } catch {
        return null;
      }
    }));
    let extraInteractive = 0;
    let extraText = 0;
    const crossFrames = [];
    for (const fr of frameResults) {
      if (!fr)
        continue;
      if (!Array.isArray(base.items))
        base.items = [];
      base.items.push(...fr.items);
      const fInteractive = fr.items.filter((i) => i.kind === "interactive").length;
      const fText = fr.items.filter((i) => i.kind === "text").length;
      extraInteractive += fInteractive;
      extraText += fText;
      crossFrames.push({ frameId: fr.frame.frameId, url: fr.frame.url, interactive: fInteractive, text: fText });
    }
    if (crossFrames.length) {
      base.count = (base.count || 0) + extraInteractive;
      base.textCount = (base.textCount || 0) + extraText;
      base.itemCount = Array.isArray(base.items) ? base.items.length : base.itemCount;
      base.crossOriginFrames = crossFrames;
      base.crossOriginFramesTruncated = roots.length > observed.length;
      base.hint = `${base.hint || ""} \u8DE8\u57DF iframe \u5185\u5BB9\u5DF2\u5408\u5E76\uFF1A\u5E26 crossOrigin=true / frameId \u7684 items \u6765\u81EA\u8DE8\u57DF\u5B50\u6846\u67B6\uFF0C\u5176 center \u4E3A\u8BE5\u6846\u67B6\u5185\u90E8\u5750\u6807\uFF08coordsLocalToFrame=true\uFF0C\u52FF\u4E0E\u4E3B\u9875\u9762\u5750\u6807\u6DF7\u7528\uFF09\uFF1B\u70B9\u51FB\u7528 browser_action {action:"click", ref:"<frameId>:<id>"}\uFF08observe \u8FD4\u56DE\u7684 id \u5DF2\u662F\u8BE5\u683C\u5F0F\uFF09\u3002`;
    }
    const allItems = Array.isArray(base.items) ? base.items : [];
    const limit = Math.min(Math.max(Number(args.limit ?? base?.stats?.limit ?? 120), 1), 200);
    const maxItems = Math.min(Math.max(Number(args.max_items ?? base.maxItems ?? 500), 1), 500);
    const interactiveCount = allItems.filter((item) => item?.kind === "interactive").length;
    if (args.allow_truncate !== true && (interactiveCount > limit || allItems.length > maxItems)) {
      base.tooMany = true;
      base.overLimit = true;
      base.itemCount = allItems.length;
      base.count = 0;
      base.textCount = 0;
      base.categoryCounts = observeCategoryCounts(allItems);
      base.items = [];
      base.marked = false;
      base.hint = `\u5F53\u524D observe \u5408\u5E76\u8DE8\u57DF iframe \u540E\u5339\u914D\u5230 ${allItems.length} \u4E2A\u6761\u76EE\uFF08\u53EF\u4EA4\u4E92 ${interactiveCount} \u4E2A\uFF09\uFF0C\u8D85\u8FC7 limit=${limit} \u6216 max_items=${maxItems}\uFF0C\u4E3A\u907F\u514D\u8FD4\u56DE\u8FC7\u591A\u5185\u5BB9\u5DF2\u4E0D\u8FD4\u56DE items\u3002\u8BF7\u4F7F\u7528 filter\u3001tag/tags\u3001keyword\uFF0C\u6216\u63D0\u9AD8 limit/max_items\uFF1BcategoryCounts \u7ED9\u51FA\u4E86\u5404\u7C7B\u522B\u6570\u91CF\u3002`;
    }
    return rememberObserveSnapshot(tab.id, base);
  }
  async function toolType(args) {
    const tab = await getActiveTab();
    const { frameId, ref } = parseRef(args.ref ?? args.mark ?? args.id);
    const result = await contentMsg(tab.id, {
      action: "type",
      ref,
      selector: args.selector,
      text: args.text,
      clearFirst: args.clear_first !== false,
      submit: false
    }, frameId);
    if (!args.submit)
      return withAutoObserve(tab, args, result, frameId);
    try {
      const pressed = await debuggerPressKey(tab.id, { key: "Enter" });
      return withAutoObserve(tab, args, { ...result, submitted: true, submit_method: pressed.method }, frameId);
    } catch (debuggerErr) {
      await contentMsg(tab.id, { action: "press_key", key: "Enter" });
      return withAutoObserve(tab, args, {
        ...result,
        submitted: true,
        submit_method: "content.KeyboardEvent",
        warning: `Native submit key dispatch failed, fell back to synthetic KeyboardEvent: ${debuggerErr?.message || String(debuggerErr)}`
      }, frameId);
    }
  }
  async function toolScroll(args) {
    const tab = await getActiveTab();
    return contentMsg(tab.id, { action: "scroll", direction: args.direction, amount: args.amount || 400, selector: args.selector });
  }
  async function toolWait(args) {
    const tab = await getActiveTab();
    return contentMsg(tab.id, { action: "wait", selector: args.selector, ms: args.ms });
  }
  function remoteObjectValue(obj) {
    if (!obj)
      return void 0;
    if ("value" in obj)
      return obj.value;
    if ("unserializableValue" in obj)
      return obj.unserializableValue;
    return obj.description ?? `[${obj.type || "unknown"}]`;
  }
  function exceptionMessage(details) {
    const exception = details?.exception;
    return exception?.description || exception?.value || details?.text || "JavaScript evaluation failed";
  }
  async function debuggerEvaluate(tabId, code) {
    const target = { tabId };
    let attached = false;
    async function evaluateExpression(expression) {
      const result = await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
        replMode: true
      });
      if (result?.exceptionDetails)
        throw new Error(exceptionMessage(result.exceptionDetails));
      return result?.result;
    }
    try {
      await chrome.debugger.attach(target, "1.3");
      attached = true;
      let result;
      try {
        result = await evaluateExpression(code);
      } catch (err) {
        if (!/Illegal return statement|Unexpected token|await is only valid/i.test(err.message || ""))
          throw err;
        result = await evaluateExpression(`(async () => {
${code}
})()`);
      }
      return {
        success: true,
        result: remoteObjectValue(result),
        type: result?.type,
        subtype: result?.subtype,
        executionContext: "debugger"
      };
    } finally {
      if (attached) {
        try {
          await chrome.debugger.detach(target);
        } catch {
        }
      }
    }
  }
  var SPECIAL_KEY_INFO = {
    Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
    Return: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
    Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
    Esc: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
    Tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
    Backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
    Delete: { key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 },
    Insert: { key: "Insert", code: "Insert", windowsVirtualKeyCode: 45 },
    Home: { key: "Home", code: "Home", windowsVirtualKeyCode: 36 },
    End: { key: "End", code: "End", windowsVirtualKeyCode: 35 },
    PageUp: { key: "PageUp", code: "PageUp", windowsVirtualKeyCode: 33 },
    PageDown: { key: "PageDown", code: "PageDown", windowsVirtualKeyCode: 34 },
    ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
    ArrowUp: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
    ArrowRight: { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 },
    ArrowDown: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
    Space: { key: " ", code: "Space", windowsVirtualKeyCode: 32 },
    " ": { key: " ", code: "Space", windowsVirtualKeyCode: 32 }
  };
  for (let i = 1; i <= 12; i++) {
    SPECIAL_KEY_INFO[`F${i}`] = { key: `F${i}`, code: `F${i}`, windowsVirtualKeyCode: 111 + i };
  }
  function modifierBits(args) {
    return (args.alt ? 1 : 0) | (args.ctrl ? 2 : 0) | (args.meta ? 4 : 0) | (args.shift ? 8 : 0);
  }
  function keyInfo(rawKey) {
    const raw = String(rawKey || "");
    const special = SPECIAL_KEY_INFO[raw];
    if (special)
      return special;
    if (/^[a-z]$/i.test(raw)) {
      const upper = raw.toUpperCase();
      return { key: raw.length === 1 ? raw : upper, code: `Key${upper}`, windowsVirtualKeyCode: upper.charCodeAt(0) };
    }
    if (/^[0-9]$/.test(raw)) {
      return { key: raw, code: `Digit${raw}`, windowsVirtualKeyCode: raw.charCodeAt(0) };
    }
    if (raw.length === 1) {
      return { key: raw, code: "", windowsVirtualKeyCode: raw.toUpperCase().charCodeAt(0) };
    }
    return { key: raw, code: raw, windowsVirtualKeyCode: 0 };
  }
  async function debuggerPressKey(tabId, args) {
    const info = keyInfo(args.key);
    const modifiers = modifierBits(args);
    const target = { tabId };
    let attached = false;
    try {
      await chrome.debugger.attach(target, "1.3");
      attached = true;
      const printable = info.key.length === 1 && modifiers === 0 && info.key !== "\r";
      const base = {
        key: info.key,
        code: info.code,
        windowsVirtualKeyCode: info.windowsVirtualKeyCode,
        nativeVirtualKeyCode: info.windowsVirtualKeyCode,
        modifiers
      };
      if (printable)
        base.text = info.key;
      await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
        ...base,
        type: printable ? "keyDown" : "rawKeyDown"
      });
      await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
        ...base,
        type: "keyUp",
        text: void 0
      });
      return { success: true, key: info.key, code: info.code, method: "debugger.Input.dispatchKeyEvent" };
    } finally {
      if (attached) {
        try {
          await chrome.debugger.detach(target);
        } catch {
        }
      }
    }
  }
  async function debuggerClick(tabId, x, y, opts) {
    const target = { tabId };
    let attached = false;
    try {
      await chrome.debugger.attach(target, "1.3");
      attached = true;
      const button = opts?.button ?? "left";
      const buttons = button === "right" ? 2 : button === "middle" ? 4 : 1;
      const clickCount = opts?.clickCount ?? 1;
      const base = { x, y, button, clickCount };
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mouseMoved", ...base, buttons: 0, button: "none", clickCount: 0 });
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mousePressed", ...base, buttons });
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mouseReleased", ...base, buttons: 0 });
      return { method: "debugger.Input.dispatchMouseEvent" };
    } finally {
      if (attached) {
        try {
          await chrome.debugger.detach(target);
        } catch {
        }
      }
    }
  }
  async function toolEvaluate(args) {
    const tab = await getActiveTab();
    const rawCode = args.code ?? args.function ?? args.fn ?? args.expression;
    const code = typeof rawCode === "function" ? String(rawCode) : String(rawCode || "");
    if (!code)
      throw new Error("code is required");
    try {
      return await debuggerEvaluate(tab.id, code);
    } catch (debuggerErr) {
      try {
        const fallback = await contentMsg(tab.id, { action: "evaluate", code });
        return {
          ...fallback,
          executionContext: "content_script",
          warning: `CDP Runtime.evaluate failed: ${debuggerErr.message || String(debuggerErr)}`
        };
      } catch (contentErr) {
        throw new Error(`browser_evaluate failed. CDP Runtime.evaluate: ${debuggerErr.message || String(debuggerErr)}; content script fallback: ${contentErr.message || String(contentErr)}`);
      }
    }
  }
  async function toolExtract(args) {
    const tab = await getActiveTab();
    return contentMsg(tab.id, { action: "extract", selector: args.selector, attributes: args.attributes, limit: args.limit || 50 });
  }
  async function toolIframeList() {
    const tab = await getActiveTab();
    return contentMsg(tab.id, { action: "iframe_list" });
  }
  async function toolPerformance() {
    const tab = await getActiveTab();
    return contentMsg(tab.id, { action: "performance" });
  }
  async function toolNetworkLog(args) {
    const tab = await getActiveTab();
    const result = await contentMsg(tab.id, { action: "performance" });
    return {
      ...result,
      source: "performance_resource_timing",
      warning: "This is a passive resource-timing view, not active network interception. Full request/response interception requires a debugger/webRequest pipeline.",
      limit: args.limit || 20,
      requests: (result.resources?.slowest || []).slice(0, args.limit || 20)
    };
  }
  async function toolFindText(args) {
    const tab = await getActiveTab();
    return contentMsg(tab.id, { action: "find_text", text: args.text, exact: !!args.exact });
  }
  async function toolStorageGet(args) {
    const tab = await getActiveTab();
    return contentMsg(tab.id, { action: "storage_get", key: args.key, storageType: args.type || "local" });
  }
  async function toolStorageSet(args) {
    const tab = await getActiveTab();
    return contentMsg(tab.id, { action: "storage_set", key: args.key, value: args.value, storageType: args.type || "local" });
  }
  async function toolStorageRemove(args) {
    const tab = await getActiveTab();
    return contentMsg(tab.id, { action: "storage_remove", key: args.key, storageType: args.type || "local" });
  }
  async function toolStorageList(args) {
    const tab = await getActiveTab();
    return contentMsg(tab.id, { action: "storage_list", prefix: args.prefix, include_values: !!args.include_values, limit: args.limit, storageType: args.type || "local" });
  }
  async function toolFileUpload(args) {
    const tab = await getActiveTab();
    return contentMsg(tab.id, { action: "file_upload", selector: args.selector, files: args.files });
  }
  async function toolDownload(args) {
    if (!args.url)
      throw new Error("url is required");
    const id = await chrome.downloads.download({
      url: String(args.url),
      filename: args.filename ? String(args.filename) : void 0,
      saveAs: !!args.save_as
    });
    return { success: true, downloadId: id, url: args.url, filename: args.filename || "" };
  }
  async function toolCookieList(args) {
    const tab = await getActiveTab();
    const url2 = String(args.url || tab.url || "");
    const cookies = await chrome.cookies.getAll(args.domain ? { domain: String(args.domain) } : { url: url2 });
    return { success: true, url: url2, domain: args.domain || "", count: cookies.length, cookies };
  }
  async function toolCookieGet(args) {
    const tab = await getActiveTab();
    const url2 = String(args.url || tab.url || "");
    if (!args.name)
      throw new Error("name is required");
    const cookie = await chrome.cookies.get({ url: url2, name: String(args.name) });
    return { success: true, url: url2, name: args.name, found: !!cookie, cookie };
  }
  async function toolCookieSet(args) {
    const tab = await getActiveTab();
    const url2 = String(args.url || tab.url || "");
    if (!args.name)
      throw new Error("name is required");
    const cookie = await chrome.cookies.set({
      url: url2,
      name: String(args.name),
      value: String(args.value ?? ""),
      domain: args.domain ? String(args.domain) : void 0,
      path: args.path ? String(args.path) : void 0,
      secure: args.secure === void 0 ? void 0 : !!args.secure,
      httpOnly: args.http_only === void 0 ? void 0 : !!args.http_only,
      expirationDate: args.expiration_date ? Number(args.expiration_date) : void 0
    });
    return { success: true, cookie };
  }
  async function toolCookieDelete(args) {
    const tab = await getActiveTab();
    const url2 = String(args.url || tab.url || "");
    if (!args.name)
      throw new Error("name is required");
    const details = await chrome.cookies.remove({ url: url2, name: String(args.name) });
    return { success: true, removed: !!details, details };
  }
  var SESSION_KEY = "_browser_sessions";
  async function readSessions() {
    const r = await chrome.storage.local.get(SESSION_KEY);
    return Array.isArray(r[SESSION_KEY]) ? r[SESSION_KEY] : [];
  }
  async function writeSessions(sessions2) {
    await chrome.storage.local.set({ [SESSION_KEY]: sessions2 });
  }
  async function toolSessionSave(args) {
    const tab = await getActiveTab();
    const id = String(args.id || `session_${Date.now()}`);
    const name = String(args.name || id);
    let local = null;
    let session = null;
    try {
      local = await contentMsg(tab.id, { action: "storage_list", include_values: true, storageType: "local", limit: 500 });
    } catch {
    }
    try {
      session = await contentMsg(tab.id, { action: "storage_list", include_values: true, storageType: "session", limit: 500 });
    } catch {
    }
    const snapshot = { id, name, url: tab.url, title: tab.title, createdAt: Date.now(), storage: { local, session } };
    const sessions2 = (await readSessions()).filter((s) => s.id !== id);
    sessions2.push(snapshot);
    await writeSessions(sessions2);
    return { success: true, session: snapshot };
  }
  async function toolSessionList() {
    const sessions2 = await readSessions();
    return { success: true, count: sessions2.length, sessions: sessions2.map((s) => ({ id: s.id, name: s.name, url: s.url, title: s.title, createdAt: s.createdAt })) };
  }
  async function toolSessionRestore(args) {
    const sessions2 = await readSessions();
    const target = sessions2.find((s) => s.id === args.id || s.name === args.name);
    if (!target)
      throw new Error("session not found");
    if (args.new_tab === false)
      await toolTabReplace({ url: target.url });
    else
      await toolTabNavigate({ url: target.url });
    const tab = await getActiveTab();
    for (const item of target.storage?.local?.items || []) {
      await contentMsg(tab.id, { action: "storage_set", key: item.key, value: item.value, storageType: "local" }).catch(() => {
      });
    }
    for (const item of target.storage?.session?.items || []) {
      await contentMsg(tab.id, { action: "storage_set", key: item.key, value: item.value, storageType: "session" }).catch(() => {
      });
    }
    return { success: true, restored: { id: target.id, name: target.name, url: target.url } };
  }
  async function toolSessionDelete(args) {
    const sessions2 = await readSessions();
    const kept = sessions2.filter((s) => s.id !== args.id && s.name !== args.name);
    await writeSessions(kept);
    return { success: true, deleted: sessions2.length - kept.length };
  }
  async function toolProfileInfo() {
    const r = await chrome.storage.local.get("_logical_profile");
    return {
      success: true,
      profile: r._logical_profile || "default",
      scope: "extension-logical-profile",
      warning: "Chrome extensions cannot switch the browser user profile. This is a logical profile marker for extension-side state only."
    };
  }
  async function toolProfileSet(args) {
    const profile = String(args.name || args.profile || "default");
    await chrome.storage.local.set({ _logical_profile: profile });
    return { success: true, profile, scope: "extension-logical-profile" };
  }
  async function toolRightClick(args) {
    const tab = await getActiveTab();
    const t = routeTarget(args);
    const result = await contentMsg(tab.id, { action: "right_click", ref: t.ref, selector: t.selector, text: t.text, x: t.x, y: t.y }, t.frameId);
    return withAutoObserve(tab, args, result, t.frameId);
  }
  async function toolDoubleClick(args) {
    const tab = await getActiveTab();
    const t = routeTarget(args);
    const result = await contentMsg(tab.id, { action: "double_click", ref: t.ref, selector: t.selector, text: t.text, x: t.x, y: t.y }, t.frameId);
    return withAutoObserve(tab, args, result, t.frameId);
  }
  async function toolDrag(args) {
    const tab = await getActiveTab();
    const result = await contentMsg(tab.id, {
      action: "drag",
      selector: args.selector,
      text: args.text,
      x: args.x,
      y: args.y,
      toSelector: args.to_selector,
      toText: args.to_text,
      toX: args.to_x,
      toY: args.to_y
    });
    return withAutoObserve(tab, args, result);
  }
  async function toolPressKey(args) {
    const tab = await getActiveTab();
    const fallback = () => contentMsg(tab.id, {
      action: "press_key",
      key: args.key,
      selector: args.selector,
      ctrl: !!args.ctrl,
      shift: !!args.shift,
      alt: !!args.alt,
      meta: !!args.meta
    });
    let result;
    try {
      if (args.selector) {
        await contentMsg(tab.id, { action: "focus_target", selector: args.selector });
      }
      result = await debuggerPressKey(tab.id, args);
    } catch (debuggerErr) {
      result = {
        ...await fallback(),
        method: "content.KeyboardEvent",
        warning: `Native key dispatch failed, fell back to synthetic KeyboardEvent: ${debuggerErr?.message || String(debuggerErr)}`
      };
    }
    return withAutoObserve(tab, args, result);
  }
  function badAction(tool, action, allowed) {
    const got = action === void 0 || action === "" ? "(\u7A7A)" : String(action);
    throw new Error(`${tool}: \u672A\u77E5 action\u300C${got}\u300D\uFF0C\u53EF\u9009 ${allowed.join(" / ")}`);
  }
  function toolTab(args) {
    switch (normalizeTabAction(args)) {
      case "list":
        return toolTabList();
      case "switch":
        return toolTabSwitch(args);
      case "replace":
        return toolTabReplace(args);
      case "navigate":
        return toolTabNavigate(args);
      case "close":
        return toolTabClose(args);
      case "back":
        return toolHistoryBack(args);
      case "forward":
        return toolHistoryForward(args);
      default:
        return badAction("browser_tab", args?.action, [...TAB_ACTIONS]);
    }
  }
  function toolAction(args) {
    switch (args?.action) {
      case "click":
        return toolClick(args);
      case "double_click":
        return toolDoubleClick(args);
      case "right_click":
        return toolRightClick(args);
      case "scroll":
        return toolScroll(args);
      case "type":
        return toolType(args);
      case "press_key":
        return toolPressKey(args);
      default:
        return badAction("browser_action", args?.action, ["click", "double_click", "right_click", "scroll", "type", "press_key"]);
    }
  }
  function toolHistory(args) {
    switch (args?.action) {
      case "back":
        return toolHistoryBack(args);
      case "forward":
        return toolHistoryForward(args);
      default:
        return badAction("browser_history", args?.action, ["back", "forward"]);
    }
  }
  function toolCookie(args) {
    switch (args?.action) {
      case "list":
        return toolCookieList(args);
      case "get":
        return toolCookieGet(args);
      case "set":
        return toolCookieSet(args);
      case "delete":
        return toolCookieDelete(args);
      default:
        return badAction("browser_cookie", args?.action, ["list", "get", "set", "delete"]);
    }
  }
  function toolStorage(args) {
    switch (args?.action) {
      case "get":
        return toolStorageGet(args);
      case "set":
        return toolStorageSet(args);
      case "remove":
        return toolStorageRemove(args);
      case "list":
        return toolStorageList(args);
      default:
        return badAction("browser_storage", args?.action, ["get", "set", "remove", "list"]);
    }
  }
  function toolSession(args) {
    switch (args?.action) {
      case "save":
        return toolSessionSave(args);
      case "list":
        return toolSessionList();
      case "restore":
        return toolSessionRestore(args);
      case "delete":
        return toolSessionDelete(args);
      default:
        return badAction("browser_session", args?.action, ["save", "list", "restore", "delete"]);
    }
  }
  function toolProfile(args) {
    switch (args?.action) {
      case "info":
        return toolProfileInfo();
      case "set":
        return toolProfileSet(args);
      default:
        return badAction("browser_profile", args?.action, ["info", "set"]);
    }
  }
  var HANDLERS = {
    // Navigation — navigate/back/forward are folded into browser_tab;
    // browser_history stays here (hidden) so legacy back/forward calls keep working.
    browser_history: toolHistory,
    // Page observation
    browser_observe: toolObserve,
    browser_screenshot: toolScreenshot,
    browser_find_text: toolFindText,
    browser_performance: () => toolPerformance(),
    browser_network_log: toolNetworkLog,
    browser_iframe_list: () => toolIframeList(),
    // Interaction — click/double_click/right_click/scroll/type/press_key merged
    // into browser_action (action param). The rest stay as their own tools.
    browser_action: toolAction,
    browser_wait: toolWait,
    browser_drag: toolDrag,
    // Data & scripting
    browser_evaluate: toolEvaluate,
    browser_extract: toolExtract,
    browser_clipboard_write: toolClipboardWrite,
    browser_file_upload: toolFileUpload,
    browser_download: toolDownload,
    // Browser state (merged action tools)
    browser_tab: toolTab,
    browser_cookie: toolCookie,
    browser_storage: toolStorage,
    browser_session: toolSession,
    browser_profile: toolProfile
  };
  var LEGACY_ALIASES = {
    // Page-interaction verbs merged into browser_action.
    browser_click: { tool: "browser_action", action: "click" },
    browser_double_click: { tool: "browser_action", action: "double_click" },
    browser_right_click: { tool: "browser_action", action: "right_click" },
    browser_scroll: { tool: "browser_action", action: "scroll" },
    browser_type: { tool: "browser_action", action: "type" },
    browser_press_key: { tool: "browser_action", action: "press_key" },
    // Page-level navigation merged into browser_tab.
    browser_navigate: { tool: "browser_tab", action: "navigate" },
    browser_tab_list: { tool: "browser_tab", action: "list" },
    browser_tab_open: { tool: "browser_tab", action: "navigate" },
    browser_tab_close: { tool: "browser_tab", action: "close" },
    browser_tab_navigate: { tool: "browser_tab", action: "navigate" },
    browser_tab_replace: { tool: "browser_tab", action: "replace" },
    browser_tab_activate: { tool: "browser_tab", action: "switch" },
    browser_tab_switch: { tool: "browser_tab", action: "switch" },
    browser_tab_back: { tool: "browser_tab", action: "back" },
    browser_tab_forward: { tool: "browser_tab", action: "forward" },
    browser_history_back: { tool: "browser_history", action: "back" },
    browser_history_forward: { tool: "browser_history", action: "forward" },
    browser_cookie_list: { tool: "browser_cookie", action: "list" },
    browser_cookie_get: { tool: "browser_cookie", action: "get" },
    browser_cookie_set: { tool: "browser_cookie", action: "set" },
    browser_cookie_delete: { tool: "browser_cookie", action: "delete" },
    browser_storage_get: { tool: "browser_storage", action: "get" },
    browser_storage_set: { tool: "browser_storage", action: "set" },
    browser_storage_remove: { tool: "browser_storage", action: "remove" },
    browser_storage_list: { tool: "browser_storage", action: "list" },
    browser_session_save: { tool: "browser_session", action: "save" },
    browser_session_list: { tool: "browser_session", action: "list" },
    browser_session_restore: { tool: "browser_session", action: "restore" },
    browser_session_delete: { tool: "browser_session", action: "delete" },
    browser_profile_info: { tool: "browser_profile", action: "info" },
    browser_profile_set: { tool: "browser_profile", action: "set" }
  };
  async function executeBrowserOnly(name, args) {
    try {
      const alias = LEGACY_ALIASES[name];
      if (alias) {
        return await HANDLERS[alias.tool]({ ...args || {}, action: alias.action });
      }
      const handler = HANDLERS[name];
      if (!handler)
        throw new Error(`Unknown browser tool: ${name}`);
      return await handler(args || {});
    } catch (err) {
      if (args?.trace || args?.return_error) {
        return { success: false, error: normalizeToolError(err, name, args) };
      }
      throw err;
    }
  }

  // src/lib/tools/dynamic.ts
  var DYNAMIC_MCP_STORAGE_KEY = "_dynamic_mcp_tools";
  var DYNAMIC_MCP_SERVER_STORAGE_KEY = "_dynamic_mcp_server_tools";
  var DYNAMIC_MCP_SERVER_SESSION_KEY = "_dynamic_mcp_server_session";
  var DYNAMIC_MCP_MANAGER_NAME = "mcp.manage_dynamic_tool";
  var BROWSER_DYNAMIC_MCP_MANAGER_NAME = "browser_mcp.manage_dynamic_tool";
  var NAME_RE = /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)*$/;
  function isManagerName(name) {
    return name === DYNAMIC_MCP_MANAGER_NAME || name === BROWSER_DYNAMIC_MCP_MANAGER_NAME;
  }
  function revision(value2) {
    const text = JSON.stringify(value2);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }
  function validate(raw) {
    const name = String(raw?.name || "").trim();
    if (!NAME_RE.test(name))
      throw new Error(`Invalid dynamic MCP name: ${name || "(empty)"}`);
    if (isManagerName(name))
      throw new Error(`${name} is reserved`);
    const description = String(raw?.description || "").trim();
    if (!description)
      throw new Error(`Dynamic MCP ${name} requires description`);
    const inputSchema = raw?.input_schema ?? raw?.inputSchema;
    if (!inputSchema || typeof inputSchema !== "object" || Array.isArray(inputSchema))
      throw new Error(`Dynamic MCP ${name} requires input_schema`);
    const code = typeof raw?.code === "string" ? JSON.parse(raw.code) : raw?.code;
    if (!Array.isArray(code) || !code.length || code.length > 32)
      throw new Error(`Dynamic MCP ${name} code must contain 1-32 instructions`);
    for (const step of code) {
      if (!step || !["call", "set", "return"].includes(step.op))
        throw new Error(`Invalid instruction in ${name}`);
      if (step.op === "call" && !String(step.tool || "").trim())
        throw new Error(`call instruction in ${name} requires tool`);
      if (step.op === "set" && !String(step.name || "").trim())
        throw new Error(`set instruction in ${name} requires name`);
    }
    return { name, description, input_schema: inputSchema, code };
  }
  async function getDynamicMcpDefinitions() {
    const stored = (await chrome.storage.local.get(DYNAMIC_MCP_STORAGE_KEY))[DYNAMIC_MCP_STORAGE_KEY];
    const list = Array.isArray(stored) ? stored : stored?.tools;
    if (list == null)
      return [];
    if (!Array.isArray(list))
      throw new Error("Dynamic MCP storage must contain a tools array");
    const tools = list.map(validate);
    if (new Set(tools.map((item) => item.name)).size !== tools.length)
      throw new Error("Duplicate dynamic MCP name");
    return tools;
  }
  async function saveDynamicMcpDefinitions(tools) {
    await chrome.storage.local.set({ [DYNAMIC_MCP_STORAGE_KEY]: { version: 1, tools } });
  }
  async function readServerSession() {
    try {
      const stored = (await chrome.storage.session.get(DYNAMIC_MCP_SERVER_SESSION_KEY))[DYNAMIC_MCP_SERVER_SESSION_KEY];
      const tools = Array.isArray(stored?.tools) ? stored.tools : [];
      const rev = typeof stored?.revision === "string" ? stored.revision : "";
      return { revision: rev, tools };
    } catch {
      return { revision: "", tools: [] };
    }
  }
  async function getServerDynamicMcpDefinitions() {
    return (await readServerSession()).tools;
  }
  async function purgeLegacyServerCache() {
    await chrome.storage.local.remove(DYNAMIC_MCP_SERVER_STORAGE_KEY);
  }
  async function clearServerDynamicMcp() {
    const current = await readServerSession();
    const hadServer = current.tools.length > 0 || !!current.revision;
    await chrome.storage.session.remove(DYNAMIC_MCP_SERVER_SESSION_KEY);
    const { merged } = await getMergedDynamicMcpDefinitions();
    return { cleared: hadServer, tools: merged.length, server: 0 };
  }
  void purgeLegacyServerCache();
  async function getMergedDynamicMcpDefinitions() {
    const [local, server] = await Promise.all([getDynamicMcpDefinitions(), getServerDynamicMcpDefinitions()]);
    const serverNames = new Set(server.map((item) => item.name));
    const byName = /* @__PURE__ */ new Map();
    for (const def of local)
      byName.set(def.name, def);
    for (const def of server)
      byName.set(def.name, def);
    return { merged: Array.from(byName.values()), serverNames };
  }
  async function applyServerDynamicMcp(payload) {
    const list = Array.isArray(payload) ? payload : payload?.tools;
    const tools = Array.isArray(list) ? list.map(validate) : [];
    if (new Set(tools.map((item) => item.name)).size !== tools.length)
      throw new Error("Duplicate dynamic MCP name");
    const rev = revision(tools);
    const current = await readServerSession();
    if (rev === current.revision)
      return { applied: false, revision: rev, tools: tools.length };
    await chrome.storage.session.set({ [DYNAMIC_MCP_SERVER_SESSION_KEY]: { revision: rev, tools } });
    return { applied: true, revision: rev, tools: tools.length };
  }
  function lookup3(root, dotted) {
    return dotted.split(".").filter(Boolean).reduce((value2, key) => value2 == null ? void 0 : value2[key], root);
  }
  function render(value2, context) {
    if (Array.isArray(value2))
      return value2.map((item) => render(item, context));
    if (value2 && typeof value2 === "object")
      return Object.fromEntries(Object.entries(value2).map(([key, item]) => [key, render(item, context)]));
    if (typeof value2 !== "string")
      return value2;
    const exact = value2.match(/^\$\{([^}]+)\}$/);
    if (exact)
      return lookup3(context, exact[1]);
    return value2.replace(/\$\{([^}]+)\}/g, (_all, expr) => {
      const found = lookup3(context, expr);
      return found == null ? "" : typeof found === "string" ? found : JSON.stringify(found);
    });
  }
  async function runProgram(def, args, callTool, callBuiltin, all, depth = 0) {
    if (depth > 8)
      throw new Error("Dynamic MCP call depth exceeded");
    const context = { args, vars: {}, last: null, workspaceRoot: "" };
    for (const step of def.code) {
      if (step.op === "set") {
        context.vars[String(step.name)] = render(step.value, context);
        continue;
      }
      if (step.op === "return")
        return render(step.value, context);
      const target = String(render(step.tool || "", context) || "").trim();
      if (isManagerName(target))
        throw new Error("Dynamic MCP code cannot invoke the management tool");
      const builtinTarget = target.startsWith("builtin:") ? target.slice("builtin:".length) : "";
      const childArgs = render(step.args || {}, context);
      const child = all.find((item) => item.name === target);
      const result = builtinTarget ? await callBuiltin(builtinTarget, childArgs) : child ? await runProgram(child, childArgs, callTool, callBuiltin, all, depth + 1) : await callTool(target, childArgs);
      context.last = result;
      if (step.save_as)
        context.vars[String(step.save_as)] = result;
    }
    return context.last;
  }
  async function executeDynamicMcp(name, args, callTool, callBuiltin) {
    if (isManagerName(name))
      return { handled: true, result: await manageDynamicMcp(args) };
    const { merged } = await getMergedDynamicMcpDefinitions();
    const def = merged.find((item) => item.name === name);
    if (!def)
      return { handled: false };
    return { handled: true, result: await runProgram(def, args || {}, callTool, callBuiltin, merged) };
  }
  var BROWSER_SOURCE_FILES = ["src/lib/tools/definitions.ts", "src/lib/tools/browser.ts", "src/lib/tools/router.ts", "dist/background.js"];
  function sourceFilesForTool(name) {
    return isManagerName(name) ? ["src/lib/tools/dynamic.ts", "dist/background.js"] : BROWSER_SOURCE_FILES;
  }
  async function readExtensionSource(requested) {
    const relative = String(requested || "").trim().replace(/\\/g, "/");
    if (!relative || relative.startsWith("/") || relative.split("/").includes("..") || !/^(src|dist)\//.test(relative)) {
      throw new Error("source_path must be a relative src/ or dist/ path inside the extension");
    }
    const response = await fetch(chrome.runtime.getURL(relative));
    if (!response.ok)
      throw new Error(`Source file not found: ${relative}`);
    const content = await response.text();
    if (content.length > 256 * 1024)
      throw new Error(`Source file is too large to inspect: ${relative}`);
    return { path: relative, content, size: content.length };
  }
  async function readToolSources(name) {
    const sources = [];
    for (const sourcePath of sourceFilesForTool(name)) {
      try {
        sources.push(await readExtensionSource(sourcePath));
      } catch {
      }
    }
    return sources;
  }
  async function inspectTool(name, all, includeSource = true) {
    const dynamic = all.find((item) => item.name === name);
    const builtin = BROWSER_TOOLS.find((item) => item.name === name);
    if (!dynamic && !builtin && !isManagerName(name))
      throw new Error(`MCP tool not found: ${name}`);
    const active = dynamic || builtin || BROWSER_DYNAMIC_MCP_MANAGER_DEF;
    return {
      ok: true,
      name,
      implementation_kind: dynamic ? "dynamic_override" : "builtin",
      active_definition: active,
      source_files: sourceFilesForTool(name),
      sources: includeSource ? await readToolSources(name) : void 0,
      dynamic_storage_key: DYNAMIC_MCP_STORAGE_KEY,
      edit_workflow: [
        `Call ${BROWSER_DYNAMIC_MCP_MANAGER_NAME} action=get_source with a tool name to read the packaged implementation.`,
        `Call ${BROWSER_DYNAMIC_MCP_MANAGER_NAME} action=upsert with starter_definition or a revised definition.`,
        `Use builtin:${name} inside a call instruction to wrap the original implementation.`,
        `Call ${BROWSER_DYNAMIC_MCP_MANAGER_NAME} action=delete to restore the built-in implementation.`
      ],
      starter_definition: dynamic || {
        name,
        description: active.description || `Dynamic override for ${name}`,
        input_schema: active.input_schema || { type: "object", properties: {} },
        code: [
          { op: "call", tool: `builtin:${name}`, args: "${args}", save_as: "original_result" },
          { op: "return", value: "${vars.original_result}" }
        ]
      }
    };
  }
  async function manageDynamicMcp(args) {
    const action = String(args?.action || "list").trim().toLowerCase();
    const all = await getDynamicMcpDefinitions();
    if (action === "reload")
      return { ok: true, tools: all.length, revision: revision(all) };
    if (action === "list")
      return { ok: true, revision: revision(all), tools: all.map((item) => ({ name: item.name, description: item.description, revision: revision(item) })) };
    const name = String(args?.name || args?.definition?.name || "").trim();
    if (action === "get_source") {
      const requested = String(args?.source_path || "").trim();
      const sources = [];
      if (requested) {
        try {
          sources.push(await readExtensionSource(requested));
        } catch (err) {
          if (!name)
            throw err;
        }
      }
      if (name) {
        const seen = new Set(sources.map((source) => source.path));
        for (const source of await readToolSources(name)) {
          if (!seen.has(source.path))
            sources.push(source);
        }
      }
      if (!sources.length)
        throw new Error("get_source requires name or a readable source_path");
      return { ok: true, name: name || void 0, requested_path: requested || void 0, source: sources[0], sources };
    }
    if (!name)
      throw new Error("name is required");
    if (action === "inspect")
      return inspectTool(name, all, args?.include_source !== false);
    if (action === "upsert" || action === "delete") {
      const serverNames = new Set((await getServerDynamicMcpDefinitions().catch(() => [])).map((item) => item.name));
      if (serverNames.has(name))
        throw new Error(`${name} is managed from the web console for this device type`);
    }
    const current = all.find((item) => item.name === name);
    if (action === "get") {
      if (!current)
        throw new Error(`Dynamic MCP not found: ${name}`);
      return { ok: true, definition: current, revision: revision(current) };
    }
    if (args?.expected_revision && current && args.expected_revision !== revision(current))
      throw new Error(`Dynamic MCP changed since it was read: ${name}`);
    let next;
    if (action === "delete") {
      if (!current)
        throw new Error(`Dynamic MCP not found: ${name}`);
      next = all.filter((item) => item.name !== name);
    } else if (action === "upsert") {
      const nextDef = validate({ ...args.definition || {}, name });
      next = [...all.filter((item) => item.name !== name), nextDef].sort((a, b) => a.name.localeCompare(b.name));
    } else
      throw new Error(`Unsupported action: ${action}`);
    await saveDynamicMcpDefinitions(next);
    return { ok: true, action, name, tools: next.length, revision: revision(next) };
  }
  var DYNAMIC_MCP_MANAGER_DEF = {
    name: DYNAMIC_MCP_MANAGER_NAME,
    description: "\u52A8\u6001\u7BA1\u7406\u672C\u6D4F\u89C8\u5668\u8BBE\u5907\u7684\u4F20\u627F MCP \u4EE3\u7801\u3002\u53EF\u8BFB\u53D6\u3001\u521B\u5EFA\u3001\u66F4\u65B0\u3001\u5220\u9664\u5E76\u70ED\u52A0\u8F7D JSON \u7A0B\u5E8F\u5DE5\u5177\uFF1B\u4F7F\u7528\u73B0\u6709\u5DE5\u5177\u540D\u53EF\u8986\u76D6\u5185\u7F6E\u5B9E\u73B0\uFF0C\u5220\u9664\u540E\u6062\u590D\u5185\u7F6E\u7248\u672C\uFF1B\u4FDD\u5B58\u540E\u4F1A\u7ACB\u5373\u5411\u670D\u52A1\u5668\u91CD\u65B0\u4E0A\u62A5\u5DE5\u5177\u76EE\u5F55\u3002",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "get", "inspect", "get_source", "upsert", "delete", "reload"], description: "\u7BA1\u7406\u52A8\u4F5C\u3002inspect \u9ED8\u8BA4\u8FD4\u56DE\u5B9E\u73B0\u6E90\u7801\uFF1Bget_source \u53EF\u6309\u5DE5\u5177\u540D\u8BFB\u53D6\u5168\u90E8\u76F8\u5173\u6E90\u7801\u3002" },
        name: { type: "string", description: "MCP \u540D\u79F0\uFF0C\u5982 browser_action \u6216 custom.collect_page\u3002get_source \u53EA\u4F20\u540D\u79F0\u5373\u53EF\u8BFB\u53D6\u6E90\u7801\u3002" },
        source_path: { type: "string", description: "\u53EF\u9009\u76F8\u5BF9\u6E90\u7801\u8DEF\u5F84\uFF1B\u8BFB\u53D6\u5931\u8D25\u4F46\u63D0\u4F9B name \u65F6\u4F1A\u81EA\u52A8\u6309\u5DE5\u5177\u540D\u67E5\u627E\u3002" },
        include_source: { type: "boolean", description: "inspect \u662F\u5426\u9644\u5E26\u5B8C\u6574\u6E90\u7801\uFF0C\u9ED8\u8BA4 true\u3002" },
        expected_revision: { type: "string", description: "get \u8FD4\u56DE\u7684\u4FEE\u8BA2\u54C8\u5E0C\uFF1B\u66F4\u65B0/\u5220\u9664\u65F6\u7528\u4E8E\u9632\u6B62\u8986\u76D6\u5E76\u53D1\u4FEE\u6539\u3002" },
        definition: {
          type: "object",
          description: "upsert \u4F7F\u7528\u7684\u5B8C\u6574\u52A8\u6001 MCP \u5B9A\u4E49\u3002",
          properties: {
            name: { type: "string", description: "\u5DE5\u5177\u540D\uFF1B\u4E0E\u5185\u7F6E\u5DE5\u5177\u540C\u540D\u65F6\u8986\u76D6\u5185\u7F6E\u5B9E\u73B0\u3002" },
            description: { type: "string", description: "\u5411 AI \u5C55\u793A\u7684\u5DE5\u5177\u8BF4\u660E\u3002" },
            input_schema: { type: "object", description: "JSON Schema \u5165\u53C2\u5B9A\u4E49\u3002" },
            code: { type: "array", minItems: 1, maxItems: 32, description: "call/set/return \u6307\u4EE4\uFF1B\u6A21\u677F\u652F\u6301 ${args.x}\u3001${vars.x}\u3001${last.x}\u3002", items: { type: "object" } }
          },
          required: ["name", "description", "input_schema", "code"]
        }
      },
      required: ["action"]
    },
    implementation: {
      kind: "builtin_manager",
      source_files: ["src/lib/tools/dynamic.ts", "dist/background.js"],
      editable_via: DYNAMIC_MCP_MANAGER_NAME
    }
  };
  var BROWSER_DYNAMIC_MCP_MANAGER_DEF = {
    ...DYNAMIC_MCP_MANAGER_DEF,
    name: BROWSER_DYNAMIC_MCP_MANAGER_NAME,
    description: "\u52A8\u6001\u7BA1\u7406\u672C\u6D4F\u89C8\u5668\u8BBE\u5907\u7684\u4F20\u627F MCP \u4EE3\u7801\u3002\u53EF\u8BFB\u53D6\u6D4F\u89C8\u5668\u5DE5\u5177\u6E90\u7801\u3001\u521B\u5EFA\u6216\u8986\u76D6\u5DE5\u5177\uFF0C\u5E76\u5728\u4FDD\u5B58\u540E\u7ACB\u5373\u70ED\u52A0\u8F7D\u548C\u91CD\u65B0\u4E0A\u62A5\u3002",
    implementation: {
      ...DYNAMIC_MCP_MANAGER_DEF.implementation,
      editable_via: BROWSER_DYNAMIC_MCP_MANAGER_NAME
    }
  };
  function isServerManagedToolDef(tool) {
    const impl = tool.implementation;
    if (!impl || typeof impl !== "object")
      return false;
    return impl.source === "server" || impl.storage_key === "memory:server";
  }
  async function dynamicMcpToolDefs() {
    const { merged, serverNames } = await getMergedDynamicMcpDefinitions();
    return [BROWSER_DYNAMIC_MCP_MANAGER_DEF, ...merged.map((def) => {
      const fromServer = serverNames.has(def.name);
      return {
        name: def.name,
        description: def.description,
        input_schema: def.input_schema,
        implementation: {
          kind: "dynamic",
          definition: def,
          code: def.code,
          storage_key: fromServer ? "memory:server" : DYNAMIC_MCP_STORAGE_KEY,
          source: fromServer ? "server" : "local",
          editable_via: BROWSER_DYNAMIC_MCP_MANAGER_NAME
        }
      };
    })];
  }

  // src/lib/tools/router.ts
  async function executeBrowserTool(name, args) {
    const dynamic = await executeDynamicMcp(name, args || {}, executeBrowserTool, executeBrowserOnly);
    if (dynamic.handled)
      return dynamic.result;
    return executeBrowserOnly(name, args);
  }

  // src/lib/ai.ts
  function dataUrlParts(dataUrl) {
    const m = String(dataUrl || "").match(/^data:([^;,]+);base64,(.+)$/);
    if (!m)
      return null;
    return { mediaType: m[1] || "image/png", data: m[2] || "" };
  }
  function anthropicMessages(messages) {
    return messages;
  }
  function stringifyToolContent(content) {
    if (typeof content === "string")
      return content;
    if (Array.isArray(content)) {
      return content.filter((item) => item?.type !== "image").map((item) => item?.type === "text" ? String(item.text || "") : JSON.stringify(item)).filter(Boolean).join("\n");
    }
    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }
  function openAiMessages(messages) {
    const out = [];
    for (const msg of messages) {
      if (msg.role === "assistant" && Array.isArray(msg.content) && msg.content.some((b) => b?.type === "tool_use")) {
        const toolCalls = msg.content.filter((b) => b?.type === "tool_use").map((tu) => ({
          id: tu.id,
          type: "function",
          function: {
            name: tu.name,
            arguments: JSON.stringify(tu.input || {})
          }
        }));
        out.push({ role: "assistant", content: null, tool_calls: toolCalls });
        continue;
      }
      if (msg.role === "user" && Array.isArray(msg.content) && msg.content.some((b) => b?.type === "tool_result")) {
        const imageMessages = [];
        for (const tr of msg.content) {
          if (tr?.type !== "tool_result")
            continue;
          const content = tr.content;
          out.push({
            role: "tool",
            tool_call_id: tr.tool_use_id || "call_0",
            content: stringifyToolContent(content)
          });
          const blocks = Array.isArray(content) ? content : [];
          const image = blocks.find((b) => b?.type === "image");
          if (image?.source?.type === "base64" && image.source.data) {
            const mediaType = image.source.media_type || "image/png";
            const dataUrl = `data:${mediaType};base64,${image.source.data}`;
            const text = blocks.find((b) => b?.type === "text")?.text || "Screenshot captured by browser_screenshot.";
            imageMessages.push({
              role: "user",
              content: [
                { type: "text", text },
                { type: "image_url", image_url: { url: dataUrl } }
              ]
            });
          }
        }
        out.push(...imageMessages);
        continue;
      }
      if (msg.role === "user" && Array.isArray(msg.content)) {
        const parts2 = [];
        for (const item of msg.content) {
          if (item?.type === "text")
            parts2.push({ type: "text", text: String(item.text || "") });
          else if (item?.type === "image" && item.source?.type === "base64") {
            const dataUrl = `data:${item.source.media_type || "image/png"};base64,${item.source.data || ""}`;
            parts2.push({ type: "image_url", image_url: { url: dataUrl } });
          } else if (item?.type === "image_url") {
            parts2.push(item);
          }
        }
        out.push({ role: msg.role, content: parts2.length ? parts2 : stringifyToolContent(msg.content) });
        continue;
      }
      out.push({ role: msg.role, content: typeof msg.content === "string" ? msg.content : stringifyToolContent(msg.content) });
    }
    return out;
  }
  function screenshotToolContent(result) {
    const parsed = dataUrlParts(result?.dataUrl || "");
    if (!parsed)
      return typeof result === "string" ? result : JSON.stringify(result);
    return [
      { type: "image", source: { type: "base64", media_type: parsed.mediaType, data: parsed.data } },
      { type: "text", text: `Screenshot of: ${result.url || "current page"}
Method: ${result.method || "browser_screenshot"}` }
    ];
  }
  async function callAI(baseUrl, apiKey, model, messages, tools, systemPrompt) {
    if (!apiKey)
      throw new Error("AI Key is not configured");
    const isAnthropic = baseUrl.includes("anthropic.com");
    const endpoint = isAnthropic ? `${baseUrl.replace(/\/$/, "")}/v1/messages` : `${baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
    const headers = { "Content-Type": "application/json" };
    if (isAnthropic) {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
      headers["anthropic-dangerous-direct-browser-access"] = "true";
    } else {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
    let body;
    if (isAnthropic) {
      body = { model, max_tokens: 4096, messages: anthropicMessages(messages) };
      if (tools?.length)
        body.tools = tools;
      if (systemPrompt)
        body.system = systemPrompt;
    } else {
      const oaMessages = systemPrompt ? [{ role: "system", content: systemPrompt }, ...openAiMessages(messages)] : openAiMessages(messages);
      body = { model, max_tokens: 4096, messages: oaMessages };
      if (tools?.length) {
        body.tools = tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.input_schema }
        }));
      }
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6e4);
    let res;
    try {
      res = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
    } catch (err) {
      if (err?.name === "AbortError")
        throw new Error("AI API request timed out after 60s");
      throw err;
    } finally {
      clearTimeout(timer);
    }
    const data = await res.json();
    if (!res.ok)
      throw new Error(data?.error?.message || `AI API error ${res.status}`);
    if (isAnthropic) {
      const textBlock = data.content?.find((b) => b.type === "text");
      const toolUseBlocks = (data.content || []).filter((b) => b.type === "tool_use");
      return {
        text: textBlock?.text,
        toolUses: toolUseBlocks.length ? toolUseBlocks : void 0,
        stopReason: data.stop_reason
      };
    } else {
      const choice = data.choices?.[0];
      if (choice?.message?.tool_calls?.length) {
        const toolUses = choice.message.tool_calls.map((tc) => ({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input: (() => {
            try {
              return JSON.parse(tc.function.arguments || "{}");
            } catch {
              return {};
            }
          })()
        }));
        return { toolUses, stopReason: choice.finish_reason };
      }
      return { text: choice?.message?.content || "", stopReason: choice?.finish_reason };
    }
  }

  // src/lib/tools/executor.ts
  function inferTool(instruction) {
    const t = instruction.toLowerCase();
    if (/截图|screenshot/.test(t))
      return "browser_screenshot";
    if (/观察|可点击|可交互|元素列表|observe/.test(t))
      return "browser_observe";
    if (/弹窗|关闭弹窗|popup|modal|dialog/.test(t))
      return "browser_action";
    if (/搜索|search/.test(t))
      return "browser_tab";
    if (/查找|找/.test(t))
      return "browser_observe";
    if (/点击|click/.test(t))
      return "browser_click";
    if (/输入|type|填写/.test(t))
      return "browser_type";
    if (/导航|打开|访问|navigate|open|go to|前往/.test(t))
      return "browser_navigate";
    if (/滚动|scroll/.test(t))
      return "browser_scroll";
    if (/提取|extract|抓取/.test(t))
      return "browser_extract";
    if (/标签|tab/.test(t))
      return "browser_tab";
    if (/内容|content|页面文本/.test(t))
      return "browser_observe";
    return "browser_observe";
  }
  var SYSTEM_PROMPT = `You are HeySure AI, a browser automation assistant running as a Chrome extension.
You act like a human looking at the page: you only see and interact with what is visible on top \u2014 not hidden or background DOM.

Page interaction goes through one tool, browser_action, with an action param:
click / double_click / right_click / scroll / type / press_key. Page-level
navigation goes through browser_tab with one of 7 actions: list / switch /
replace / navigate / close / back / forward.

Core interaction loop (prefer this for any click/type):
1. browser_tab {action:"list"} to see open pages and the active tab.
   If the target page is already open, browser_tab {action:"switch", tab_id}.
   To open a URL in a new tab: browser_tab {action:"navigate", url}.
   To change the current tab's URL: browser_tab {action:"replace", url}.
2. Call browser_observe to read the visible page: kind=frame lists every iframe boundary (see also the top-level frames array; accessible=true means inner controls are scanned with inFrame=true), kind=text is visible text, kind=interactive are top-most controls, each with its own id (every control is listed individually; use the filter param to narrow by category, e.g. filter:"button"). Cross-origin frames have accessible=false \u2014 do not coordinate-click them. Marks: purple dashed=iframe boundary, green=clickable, red=disabled/blocked/covered. Call browser_screenshot to see marks if needed.
3. Act by interactive id: browser_action {action:"click", ref:id}, then browser_action {action:"type", text:"\u2026"} for inputs. Using ref is far more reliable than guessing selectors, Playwright syntax (:has-text), or raw coordinates.
4. Re-run browser_observe after anything changes the page (scroll, navigation, opening a menu/popup) to refresh the ids.

Handling obstacles:
- If browser_action {action:"click"} returns occluded:true, a popup/overlay/ad is covering the target. Re-observe to find the close button and click it, try browser_action {action:"press_key", key:"Escape"}, or use force:true only when deliberate.
- If it returns not_visible:true, the element isn't on screen \u2014 scroll or expand its container first, then observe again.

Always:
- Use browser_observe + browser_screenshot to understand the page; after scrolling, read the position info returned by browser_action {action:"scroll"}.
- Be methodical and verify each step.
- Respond in the same language as the user's message.
- Summarize what you accomplished at the end.`;
  async function executeTask(task, settings) {
    const toolName = task.tool || inferTool(task.instruction || "");
    const args = task.args || {};
    if (toolName && toolName !== "ai_agent" && !toolName.startsWith("ai.")) {
      if (!task.tool && task.instruction && Object.keys(args).length === 0) {
        if (toolName === "browser_tab" && /搜索|search/.test((task.instruction || "").toLowerCase())) {
          args.action = "navigate";
          args.url = `https://www.google.com/search?q=${encodeURIComponent(task.instruction || "")}`;
        } else if (toolName === "browser_navigate")
          args.url = task.instruction;
        else if (toolName === "browser_tab")
          args.action = "list";
      }
      try {
        const result = await executeBrowserTool(toolName, args);
        return { success: true, tool: toolName, result, summary: `${toolName} completed` };
      } catch (err) {
        return { success: false, tool: toolName, result: null, summary: err.message };
      }
    }
    if (!settings.aiKey) {
      return { success: false, tool: "ai_agent", result: null, summary: "AI Key not configured" };
    }
    const messages = [{
      role: "user",
      content: task.instruction || JSON.stringify(task.args) || "Complete the task"
    }];
    const toolsUsed = [];
    let iterations = 0;
    const MAX_ITER = 12;
    try {
      while (iterations < MAX_ITER) {
        const resp = await callAI(settings.aiBaseUrl, settings.aiKey, settings.aiModel, messages, BROWSER_TOOLS, SYSTEM_PROMPT);
        if (!resp.toolUses?.length) {
          return {
            success: true,
            tool: "ai_agent",
            result: { text: resp.text, toolsUsed },
            summary: resp.text?.slice(0, 200) || "Done"
          };
        }
        messages.push({ role: "assistant", content: resp.toolUses });
        const toolResults = [];
        for (const tu of resp.toolUses) {
          toolsUsed.push(tu.name);
          try {
            const toolResult = await executeBrowserTool(tu.name, tu.input);
            let content = typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult);
            if (tu.name === "browser_screenshot" && toolResult?.dataUrl) {
              content = screenshotToolContent(toolResult);
            }
            toolResults.push({ type: "tool_result", tool_use_id: tu.id, content });
          } catch (err) {
            toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: `Error: ${err.message}`, is_error: true });
          }
        }
        messages.push({ role: "user", content: toolResults });
        iterations++;
      }
      return { success: false, tool: "ai_agent", result: { toolsUsed }, summary: "Max iterations reached" };
    } catch (err) {
      return { success: false, tool: "ai_agent", result: null, summary: err.message };
    }
  }

  // src/lib/tools/overrides.ts
  async function allToolDefs() {
    return await dynamicMcpToolDefs();
  }
  async function effectiveToolDefs() {
    const overrides = await getToolDescOverrides();
    return (await allToolDefs()).map((tool) => {
      if (isServerManagedToolDef(tool))
        return tool;
      const o = overrides[tool.name];
      if (!o)
        return tool;
      const desc = (o.description || "").trim();
      const props = tool.input_schema?.properties || {};
      let nextProps = props;
      if (o.parameters && Object.keys(o.parameters).length) {
        nextProps = {};
        for (const [k, v] of Object.entries(props)) {
          const pd = (o.parameters[k] || "").trim();
          nextProps[k] = pd ? { ...v, description: pd } : v;
        }
      }
      return {
        ...tool,
        description: desc || tool.description,
        input_schema: { ...tool.input_schema, properties: nextProps }
      };
    });
  }

  // src/lib/remote-control.ts
  var debuggerApi = chrome.debugger;
  function hasDebuggerApi() {
    return !!(debuggerApi?.attach && debuggerApi?.detach && debuggerApi?.sendCommand && debuggerApi?.onEvent?.addListener && debuggerApi?.onDetach?.addListener);
  }
  function debuggerUnavailableError() {
    return new Error("\u5F53\u524D\u6D4F\u89C8\u5668\u4E0D\u652F\u6301 chrome.debugger API\uFF0C\u65E0\u6CD5\u4F7F\u7528\u8FDC\u7A0B\u63A7\u5236");
  }
  async function resolveIceServers() {
    try {
      const [settings, auth] = await Promise.all([getSettings(), getAuth()]);
      if (!settings.serverUrl || !auth.token)
        return DEFAULT_ICE_SERVERS;
      return await getIceServers(settings.serverUrl, auth.token);
    } catch {
      return DEFAULT_ICE_SERVERS;
    }
  }
  function isControllableUrl(url2) {
    const raw = String(url2 || "");
    if (!raw)
      return false;
    if (/^(chrome|edge|brave|vivaldi|opera|about|chrome-extension|devtools|view-source):/i.test(raw))
      return false;
    if (/^https:\/\/chromewebstore\.google\.com\//i.test(raw))
      return false;
    return true;
  }
  var sessions = /* @__PURE__ */ new Map();
  var listenersBound = false;
  var FRAME_OPTS = { format: "jpeg", quality: 85, maxWidth: 2560, maxHeight: 1440, everyNthFrame: 1 };
  function cdp(tabId, method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!debuggerApi?.sendCommand) {
        reject(debuggerUnavailableError());
        return;
      }
      debuggerApi.sendCommand({ tabId }, method, params, (res) => {
        const err = chrome.runtime.lastError;
        if (err)
          reject(new Error(err.message));
        else
          resolve(res);
      });
    });
  }
  function attach(tabId) {
    return new Promise((resolve, reject) => {
      if (!debuggerApi?.attach) {
        reject(debuggerUnavailableError());
        return;
      }
      debuggerApi.attach({ tabId }, "1.3", () => {
        const err = chrome.runtime.lastError;
        if (err && !/already attached/i.test(err.message))
          reject(new Error(err.message));
        else
          resolve();
      });
    });
  }
  var selfDetaching = /* @__PURE__ */ new Set();
  function detach(tabId) {
    selfDetaching.add(tabId);
    try {
      if (!debuggerApi?.detach) {
        selfDetaching.delete(tabId);
        return;
      }
      debuggerApi.detach({ tabId }, () => {
        void chrome.runtime.lastError;
        setTimeout(() => selfDetaching.delete(tabId), 0);
      });
    } catch {
      selfDetaching.delete(tabId);
    }
  }
  async function startCapture(session) {
    const tabId = session.tabId;
    if (!hasDebuggerApi())
      return false;
    if (session.attaching || session.attached)
      return session.attached;
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      return false;
    }
    if (!isControllableUrl(tab.url)) {
      session.attached = false;
      return false;
    }
    session.attaching = true;
    try {
      await attach(tabId);
      await cdp(tabId, "Page.enable");
      await cdp(tabId, "Page.startScreencast", FRAME_OPTS);
      session.attached = true;
      return true;
    } catch {
      session.attached = false;
      detach(tabId);
      return false;
    } finally {
      session.attaching = false;
    }
  }
  function findSessionByTab(tabId) {
    for (const s of sessions.values())
      if (s.tabId === tabId)
        return s;
    return void 0;
  }
  async function activeTab() {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tabs[0] ?? null;
  }
  function toOffscreen(event, payload) {
    chrome.runtime.sendMessage({ rc: true, dir: "to-offscreen", event, ...payload }).catch(() => {
    });
  }
  function initRemoteControl() {
    if (listenersBound)
      return;
    if (!hasDebuggerApi()) {
      listenersBound = true;
      return;
    }
    listenersBound = true;
    debuggerApi.onEvent.addListener((source, method, params) => {
      if (method !== "Page.screencastFrame" || source.tabId == null)
        return;
      const session = findSessionByTab(source.tabId);
      if (!session)
        return;
      cdp(source.tabId, "Page.screencastFrameAck", { sessionId: params.sessionId }).catch(() => {
      });
      if (params.metadata) {
        session.metadata = { deviceWidth: params.metadata.deviceWidth, deviceHeight: params.metadata.deviceHeight };
      }
      toOffscreen("frame", { sessionId: session.sessionId, dataUrl: `data:image/jpeg;base64,${params.data}` });
    });
    debuggerApi.onDetach.addListener((source) => {
      const tabId = source.tabId;
      if (tabId == null)
        return;
      if (selfDetaching.delete(tabId))
        return;
      const session = findSessionByTab(tabId);
      if (!session)
        return;
      session.attached = false;
      chrome.tabs.get(tabId).then((tab) => {
        if (isControllableUrl(tab.url)) {
          endSession(session.sessionId, "debugger_detached", true);
        } else {
          void broadcastBrowserState(session);
        }
      }).catch(() => endSession(session.sessionId, "tab_closed", true));
    });
    const onTabsChanged = () => {
      for (const s of sessions.values()) {
        void broadcastBrowserState(s);
        if (!s.attached && !s.attaching)
          void startCapture(s).then((ok) => {
            if (ok)
              void broadcastBrowserState(s);
          });
      }
    };
    chrome.tabs.onUpdated.addListener(onTabsChanged);
    chrome.tabs.onActivated.addListener(onTabsChanged);
    chrome.tabs.onCreated.addListener(onTabsChanged);
    chrome.tabs.onRemoved.addListener(onTabsChanged);
    chrome.tabs.onMoved.addListener(onTabsChanged);
  }
  async function handleRcSocketSignal(event, data, send) {
    const sessionId = String(data?.sessionId || "");
    if (!sessionId)
      return;
    if (event === "rc:start") {
      if (!hasDebuggerApi()) {
        send("rc:error", { sessionId, code: "debugger_unavailable", message: "\u5F53\u524D\u6D4F\u89C8\u5668\u4E0D\u652F\u6301 chrome.debugger API\uFF0C\u65E0\u6CD5\u4F7F\u7528\u8FDC\u7A0B\u63A7\u5236" });
        return;
      }
      const tab = await activeTab();
      if (!tab || tab.id == null) {
        send("rc:error", { sessionId, code: "no_tab", message: "\u6CA1\u6709\u53EF\u63A7\u5236\u7684\u6D3B\u52A8\u6807\u7B7E\u9875" });
        return;
      }
      const tabId = tab.id;
      try {
        initRemoteControl();
        const session = {
          sessionId,
          tabId,
          windowId: tab.windowId,
          send,
          metadata: null,
          buttons: 0,
          attached: false,
          attaching: false
        };
        sessions.set(sessionId, session);
        const iceServers = await resolveIceServers();
        toOffscreen("peer-start", { sessionId, iceServers });
        await startCapture(session);
        void broadcastBrowserState(session);
      } catch (err) {
        detach(tabId);
        sessions.delete(sessionId);
        send("rc:error", { sessionId, code: "attach_failed", message: err?.message || "\u65E0\u6CD5\u9644\u52A0\u5230\u6807\u7B7E\u9875\uFF08\u8BF7\u5173\u95ED\u8BE5\u6807\u7B7E\u7684\u5F00\u53D1\u8005\u5DE5\u5177\u540E\u91CD\u8BD5\uFF09" });
      }
      return;
    }
    if (event === "rc:answer")
      toOffscreen("answer", { sessionId, sdp: data.sdp });
    else if (event === "rc:ice")
      toOffscreen("ice", { sessionId, candidate: data.candidate });
    else if (event === "rc:stop")
      endSession(sessionId, "operator_stop", false);
  }
  function handleOffscreenRcMessage(msg, send) {
    const sessionId = String(msg?.sessionId || "");
    const session = sessions.get(sessionId);
    switch (msg?.event) {
      case "offer":
        send("rc:offer", { sessionId, sdp: msg.sdp });
        break;
      case "ice":
        send("rc:ice", { sessionId, candidate: msg.candidate });
        break;
      case "ready":
        send("rc:ready", { sessionId, width: msg.width, height: msg.height, rotation: 0 });
        break;
      case "error":
        send("rc:error", { sessionId, code: msg.code || "peer_error", message: msg.message || "" });
        endSession(sessionId, "peer_error", false);
        break;
      case "stopped":
        endSession(sessionId, "peer_stopped", false);
        send("rc:stopped", { sessionId });
        break;
      case "control-msg":
        if (!session)
          break;
        if (msg.msg?.kind === "browser")
          void handleBrowserCommand(session, msg.msg);
        else
          void dispatchInput(session, msg.msg);
        break;
    }
  }
  function stopAllRemoteControl() {
    for (const sessionId of [...sessions.keys()])
      endSession(sessionId, "agent_disconnected", true);
  }
  function endSession(sessionId, reason, notifyPeer) {
    const session = sessions.get(sessionId);
    if (!session)
      return;
    sessions.delete(sessionId);
    if (session.attached)
      cdp(session.tabId, "Page.stopScreencast").catch(() => {
      });
    detach(session.tabId);
    toOffscreen("peer-stop", { sessionId });
    if (notifyPeer)
      session.send("rc:stopped", { sessionId, reason });
  }
  var BUTTON_BIT = { left: 1, right: 2, middle: 4 };
  async function dispatchInput(session, input) {
    const md = session.metadata;
    if (!md)
      return;
    const tabId = session.tabId;
    const x = Math.round((Number(input?.x) || 0) * md.deviceWidth);
    const y = Math.round((Number(input?.y) || 0) * md.deviceHeight);
    const button = input?.button === "right" || input?.button === "middle" ? input.button : "left";
    try {
      switch (input?.type) {
        case "move":
          await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: session.buttons });
          break;
        case "down":
          session.buttons |= BUTTON_BIT[button] || 1;
          await cdp(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, buttons: session.buttons, clickCount: 1 });
          break;
        case "up":
          await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, buttons: session.buttons, clickCount: 1 });
          session.buttons &= ~(BUTTON_BIT[button] || 1);
          break;
        case "scroll":
          await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: Number(input?.dx) || 0, deltaY: Number(input?.dy) || 0 });
          break;
        case "text":
          if (input?.text)
            await cdp(tabId, "Input.insertText", { text: String(input.text) });
          break;
        case "key":
          await dispatchKey(tabId, input);
          break;
      }
    } catch {
    }
  }
  var NAMED_KEYS = {
    Enter: { code: "Enter", vk: 13 },
    Tab: { code: "Tab", vk: 9 },
    Backspace: { code: "Backspace", vk: 8 },
    Delete: { code: "Delete", vk: 46 },
    Escape: { code: "Escape", vk: 27 },
    ArrowUp: { code: "ArrowUp", vk: 38 },
    ArrowDown: { code: "ArrowDown", vk: 40 },
    ArrowLeft: { code: "ArrowLeft", vk: 37 },
    ArrowRight: { code: "ArrowRight", vk: 39 },
    Home: { code: "Home", vk: 36 },
    End: { code: "End", vk: 35 },
    PageUp: { code: "PageUp", vk: 33 },
    PageDown: { code: "PageDown", vk: 34 }
  };
  var MODIFIER_ONLY = /* @__PURE__ */ new Set(["Control", "Alt", "Shift", "Meta"]);
  async function dispatchKey(tabId, input) {
    const key = String(input?.key || "");
    if (!key || MODIFIER_ONLY.has(key))
      return;
    let modifiers = 0;
    if (input?.alt)
      modifiers |= 1;
    if (input?.ctrl)
      modifiers |= 2;
    if (input?.meta)
      modifiers |= 4;
    if (input?.shift)
      modifiers |= 8;
    const type = input?.action === "up" ? "keyUp" : "keyDown";
    const named = NAMED_KEYS[key];
    const params = { type, modifiers, key };
    if (named) {
      params.code = named.code;
      params.windowsVirtualKeyCode = named.vk;
      params.nativeVirtualKeyCode = named.vk;
    } else if (key.length === 1) {
      if (type === "keyDown" && !input?.ctrl && !input?.alt && !input?.meta) {
        params.text = key;
        params.unmodifiedText = key;
      }
    }
    await cdp(tabId, "Input.dispatchKeyEvent", params);
  }
  async function broadcastBrowserState(session) {
    try {
      const tabs = await chrome.tabs.query({ windowId: session.windowId });
      const captured = tabs.find((t) => t.id === session.tabId);
      const state = {
        activeTabId: session.tabId,
        // false on a restricted page (chrome://, web store, …): the live screen is
        // frozen and pointer/keyboard do nothing, but the address bar still works.
        // The web UI uses this to show a hint instead of looking broken.
        controllable: isControllableUrl(captured?.url),
        tabs: tabs.map((t) => ({
          id: t.id,
          title: t.title || t.url || "\u65B0\u6807\u7B7E\u9875",
          url: t.url || "",
          favIconUrl: t.favIconUrl || "",
          active: t.id === session.tabId
        }))
      };
      toOffscreen("browser-state", { sessionId: session.sessionId, state });
    } catch {
    }
  }
  function normalizeAddress(input) {
    const value2 = String(input || "").trim();
    if (!value2)
      return "about:blank";
    if (/^[a-z]+:\/\//i.test(value2) || value2.startsWith("about:") || value2.startsWith("chrome:"))
      return value2;
    if (!/\s/.test(value2) && /\.[a-z]{2,}$/i.test(value2.split("/")[0]))
      return `https://${value2}`;
    return `https://www.bing.com/search?q=${encodeURIComponent(value2)}`;
  }
  async function switchCaptureTab(session, newTabId) {
    if (session.tabId === newTabId) {
      await chrome.tabs.update(newTabId, { active: true }).catch(() => {
      });
      if (!session.attached)
        await startCapture(session);
      void broadcastBrowserState(session);
      return;
    }
    if (session.attached) {
      try {
        await cdp(session.tabId, "Page.stopScreencast");
      } catch {
      }
      detach(session.tabId);
    }
    session.tabId = newTabId;
    session.metadata = null;
    session.buttons = 0;
    session.attached = false;
    await chrome.tabs.update(newTabId, { active: true }).catch(() => {
    });
    await startCapture(session);
    void broadcastBrowserState(session);
  }
  async function handleBrowserCommand(session, cmd) {
    const tabId = session.tabId;
    try {
      switch (cmd?.action) {
        case "back":
          await chrome.tabs.goBack(tabId);
          break;
        case "forward":
          await chrome.tabs.goForward(tabId);
          break;
        case "reload":
          await chrome.tabs.reload(tabId);
          break;
        case "navigate":
          await chrome.tabs.update(tabId, { url: normalizeAddress(cmd.url) });
          break;
        case "new-tab": {
          const created = await chrome.tabs.create({
            windowId: session.windowId,
            url: cmd.url ? normalizeAddress(cmd.url) : void 0
          });
          if (created.id != null)
            await switchCaptureTab(session, created.id);
          break;
        }
        case "switch-tab":
          if (typeof cmd.tabId === "number")
            await switchCaptureTab(session, cmd.tabId);
          break;
        case "close-tab":
          if (typeof cmd.tabId === "number") {
            const closingCaptured = cmd.tabId === session.tabId;
            await chrome.tabs.remove(cmd.tabId);
            if (closingCaptured) {
              const rest = await chrome.tabs.query({ windowId: session.windowId });
              const next = rest.find((t) => t.id != null);
              if (next?.id != null)
                await switchCaptureTab(session, next.id);
            }
          }
          break;
      }
    } catch {
    }
    void broadcastBrowserState(session);
  }

  // src/background.ts
  var socket = null;
  var currentStatus = "disconnected";
  var taskOutcomes = /* @__PURE__ */ new Map();
  var popupPorts = /* @__PURE__ */ new Set();
  var offlineChatControllers = /* @__PURE__ */ new Map();
  var _machineId = null;
  var currentAgentId = null;
  var connectPromise = null;
  var authRejected = false;
  async function withTaskTimeout(promise, ms, label) {
    let timer = null;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        })
      ]);
    } finally {
      if (timer)
        clearTimeout(timer);
    }
  }
  function taskTimeoutMs(task) {
    const fromArgs = Number(task.args?.task_timeout_ms || task.args?.timeout_seconds && Number(task.args.timeout_seconds) * 1e3);
    if (Number.isFinite(fromArgs) && fromArgs > 0)
      return Math.min(11e4, Math.max(5e3, Math.round(fromArgs)));
    if (task.tool === "browser_screenshot")
      return 35e3;
    return 9e4;
  }
  var MAX_TASK_OUTCOMES = 100;
  function rememberTaskOutcome(taskId, outcome) {
    taskOutcomes.delete(taskId);
    taskOutcomes.set(taskId, outcome);
    for (const key of taskOutcomes.keys()) {
      if (taskOutcomes.size <= MAX_TASK_OUTCOMES)
        break;
      if (taskOutcomes.get(key)?.kind === "running")
        continue;
      taskOutcomes.delete(key);
    }
  }
  function emitTaskOutcome(taskId, outcome) {
    if (!socket?.connected) {
      outcome.unsent = true;
      return;
    }
    if (outcome.kind === "result")
      socket.emit("task:result", outcome.payload);
    else if (outcome.kind === "error")
      socket.emit("task:error", { taskId, userId: outcome.userId, error: outcome.error });
    outcome.unsent = false;
  }
  function flushUnsentTaskOutcomes() {
    if (!socket?.connected)
      return;
    for (const [taskId, outcome] of taskOutcomes) {
      if (outcome?.unsent)
        emitTaskOutcome(taskId, outcome);
    }
  }
  function mkEntry(type, status, message, data) {
    return { id: Math.random().toString(36).slice(2), type, status, message, data, timestamp: Date.now() };
  }
  function log(type, status, message, data) {
    const entry = mkEntry(type, status, message, data);
    void pushActivity(entry);
    broadcast({ type: "activity:log", entry });
  }
  function refreshPopupStatus() {
    broadcast({ type: "device:status", status: currentStatus, aiConfigId: boundAiConfigId });
  }
  var boundAiConfigId = null;
  var actionApi = chrome.action;
  function setStatus(status, reason) {
    currentStatus = status;
    if (status !== "registered" && status !== "connected")
      boundAiConfigId = null;
    broadcast({ type: "device:status", status, reason, aiConfigId: boundAiConfigId });
    const colors = {
      disconnected: "#787878",
      connecting: "#f59e0b",
      connected: "#6366f1",
      registered: "#22c55e",
      error: "#ef4444"
    };
    try {
      actionApi?.setBadgeBackgroundColor?.({ color: colors[status] });
      actionApi?.setBadgeText?.({ text: status === "registered" ? "\u25CF" : status === "error" ? "!" : "" });
      actionApi?.setTitle?.({ title: `HeySure Agent \u2014 ${status}` });
    } catch {
    }
  }
  function postToPopup(port, msg) {
    try {
      port.postMessage(msg);
      return true;
    } catch {
      popupPorts.delete(port);
      return false;
    }
  }
  function broadcast(msg) {
    popupPorts.forEach((port) => {
      postToPopup(port, msg);
    });
  }
  function rcSend(event, payload) {
    socket?.emit(event, payload);
  }
  async function getMachineId() {
    if (_machineId)
      return _machineId;
    const r = await chrome.storage.local.get("_mid");
    if (r._mid) {
      _machineId = r._mid;
      return _machineId;
    }
    const id = "br-" + Math.random().toString(36).slice(2, 10);
    await chrome.storage.local.set({ _mid: id });
    _machineId = id;
    return id;
  }
  async function emitRegisterOn(s) {
    const settings = await getSettings();
    const auth = await getAuth();
    if (settings.offlineMode)
      return;
    const id = settings.deviceId || await getMachineId();
    currentAgentId = id;
    const toolDefs = await effectiveToolDefs();
    s.emit("device:register", {
      id,
      aiConfigId: null,
      name: settings.agentName || "\u6D4F\u89C8\u5668\u63D2\u4EF6",
      group: settings.agentGroup || "",
      platform: `browser-extension (${navigator?.userAgent?.split(" ").pop() || "chrome"})`,
      os: { platform: "browser", arch: "unknown", release: "1.0", hostname: id },
      // Advertise remote_control alongside the tool names so the server gates live
      // screen control on it (mirrors remote_control.RC_CAPABILITY server-side).
      capabilities: [...toolDefs.map((t) => t.name), "remote_control"],
      // Full self-described tool schemas (with the user's local description edits
      // merged in). The server stores these and surfaces them in mcp.list_tools /
      // describe_tool instead of hardcoding browser tool schemas, so a tool added
      // here — or a description edited in the popup — needs no server change.
      toolDefs,
      version: "1.0.0",
      token: auth.token || settings.agentToken || "",
      userId: auth.userId ?? null,
      workspaceRoot: "",
      lifecycle: "registered",
      isWindowsDesktop: false,
      isBrowserExtension: true
    });
  }
  async function connect() {
    if (socket?.connected)
      return;
    if (connectPromise)
      return connectPromise;
    connectPromise = doConnect().finally(() => {
      connectPromise = null;
    });
    return connectPromise;
  }
  async function doConnect() {
    const settings = await getSettings();
    if (socket?.connected)
      return;
    if (settings.offlineMode) {
      log("system", "info", "\u79BB\u7EBF\u6A21\u5F0F\u5DF2\u5F00\u542F\uFF0C\u8DF3\u8FC7\u670D\u52A1\u5668\u8FDE\u63A5");
      return;
    }
    const auth = await getAuth();
    if (!auth.token) {
      setStatus("disconnected");
      log("system", "warn", "\u672A\u767B\u5F55\uFF0C\u5DF2\u963B\u6B62\u8FDE\u63A5\u670D\u52A1\u5668\uFF08\u8BF7\u5148\u767B\u5F55\u8D26\u53F7\uFF09");
      return;
    }
    let agentSocketUrl = String(settings.agentSocketUrl || "").trim();
    if (!agentSocketUrl) {
      try {
        agentSocketUrl = await getAgentEndpoint(settings.serverUrl, auth.token);
        await saveSettings({ agentSocketUrl });
      } catch (err) {
        setStatus("error", "\u65E0\u6CD5\u83B7\u53D6 Agent \u8FDE\u63A5\u5730\u5740");
        log("system", "error", `\u65E0\u6CD5\u83B7\u53D6 Agent \u8FDE\u63A5\u5730\u5740: ${err?.message || err}`);
        return;
      }
    }
    try {
      agentSocketUrl = new URL(agentSocketUrl).href.replace(/\/$/, "");
    } catch {
      log("system", "error", "Agent \u8FDE\u63A5\u5730\u5740\u683C\u5F0F\u65E0\u6548");
      return;
    }
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }
    authRejected = false;
    setStatus("connecting");
    log("system", "info", `\u6B63\u5728\u8FDE\u63A5 Agent \u670D\u52A1\u5668: ${agentSocketUrl}`);
    socket = lookup2(agentSocketUrl, {
      transports: ["websocket", "polling"],
      reconnectionDelay: 2e3,
      reconnectionAttempts: Infinity
    });
    attachOperationalListeners(socket, settings.agentName || "\u6D4F\u89C8\u5668\u63D2\u4EF6");
  }
  function attachOperationalListeners(s, agentName) {
    s.on("connect", async () => {
      setStatus("connected");
      log("system", "info", "\u5DF2\u8FDE\u63A5\u5230\u670D\u52A1\u5668");
      await register();
      flushUnsentTaskOutcomes();
    });
    s.on("disconnect", (reason) => {
      void clearServerSyncedTools();
      setStatus("disconnected", reason);
      log("system", "warn", `\u8FDE\u63A5\u65AD\u5F00: ${reason}`);
      if (reason === "io server disconnect" && !authRejected) {
        setTimeout(() => {
          if (socket && !socket.connected && !socket.active)
            socket.connect();
        }, 2e3);
      }
    });
    s.on("connect_error", (err) => {
      setStatus("error", err.message);
      log("system", "error", `\u8FDE\u63A5\u5931\u8D25: ${err.message}`);
    });
    s.on("device:registered", (data) => {
      const raw = data?.aiConfigId;
      const parsed = typeof raw === "number" ? raw : raw != null && String(raw).trim() !== "" ? Number(raw) : null;
      boundAiConfigId = Number.isFinite(parsed) ? parsed : null;
      setStatus("registered");
      log("system", "success", `\u5DF2\u6CE8\u518C: ${data?.name || agentName}${boundAiConfigId == null ? "\uFF08\u672A\u5206\u914D AI\uFF09" : ""}`);
    });
    s.on("device:list", (rows) => {
      if (!currentAgentId || !Array.isArray(rows))
        return;
      const mine = rows.find((row) => String(row?.id || "") === currentAgentId);
      if (!mine)
        return;
      const raw = mine?.aiConfigId ?? mine?.ai_config_id;
      const parsed = typeof raw === "number" ? raw : raw != null && String(raw).trim() !== "" ? Number(raw) : null;
      const nextAiConfigId = Number.isFinite(parsed) ? parsed : null;
      if (nextAiConfigId !== boundAiConfigId) {
        boundAiConfigId = nextAiConfigId;
        refreshPopupStatus();
        log("system", "info", `AI \u7ED1\u5B9A\u5DF2\u66F4\u65B0: ${boundAiConfigId == null ? "\u672A\u5206\u914D" : `#${boundAiConfigId}`}`);
      }
    });
    s.on("device:register_rejected", (data) => {
      const reason = data?.reason || "\u6CE8\u518C\u88AB\u670D\u52A1\u5668\u62D2\u7EDD";
      authRejected = true;
      try {
        s.io.reconnection(false);
      } catch {
      }
      disconnect();
      setStatus("error", reason);
      log("system", "error", `\u6CE8\u518C\u88AB\u62D2\u7EDD\uFF0C\u5DF2\u505C\u6B62\u81EA\u52A8\u91CD\u8FDE\uFF08\u8BF7\u91CD\u65B0\u767B\u5F55\u540E\u518D\u8FDE\u63A5\uFF09: ${reason}`);
    });
    s.on("task:dispatch", (task) => {
      void handleTask(task);
    });
    try {
      initRemoteControl();
    } catch (err) {
      log("system", "warn", `\u8FDC\u7A0B\u63A7\u5236\u521D\u59CB\u5316\u5931\u8D25\uFF0C\u5DF2\u7EE7\u7EED\u8FDE\u63A5\u670D\u52A1\u5668: ${err?.message || err}`);
    }
    for (const ev of ["rc:start", "rc:answer", "rc:ice", "rc:stop"]) {
      s.on(ev, (data) => {
        void handleRcSocketSignal(ev, data, rcSend);
      });
    }
    s.on("device:tool-config", (payload) => {
      void (async () => {
        try {
          const status = await applyServerDynamicMcp(payload);
          if (status.applied) {
            const names = Array.isArray(payload?.tools) ? payload.tools.map((t) => String(t?.name || "").trim()).filter(Boolean) : [];
            if (names.length)
              await clearToolDescOverrides(names);
            log("system", "info", `\u5DF2\u5E94\u7528\u670D\u52A1\u5668\u4E0B\u53D1\u7684 MCP \u5DE5\u5177\uFF1A${status.tools} \u4E2A`);
            if (socket?.connected)
              await register();
          }
        } catch (err) {
          log("system", "error", `\u5E94\u7528\u670D\u52A1\u5668 MCP \u5DE5\u5177\u5931\u8D25: ${err?.message || err}`);
        }
      })();
    });
  }
  async function register() {
    const settings = await getSettings();
    if (settings.offlineMode) {
      log("system", "info", "\u79BB\u7EBF\u6A21\u5F0F\u5DF2\u5F00\u542F\uFF0C\u8DF3\u8FC7\u6CE8\u518C");
      return;
    }
    if (!socket)
      return;
    log("system", "info", "\u6CE8\u518C agent\uFF08AI \u7531\u670D\u52A1\u5668\u4F5C\u574A\u5206\u914D\uFF09");
    await emitRegisterOn(socket);
  }
  function disconnect() {
    stopAllRemoteControl();
    socket?.disconnect();
    socket = null;
    void clearServerSyncedTools();
    setStatus("disconnected");
  }
  async function clearServerSyncedTools() {
    const status = await clearServerDynamicMcp();
    if (!status.cleared)
      return;
    log("system", "info", "\u5DF2\u6E05\u7A7A\u670D\u52A1\u5668\u4E0B\u53D1\u7684 MCP \u5DE5\u5177\uFF08\u7B49\u5F85\u91CD\u65B0\u540C\u6B65\uFF09");
    if (socket?.connected)
      await register();
  }
  async function restoreAndConnectOnStartup() {
    const s = await getSettings();
    const auth = await getAuth();
    if (!s.offlineMode && auth.token)
      await connect();
  }
  var ensureOffscreenPromise = null;
  async function ensureOffscreen() {
    if (ensureOffscreenPromise)
      return ensureOffscreenPromise;
    ensureOffscreenPromise = (async () => {
      try {
        if (await chrome.offscreen.hasDocument())
          return;
        await chrome.offscreen.createDocument({
          url: "offscreen.html",
          // WORKERS: keepalive heartbeat. WEB_RTC: host the remote-control peer
          // connection (a service worker can't run RTCPeerConnection).
          reasons: [chrome.offscreen.Reason.WORKERS, chrome.offscreen.Reason.WEB_RTC],
          justification: "\u4FDD\u6301\u540E\u53F0\u8FDE\u63A5\uFF0C\u5E76\u627F\u8F7D\u8FDC\u7A0B\u63A7\u5236\u7684 WebRTC \u8FDE\u63A5\uFF08Service Worker \u65E0\u6CD5\u8FD0\u884C RTCPeerConnection\uFF09\u3002"
        });
      } catch {
      }
    })().finally(() => {
      ensureOffscreenPromise = null;
    });
    return ensureOffscreenPromise;
  }
  async function handleTask(task) {
    const taskId = task.taskId;
    if (!taskId)
      return;
    const cached = taskOutcomes.get(taskId);
    if (cached) {
      if (cached.kind === "result" || cached.kind === "error")
        emitTaskOutcome(taskId, cached);
      return;
    }
    taskOutcomes.set(taskId, { kind: "running" });
    const tool = task.tool || "(infer)";
    log("task", "running", `[\u5DE5\u5177] ${tool}`, task.args);
    broadcast({ type: "task:start", data: { taskId, tool, args: task.args, timestamp: Date.now() } });
    socket?.emit("task:progress", { taskId, progress: 0, message: `\u6267\u884C ${tool}...` });
    try {
      const settings = await getSettings();
      const timeoutMs = taskTimeoutMs(task);
      const outcome = await withTaskTimeout(executeTask(task, settings), timeoutMs, `Endpoint task ${tool}`);
      const payload = {
        taskId,
        userId: task.userId,
        aiConfigId: task.aiConfigId,
        sessionId: task.sessionId,
        tool: outcome.tool,
        success: outcome.success,
        result: outcome.result,
        summary: outcome.summary
      };
      const entry = { kind: "result", payload };
      rememberTaskOutcome(taskId, entry);
      emitTaskOutcome(taskId, entry);
      log("task", outcome.success ? "success" : "error", `${outcome.success ? "\u5B8C\u6210" : "\u5931\u8D25"}: ${outcome.tool}`, outcome.result);
      broadcast({ type: "task:result", data: { taskId, tool: outcome.tool, result: outcome.result, success: outcome.success, timestamp: Date.now() } });
    } catch (err) {
      const errMsg = err?.message || String(err);
      const entry = { kind: "error", error: errMsg, userId: task.userId };
      rememberTaskOutcome(taskId, entry);
      emitTaskOutcome(taskId, entry);
      log("task", "error", `\u5F02\u5E38: ${tool} \u2014 ${errMsg}`);
      broadcast({ type: "task:result", data: { taskId, tool, result: null, success: false, timestamp: Date.now() } });
    }
  }
  async function testConnection() {
    const settings = await getSettings();
    if (!settings.serverUrl)
      return { success: false, error: "\u672A\u914D\u7F6E\u670D\u52A1\u5668 URL" };
    let url2;
    try {
      url2 = new URL(settings.serverUrl);
    } catch {
      return { success: false, error: "URL \u683C\u5F0F\u65E0\u6548" };
    }
    const base = url2.href.replace(/\/$/, "");
    let httpResult = null;
    try {
      const start = Date.now();
      const res = await fetch(`${base}/`, { signal: AbortSignal.timeout(5e3) }).catch(() => fetch(base, { signal: AbortSignal.timeout(5e3) }));
      httpResult = { success: true, status: res.status, ms: Date.now() - start };
    } catch (err) {
      httpResult = { success: false, error: err.message };
    }
    const auth = await getAuth();
    let agentSocketUrl = settings.agentSocketUrl || "";
    let endpointResult = null;
    if (auth.token) {
      try {
        agentSocketUrl = await getAgentEndpoint(settings.serverUrl, auth.token);
        await saveSettings({ agentSocketUrl });
        endpointResult = { success: true, agentSocketUrl };
      } catch (err) {
        endpointResult = { success: false, error: err?.message || String(err) };
      }
    }
    return {
      success: httpResult.success,
      http: httpResult,
      agentSocketUrl,
      endpoint: endpointResult,
      needsLogin: !auth.token
    };
  }
  var CHAT_SYSTEM = `You are HeySure AI, a browser automation assistant running as a Chrome extension.
You can navigate pages, click, double-click, right-click, type, drag, press keys, scroll, take
screenshots, extract data, and more.

Use browser_observe and browser_screenshot to understand the page; after scrolling, read the
position info returned by browser_action {action:"scroll"} so you know where you landed.

If a popup/modal/dialog blocks the page, re-observe to find its close button and click it, or
press Escape with browser_action {action:"press_key", key:"Escape"}.

When asked to complete tasks, use the available tools systematically and summarize what you did.
Respond in the same language as the user.`;
  async function runChat(messages) {
    const settings = await getSettings();
    if (!settings.aiKey)
      throw new Error("\u672A\u914D\u7F6E AI Key");
    const toolsUsed = [];
    const toolEvents = [];
    let iter = 0;
    const MAX = 12;
    const chatTools = await effectiveToolDefs();
    while (iter < MAX) {
      const resp = await callAI(settings.aiBaseUrl, settings.aiKey, settings.aiModel, messages, chatTools, CHAT_SYSTEM);
      if (!resp.toolUses?.length) {
        return { text: resp.text || "\u5B8C\u6210", toolsUsed, toolEvents };
      }
      messages.push({ role: "assistant", content: resp.toolUses });
      const toolResults = [];
      for (const tu of resp.toolUses) {
        toolsUsed.push(tu.name);
        log("task", "running", `[AI\u5DE5\u5177] ${tu.name}`, tu.input);
        try {
          const result = await withTaskTimeout(executeBrowserTool(tu.name, tu.input), taskTimeoutMs({ tool: tu.name, args: tu.input }), tu.name);
          let content = typeof result === "string" ? result : JSON.stringify(result);
          if (tu.name === "browser_screenshot" && result?.dataUrl) {
            content = screenshotToolContent(result);
            toolEvents.push({
              key: `${tu.id || tu.name}:${toolEvents.length}`,
              label: "\u6D4F\u89C8\u5668\u622A\u56FE",
              detail: [result.url, result.method].filter(Boolean).join("\n"),
              imageUrl: result.dataUrl
            });
          }
          toolResults.push({ type: "tool_result", tool_use_id: tu.id, content });
          log("task", "success", `\u5B8C\u6210: ${tu.name}`);
        } catch (err) {
          toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: `Error: ${err.message}`, is_error: true });
          log("task", "error", `\u5931\u8D25: ${tu.name} \u2014 ${err.message}`);
        }
      }
      messages.push({ role: "user", content: toolResults });
      iter++;
    }
    return { text: "\u5DF2\u8FBE\u5230\u6700\u5927\u8FED\u4EE3\u6B21\u6570", toolsUsed, toolEvents };
  }
  function estimateTokensFromMessages(messages, text = "") {
    const raw = messages.map((m) => typeof m.content === "string" ? m.content : JSON.stringify(m.content)).join("\n") + text;
    const total = Math.max(1, Math.ceil(raw.length / 4));
    return { inputTokens: total, outputTokens: Math.max(1, Math.ceil(String(text || "").length / 4)), totalTokens: total, estimated: true };
  }
  function summarizeToolResult(result, success) {
    if (!success)
      return typeof result === "string" ? result : "\u6267\u884C\u5931\u8D25";
    if (result?.summary)
      return String(result.summary);
    if (result?.success === false && result?.error)
      return String(result.error);
    if (typeof result === "string")
      return result.slice(0, 160);
    return "\u6267\u884C\u5B8C\u6210";
  }
  function resultForModel(tool, result) {
    if (tool === "browser_screenshot" && result?.dataUrl)
      return screenshotToolContent(result);
    return typeof result === "string" ? result : JSON.stringify(result);
  }
  async function runOfflineChat(port, requestId, messages, prompt, allowedTools) {
    const settings = await getSettings();
    if (!settings.aiKey)
      throw new Error("\u672A\u914D\u7F6E AI Key");
    if (!settings.aiBaseUrl)
      throw new Error("\u672A\u914D\u7F6E Base URL");
    if (!settings.aiModel)
      throw new Error("\u672A\u914D\u7F6E\u6A21\u578B");
    const controller = { canceled: false };
    offlineChatControllers.set(requestId, controller);
    const allowed = new Set((allowedTools || []).map((t) => String(t || "").trim()).filter(Boolean));
    const allTools = await effectiveToolDefs();
    const chatTools = Array.isArray(allowedTools) ? allTools.filter((t) => allowed.has(t.name)) : allTools;
    const systemPrompt = String(prompt || settings.offlinePrompt || "").trim();
    const toolsUsed = [];
    const toolEvents = [];
    const workingMessages = messages.map((m) => ({ ...m }));
    const MAX = 12;
    try {
      for (let iter = 0; iter < MAX; iter++) {
        if (controller.canceled)
          throw new DOMException("\u5DF2\u505C\u6B62", "AbortError");
        const resp = await callAI(settings.aiBaseUrl, settings.aiKey, settings.aiModel, workingMessages, chatTools, systemPrompt);
        if (controller.canceled)
          throw new DOMException("\u5DF2\u505C\u6B62", "AbortError");
        if (!resp.toolUses?.length) {
          const text = resp.text || "\u5B8C\u6210";
          return { text, toolsUsed, toolEvents, usage: estimateTokensFromMessages(workingMessages, text) };
        }
        workingMessages.push({ role: "assistant", content: resp.toolUses });
        const toolResults = [];
        for (const tu of resp.toolUses) {
          if (controller.canceled)
            throw new DOMException("\u5DF2\u505C\u6B62", "AbortError");
          const args = tu.input || {};
          toolsUsed.push(tu.name);
          postToPopup(port, { type: "offline-chat:progress", requestId, event: { type: "tool_start", tool: tu.name, arguments: args } });
          log("task", "running", `[\u672C\u5730\u5BF9\u8BDD\u5DE5\u5177] ${tu.name}`, args);
          try {
            const result = await withTaskTimeout(
              executeBrowserTool(tu.name, args),
              taskTimeoutMs({ taskId: requestId, tool: tu.name, args }),
              `offline-chat ${tu.name}`
            );
            if (controller.canceled)
              throw new DOMException("\u5DF2\u505C\u6B62", "AbortError");
            const event = {
              tool: tu.name,
              arguments: args,
              success: true,
              result,
              summary: summarizeToolResult(result, true)
            };
            toolEvents.push(event);
            postToPopup(port, { type: "offline-chat:progress", requestId, event: { type: "tool_result", event } });
            toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: resultForModel(tu.name, result) });
            log("task", "success", `\u672C\u5730\u5BF9\u8BDD\u5B8C\u6210: ${tu.name}`);
          } catch (err) {
            const message = err?.message || String(err);
            const event = {
              tool: tu.name,
              arguments: args,
              success: false,
              result: null,
              summary: message
            };
            toolEvents.push(event);
            postToPopup(port, { type: "offline-chat:progress", requestId, event: { type: "tool_result", event } });
            toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: `Error: ${message}`, is_error: true });
            log("task", "error", `\u672C\u5730\u5BF9\u8BDD\u5931\u8D25: ${tu.name} \u2014 ${message}`);
          }
        }
        workingMessages.push({ role: "user", content: toolResults });
      }
      return { text: "\u5DF2\u8FBE\u5230\u6700\u5927\u8FED\u4EE3\u6B21\u6570", toolsUsed, toolEvents, usage: estimateTokensFromMessages(workingMessages, "\u5DF2\u8FBE\u5230\u6700\u5927\u8FED\u4EE3\u6B21\u6570") };
    } finally {
      offlineChatControllers.delete(requestId);
    }
  }
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "popup" && port.name !== "offline-chat")
      return;
    popupPorts.add(port);
    postToPopup(port, { type: "device:status", status: currentStatus, aiConfigId: boundAiConfigId });
    getActivity().then((entries) => {
      entries.forEach((e) => postToPopup(port, { type: "activity:log", entry: e }));
    });
    port.onDisconnect.addListener(() => popupPorts.delete(port));
    port.onMessage.addListener(async (msg) => {
      switch (msg.type) {
        case "device:connect": {
          if (socket?.connected)
            await emitRegisterOn(socket);
          else
            await connect();
          break;
        }
        case "device:disconnect": {
          disconnect();
          break;
        }
        case "auth:logout": {
          authRejected = false;
          disconnect();
          await saveSettings({ selectedAiConfigId: null, agentSocketUrl: "" });
          break;
        }
        case "settings:get": {
          const settings = await getSettings();
          postToPopup(port, { type: "settings:data", settings });
          break;
        }
        case "settings:save": {
          const prev = await getSettings();
          const payload = { ...msg.payload };
          const serverUrlChanged = payload.serverUrl !== void 0 && payload.serverUrl !== prev.serverUrl;
          if (serverUrlChanged && payload.agentSocketUrl === void 0) {
            payload.agentSocketUrl = "";
          }
          await saveSettings(payload);
          if (payload.offlineMode === true && socket?.connected) {
            disconnect();
          }
          if ((serverUrlChanged || payload.agentSocketUrl !== void 0) && socket) {
            const wasConnected = !!socket;
            disconnect();
            if (wasConnected && !payload.offlineMode) {
              void connect();
            }
          }
          break;
        }
        case "chat:send": {
          const requestId = msg.requestId;
          try {
            const result = await runChat(msg.messages);
            postToPopup(port, { type: "chat:response", text: result.text, toolsUsed: result.toolsUsed, toolEvents: result.toolEvents, requestId });
          } catch (err) {
            postToPopup(port, { type: "chat:error", error: err.message, requestId });
          }
          break;
        }
        case "connection:test": {
          const result = await testConnection();
          postToPopup(port, { type: "connection:result", result });
          break;
        }
        case "mcp:test": {
          log("task", "running", `\u6D4B\u8BD5: ${msg.tool}`, msg.args);
          try {
            const result = await withTaskTimeout(
              executeBrowserTool(msg.tool, msg.args || {}),
              taskTimeoutMs({ taskId: "mcp-test", tool: msg.tool, args: msg.args }),
              `mcp.test ${msg.tool}`
            );
            log("task", "success", `\u6D4B\u8BD5\u5B8C\u6210: ${msg.tool}`);
            postToPopup(port, { type: "mcp:test:result", requestId: msg.requestId, ok: true, result });
          } catch (err) {
            log("task", "error", `\u6D4B\u8BD5\u5931\u8D25: ${msg.tool} \u2014 ${err?.message || err}`);
            postToPopup(port, { type: "mcp:test:result", requestId: msg.requestId, ok: false, error: err?.message || String(err) });
          }
          break;
        }
        case "offline-chat:get-config": {
          const settings = await getSettings();
          postToPopup(port, { type: "offline-chat:config", requestId: msg.requestId, settings, hasAiKey: !!settings.aiKey?.trim() });
          break;
        }
        case "offline-chat:save-model": {
          try {
            const payload = {
              aiKey: String(msg.payload.aiKey || "").trim(),
              aiBaseUrl: String(msg.payload.aiBaseUrl || "").trim() || "https://api.anthropic.com",
              aiModel: String(msg.payload.aiModel || "").trim() || "claude-sonnet-4-5"
            };
            await saveSettings(payload);
            const settings = await getSettings();
            postToPopup(port, { type: "offline-chat:model-saved", requestId: msg.requestId, ok: true, settings });
          } catch (err) {
            postToPopup(port, { type: "offline-chat:model-saved", requestId: msg.requestId, ok: false, error: err?.message || String(err) });
          }
          break;
        }
        case "offline-chat:save-prompt": {
          await saveSettings({ offlinePrompt: String(msg.prompt || "").trim() });
          postToPopup(port, { type: "offline-chat:prompt-saved", requestId: msg.requestId, ok: true });
          break;
        }
        case "offline-chat:list-tools": {
          const tools = await effectiveToolDefs();
          postToPopup(port, { type: "offline-chat:tools", requestId: msg.requestId, tools });
          break;
        }
        case "offline-chat:send": {
          void (async () => {
            try {
              const result = await runOfflineChat(port, msg.requestId, msg.messages, msg.prompt, msg.allowedTools);
              postToPopup(port, { type: "offline-chat:response", requestId: msg.requestId, ...result });
            } catch (err) {
              const canceled = err?.name === "AbortError" || /已停止|aborted|canceled|cancelled/i.test(String(err?.message || err));
              postToPopup(port, { type: "offline-chat:error", requestId: msg.requestId, error: canceled ? "\u5DF2\u505C\u6B62" : err?.message || String(err) });
            }
          })();
          break;
        }
        case "offline-chat:cancel": {
          const controller = offlineChatControllers.get(msg.requestId);
          if (controller)
            controller.canceled = true;
          postToPopup(port, { type: "offline-chat:canceled", requestId: msg.requestId, ok: !!controller });
          break;
        }
      }
    });
  });
  function nudgeSocketHealth() {
    if (authRejected)
      return;
    if (!socket) {
      void restoreAndConnectOnStartup();
      return;
    }
    if (!socket.connected && !socket.active)
      socket.connect();
  }
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "offscreen:keepalive") {
      nudgeSocketHealth();
      return false;
    }
    if (msg?.rc && msg.dir === "to-bg") {
      handleOffscreenRcMessage(msg, rcSend);
      return false;
    }
  });
  chrome.alarms.create("keepalive", { periodInMinutes: 0.4 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== "keepalive")
      return;
    void ensureOffscreen();
    nudgeSocketHealth();
  });
  var contextMenusApi = chrome.contextMenus;
  chrome.runtime.onInstalled.addListener(() => {
    void ensureOffscreen();
    if (!contextMenusApi?.removeAll || !contextMenusApi?.create) {
      log("system", "warn", "\u5F53\u524D\u6D4F\u89C8\u5668\u4E0D\u652F\u6301\u53F3\u952E\u83DC\u5355 API\uFF0C\u5DF2\u8DF3\u8FC7\u83DC\u5355\u6CE8\u518C");
      return;
    }
    contextMenusApi.removeAll(() => {
      contextMenusApi.create({ id: "hs-ask", title: "HeySure AI: \u8BE2\u95EE\u9009\u4E2D\u5185\u5BB9", contexts: ["selection"] });
      contextMenusApi.create({ id: "hs-screenshot", title: "HeySure AI: \u622A\u56FE\u5206\u6790\u6B64\u9875", contexts: ["page"] });
    });
  });
  contextMenusApi?.onClicked?.addListener(async (info) => {
    if (info.menuItemId === "hs-ask" && info.selectionText) {
      await chrome.storage.session.set({ _pendingChat: info.selectionText });
    } else if (info.menuItemId === "hs-screenshot") {
      await chrome.storage.session.set({ _pendingChat: "\u8BF7\u622A\u56FE\u5E76\u5206\u6790\u5F53\u524D\u9875\u9762" });
    }
  });
  chrome.runtime.onStartup.addListener(async () => {
    void ensureOffscreen();
    await restoreAndConnectOnStartup();
  });
  void ensureOffscreen();
  void restoreAndConnectOnStartup();
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local")
      return;
    if (changes[DYNAMIC_MCP_STORAGE_KEY]) {
      if (socket?.connected)
        void emitRegisterOn(socket);
      return;
    }
    const authChange = changes._auth_state;
    if (!authChange)
      return;
    const oldToken = String(authChange.oldValue?.token || "");
    const newToken = String(authChange.newValue?.token || "");
    if (oldToken === newToken)
      return;
    authRejected = false;
    if (newToken) {
      if (socket)
        disconnect();
      void connect();
    } else {
      disconnect();
    }
  });
})();
