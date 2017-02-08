import Message from "./Message";
import { format, lengthOfUTF8, encodeMBI, parseUTF8, writeString, writeUint16, readUint16, validate } from "./util";
import { ERROR, CONNACK_RC, MESSAGE_TYPE, MqttProtoIdentifierv3, MqttProtoIdentifierv4 } from "./constants";
import Pinger from "./Pinger";
import Timeout from "./Timeout";
import WireMessage from "./WireMessage";

// Collection of utility methods used to simplify module code
// and promote the DRY pattern.

/**
 * Return a new function which runs the user function bound
 * to a fixed scope.
 * @param {function} User function
 * @param {object} Function scope
 * @return {function} User function bound to another scope
 * @private
 */
var scope = function (f, scope) {
  return function () {
    return f.apply(scope, arguments);
  };
};

function decodeMessage(input, pos) {
  var startingPos = pos;
  var first = input[pos];
  var type = first >> 4;
  var messageInfo = first &= 0x0f;
  pos += 1;


  // Decode the remaining length (MBI format)

  var digit;
  var remLength = 0;
  var multiplier = 1;
  do {
    if (pos == input.length) {
      return [null, startingPos];
    }
    digit = input[pos++];
    remLength += ((digit & 0x7F) * multiplier);
    multiplier *= 128;
  } while ((digit & 0x80) != 0);

  var endPos = pos + remLength;
  if (endPos > input.length) {
    return [null, startingPos];
  }

  var wireMessage = new WireMessage(type);
  switch (type) {
    case MESSAGE_TYPE.CONNACK:
      var connectAcknowledgeFlags = input[pos++];
      if (connectAcknowledgeFlags & 0x01)
        wireMessage.sessionPresent = true;
      wireMessage.returnCode = input[pos++];
      break;

    case MESSAGE_TYPE.PUBLISH:
      var qos = (messageInfo >> 1) & 0x03;

      var len = readUint16(input, pos);
      pos += 2;
      var topicName = parseUTF8(input, pos, len);
      pos += len;
      // If QoS 1 or 2 there will be a messageIdentifier
      if (qos > 0) {
        wireMessage.messageIdentifier = readUint16(input, pos);
        pos += 2;
      }

      var message = new Message(input.subarray(pos, endPos));
      if ((messageInfo & 0x01) == 0x01)
        message.retained = true;
      if ((messageInfo & 0x08) == 0x08)
        message.duplicate = true;
      message.qos = qos;
      message.destinationName = topicName;
      wireMessage.payloadMessage = message;
      break;

    case  MESSAGE_TYPE.PUBACK:
    case  MESSAGE_TYPE.PUBREC:
    case  MESSAGE_TYPE.PUBREL:
    case  MESSAGE_TYPE.PUBCOMP:
    case  MESSAGE_TYPE.UNSUBACK:
      wireMessage.messageIdentifier = readUint16(input, pos);
      break;

    case  MESSAGE_TYPE.SUBACK:
      wireMessage.messageIdentifier = readUint16(input, pos);
      pos += 2;
      wireMessage.returnCode = input.subarray(pos, endPos);
      break;

    default:
      ;
  }

  return [wireMessage, endPos];
}

/*
 * Internal implementation of the Websockets MQTT V3.1 client.
 *
 * @name ClientImpl @constructor
 * @param {String} host the DNS nameof the webSocket host.
 * @param {Number} port the port number for that host.
 * @param {String} clientId the MQ client identifier.
 * @param {Object} optional object implementing getItem, setItem, removeItem in a manner compatible with localStorage
 */
export const ClientImpl = function (uri, host, port, path, clientId, storage, ws) {
  // Check dependencies are satisfied in this browser.
  if (!ws && !(window.hasOwnProperty('WebSocket'))) {
    throw new Error(format(ERROR.UNSUPPORTED, ["WebSocket"]));
  }
  if (!storage && !(window.hasOwnProperty('localStorage'))) {
    throw new Error(format(ERROR.UNSUPPORTED, ["localStorage"]));
  }

  if (!(window.hasOwnProperty('ArrayBuffer'))) {
    throw new Error(format(ERROR.UNSUPPORTED, ["ArrayBuffer"]));
  }
  this._trace("Client", uri, host, port, path, clientId);

  this.host = host;
  this.port = port;
  this.path = path;
  this.uri = uri;
  this.clientId = clientId;
  this.storage = storage || window.localStorage;
  this.webSocket = ws || window.WebSocket;

  // Local storagekeys are qualified with the following string.
  // The conditional inclusion of path in the key is for backward
  // compatibility to when the path was not configurable and assumed to
  // be /mqtt
  this._localKey = host + ":" + port + (path != "/mqtt" ? ":" + path : "") + ":" + clientId + ":";

  // Create private instance-only message queue
  // Internal queue of messages to be sent, in sending order.
  this._msg_queue = [];

  // Messages we have sent and are expecting a response for, indexed by their respective message ids.
  this._sentMessages = {};

  // Messages we have received and acknowleged and are expecting a confirm message for
  // indexed by their respective message ids.
  this._receivedMessages = {};

  // Internal list of callbacks to be executed when messages
  // have been successfully sent over web socket, e.g. disconnect
  // when it doesn't have to wait for ACK, just message is dispatched.
  this._notify_msg_sent = {};

  // Unique identifier for SEND messages, incrementing
  // counter as messages are sent.
  this._message_identifier = 1;

  // Used to determine the transmission sequence of stored sent messages.
  this._sequence = 0;


  // Load the local state, if any, from the saved version, only restore state relevant to this client.
  for (var key in this.storage)
    if (key.indexOf("Sent:" + this._localKey) == 0
      || key.indexOf("Received:" + this._localKey) == 0)
      this.restore(key);
};

// Messaging Client public instance members.
ClientImpl.prototype.host;
ClientImpl.prototype.port;
ClientImpl.prototype.path;
ClientImpl.prototype.uri;
ClientImpl.prototype.clientId;
ClientImpl.prototype.storage;
ClientImpl.prototype.webSocket;

// Messaging Client private instance members.
ClientImpl.prototype.socket;
/* true once we have received an acknowledgement to a CONNECT packet. */
ClientImpl.prototype.connected = false;
/* The largest message identifier allowed, may not be larger than 2**16 but
 * if set smaller reduces the maximum number of outbound messages allowed.
 */
ClientImpl.prototype.maxMessageIdentifier = 65536;
ClientImpl.prototype.connectOptions;
ClientImpl.prototype.hostIndex;
ClientImpl.prototype.onConnectionLost;
ClientImpl.prototype.onMessageDelivered;
ClientImpl.prototype.onMessageArrived;
ClientImpl.prototype.traceFunction;
ClientImpl.prototype._msg_queue = null;
ClientImpl.prototype._connectTimeout;
/* The sendPinger monitors how long we allow before we send data to prove to the server that we are alive. */
ClientImpl.prototype.sendPinger = null;
/* The receivePinger monitors how long we allow before we require evidence that the server is alive. */
ClientImpl.prototype.receivePinger = null;

ClientImpl.prototype.receiveBuffer = null;

ClientImpl.prototype._traceBuffer = null;
ClientImpl.prototype._MAX_TRACE_ENTRIES = 100;

ClientImpl.prototype.connect = function (connectOptions) {
  var connectOptionsMasked = this._traceMask(connectOptions, "password");
  this._trace("Client.connect", connectOptionsMasked, this.socket, this.connected);

  if (this.connected)
    throw new Error(format(ERROR.INVALID_STATE, ["already connected"]));
  if (this.socket)
    throw new Error(format(ERROR.INVALID_STATE, ["already connected"]));

  this.connectOptions = connectOptions;

  if (connectOptions.uris) {
    this.hostIndex = 0;
    this._doConnect(connectOptions.uris[0]);
  } else {
    this._doConnect(this.uri);
  }

};

ClientImpl.prototype.subscribe = function (filter, subscribeOptions) {
  this._trace("Client.subscribe", filter, subscribeOptions);

  if (!this.connected)
    throw new Error(format(ERROR.INVALID_STATE, ["not connected"]));

  var wireMessage = new WireMessage(MESSAGE_TYPE.SUBSCRIBE);
  wireMessage.topics = [filter];
  if (subscribeOptions.qos != undefined)
    wireMessage.requestedQos = [subscribeOptions.qos];
  else
    wireMessage.requestedQos = [0];

  if (subscribeOptions.onSuccess) {
    wireMessage.onSuccess = function (grantedQos) {
      subscribeOptions.onSuccess({ invocationContext: subscribeOptions.invocationContext, grantedQos: grantedQos });
    };
  }

  if (subscribeOptions.onFailure) {
    wireMessage.onFailure = function (errorCode) {
      subscribeOptions.onFailure({ invocationContext: subscribeOptions.invocationContext, errorCode: errorCode });
    };
  }

  if (subscribeOptions.timeout) {
    wireMessage.timeOut = new Timeout(this, subscribeOptions.timeout, subscribeOptions.onFailure
      , [{
        invocationContext: subscribeOptions.invocationContext,
        errorCode: ERROR.SUBSCRIBE_TIMEOUT.code,
        errorMessage: format(ERROR.SUBSCRIBE_TIMEOUT)
      }]);
  }

  // All subscriptions return a SUBACK.
  this._requires_ack(wireMessage);
  this._schedule_message(wireMessage);
};

/** @ignore */
ClientImpl.prototype.unsubscribe = function (filter, unsubscribeOptions) {
  this._trace("Client.unsubscribe", filter, unsubscribeOptions);

  if (!this.connected)
    throw new Error(format(ERROR.INVALID_STATE, ["not connected"]));

  var wireMessage = new WireMessage(MESSAGE_TYPE.UNSUBSCRIBE);
  wireMessage.topics = [filter];

  if (unsubscribeOptions.onSuccess) {
    wireMessage.callback = function () {
      unsubscribeOptions.onSuccess({ invocationContext: unsubscribeOptions.invocationContext });
    };
  }
  if (unsubscribeOptions.timeout) {
    wireMessage.timeOut = new Timeout(this, unsubscribeOptions.timeout, unsubscribeOptions.onFailure
      , [{
        invocationContext: unsubscribeOptions.invocationContext,
        errorCode: ERROR.UNSUBSCRIBE_TIMEOUT.code,
        errorMessage: format(ERROR.UNSUBSCRIBE_TIMEOUT)
      }]);
  }

  // All unsubscribes return a SUBACK.
  this._requires_ack(wireMessage);
  this._schedule_message(wireMessage);
};

ClientImpl.prototype.send = function (message) {
  this._trace("Client.send", message);

  if (!this.connected)
    throw new Error(format(ERROR.INVALID_STATE, ["not connected"]));

  wireMessage = new WireMessage(MESSAGE_TYPE.PUBLISH);
  wireMessage.payloadMessage = message;

  if (message.qos > 0)
    this._requires_ack(wireMessage);
  else if (this.onMessageDelivered)
    this._notify_msg_sent[wireMessage] = this.onMessageDelivered(wireMessage.payloadMessage);
  this._schedule_message(wireMessage);
};

ClientImpl.prototype.disconnect = function () {
  this._trace("Client.disconnect");

  if (!this.socket)
    throw new Error(format(ERROR.INVALID_STATE, ["not connecting or connected"]));

  wireMessage = new WireMessage(MESSAGE_TYPE.DISCONNECT);

  // Run the disconnected call back as soon as the message has been sent,
  // in case of a failure later on in the disconnect processing.
  // as a consequence, the _disconected call back may be run several times.
  this._notify_msg_sent[wireMessage] = scope(this._disconnected, this);

  this._schedule_message(wireMessage);
};

ClientImpl.prototype.getTraceLog = function () {
  if (this._traceBuffer !== null) {
    this._trace("Client.getTraceLog", new Date());
    this._trace("Client.getTraceLog in flight messages", this._sentMessages.length);
    for (var key in this._sentMessages)
      this._trace("_sentMessages ", key, this._sentMessages[key]);
    for (var key in this._receivedMessages)
      this._trace("_receivedMessages ", key, this._receivedMessages[key]);

    return this._traceBuffer;
  }
};

ClientImpl.prototype.startTrace = function () {
  if (this._traceBuffer === null) {
    this._traceBuffer = [];
  }
  this._trace("Client.startTrace", new Date(), version);
};

ClientImpl.prototype.stopTrace = function () {
  delete this._traceBuffer;
};

ClientImpl.prototype._doConnect = function (wsurl) {
  // When the socket is open, this client will send the CONNECT WireMessage using the saved parameters.
  if (this.connectOptions.useSSL) {
    var uriParts = wsurl.split(":");
    uriParts[0] = "wss";
    wsurl = uriParts.join(":");
  }
  this.connected = false;
  if (this.connectOptions.mqttVersion < 4) {
    this.socket = new this.webSocket(wsurl, ["mqttv3.1"]);
  } else {
    this.socket = new this.webSocket(wsurl, ["mqtt"]);
  }
  this.socket.binaryType = 'arraybuffer';

  this.socket.onopen = scope(this._on_socket_open, this);
  this.socket.onmessage = scope(this._on_socket_message, this);
  this.socket.onerror = scope(this._on_socket_error, this);
  this.socket.onclose = scope(this._on_socket_close, this);

  this.sendPinger = new Pinger(this, this.connectOptions.keepAliveInterval);
  this.receivePinger = new Pinger(this, this.connectOptions.keepAliveInterval);

  this._connectTimeout = new Timeout(this, this.connectOptions.timeout, this._disconnected, [ERROR.CONNECT_TIMEOUT.code, format(ERROR.CONNECT_TIMEOUT)]);
};


// Schedule a new message to be sent over the WebSockets
// connection. CONNECT messages cause WebSocket connection
// to be started. All other messages are queued internally
// until this has happened. When WS connection starts, process
// all outstanding messages.
ClientImpl.prototype._schedule_message = function (message) {
  this._msg_queue.push(message);
  // Process outstanding messages in the queue if we have an  open socket, and have received CONNACK.
  if (this.connected) {
    this._process_queue();
  }
};

ClientImpl.prototype.store = function (prefix, wireMessage) {
  var storedMessage = { type: wireMessage.type, messageIdentifier: wireMessage.messageIdentifier, version: 1 };

  switch (wireMessage.type) {
    case MESSAGE_TYPE.PUBLISH:
      if (wireMessage.pubRecReceived)
        storedMessage.pubRecReceived = true;

      // Convert the payload to a hex string.
      storedMessage.payloadMessage = {};
      var hex = "";
      var messageBytes = wireMessage.payloadMessage.payloadBytes;
      for (var i = 0; i < messageBytes.length; i++) {
        if (messageBytes[i] <= 0xF)
          hex = hex + "0" + messageBytes[i].toString(16);
        else
          hex = hex + messageBytes[i].toString(16);
      }
      storedMessage.payloadMessage.payloadHex = hex;

      storedMessage.payloadMessage.qos = wireMessage.payloadMessage.qos;
      storedMessage.payloadMessage.destinationName = wireMessage.payloadMessage.destinationName;
      if (wireMessage.payloadMessage.duplicate)
        storedMessage.payloadMessage.duplicate = true;
      if (wireMessage.payloadMessage.retained)
        storedMessage.payloadMessage.retained = true;

      // Add a sequence number to sent messages.
      if (prefix.indexOf("Sent:") == 0) {
        if (wireMessage.sequence === undefined)
          wireMessage.sequence = ++this._sequence;
        storedMessage.sequence = wireMessage.sequence;
      }
      break;

    default:
      throw Error(format(ERROR.INVALID_STORED_DATA, [key, storedMessage]));
  }
  this.storage.setItem(prefix + this._localKey + wireMessage.messageIdentifier, JSON.stringify(storedMessage));
};

ClientImpl.prototype.restore = function (key) {
  var value = this.storage.getItem(key);
  var storedMessage = JSON.parse(value);

  var wireMessage = new WireMessage(storedMessage.type, storedMessage);

  switch (storedMessage.type) {
    case MESSAGE_TYPE.PUBLISH:
      // Replace the payload message with a Message object.
      var hex = storedMessage.payloadMessage.payloadHex;
      var buffer = new ArrayBuffer((hex.length) / 2);
      var byteStream = new Uint8Array(buffer);
      var i = 0;
      while (hex.length >= 2) {
        var x = parseInt(hex.substring(0, 2), 16);
        hex = hex.substring(2, hex.length);
        byteStream[i++] = x;
      }
      var payloadMessage = new Message(byteStream);

      payloadMessage.qos = storedMessage.payloadMessage.qos;
      payloadMessage.destinationName = storedMessage.payloadMessage.destinationName;
      if (storedMessage.payloadMessage.duplicate)
        payloadMessage.duplicate = true;
      if (storedMessage.payloadMessage.retained)
        payloadMessage.retained = true;
      wireMessage.payloadMessage = payloadMessage;

      break;

    default:
      throw Error(format(ERROR.INVALID_STORED_DATA, [key, value]));
  }

  if (key.indexOf("Sent:" + this._localKey) == 0) {
    wireMessage.payloadMessage.duplicate = true;
    this._sentMessages[wireMessage.messageIdentifier] = wireMessage;
  } else if (key.indexOf("Received:" + this._localKey) == 0) {
    this._receivedMessages[wireMessage.messageIdentifier] = wireMessage;
  }
};

ClientImpl.prototype._process_queue = function () {
  var message = null;
  // Process messages in order they were added
  var fifo = this._msg_queue.reverse();

  // Send all queued messages down socket connection
  while ((message = fifo.pop())) {
    this._socket_send(message);
    // Notify listeners that message was successfully sent
    if (this._notify_msg_sent[message]) {
      this._notify_msg_sent[message]();
      delete this._notify_msg_sent[message];
    }
  }
};

/**
 * Expect an ACK response for this message. Add message to the set of in progress
 * messages and set an unused identifier in this message.
 * @ignore
 */
ClientImpl.prototype._requires_ack = function (wireMessage) {
  var messageCount = Object.keys(this._sentMessages).length;
  if (messageCount > this.maxMessageIdentifier)
    throw Error("Too many messages:" + messageCount);

  while (this._sentMessages[this._message_identifier] !== undefined) {
    this._message_identifier++;
  }
  wireMessage.messageIdentifier = this._message_identifier;
  this._sentMessages[wireMessage.messageIdentifier] = wireMessage;
  if (wireMessage.type === MESSAGE_TYPE.PUBLISH) {
    this.store("Sent:", wireMessage);
  }
  if (this._message_identifier === this.maxMessageIdentifier) {
    this._message_identifier = 1;
  }
};

/**
 * Called when the underlying websocket has been opened.
 * @ignore
 */
ClientImpl.prototype._on_socket_open = function () {
  // Create the CONNECT message object.
  var wireMessage = new WireMessage(MESSAGE_TYPE.CONNECT, this.connectOptions);
  wireMessage.clientId = this.clientId;
  this._socket_send(wireMessage);
};

/**
 * Called when the underlying websocket has received a complete packet.
 * @ignore
 */
ClientImpl.prototype._on_socket_message = function (event) {
  this._trace("Client._on_socket_message", event.data);
  var messages = this._deframeMessages(event.data);
  for (var i = 0; i < messages.length; i += 1) {
    this._handleMessage(messages[i]);
  }
}

ClientImpl.prototype._deframeMessages = function (data) {
  var byteArray = new Uint8Array(data);
  if (this.receiveBuffer) {
    var newData = new Uint8Array(this.receiveBuffer.length + byteArray.length);
    newData.set(this.receiveBuffer);
    newData.set(byteArray, this.receiveBuffer.length);
    byteArray = newData;
    delete this.receiveBuffer;
  }
  try {
    var offset = 0;
    var messages = [];
    while (offset < byteArray.length) {
      var result = decodeMessage(byteArray, offset);
      var wireMessage = result[0];
      offset = result[1];
      if (wireMessage !== null) {
        messages.push(wireMessage);
      } else {
        break;
      }
    }
    if (offset < byteArray.length) {
      this.receiveBuffer = byteArray.subarray(offset);
    }
  } catch (error) {
    this._disconnected(ERROR.INTERNAL_ERROR.code, format(ERROR.INTERNAL_ERROR, [error.message, error.stack.toString()]));
    return;
  }
  return messages;
}

ClientImpl.prototype._handleMessage = function (wireMessage) {

  this._trace("Client._handleMessage", wireMessage);

  try {
    switch (wireMessage.type) {
      case MESSAGE_TYPE.CONNACK:
        this._connectTimeout.cancel();

        // If we have started using clean session then clear up the local state.
        if (this.connectOptions.cleanSession) {
          for (var key in this._sentMessages) {
            var sentMessage = this._sentMessages[key];
            this.storage.removeItem("Sent:" + this._localKey + sentMessage.messageIdentifier);
          }
          this._sentMessages = {};

          for (var key in this._receivedMessages) {
            var receivedMessage = this._receivedMessages[key];
            this.storage.removeItem("Received:" + this._localKey + receivedMessage.messageIdentifier);
          }
          this._receivedMessages = {};
        }
        // Client connected and ready for business.
        if (wireMessage.returnCode === 0) {
          this.connected = true;
          // Jump to the end of the list of uris and stop looking for a good host.
          if (this.connectOptions.uris)
            this.hostIndex = this.connectOptions.uris.length;
        } else {
          this._disconnected(ERROR.CONNACK_RETURNCODE.code, format(ERROR.CONNACK_RETURNCODE, [wireMessage.returnCode, CONNACK_RC[wireMessage.returnCode]]));
          break;
        }

        // Resend messages.
        var sequencedMessages = new Array();
        for (var msgId in this._sentMessages) {
          if (this._sentMessages.hasOwnProperty(msgId))
            sequencedMessages.push(this._sentMessages[msgId]);
        }

        // Sort sentMessages into the original sent order.
        var sequencedMessages = sequencedMessages.sort(function (a, b) {
          return a.sequence - b.sequence;
        });
        for (var i = 0, len = sequencedMessages.length; i < len; i++) {
          var sentMessage = sequencedMessages[i];
          if (sentMessage.type == MESSAGE_TYPE.PUBLISH && sentMessage.pubRecReceived) {
            var pubRelMessage = new WireMessage(MESSAGE_TYPE.PUBREL, { messageIdentifier: sentMessage.messageIdentifier });
            this._schedule_message(pubRelMessage);
          } else {
            this._schedule_message(sentMessage);
          }
          ;
        }

        // Execute the connectOptions.onSuccess callback if there is one.
        if (this.connectOptions.onSuccess) {
          this.connectOptions.onSuccess({ invocationContext: this.connectOptions.invocationContext });
        }

        // Process all queued messages now that the connection is established.
        this._process_queue();
        break;

      case MESSAGE_TYPE.PUBLISH:
        this._receivePublish(wireMessage);
        break;

      case MESSAGE_TYPE.PUBACK:
        var sentMessage = this._sentMessages[wireMessage.messageIdentifier];
        // If this is a re flow of a PUBACK after we have restarted receivedMessage will not exist.
        if (sentMessage) {
          delete this._sentMessages[wireMessage.messageIdentifier];
          this.storage.removeItem("Sent:" + this._localKey + wireMessage.messageIdentifier);
          if (this.onMessageDelivered)
            this.onMessageDelivered(sentMessage.payloadMessage);
        }
        break;

      case MESSAGE_TYPE.PUBREC:
        var sentMessage = this._sentMessages[wireMessage.messageIdentifier];
        // If this is a re flow of a PUBREC after we have restarted receivedMessage will not exist.
        if (sentMessage) {
          sentMessage.pubRecReceived = true;
          var pubRelMessage = new WireMessage(MESSAGE_TYPE.PUBREL, { messageIdentifier: wireMessage.messageIdentifier });
          this.store("Sent:", sentMessage);
          this._schedule_message(pubRelMessage);
        }
        break;

      case MESSAGE_TYPE.PUBREL:
        var receivedMessage = this._receivedMessages[wireMessage.messageIdentifier];
        this.storage.removeItem("Received:" + this._localKey + wireMessage.messageIdentifier);
        // If this is a re flow of a PUBREL after we have restarted receivedMessage will not exist.
        if (receivedMessage) {
          this._receiveMessage(receivedMessage);
          delete this._receivedMessages[wireMessage.messageIdentifier];
        }
        // Always flow PubComp, we may have previously flowed PubComp but the server lost it and restarted.
        var pubCompMessage = new WireMessage(MESSAGE_TYPE.PUBCOMP, { messageIdentifier: wireMessage.messageIdentifier });
        this._schedule_message(pubCompMessage);
        break;

      case MESSAGE_TYPE.PUBCOMP:
        var sentMessage = this._sentMessages[wireMessage.messageIdentifier];
        delete this._sentMessages[wireMessage.messageIdentifier];
        this.storage.removeItem("Sent:" + this._localKey + wireMessage.messageIdentifier);
        if (this.onMessageDelivered)
          this.onMessageDelivered(sentMessage.payloadMessage);
        break;

      case MESSAGE_TYPE.SUBACK:
        var sentMessage = this._sentMessages[wireMessage.messageIdentifier];
        if (sentMessage) {
          if (sentMessage.timeOut)
            sentMessage.timeOut.cancel();
          // This will need to be fixed when we add multiple topic support
          if (wireMessage.returnCode[0] === 0x80) {
            if (sentMessage.onFailure) {
              sentMessage.onFailure(wireMessage.returnCode);
            }
          } else if (sentMessage.onSuccess) {
            sentMessage.onSuccess(wireMessage.returnCode);
          }
          delete this._sentMessages[wireMessage.messageIdentifier];
        }
        break;

      case MESSAGE_TYPE.UNSUBACK:
        var sentMessage = this._sentMessages[wireMessage.messageIdentifier];
        if (sentMessage) {
          if (sentMessage.timeOut)
            sentMessage.timeOut.cancel();
          if (sentMessage.callback) {
            sentMessage.callback();
          }
          delete this._sentMessages[wireMessage.messageIdentifier];
        }

        break;

      case MESSAGE_TYPE.PINGRESP:
        /* The sendPinger or receivePinger may have sent a ping, the receivePinger has already been reset. */
        this.sendPinger.reset();
        break;

      case MESSAGE_TYPE.DISCONNECT:
        // Clients do not expect to receive disconnect packets.
        this._disconnected(ERROR.INVALID_MQTT_MESSAGE_TYPE.code, format(ERROR.INVALID_MQTT_MESSAGE_TYPE, [wireMessage.type]));
        break;

      default:
        this._disconnected(ERROR.INVALID_MQTT_MESSAGE_TYPE.code, format(ERROR.INVALID_MQTT_MESSAGE_TYPE, [wireMessage.type]));
    }
    ;
  } catch (error) {
    this._disconnected(ERROR.INTERNAL_ERROR.code, format(ERROR.INTERNAL_ERROR, [error.message, error.stack.toString()]));
    return;
  }
};

/** @ignore */
ClientImpl.prototype._on_socket_error = function (error) {
  this._disconnected(ERROR.SOCKET_ERROR.code, format(ERROR.SOCKET_ERROR, [error.data]));
};

/** @ignore */
ClientImpl.prototype._on_socket_close = function () {
  this._disconnected(ERROR.SOCKET_CLOSE.code, format(ERROR.SOCKET_CLOSE));
};

/** @ignore */
ClientImpl.prototype._socket_send = function (wireMessage) {

  if (wireMessage.type === 1) {
    const wireMessageMasked = this._traceMask(wireMessage, "password");
    this._trace("Client._socket_send", wireMessageMasked);
  }
  else this._trace("Client._socket_send", wireMessage);

  this.socket.send(wireMessage.encode());
  /* We have proved to the server we are alive. */
  this.sendPinger.reset();
};

/** @ignore */
ClientImpl.prototype._receivePublish = function (wireMessage) {
  switch (wireMessage.payloadMessage.qos) {
    case "undefined":
    case 0:
      this._receiveMessage(wireMessage);
      break;

    case 1:
      var pubAckMessage = new WireMessage(MESSAGE_TYPE.PUBACK, { messageIdentifier: wireMessage.messageIdentifier });
      this._schedule_message(pubAckMessage);
      this._receiveMessage(wireMessage);
      break;

    case 2:
      this._receivedMessages[wireMessage.messageIdentifier] = wireMessage;
      this.store("Received:", wireMessage);
      var pubRecMessage = new WireMessage(MESSAGE_TYPE.PUBREC, { messageIdentifier: wireMessage.messageIdentifier });
      this._schedule_message(pubRecMessage);

      break;

    default:
      throw Error("Invaild qos=" + wireMmessage.payloadMessage.qos);
  }
  ;
};

/** @ignore */
ClientImpl.prototype._receiveMessage = function (wireMessage) {
  if (this.onMessageArrived) {
    this.onMessageArrived(wireMessage.payloadMessage);
  }
};

/**
 * Client has disconnected either at its own request or because the server
 * or network disconnected it. Remove all non-durable state.
 * @param {errorCode} [number] the error number.
 * @param {errorText} [string] the error text.
 * @ignore
 */
ClientImpl.prototype._disconnected = function (errorCode, errorText) {
  this._trace("Client._disconnected", errorCode, errorText);

  this.sendPinger.cancel();
  this.receivePinger.cancel();
  if (this._connectTimeout)
    this._connectTimeout.cancel();
  // Clear message buffers.
  this._msg_queue = [];
  this._notify_msg_sent = {};

  if (this.socket) {
    // Cancel all socket callbacks so that they cannot be driven again by this socket.
    this.socket.onopen = null;
    this.socket.onmessage = null;
    this.socket.onerror = null;
    this.socket.onclose = null;
    if (this.socket.readyState === 1)
      this.socket.close();
    delete this.socket;
  }

  if (this.connectOptions.uris && this.hostIndex < this.connectOptions.uris.length - 1) {
    // Try the next host.
    this.hostIndex++;
    this._doConnect(this.connectOptions.uris[this.hostIndex]);

  } else {

    if (errorCode === undefined) {
      errorCode = ERROR.OK.code;
      errorText = format(ERROR.OK);
    }

    // Run any application callbacks last as they may attempt to reconnect and hence create a new socket.
    if (this.connected) {
      this.connected = false;
      // Execute the connectionLostCallback if there is one, and we were connected.
      if (this.onConnectionLost)
        this.onConnectionLost({ errorCode: errorCode, errorMessage: errorText });
    } else {
      // Otherwise we never had a connection, so indicate that the connect has failed.
      if (this.connectOptions.mqttVersion === 4 && this.connectOptions.mqttVersionExplicit === false) {
        this._trace("Failed to connect V4, dropping back to V3")
        this.connectOptions.mqttVersion = 3;
        if (this.connectOptions.uris) {
          this.hostIndex = 0;
          this._doConnect(this.connectOptions.uris[0]);
        } else {
          this._doConnect(this.uri);
        }
      } else if (this.connectOptions.onFailure) {
        this.connectOptions.onFailure({
          invocationContext: this.connectOptions.invocationContext,
          errorCode: errorCode,
          errorMessage: errorText
        });
      }
    }
  }
};

/** @ignore */
ClientImpl.prototype._trace = function () {
  // Pass trace message back to client's callback function
  if (this.traceFunction) {
    for (var i in arguments) {
      if (typeof arguments[i] !== "undefined")
        arguments[i] = JSON.stringify(arguments[i]);
    }
    var record = Array.prototype.slice.call(arguments).join("");
    this.traceFunction({ severity: "Debug", message: record });
  }

  //buffer style trace
  if (this._traceBuffer !== null) {
    for (var i = 0, max = arguments.length; i < max; i++) {
      if (this._traceBuffer.length == this._MAX_TRACE_ENTRIES) {
        this._traceBuffer.shift();
      }
      if (i === 0) this._traceBuffer.push(arguments[i]);
      else if (typeof arguments[i] === "undefined") this._traceBuffer.push(arguments[i]);
      else this._traceBuffer.push("  " + JSON.stringify(arguments[i]));
    }
    ;
  }
  ;
};

/** @ignore */
ClientImpl.prototype._traceMask = function (traceObject, masked) {
  var traceObjectMasked = {};
  for (var attr in traceObject) {
    if (traceObject.hasOwnProperty(attr)) {
      if (attr == masked)
        traceObjectMasked[attr] = "******";
      else
        traceObjectMasked[attr] = traceObject[attr];
    }
  }
  return traceObjectMasked;
};
