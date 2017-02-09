import { Client, Message } from '../..';

//global.window = global;
global.Paho = {
  MQTT: {
    Client: Client,
    Message: Message
  }
};

// This is the equivalent of the old waitsFor/runs syntax
// which was removed from Jasmine 2
global.runs = global.waitsFor = function (escapeFunction, runFunction, escapeTime) {
  // check the escapeFunction every millisecond so as soon as it is met we can escape the function
  var interval = setInterval(function () {
    if (escapeFunction()) {
      clearMe();
      runFunction();
    }
  }, 1);

  // in case we never reach the escapeFunction, we will time out
  // at the escapeTime
  var timeOut = setTimeout(function () {
    clearMe();
    runFunction();
  }, escapeTime);

  // clear the interval and the timeout
  function clearMe() {
    clearInterval(interval);
    clearTimeout(timeOut);
  }
};

global.waits = function (ms) {
  var start = new Date().getTime(), expire = start + ms;
  while (new Date().getTime() < expire) {
  }
  return;
};

global.WebSocket = require('websocket').w3cwebsocket;


var LocalStorage = require('node-localstorage').LocalStorage;
global.localStorage = new LocalStorage('./persistence');

require('../Client');
