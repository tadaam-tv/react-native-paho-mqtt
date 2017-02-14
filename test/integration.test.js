import { Client } from '../';
import { uri, mqttVersion, startBroker, stopBroker, storage, webSocket } from './.support';
import Message from '../src/Message';

const client = new Client({
  uri,
  clientId: 'testclientid',
  webSocket,
  storage,
});

test('client is set up correctly', function () {
  expect(client.uri).toBe(uri);
});

describe('Integration tests', () => {
  beforeAll(() => startBroker().then(() => client.connect({ mqttVersion })));

  test('should send and receive a message', (done) => {
    client.on('messageReceived', (message) => {
      expect(message.payloadString).toEqual('Hello');
      done();
    });
    const message = new Message('Hello');
    message.destinationName = 'World';
    client.subscribe('World').then(() => client.send(message));
  });

  test('should disconnect and reconnect cleanly', () => client.disconnect().then(() => client.connect({ mqttVersion })));

  afterAll(() => client.disconnect().then(() => stopBroker()));
});
