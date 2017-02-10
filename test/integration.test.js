import { Client } from '../';
import { host, mqttVersion, path, port, startBroker, stopBroker, storage, webSocket } from './.support';
import Message from '../src/Message';

const client = new Client({
  host,
  port,
  path,
  clientId: 'testclientid',
  webSocket,
  storage,
});

test('client is set up correctly', function () {
  expect(client.host).toBe(host);
  expect(client.port).toBe(port);
  expect(client.path).toBe(path);
});

describe('Integration tests', () => {
  beforeAll(async () => {
    await startBroker();
    await client.connect({ mqttVersion });
  });

  test('should send and receive a message', async (done) => {
    client.on('messageReceived', (message) => {
      expect(message.payloadString).toEqual('Hello');
      done();
    });
    const message = new Message('Hello');
    message.destinationName = '/World';
    await client.subscribe('/World');
    await client.send(message);
  });

  test('should disconnect and reconnect cleanly', async () => {
    await client.disconnect();
    await client.connect({ mqttVersion });
  });

  afterAll(async () => {
    await client.disconnect();
    await stopBroker();
  });
});
