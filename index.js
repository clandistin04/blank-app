import { connect } from "cloudflare:sockets";

const UUID = "de04add9-5c68-8bab-950c-08cd5320df18";
const WS_PATH = "/vless";

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("VLESS Worker OK", { status: 200 });
    }

    if (url.pathname !== WS_PATH) {
      return new Response("Wrong path", { status: 404 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    vlessHandler(server).catch(() => server.close());

    return new Response(null, { status: 101, webSocket: client });
  }
};

async function vlessHandler(ws) {
  let socket = null;

  ws.addEventListener("message", async (event) => {
    const chunk = new Uint8Array(event.data);

    if (!socket) {
      const req = parseVLESS(chunk);
      if (!req || req.uuid !== UUID) {
        ws.close();
        return;
      }

      socket = connect({
        hostname: req.host,
        port: req.port
      });

      ws.send(new Uint8Array([0, 0])); // VLESS OK response

      pipeRemoteToWS(socket, ws);

      if (req.data && req.data.length > 0) {
        socket.write(req.data);
      }
    } else {
      socket.write(chunk);
    }
  });

  ws.addEventListener("close", () => {
    try { socket?.close(); } catch {}
  });
}

function parseVLESS(buf) {
  if (buf.length < 24) return null;

  const uuid = formatUUID(buf.slice(1, 17));
  const cmd = buf[17];
  if (cmd !== 1) return null; // TCP only

  const addrType = buf[19];
  let host = "";
  let index = 20;

  if (addrType === 1) {
    host = [...buf.slice(index, index + 4)].join(".");
    index += 4;
  } else if (addrType === 2) {
    const len = buf[index];
    index += 1;
    host = new TextDecoder().decode(buf.slice(index, index + len));
    index += len;
  } else if (addrType === 3) {
    const data = buf.slice(index, index + 16);
    host = [...data].map(x => x.toString(16)).join(":");
    index += 16;
  }

  const port = (buf[index] << 8) + buf[index + 1];
  index += 2;

  return {
    uuid,
    host,
    port,
    data: buf.slice(index)
  };
}

function formatUUID(buf) {
  const hex =
