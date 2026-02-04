import { connect } from "cloudflare:sockets";

export default {
  async fetch(request, env) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("VLESS Worker Running ✅", { status: 200 });
    }

    const uuid = env.UUID;
    const path = env.VLESS_WSPATH || "/vless";

    const url = new URL(request.url);
    if (url.pathname !== path) {
      return new Response("Wrong path", { status: 404 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    handleVLESS(server, uuid).catch(() => server.close());

    return new Response(null, { status: 101, webSocket: client });
  }
};

async function handleVLESS(ws, uuid) {
  let tcpSocket = null;

  ws.addEventListener("message", async (event) => {
    const data = new Uint8Array(event.data);

    // أول باكيت = VLESS header
    if (!tcpSocket) {
      const parsed = parseVLESS(data, uuid);
      if (!parsed) {
        ws.close();
        return;
      }

      tcpSocket = connect({
        hostname: parsed.host,
        port: parsed.port
      });

      // رد نجاح VLESS
      ws.send(new Uint8Array([0, 0]));

      pipeSocketToWS(tcpSocket, ws);
      if (parsed.payload) tcpSocket.write(parsed.payload);
    } else {
      tcpSocket.write(data);
    }
  });

  ws.addEventListener("close", () => {
    try { tcpSocket?.close(); } catch {}
  });
}

function parseVLESS(buf, uuid) {
  const id = buf.slice(1, 17);
  const idStr = formatUUID(id);
  if (idStr !== uuid) return null;

  const cmd = buf[17];
  if (cmd !== 1) return null; // TCP فقط

  const addrType = buf[19];
  let host = "";
  let portIndex;

  if (addrType === 1) {
    host = [...buf.slice(20, 24)].join(".");
    portIndex = 24;
  } else if (addrType === 2) {
    const len = buf[20];
    host = new TextDecoder().decode(buf.slice(21, 21 + len));
    portIndex = 21 + len;
  } else if (addrType === 3) {
    const data = buf.slice(20, 36);
    host = [...data].map(x => x.toString(16)).join(":");
    portIndex = 36;
  }

  const port = (buf[portIndex] << 8) + buf[portIndex + 1];
  const payload = buf.slice(portIndex + 2);

  return { host, port, payload };
}

function formatUUID(buf) {
  const hex = [...buf].map(b => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

async function pipeSocketToWS(socket, ws) {
  const reader = socket.readable.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    ws.send(value);
  }
}
