import { Client } from "../../";
import * as settings from './.support';
import Message from "../Message";

const client = new Client({
  host: settings.host,
  port: settings.port,
  path: settings.path,
  clientId: "testclientid",
  webSocket: settings.webSocket,
  storage: settings.storage
});

test('client is set up correctly', function () {
  expect(client.host).toBe(settings.host);
  expect(client.port).toBe(settings.port);
  expect(client.path).toBe(settings.path);
});

describe('Integration tests', () => {
  beforeAll(() => {
    return settings.startBroker().then(() =>
      client.connect({ mqttVersion: settings.mqttVersion })
    ).then((a) => {
      console.log(a)
    })
      .catch(err => {
      console.warn(err);
    });
  });

  test('should send and receive a message', function (done) {
    client.on('messageReceived', (message) => {
      expect(message.payloadString).toEqual('Hello');
      done();
    });
    message = new Message("Hello");
    message.destinationName = "/World";
    client.subscribe("/World").then(() => client.send(message)).catch(err => {
      console.warn(err);
    });
  });

  test('should disconnect and reconnect cleanly', function () {
    return client.disconnect().then(() => client.connect({ mqttVersion: settings.mqttVersion }));
  });

  afterAll(() => {
    return client.disconnect().then(() => settings.stopBroker());
  });
});
