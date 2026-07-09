(() => {
  // src/offscreen.ts
  var PING_INTERVAL_MS = 2e4;
  function ping() {
    chrome.runtime.sendMessage({ type: "offscreen:keepalive", at: Date.now() }).catch(() => {
    });
  }
  ping();
  setInterval(ping, PING_INTERVAL_MS);
  var RC_ICE_SERVERS_FALLBACK = [{ urls: "stun:stun.l.google.com:19302" }];
  var pc = null;
  var channel = null;
  var canvas = null;
  var ctx = null;
  var sessionId = "";
  var readySent = false;
  var pendingIce = [];
  var lastBrowserState = null;
  function sendBrowserState() {
    if (channel && channel.readyState === "open" && lastBrowserState != null) {
      try {
        channel.send(JSON.stringify({ kind: "browser-state", state: lastBrowserState }));
      } catch {
      }
    }
  }
  function toBg(event, payload) {
    chrome.runtime.sendMessage({ rc: true, dir: "to-bg", event, sessionId, ...payload }).catch(() => {
    });
  }
  function rcCleanup() {
    if (channel) {
      try {
        channel.close();
      } catch {
      }
      channel = null;
    }
    if (pc) {
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      try {
        pc.close();
      } catch {
      }
      pc = null;
    }
    canvas = null;
    ctx = null;
    readySent = false;
    pendingIce.length = 0;
    lastBrowserState = null;
    sessionId = "";
  }
  async function startPeer(sid, iceServers) {
    if (pc)
      rcCleanup();
    sessionId = sid;
    canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    ctx = canvas.getContext("2d");
    const stream = canvas.captureStream(30);
    const connection = new RTCPeerConnection({ iceServers: iceServers?.length ? iceServers : RC_ICE_SERVERS_FALLBACK });
    pc = connection;
    connection.onicecandidate = (e) => {
      if (e.candidate)
        toBg("ice", { candidate: e.candidate.toJSON() });
    };
    connection.onconnectionstatechange = () => {
      const s = connection.connectionState;
      if (s === "failed" || s === "disconnected" || s === "closed")
        toBg("stopped", {});
    };
    const [videoTrack] = stream.getVideoTracks();
    if (videoTrack)
      videoTrack.contentHint = "detail";
    const sender = videoTrack ? connection.addTrack(videoTrack, stream) : null;
    if (sender) {
      try {
        const params = sender.getParameters();
        if (!params.encodings || !params.encodings.length)
          params.encodings = [{}];
        params.encodings[0].maxBitrate = 8e6;
        params.degradationPreference = "maintain-resolution";
        await sender.setParameters(params);
      } catch {
      }
    }
    channel = connection.createDataChannel("control");
    channel.onopen = () => sendBrowserState();
    channel.onmessage = (e) => {
      try {
        toBg("control-msg", { msg: JSON.parse(String(e.data)) });
      } catch {
      }
    };
    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    toBg("offer", { sdp: offer.sdp });
  }
  function drawFrame(dataUrl) {
    if (!ctx || !canvas)
      return;
    const img = new Image();
    img.onload = () => {
      if (!ctx || !canvas)
        return;
      if (canvas.width !== img.width || canvas.height !== img.height) {
        canvas.width = img.width;
        canvas.height = img.height;
      }
      ctx.drawImage(img, 0, 0);
      if (!readySent) {
        readySent = true;
        toBg("ready", { width: img.width, height: img.height });
      }
    };
    img.src = dataUrl;
  }
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg?.rc || msg.dir !== "to-offscreen")
      return;
    switch (msg.event) {
      case "peer-start":
        void startPeer(String(msg.sessionId || ""), Array.isArray(msg.iceServers) ? msg.iceServers : void 0);
        break;
      case "answer":
        if (pc && msg.sessionId === sessionId) {
          void pc.setRemoteDescription({ type: "answer", sdp: msg.sdp }).then(async () => {
            for (const c of pendingIce.splice(0))
              await pc.addIceCandidate(c).catch(() => {
              });
          });
        }
        break;
      case "ice":
        if (pc && msg.sessionId === sessionId && msg.candidate) {
          if (pc.remoteDescription)
            void pc.addIceCandidate(msg.candidate).catch(() => {
            });
          else
            pendingIce.push(msg.candidate);
        }
        break;
      case "frame":
        if (msg.sessionId === sessionId)
          drawFrame(String(msg.dataUrl || ""));
        break;
      case "browser-state":
        lastBrowserState = msg.state;
        sendBrowserState();
        break;
      case "peer-stop":
        rcCleanup();
        break;
    }
    return false;
  });
})();
