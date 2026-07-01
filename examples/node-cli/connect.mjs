#!/usr/bin/env node
// Minimal Node.js example: connect to a MeshCore device over USB serial,
// print device info + contacts, and stream incoming messages.
//
// Usage:
//   npm i serialport            # optional peer dependency
//   node examples/node-cli/connect.mjs [/dev/tty.usbmodemXXXX]
//
// With no path argument, lists the available serial ports and exits.

import { MeshCore, NodeSerialTransport } from '../../dist/index.js';

const path = process.argv[2];

if (!path) {
  const ports = await NodeSerialTransport.list();
  console.log('Available serial ports:');
  for (const p of ports) console.log(`  ${p.path}${p.manufacturer ? `  (${p.manufacturer})` : ''}`);
  console.log('\nRe-run with a port path, e.g.:\n  node examples/node-cli/connect.mjs ' +
    (ports[0]?.path ?? '/dev/tty.usbmodem1101'));
  process.exit(0);
}

const client = new MeshCore(new NodeSerialTransport({ path }));

client.on('message', (m) => console.log(`\n[message] ${m.text}`));
client.on('advert', (pk) => console.log(`[advert] ${pk.slice(0, 16)}…`));
client.on('sendConfirmed', (c) => console.log(`[ack] rtt=${c.roundTripMillis}ms`));
client.on('disconnect', () => {
  console.log('\nDevice disconnected.');
  process.exit(0);
});

const { deviceInfo, selfInfo } = await client.connect();
console.log(`Connected to "${selfInfo.name}" — ${deviceInfo.manufacturer} ${deviceInfo.firmwareVersion}`);
console.log(`  ${selfInfo.freq} MHz  SF${selfInfo.spreadingFactor}  CR${selfInfo.codingRate}`);
console.log(`  public key: ${selfInfo.publicKey}`);

const contacts = await client.getContacts();
console.log(`\nContacts (${contacts.length}):`);
for (const c of contacts) {
  console.log(`  ${c.name.padEnd(20)} ${c.publicKey.slice(0, 16)}…`);
}

console.log('\nListening for messages — press Ctrl+C to exit.');
