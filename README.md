# Eclipse Paho JavaScript client forked for React Native
[![npm version](https://badge.fury.io/js/react-native-paho-mqtt.svg)](https://badge.fury.io/js/react-native-paho-mqtt) [![Build Status](https://travis-ci.org/rh389/react-native-paho-mqtt.svg?branch=master)](https://travis-ci.org/rh389/react-native-paho-mqtt)

A fork of [paho-client](https://www.npmjs.com/package/paho-client), this project exists to provide an ES6-ready, Promise-based, react-native compatible version of the Eclipse Paho client

### Compatibility note

Due to a React Native binary websocket bug, this library will *not work* with React Native 0.46.0 on Android, but should be ok on other platforms. RN 0.47 and RN<=0.45 are fine on all platforms as far as I know.

### Documentation

Reference documentation (for the base Paho client) is online at: [http://www.eclipse.org/paho/files/jsdoc/index.html](http://www.eclipse.org/paho/files/jsdoc/index.html)

## Getting Started

The included code below is a very basic sample that connects to a server using WebSockets and subscribes to the topic ```World```, once subscribed, it then publishes the message ```Hello``` to that topic. Any messages that come into the subscribed topic will be printed to the Javascript console.

This requires the use of a broker that supports WebSockets natively, or the use of a gateway that can forward between WebSockets and TCP.

```js
import { Client, Message } from 'react-native-paho-mqtt';

//Set up an in-memory alternative to global localStorage
const myStorage = {
  setItem: (key, item) => {
    myStorage[key] = item;
  },
  getItem: (key) => myStorage[key],
  removeItem: (key) => {
    delete myStorage[key];
  },
};

// Create a client instance
const client = new Client({ uri: 'ws://iot.eclipse.org:80/ws', clientId: 'clientId', storage: myStorage });

// set event handlers
client.on('connectionLost', (responseObject) => {
  if (responseObject.errorCode !== 0) {
    console.log(responseObject.errorMessage);
  }
});
client.on('messageReceived', (message) => {
  console.log(message.payloadString);
});

// connect the client
client.connect()
  .then(() => {
    // Once a connection has been made, make a subscription and send a message.
    console.log('onConnect');
    return client.subscribe('World');
  })
  .then(() => {
    const message = new Message('Hello');
    message.destinationName = 'World';
    client.send(message);
  })
  .catch((responseObject) => {
    if (responseObject.errorCode !== 0) {
      console.log('onConnectionLost:' + responseObject.errorMessage);
    }
  })
;

```
