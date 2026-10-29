// Maintainer-test preload. Deny Node-side outbound access before renderer imports.
import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import {syncBuiltinESMExports} from 'node:module';
const local = host => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(String(host).toLowerCase());
function deny(host) {
  if (local(host)) return;
  if (process.env.QS_GRAPHICS_NETWORK_LOG) fs.appendFileSync(process.env.QS_GRAPHICS_NETWORK_LOG, JSON.stringify({blockedHost: String(host)}) + '\n');
  throw new Error('Graphics fixture denied nonlocal network access');
}
function hostFrom(args) {
  const first = args[0];
  if (typeof first === 'string' && first.startsWith('/')) return 'localhost';
  if (typeof first === 'object' && first) return first.host ?? first.hostname ?? 'localhost';
  return typeof args[1] === 'string' ? args[1] : 'localhost';
}
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function(...args) {deny(hostFrom(Array.isArray(args[0]) ? args[0] : args));return connect.apply(this, args);};
const tlsConnect = tls.connect;
tls.connect = function(...args) {deny(hostFrom(args));return tlsConnect.apply(this, args);};
for (const module of [http, https]) for (const name of ['request', 'get']) {
  const original = module[name];
  module[name] = function(...args) {
    const arg = args[0];
    deny(typeof arg === 'string' || arg instanceof URL ? new URL(arg).hostname : arg?.hostname ?? arg?.host ?? 'localhost');
    return original.apply(this, args);
  };
}
const fetch = globalThis.fetch;
globalThis.fetch = function(resource, options) {deny(new URL(typeof resource === 'string' || resource instanceof URL ? resource : resource.url).hostname);return fetch(resource, options);};
syncBuiltinESMExports();
