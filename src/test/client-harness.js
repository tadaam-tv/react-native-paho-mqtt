import { Server } from "mosca";

let broker = null;

function ensureValue(prop, value) {
  if (prop == "" || prop[0] == "$") {
    return value;
  }
  return prop;
}

export const startBroker = () => new Promise((resolve, reject) => {
  broker = new Server({
    port: 1883,
    backend: {
      //using ascoltatore
      type: 'mongo',
      url: 'mongodb://localhost:27017/mqtt',
      pubsubCollection: 'ascoltatori',
      mongo: {}
    },
    http: {
      port: 3000,
      bundle: true,
      static: './'
    }
  });
  broker.on('ready', resolve);
});

export const stopBroker = () => {
  if (broker) {
    return new Promise((resolve, reject) => {
      broker.close(resolve);
      broker = null;
    });
  }
  return Promise.resolve();
};

export const server = ensureValue("${test.server}", "localhost");
export const port = parseInt(ensureValue("${test.server.port}", "3000"));
export const path = ensureValue("${test.server.path}", "/");
export const webSocket = require('websocket').w3cwebsocket;
export const storage = require('node-localstorage');
export const mqttVersion = parseInt(ensureValue("${test.server.mqttVersion}", "3"));
export const interopServer = ensureValue("${test.interopServer}", "iot.eclipse.org");
export const interopPort = parseInt(ensureValue("${test.interopPort}", "80"));
export const interopPath = ensureValue("${test.interopPath}", "/ws");
