import Message from "./Message";
import { decodeMessage, format } from "./util";
import { CONNACK_RC, ERROR, MESSAGE_TYPE } from "./constants";
import Pinger from "./Pinger";
import WireMessage from "./WireMessage";

/*
 * Internal implementation of the Websockets MQTT V3.1 client.
 *
 * @name ClientImpl @constructor
 * @param {String} host the DNS nameof the webSocket host.
 * @param {Number} port the port number for that host.
 * @param {String} clientId the MQ client identifier.
 * @param {Object} optional object implementing getItem, setItem, removeItem in a manner compatible with localStorage
 */
export class ClientImpl {

  // Messaging Client public instance members.
  host;
  port;
  path;
  uri;
  clientId;
  storage;
  webSocket;

// Messaging Client private instance members.
  socket;
  /* true once we have received an acknowledgement to a CONNECT packet. */
  connected = false;
  /* The largest message identifier allowed, may not be larger than 2**16 but
   * if set smaller reduces the maximum number of outbound messages allowed.
   */
  maxMessageIdentifier = 65536;
  connectOptions;
  hostIndex;
  onConnectionLost;
  onMessageDelivered;
  onMessageArrived;
  traceFunction;
  _msg_queue = null;
  _connectTimeout;
  /* The sendPinger monitors how long we allow before we send data to prove to the server that we are alive. */
  sendPinger = null;
  /* The receivePinger monitors how long we allow before we require evidence that the server is alive. */
  receivePinger = null;

  receiveBuffer = null;

  _traceBuffer = null;
  _MAX_TRACE_ENTRIES = 100;

  constructor(uri, host, port, path, clientId, storage, ws) {
    // Check dependencies are satisfied in this browser.
    if (!ws && !(window && window.WebSocket)) {
      throw new Error(format(ERROR.UNSUPPORTED, ["WebSocket"]));
    }
    if (!storage && !(window && window.localStorage)) {
      throw new Error(format(ERROR.UNSUPPORTED, ["localStorage"]));
    }

    if (!(window && window.ArrayBuffer)) {
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
    this._localKey = host + ":" + port + (path !== "/mqtt" ? ":" + path : "") + ":" + clientId + ":";

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
    Object.keys(this.storage).forEach(key => {
      if (key.indexOf("Sent:" + this._localKey) === 0 || key.indexOf("Received:" + this._localKey) === 0) {
        this.restore(key);
      }
    });
  }


  connect(connectOptions) {
    const maskedCopy = { ...connectOptions };
    if (maskedCopy.type === 1 && maskedCopy.password) {
      maskedCopy.password = 'REDACTED'
    }
    this._trace("Client.connect", maskedCopy, this.socket, this.connected);

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

  }

  subscribe(filter, subscribeOptions) {
    this._trace("Client.subscribe", filter, subscribeOptions);

    if (!this.connected)
      throw new Error(format(ERROR.INVALID_STATE, ["not connected"]));

    const wireMessage = new WireMessage(MESSAGE_TYPE.SUBSCRIBE);
    wireMessage.topics = [filter];
    wireMessage.requestedQos = [subscribeOptions.qos || 0];

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

    if (subscribeOptions.timeout && subscribeOptions.onFailure) {
      wireMessage.timeOut = setTimeout(() => {
        subscribeOptions.onFailure({
          invocationContext: subscribeOptions.invocationContext,
          errorCode: ERROR.SUBSCRIBE_TIMEOUT.code,
          errorMessage: format(ERROR.SUBSCRIBE_TIMEOUT)
        })
      }, subscribeOptions.timeout);
    }

    // All subscriptions return a SUBACK.
    this._requires_ack(wireMessage);
    this._schedule_message(wireMessage);
  }

  /** @ignore */
  unsubscribe(filter, unsubscribeOptions) {
    this._trace("Client.unsubscribe", filter, unsubscribeOptions);

    if (!this.connected)
      throw new Error(format(ERROR.INVALID_STATE, ["not connected"]));

    const wireMessage = new WireMessage(MESSAGE_TYPE.UNSUBSCRIBE);
    wireMessage.topics = [filter];

    if (unsubscribeOptions.onSuccess) {
      wireMessage.callback = function () {
        unsubscribeOptions.onSuccess({ invocationContext: unsubscribeOptions.invocationContext });
      };
    }
    if (unsubscribeOptions.timeout) {
      wireMessage.timeOut = setTimeout(() => {
        unsubscribeOptions.onFailure({
          invocationContext: unsubscribeOptions.invocationContext,
          errorCode: ERROR.UNSUBSCRIBE_TIMEOUT.code,
          errorMessage: format(ERROR.UNSUBSCRIBE_TIMEOUT)
        })
      }, unsubscribeOptions.timeout);
    }

    // All unsubscribes return a SUBACK.
    this._requires_ack(wireMessage);
    this._schedule_message(wireMessage);
  }

  send(message) {
    this._trace("Client.send", message);

    if (!this.connected)
      throw new Error(format(ERROR.INVALID_STATE, ["not connected"]));

    const wireMessage = new WireMessage(MESSAGE_TYPE.PUBLISH);
    wireMessage.payloadMessage = message;

    if (message.qos > 0)
      this._requires_ack(wireMessage);
    else if (this.onMessageDelivered)
      this._notify_msg_sent[wireMessage] = this.onMessageDelivered(wireMessage.payloadMessage);
    this._schedule_message(wireMessage);
  }

  disconnect() {
    this._trace("Client.disconnect");

    if (!this.socket)
      throw new Error(format(ERROR.INVALID_STATE, ["not connecting or connected"]));

    const wireMessage = new WireMessage(MESSAGE_TYPE.DISCONNECT);

    // Run the disconnected call back as soon as the message has been sent,
    // in case of a failure later on in the disconnect processing.
    // as a consequence, the _disconnected call back may be run several times.
    this._notify_msg_sent[wireMessage] = () => this._disconnected();

    this._schedule_message(wireMessage);
  }

  getTraceLog() {
    if (this._traceBuffer !== null) {
      this._trace("Client.getTraceLog", new Date());
      this._trace("Client.getTraceLog in flight messages", this._sentMessages.length);
      Object.keys(this._sentMessages).forEach((key) => {
        this._trace("_sentMessages ", key, this._sentMessages[key]);
      });
      Object.keys(this._receivedMessages).forEach((key) => {
        this._trace("_receivedMessages ", key, this._receivedMessages[key]);
      });
      return this._traceBuffer;
    }
  }

  startTrace() {
    if (this._traceBuffer === null) {
      this._traceBuffer = [];
    }
    this._trace("Client.startTrace", new Date());
  }

  stopTrace() {
    this._traceBuffer = null;
  }

  _doConnect(wsurl) {
    // When the socket is open, this client will send the CONNECT WireMessage using the saved parameters.
    if (this.connectOptions.useSSL) {
      const uriParts = wsurl.split(":");
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

    this.socket.onopen = () => this._on_socket_open();
    this.socket.onmessage = (event) => this._on_socket_message(event);
    this.socket.onerror = (error) => this._on_socket_error(error);
    this.socket.onclose = () => this._on_socket_close();

    this.sendPinger = new Pinger(this, this.connectOptions.keepAliveInterval);
    this.receivePinger = new Pinger(this, this.connectOptions.keepAliveInterval);

    if (this.connectOptions.timeout) {
      this._connectTimeout = setTimeout(() => {
        this._disconnected(ERROR.CONNECT_TIMEOUT.code, format(ERROR.CONNECT_TIMEOUT));
      }, this.connectOptions.timeout);
    }
  }


// Schedule a new message to be sent over the WebSockets
// connection. CONNECT messages cause WebSocket connection
// to be started. All other messages are queued internally
// until this has happened. When WS connection starts, process
// all outstanding messages.
  _schedule_message(message) {
    this._msg_queue.push(message);
    // Process outstanding messages in the queue if we have an  open socket, and have received CONNACK.
    if (this.connected) {
      this._process_queue();
    }
  };

  store(prefix, wireMessage) {
    const storedMessage = { type: wireMessage.type, messageIdentifier: wireMessage.messageIdentifier, version: 1 };

    switch (wireMessage.type) {
      case MESSAGE_TYPE.PUBLISH:
        if (wireMessage.pubRecReceived)
          storedMessage.pubRecReceived = true;

        // Convert the payload to a hex string.
        storedMessage.payloadMessage = {};
        let hex = "";
        const messageBytes = wireMessage.payloadMessage.payloadBytes;
        for (let i = 0; i < messageBytes.length; i++) {
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
        if (prefix.indexOf("Sent:") === 0) {
          if (wireMessage.sequence === undefined)
            wireMessage.sequence = ++this._sequence;
          storedMessage.sequence = wireMessage.sequence;
        }
        break;

      default:
        throw Error(format(ERROR.INVALID_STORED_DATA, [prefix + this._localKey + wireMessage.messageIdentifier, storedMessage]));
    }
    this.storage.setItem(prefix + this._localKey + wireMessage.messageIdentifier, JSON.stringify(storedMessage));
  };

  restore(key) {
    const value = this.storage.getItem(key);
    const storedMessage = JSON.parse(value);

    const wireMessage = new WireMessage(storedMessage.type, storedMessage);

    switch (storedMessage.type) {
      case MESSAGE_TYPE.PUBLISH:
        // Replace the payload message with a Message object.
        let hex = storedMessage.payloadMessage.payloadHex;
        const buffer = new ArrayBuffer((hex.length) / 2);
        const byteStream = new Uint8Array(buffer);
        let i = 0;
        while (hex.length >= 2) {
          const x = parseInt(hex.substring(0, 2), 16);
          hex = hex.substring(2, hex.length);
          byteStream[i++] = x;
        }
        const payloadMessage = new Message(byteStream);

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

    if (key.indexOf("Sent:" + this._localKey) === 0) {
      wireMessage.payloadMessage.duplicate = true;
      this._sentMessages[wireMessage.messageIdentifier] = wireMessage;
    } else if (key.indexOf("Received:" + this._localKey) === 0) {
      this._receivedMessages[wireMessage.messageIdentifier] = wireMessage;
    }
  };

  _process_queue() {
    // Process messages in order they were added
    // Send all queued messages down socket connection
    this._msg_queue.reverse().forEach(message => {
      this._socket_send(message);
      // Notify listeners that message was successfully sent
      if (this._notify_msg_sent[message]) {
        this._notify_msg_sent[message]();
        delete this._notify_msg_sent[message];
      }
    });
  };

  /**
   * Expect an ACK response for this message. Add message to the set of in progress
   * messages and set an unused identifier in this message.
   * @ignore
   */
  _requires_ack(wireMessage) {
    const messageCount = Object.keys(this._sentMessages).length;
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
  _on_socket_open() {
    // Create the CONNECT message object.
    const wireMessage = new WireMessage(MESSAGE_TYPE.CONNECT, this.connectOptions);
    wireMessage.clientId = this.clientId;
    this._socket_send(wireMessage);
  };

  /**
   * Called when the underlying websocket has received a complete packet.
   * @ignore
   */
  _on_socket_message(event) {
    this._trace("Client._on_socket_message", event.data);
    const messages = this._deframeMessages(event.data);
    messages && messages.forEach(message => this._handleMessage(message));
  };

  _deframeMessages(data) {
    let byteArray = new Uint8Array(data);
    if (this.receiveBuffer) {
      const newData = new Uint8Array(this.receiveBuffer.length + byteArray.length);
      newData.set(this.receiveBuffer);
      newData.set(byteArray, this.receiveBuffer.length);
      byteArray = newData;
      this.receiveBuffer = null;
    }
    try {
      let offset = 0;
      let messages = [];
      while (offset < byteArray.length) {
        const result = decodeMessage(byteArray, offset);
        const wireMessage = result[0];
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
      return messages;
    } catch (error) {
      this._disconnected(ERROR.INTERNAL_ERROR.code, format(ERROR.INTERNAL_ERROR, [error.message, error.stack.toString()]));
    }
  };

  _handleMessage(wireMessage) {

    this._trace("Client._handleMessage", wireMessage);

    try {
      let sentMessage, receivedMessage;
      switch (wireMessage.type) {
        case MESSAGE_TYPE.CONNACK:
          clearTimeout(this._connectTimeout);

          // If we have started using clean session then clear up the local state.
          if (this.connectOptions.cleanSession) {
            Object.keys(this._sentMessages).forEach((key) => {
              const sentMessage = this._sentMessages[key];
              this.storage.removeItem("Sent:" + this._localKey + sentMessage.messageIdentifier);
            });
            this._sentMessages = {};

            Object.keys(this._receivedMessages).forEach((key) => {
              const receivedMessage = this._receivedMessages[key];
              this.storage.removeItem("Received:" + this._localKey + receivedMessage.messageIdentifier);
            });
            this._receivedMessages = {};
          }
          // Client connected and ready for business.
          if (wireMessage.returnCode === 0) {
            this.connected = true;
            // Jump to the end of the list of uris and stop looking for a good host.
            if (this.connectOptions.uris) {
              this.hostIndex = this.connectOptions.uris.length;
            }
          } else {
            this._disconnected(ERROR.CONNACK_RETURNCODE.code, format(ERROR.CONNACK_RETURNCODE, [wireMessage.returnCode, CONNACK_RC[wireMessage.returnCode]]));
            break;
          }

          // Resend messages. Sort sentMessages into the original sent order.
          const sequencedMessages = Object.keys(this._sentMessages).map(key => this._sentMessages[key]).sort((a, b) => a.sequence - b.sequence);

          sequencedMessages.forEach((sentMessage) => {
            if (sentMessage.type === MESSAGE_TYPE.PUBLISH && sentMessage.pubRecReceived) {
              this._schedule_message(new WireMessage(MESSAGE_TYPE.PUBREL, { messageIdentifier: sentMessage.messageIdentifier }));
            } else {
              this._schedule_message(sentMessage);
            }
          });

          // Execute the connectOptions.onSuccess callback if there is one.
          this.connectOptions.onSuccess && this.connectOptions.onSuccess();

          // Process all queued messages now that the connection is established.
          this._process_queue();
          break;

        case MESSAGE_TYPE.PUBLISH:
          this._receivePublish(wireMessage);
          break;

        case MESSAGE_TYPE.PUBACK:
          sentMessage = this._sentMessages[wireMessage.messageIdentifier];
          // If this is a re flow of a PUBACK after we have restarted receivedMessage will not exist.
          if (sentMessage) {
            delete this._sentMessages[wireMessage.messageIdentifier];
            this.storage.removeItem("Sent:" + this._localKey + wireMessage.messageIdentifier);
            if (this.onMessageDelivered)
              this.onMessageDelivered(sentMessage.payloadMessage);
          }
          break;

        case MESSAGE_TYPE.PUBREC:
          sentMessage = this._sentMessages[wireMessage.messageIdentifier];
          // If this is a re flow of a PUBREC after we have restarted receivedMessage will not exist.
          if (sentMessage) {
            sentMessage.pubRecReceived = true;
            const pubRelMessage = new WireMessage(MESSAGE_TYPE.PUBREL, { messageIdentifier: wireMessage.messageIdentifier });
            this.store("Sent:", sentMessage);
            this._schedule_message(pubRelMessage);
          }
          break;

        case MESSAGE_TYPE.PUBREL:
          receivedMessage = this._receivedMessages[wireMessage.messageIdentifier];
          this.storage.removeItem("Received:" + this._localKey + wireMessage.messageIdentifier);
          // If this is a re flow of a PUBREL after we have restarted receivedMessage will not exist.
          if (receivedMessage) {
            this._receiveMessage(receivedMessage);
            delete this._receivedMessages[wireMessage.messageIdentifier];
          }
          // Always flow PubComp, we may have previously flowed PubComp but the server lost it and restarted.
          const pubCompMessage = new WireMessage(MESSAGE_TYPE.PUBCOMP, { messageIdentifier: wireMessage.messageIdentifier });
          this._schedule_message(pubCompMessage);
          break;

        case MESSAGE_TYPE.PUBCOMP:
          sentMessage = this._sentMessages[wireMessage.messageIdentifier];
          delete this._sentMessages[wireMessage.messageIdentifier];
          this.storage.removeItem("Sent:" + this._localKey + wireMessage.messageIdentifier);
          if (this.onMessageDelivered)
            this.onMessageDelivered(sentMessage.payloadMessage);
          break;

        case MESSAGE_TYPE.SUBACK:
          sentMessage = this._sentMessages[wireMessage.messageIdentifier];
          if (sentMessage) {
            if (sentMessage.timeOut)
              clearTimeout(sentMessage.timeOut);
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
          sentMessage = this._sentMessages[wireMessage.messageIdentifier];
          if (sentMessage) {
            if (sentMessage.timeOut) {
              clearTimeout(sentMessage.timeOut);
            }
            if (sentMessage.callback) {
              sentMessage.callback();
            }
            delete this._sentMessages[wireMessage.messageIdentifier];
          }

          break;

        case MESSAGE_TYPE.PINGRESP:
          // The sendPinger or receivePinger may have sent a ping, the receivePinger has already been reset.
          this.sendPinger.reset();
          break;

        case MESSAGE_TYPE.DISCONNECT:
          // Clients do not expect to receive disconnect packets.
          this._disconnected(ERROR.INVALID_MQTT_MESSAGE_TYPE.code, format(ERROR.INVALID_MQTT_MESSAGE_TYPE, [wireMessage.type]));
          break;

        default:
          this._disconnected(ERROR.INVALID_MQTT_MESSAGE_TYPE.code, format(ERROR.INVALID_MQTT_MESSAGE_TYPE, [wireMessage.type]));
      }
    } catch (error) {
      this._disconnected(ERROR.INTERNAL_ERROR.code, format(ERROR.INTERNAL_ERROR, [error.message, error.stack.toString()]));
    }
  };

  /** @ignore */
  _on_socket_error(error) {
    this._disconnected(ERROR.SOCKET_ERROR.code, format(ERROR.SOCKET_ERROR, [error.data || ' Unknown socket error']));
  };

  /** @ignore */
  _on_socket_close() {
    this._disconnected(ERROR.SOCKET_CLOSE.code, format(ERROR.SOCKET_CLOSE));
  };

  /** @ignore */
  _socket_send(wireMessage) {
    const maskedCopy = { ...wireMessage };
    if (maskedCopy.type === 1 && maskedCopy.password) {
      maskedCopy.password = 'REDACTED'
    }
    this._trace("Client._socket_send", maskedCopy);

    this.socket.send(wireMessage.encode());
    /* We have proved to the server we are alive. */
    this.sendPinger.reset();
  };

  /** @ignore */
  _receivePublish(wireMessage) {
    switch (wireMessage.payloadMessage.qos) {
      case 0:
        this._receiveMessage(wireMessage);
        break;

      case 1:
        this._schedule_message(new WireMessage(MESSAGE_TYPE.PUBACK, { messageIdentifier: wireMessage.messageIdentifier }));
        this._receiveMessage(wireMessage);
        break;

      case 2:
        this._receivedMessages[wireMessage.messageIdentifier] = wireMessage;
        this.store("Received:", wireMessage);
        this._schedule_message(new WireMessage(MESSAGE_TYPE.PUBREC, { messageIdentifier: wireMessage.messageIdentifier }));
        break;

      default:
        throw Error("Invaild qos=" + wireMessage.payloadMessage.qos);
    }
  };

  /** @ignore */
  _receiveMessage(wireMessage) {
    if (this.onMessageArrived) {
      this.onMessageArrived(wireMessage.payloadMessage);
    }
  };

  /**
   * Client has disconnected either at its own request or because the server
   * or network disconnected it. Remove all non-durable state.
   * @param {number} [errorCode] the error number.
   * @param {string} [errorText] the error text.
   * @ignore
   */
  _disconnected(errorCode, errorText) {
    this._trace("Client._disconnected", errorCode, errorText);

    this.sendPinger.cancel();
    this.receivePinger.cancel();
    if (this._connectTimeout)
      clearTimeout(this._connectTimeout);
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
      this.socket = null;
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
        this.onConnectionLost && this.onConnectionLost({ errorCode: errorCode, errorMessage: errorText });
      } else {
        // Otherwise we never had a connection, so indicate that the connect has failed.
        if (this.connectOptions.mqttVersion === 4 && this.connectOptions.allowMqttVersionFallback === true) {
          this._trace("Failed to connect V4, dropping back to V3");
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
  _trace() {
    // Pass trace message back to client's callback function
    if (this.traceFunction) {
      for (let i in arguments) {
        if (arguments.hasOwnProperty(i) && typeof arguments[i] !== "undefined")
          arguments[i] = JSON.stringify(arguments[i]);
      }
      this.traceFunction({ severity: "Debug", message: Array.prototype.slice.call(arguments).join("") });
    }

    //buffer style trace
    if (this._traceBuffer !== null) {
      for (let i = 0, max = arguments.length; i < max; i++) {
        if (this._traceBuffer.length === this._MAX_TRACE_ENTRIES) {
          this._traceBuffer.shift();
        }
        if (i === 0) this._traceBuffer.push(arguments[i]);
        else if (typeof arguments[i] === "undefined") this._traceBuffer.push(arguments[i]);
        else this._traceBuffer.push("  " + JSON.stringify(arguments[i]));
      }
    }
  }
}
