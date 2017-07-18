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

describe('Basic integration tests', () => {
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

describe('Keep alive mechanism', () => {
  beforeAll(() => startBroker().then(() => client.connect({ mqttVersion, keepAliveInterval: 1 })));

  test('should send PINGREQ messages so that the server does not disconnect', () => {
    return new Promise((resolve, reject) => {
      const successTimer = setTimeout(resolve, 3000);
      const onFail = (e) => {
        clearTimeout(successTimer);
        client.removeListener('connectionLost', onFail);
        stopBroker().then(() => reject(new Error('Unexpected disconnection')));
      };
      client.on('connectionLost', onFail);
    });
  }, 5000);

  afterAll(() => client.disconnect().then(() => stopBroker()));
});
