#!/usr/bin/env node

const fs = require('node:fs');
const net = require('node:net');
const tls = require('node:tls');

const certificatePath = process.env.ANTARCTIC_TLS_CERT;
const keyPath = process.env.ANTARCTIC_TLS_KEY;
const listenPort = Number(process.env.ANTARCTIC_WISP_TLS_PORT || 5002);
const upstreamPort = Number(process.env.ANTARCTIC_WISP_PORT || 5001);

if (!certificatePath || !keyPath) {
  console.error('ANTARCTIC_TLS_CERT and ANTARCTIC_TLS_KEY are required.');
  process.exit(1);
}

const server = tls.createServer({
  cert: fs.readFileSync(certificatePath),
  key: fs.readFileSync(keyPath),
}, (client) => {
  const upstream = net.connect({ host: '127.0.0.1', port: upstreamPort });
  const closeBoth = () => {
    client.destroy();
    upstream.destroy();
  };

  client.on('error', closeBoth);
  upstream.on('error', closeBoth);
  client.pipe(upstream);
  upstream.pipe(client);
});

server.listen(listenPort, '0.0.0.0', () => {
  console.log(`Secure Wisp proxy listening on 0.0.0.0:${listenPort}`);
});
