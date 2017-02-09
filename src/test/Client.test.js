import { Client } from '../..';
import { host, path, port } from './.support';

import { w3cwebsocket as webSocket } from 'websocket';
import { LocalStorage } from 'node-localstorage';

const storage = new LocalStorage('./tmp');

describe('client-uris', function () {

  test('should create a new client with a default path', function () {
    const client = new Client({ host, port, clientId: 'testclientid', webSocket, storage });
    expect(client).not.toBe(null);
    expect(client.host).toBe(host);
    expect(client.port).toBe(port);
    expect(client.path).toBe('/mqtt');

  });

  test('should create a new client with a path', function () {
    const client = new Client({ host, port, path, clientId: 'testclientid', webSocket, storage });

    expect(client).not.toBe(null);
    expect(client.host).toBe(host);
    expect(client.port).toBe(port);
    expect(client.path).toBe(path);
  });

  test('should create a new client with a uri', function () {
    const client = new Client({
      host: 'ws://' + host + ':' + port + path,
      clientId: 'testclientid',
      webSocket,
      storage
    });

    expect(client).not.toBe(null);
    expect(client.host).toBe(host);
    expect(client.port).toBe(port);
    expect(client.path).toBe(path);
  });

  test('should fail to create a new client with an invalid ws uri', function () {
    let client = null;
    let error;
    try {
      client = new Client({ host: 'http://example.com', clientId: 'testclientid', webSocket, storage });
    } catch (err) {
      error = err;
    }
    expect(client).toBe(null);
    expect(error).not.toBe(null);
  });

  /*
   // We don't yet expose setting the path element with the arrays of hosts/ports
   // If you want a path other than /mqtt, you need to use the array of hosts-as-uris.
   // Leaving this test here to remember this fact in case we add an array of paths to connopts
   it('should connect and disconnect to a server using connectoptions hosts and ports', function() {
   client = new Paho.MQTT.Client(testServer, testPort, "testclientid");
   expect(client).not.toBe(null);

   client.onMessageArrived = messageArrived;
   client.onConnectionLost = onDisconnect;

   runs(function() {
   client.connect({onSuccess:onConnect,hosts:[host],ports:[port]});
   });

   waitsFor(function() {
   return connected;
   }, "the client should connect", 10000);

   runs(function() {
   expect(connected).toBe(true);
   });
   runs(function() {
   client.disconnect();
   });
   waitsFor(function() {
   return !connected;
   }, "the client should disconnect",1000);
   runs(function() {
   expect(connected).toBe(false);
   expect(disconnectError).not.toBe(null);
   expect(disconnectError.errorCode).toBe(0);
   });
   });
   */
});
