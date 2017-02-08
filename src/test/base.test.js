import { Client } from "../../";
import * as settings from './client-harness';
import Message from "../Message";

const client = new Client({
  host: settings.server,
  port: settings.port,
  path: settings.path,
  clientId: "testclientid",
  webSocket: settings.webSocket,
  storage: settings.storage
});

test('client is set up correctly', function () {
  expect(client.host).toBe(settings.server);
  expect(client.port).toBe(settings.port);
  expect(client.path).toBe(settings.path);
});

describe('Integration tests', () => {
  beforeAll(() => {
    return settings.startBroker().then(() =>
      client.connect({ mqttVersion: settings.mqttVersion })
    )
  });

  test('should send and receive a message', function (done) {
    client.onMessageArrived = (message) => {
      expect(message.payloadString).toEqual('Hello');
      done();
    };
    message = new Message("Hello");
    message.destinationName = "/World";
    client.subscribe("/World").then(() => client.send(message));
  });

  afterAll((done) => {
    client.disconnect();
    return settings.stopBroker();
  });
});
