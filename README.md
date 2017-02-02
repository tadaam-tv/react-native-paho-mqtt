# Eclipse Paho JavaScript client forked for React Native

A fork of [paho-client](https://www.npmjs.com/package/paho-client), this project exists to provide an ES6-ready, Promise-based, react-native compatible version of the Eclipse Paho client

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
const client = new Client({ host: 'iot.eclipse.org', port: 80, path: '/ws', clientId: 'clientId', storage: myStorage });

// set callback handlers
client.onConnectionLost = (responseObject) => {
    if (responseObject.errorCode !== 0) {
      console.log("onConnectionLost:"+responseObject.errorMessage);
    }
};
client.onMessageArrived = (message) => {
    console.log("onMessageArrived:"+message.payloadString);
};

// connect the client
client.connect()
    .then(() => {
      // Once a connection has been made, make a subscription and send a message.
      console.log("onConnect");
      return client.subscribe("World");
    })
    .then(() => {
      message = new Message("Hello");
      message.destinationName = "World";
      client.send(message);
    })
    .catch((responseObject) => {
      if (responseObject.errorCode !== 0) {
        console.log("onConnectionLost:"+responseObject.errorMessage);
      }
    })
;

```
