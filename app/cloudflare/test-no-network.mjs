// Test preload: fixtures may replace fetch, but no test may reach an external service.
import {Socket} from 'node:net';
import {syncBuiltinESMExports} from 'node:module';
const deny=()=>{throw new Error('External network is disabled in local tests');};
globalThis.fetch=deny;
Socket.prototype.connect=deny;
syncBuiltinESMExports();
