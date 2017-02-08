/*******************************************************************************
 * Copyright (c) 2013 IBM Corp.
 *
 * All rights reserved. This program and the accompanying materials
 * are made available under the terms of the Eclipse Public License v1.0
 * and Eclipse Distribution License v1.0 which accompany this distribution.
 *
 * The Eclipse Public License is available at
 *    http://www.eclipse.org/legal/epl-v10.html
 * and the Eclipse Distribution License is available at
 *   http://www.eclipse.org/org/documents/edl-v10.php.
 *
 * Contributors:
 *    Andrew Banks - initial API and implementation and initial documentation
 *******************************************************************************/

import { ClientImpl } from "./ClientImpl";
import Message from "./Message";
import { format, validate } from "./util";
import { ERROR } from "./constants";
import { EventEmitter } from "events";

// ------------------------------------------------------------------------
// Public API.
// ------------------------------------------------------------------------

/**
 * The JavaScript application communicates to the server using a {@link Client} object.
 * <p>
 * Most applications will create just one Client object and then call its connect() method,
 * however applications can create more than one Client object if they wish.
 * In this case the combination of host, port and clientId attributes must be different for each Client object.
 * <p>
 * The send, subscribe and unsubscribe methods are implemented as asynchronous JavaScript methods
 * (even though the underlying protocol exchange might be synchronous in nature).
 * This means they signal their completion by calling back to the application,
 * via Success or Failure callback functions provided by the application on the method in question.
 * Such callbacks are called at most once per method invocation and do not persist beyond the lifetime
 * of the script that made the invocation.
 * <p>
 * In contrast there are some callback functions, most notably <i>onMessageArrived</i>,
 * that are defined on the {@link Client} object.
 * These may get called multiple times, and aren't directly related to specific method invocations made by the client.
 *
 * @name Client
 *
 * @constructor
 *
 * @param {string} host - the address of the messaging server, as a fully qualified WebSocket URI, as a DNS name or dotted decimal IP address.
 * @param {number} port - the port number to connect to - only required if host is not a URI
 * @param {string} path - the path on the host to connect to - only used if host is not a URI. Default: '/mqtt'.
 * @param {string} clientId - the Messaging client identifier, between 1 and 23 characters in length.
 * @param {Object} storage - object implementing getItem, setItem, removeItem in a manner compatible with localStorage
 *
 * @property {string} host - <i>read only</i> the server's DNS hostname or dotted decimal IP address.
 * @property {number} port - <i>read only</i> the server's port.
 * @property {string} path - <i>read only</i> the server's path.
 * @property {string} clientId - <i>read only</i> used when connecting to the server.
 * @property {function} onConnectionLost - called when a connection has been lost.
 *                            after a connect() method has succeeded.
 *                            Establish the call back used when a connection has been lost. The connection may be
 *                            lost because the client initiates a disconnect or because the server or network
 *                            cause the client to be disconnected. The disconnect call back may be called without
 *                            the connectionComplete call back being invoked if, for example the client fails to
 *                            connect.
 *                            A single response object parameter is passed to the onConnectionLost callback containing the following fields:
 *                            <ol>
 *                            <li>errorCode
 *                            <li>errorMessage
 *                            </ol>
 * @property {function} onMessageDelivered called when a message has been delivered.
 *                            All processing that this Client will ever do has been completed. So, for example,
 *                            in the case of a Qos=2 message sent by this client, the PubComp flow has been received from the server
 *                            and the message has been removed from persistent storage before this callback is invoked.
 *                            Parameters passed to the onMessageDelivered callback are:
 *                            <ol>
 *                            <li>{@link Message} that was delivered.
 *                            </ol>
 * @property {function} onMessageArrived called when a message has arrived in this Client.
 *                            Parameters passed to the onMessageArrived callback are:
 *                            <ol>
 *                            <li>{@link Message} that has arrived.
 *                            </ol>
 */
export default class Client extends EventEmitter {
  constructor({ host, port, path = '/mqtt', clientId, storage, webSocket }) {
    super();
    let uri;

    if (typeof host !== "string")
      throw new Error(format(ERROR.INVALID_TYPE, [typeof host, "host"]));

    if (!port) {
      // host: must be full ws:// uri
      uri = host;
      let match = uri.match(/^(wss?):\/\/((\[(.+)\])|([^\/]+?))(:(\d+))?(\/.*)$/);
      if (match) {
        host = match[4] || match[2];
        port = parseInt(match[7]);
        path = match[8];
      } else {
        throw new Error(format(ERROR.INVALID_ARGUMENT, [host, "host"]));
      }
    } else {
      if (!path) {
        path = "/mqtt";
      }
      if (typeof port !== "number" || port < 0)
        throw new Error(format(ERROR.INVALID_TYPE, [typeof port, "port"]));
      if (typeof path !== "string")
        throw new Error(format(ERROR.INVALID_TYPE, [typeof path, "path"]));

      const ipv6AddSBracket = (host.indexOf(":") !== -1 && host.slice(0, 1) !== "[" && host.slice(-1) !== "]");
      uri = "ws://" + (ipv6AddSBracket ? "[" + host + "]" : host) + ":" + port + path;
    }

    let clientIdLength = 0;
    for (let i = 0; i < clientId.length; i++) {
      let charCode = clientId.charCodeAt(i);
      if (0xD800 <= charCode && charCode <= 0xDBFF) {
        i++; // Surrogate pair.
      }
      clientIdLength++;
    }
    if (typeof clientId !== "string" || clientIdLength > 65535)
      throw new Error(format(ERROR.INVALID_ARGUMENT, [clientId, "clientId"]));

    this._client = new ClientImpl(uri, host, port, path, clientId, storage, webSocket);
    this._client.onMessageDelivered = (e) => this.emit('messageDelivered', e);
    this._client.onMessageArrived = (e) => this.emit('messageReceived', e);
    this._client.onConnectionLost = (e) => this.emit('connectionLost', e);
  }

  /**
   * Connect this Messaging client to its server.
   *
   * @name Client#connect
   * @function
   * @param {number} [timeout=30000] - Fail if not connected within this time
   * @param {string} [userName] - Authentication username for this connection.
   * @param {string} [password] - Authentication password for this connection.
   * @param {Message} [willMessage] - sent by the server when the client disconnects abnormally.
   * @param {number} [keepAliveInterval=60000] - ping the server every n ms to avoid being disconnected by the remote end.
   * @param {number} [mqttVersion=4] - protocol version to use (3 or 4).
   * @param {number} [allowMqttVersionFallback=true] - if mqttVersion==4 and connecting fails, try version 3.
   * @param {boolean} [cleanSession=true] - if true the client and server persistent state is deleted on successful connect.
   * @param {boolean} [useSSL=false] - use an SSL Websocket connection if true.
   * @param {string[]} [uris] If present this contains either a set of fully qualified
   *  WebSocket URIs (ws://example.com:1883/mqtt), that are tried in order in place
   *  of the constructor's configuration. The hosts are tried one at at time in order until
   *  one of them succeeds.
   */
  connect({
    userName,
    password,
    willMessage,
    timeout = 30000,
    keepAliveInterval = 60000,
    useSSL = false,
    cleanSession = true,
    mqttVersion = 4,
    allowMqttVersionFallback = true,
    uris
  } = {}) {
    validate({
      userName,
      password,
      willMessage,
      timeout,
      keepAliveInterval,
      useSSL,
      cleanSession,
      mqttVersion,
      allowMqttVersionFallback,
      uris
    }, {
      timeout: "number",
      userName: "?string",
      password: "?string",
      willMessage: "?object",
      keepAliveInterval: "number",
      cleanSession: "boolean",
      useSSL: "boolean",
      mqttVersion: "number",
      allowMqttVersionFallback: "boolean",
      uris: "?object"
    });

    return new Promise((resolve, reject) => {

      if (mqttVersion > 4 || mqttVersion < 3) {
        throw new Error(format(ERROR.INVALID_ARGUMENT, [mqttVersion, "mqttVersion"]));
      }

      //Check that if password is set, so is username
      if (password !== undefined && userName === undefined)
        throw new Error(format(ERROR.INVALID_ARGUMENT, [password, "password"]))

      if (willMessage) {
        if (!(willMessage instanceof Message))
          throw new Error(format(ERROR.INVALID_TYPE, [willMessage, "willMessage"]));
        // The will message must have a payload that can be represented as a string.
        // Cause the willMessage to throw an exception if this is not the case.
        willMessage.stringPayload;

        if (typeof willMessage.destinationName === "undefined")
          throw new Error(format(ERROR.INVALID_TYPE, [typeof willMessage.destinationName, "willMessage.destinationName"]));
      }

      if (uris) {
        if (!Array.isArray(uris) || uris.length < 1)
          throw new Error(format(ERROR.INVALID_ARGUMENT, [uris, "uris"]));

        // Validate that all hosts are URIs, or none are, and validate the corresponding port
        uris.forEach((host) => {
          if (/^(wss?):\/\/((\[(.+)\])|([^\/]+?))(:(\d+))?(\/.*)$/.test(host) !== usingURIs) {
            throw new Error(format(ERROR.INVALID_ARGUMENT, [host, "hosts[" + i + "]"]));
          }
        });
      }


      this._client.connect({
        userName,
        password,
        willMessage,
        timeout,
        keepAliveInterval,
        useSSL,
        cleanSession,
        mqttVersion,
        allowMqttVersionFallback,
        uris,
        onSuccess: resolve,
        onFailure: reject
      });
    });
  }

  /**
   * Subscribe for messages, request receipt of a copy of messages sent to the destinations described by the filter.
   *
   * @name Client#subscribe
   * @function
   * @param {string} filter describing the destinations to receive messages from.
   * <br>
   * @param {object} subscribeOptions - used to control the subscription
   *
   * @param {number} subscribeOptions.qos - the maiximum qos of any publications sent
   *                                  as a result of making this subscription.
   * @param {object} subscribeOptions.invocationContext - passed to the onSuccess callback
   *                                  or onFailure callback.
   * @param {function} subscribeOptions.onSuccess - called when the subscribe acknowledgement
   *                                  has been received from the server.
   *                                  A single response object parameter is passed to the onSuccess callback containing the following fields:
   *                                  <ol>
   *                                  <li>invocationContext if set in the subscribeOptions.
   *                                  </ol>
   * @param {function} subscribeOptions.onFailure - called when the subscribe request has failed or timed out.
   *                                  A single response object parameter is passed to the onFailure callback containing the following fields:
   *                                  <ol>
   *                                  <li>invocationContext - if set in the subscribeOptions.
   *                                  <li>errorCode - a number indicating the nature of the error.
   *                                  <li>errorMessage - text describing the error.
   *                                  </ol>
   * @param {number} subscribeOptions.timeout - which, if present, determines the number of
   *                                  seconds after which the onFailure calback is called.
   *                                  The presence of a timeout does not prevent the onSuccess
   *                                  callback from being called when the subscribe completes.
   * @throws {InvalidState} if the client is not in connected state.
   */
  subscribe(filter, subscribeOptions) {
    if (typeof filter !== "string")
      throw new Error("Invalid argument:" + filter);
    subscribeOptions = subscribeOptions || {};
    validate(subscribeOptions, {
      qos: "number",
      timeout: "number"
    });

    if (typeof subscribeOptions.qos !== "undefined"
      && !(subscribeOptions.qos === 0 || subscribeOptions.qos === 1 || subscribeOptions.qos === 2 ))
      throw new Error(format(ERROR.INVALID_ARGUMENT, [subscribeOptions.qos, "subscribeOptions.qos"]));

    return new Promise((resolve, reject) => {
      subscribeOptions.onSuccess = resolve;
      subscribeOptions.onFailure = reject;
      this._client.subscribe(filter, subscribeOptions);
    });
  }

  /**
   * Unsubscribe for messages, stop receiving messages sent to destinations described by the filter.
   *
   * @name Client#unsubscribe
   * @function
   * @param {string} filter - describing the destinations to receive messages from.
   * @param {object} unsubscribeOptions - used to control the subscription
   * @param {object} unsubscribeOptions.invocationContext - passed to the onSuccess callback
   or onFailure callback.
   * @param {function} unsubscribeOptions.onSuccess - called when the unsubscribe acknowledgement has been received from the server.
   *                                    A single response object parameter is passed to the
   *                                    onSuccess callback containing the following fields:
   *                                    <ol>
   *                                    <li>invocationContext - if set in the unsubscribeOptions.
   *                                    </ol>
   * @param {function} unsubscribeOptions.onFailure called when the unsubscribe request has failed or timed out.
   *                                    A single response object parameter is passed to the onFailure callback containing the following fields:
   *                                    <ol>
   *                                    <li>invocationContext - if set in the unsubscribeOptions.
   *                                    <li>errorCode - a number indicating the nature of the error.
   *                                    <li>errorMessage - text describing the error.
   *                                    </ol>
   * @param {number} unsubscribeOptions.timeout - which, if present, determines the number of seconds
   *                                    after which the onFailure callback is called. The presence of
   *                                    a timeout does not prevent the onSuccess callback from being
   *                                    called when the unsubscribe completes
   * @throws {InvalidState} if the client is not in connected state.
   */
  unsubscribe(filter, unsubscribeOptions) {
    if (typeof filter !== "string")
      throw new Error("Invalid argument:" + filter);
    unsubscribeOptions = unsubscribeOptions || {};
    validate(unsubscribeOptions, {
      invocationContext: "object",
      timeout: "number"
    });

    return new Promise((resolve, reject) => {
      unsubscribeOptions.onSuccess = resolve;
      unsubscribeOptions.onFailure = reject;
      this._client.unsubscribe(filter, unsubscribeOptions);
    });
  }

  /**
   * Send a message to the consumers of the destination in the Message.
   *
   * @name Client#send
   * @function
   * @param {string|Message} topic - <b>mandatory</b> The name of the destination to which the message is to be sent.
   *             - If it is the only parameter, used as Message object.
   * @param {String|ArrayBuffer} payload - The message data to be sent.
   * @param {number} qos The Quality of Service used to deliver the message.
   *    <dl>
   *      <dt>0 Best effort (default).
   *          <dt>1 At least once.
   *          <dt>2 Exactly once.
   *    </dl>
   * @param {Boolean} retained If true, the message is to be retained by the server and delivered
   *                     to both current and future subscriptions.
   *                     If false the server only delivers the message to current subscribers, this is the default for new Messages.
   *                     A received message has the retained boolean set to true if the message was published
   *                     with the retained boolean set to true
   *                     and the subscrption was made after the message has been published.
   * @throws {InvalidState} if the client is not connected.
   */
  send(topic, payload, qos, retained) {
    let message;

    if (arguments.length == 0) {
      throw new Error("Invalid argument." + "length");

    } else if (arguments.length == 1) {

      if (!(topic instanceof Message) && (typeof topic !== "string"))
        throw new Error("Invalid argument:" + typeof topic);

      message = topic;
      if (typeof message.destinationName === "undefined")
        throw new Error(format(ERROR.INVALID_ARGUMENT, [message.destinationName, "Message.destinationName"]));
      this._client.send(message);

    } else {
      //parameter checking in Message object
      message = new Message(payload);
      message.destinationName = topic;
      if (arguments.length >= 3)
        message.qos = qos;
      if (arguments.length >= 4)
        message.retained = retained;
      this._client.send(message);
    }
  }

  /**
   * Normal disconnect of this Messaging client from its server.
   *
   * @name Client#disconnect
   * @function
   * @throws {InvalidState} if the client is already disconnected.
   */
  disconnect() {
    return new Promise((resolve, reject) => {
      this.once('connectionLost', (error) => {
        if (error && error.errorCode !== 0) {
          return reject(error);
        }
        resolve();
      });
      this._client.disconnect();
    });
  }

  /**
   * Get the contents of the trace log.
   *
   * @name Client#getTraceLog
   * @function
   * @return {Object[]} tracebuffer containing the time ordered trace records.
   */
  getTraceLog() {
    return this._client.getTraceLog();
  }

  /**
   * Start tracing.
   *
   * @name Client#startTrace
   * @function
   */
  startTrace() {
    this._client.startTrace();
  };

  /**
   * Stop tracing.
   *
   * @name Client#stopTrace
   * @function
   */
  stopTrace() {
    this._client.stopTrace();
  }

  isConnected() {
    return this._client.connected;
  }

  get host() {
    return this._client.host;
  }

  get port() {
    return this._client.port;
  }

  get path() {
    return this._client.path;
  }

  get clientId() {
    return this._client.clientId;
  }

  get trace() {
    return this._client.traceFunction;
  }

  set trace(trace) {
    if (typeof trace === "function") {
      this._client.traceFunction = trace;
    } else {
      throw new Error(format(ERROR.INVALID_TYPE, [typeof trace, "onTrace"]));
    }
  }
};
