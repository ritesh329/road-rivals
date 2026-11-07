import http from "node:http";
import { Server } from "socket.io";
import { config } from "./utils/config";
import { createApp } from "./app";
import { registerSockets } from "./sockets";

const server = http.createServer(createApp());
const io = new Server(server, { cors: { origin: config.clientOrigin, credentials: true } });
registerSockets(io);
server.listen(config.port, () => console.log(`ROAD RIVALS server on :${config.port}`));
