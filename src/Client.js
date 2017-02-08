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

/**
 * Send and receive messages using web browsers.
 * <p>
 * This programming interface lets a JavaScript client application use the MQTT V3.1 or
 * V3.1.1 protocol to connect to an MQTT-supporting messaging server.
 *
 * The function supported includes:
 * <ol>
 * <li>Connecting to and disconnecting from a server. The server is identified by its host name and port number.
 * <li>Specifying options that relate to the communications link with the server,
 * for example the frequency of keep-alive heartbeats, and whether SSL/TLS is required.
 * <li>Subscribing to and receiving messages from MQTT Topics.
 * <li>Publishing messages to MQTT Topics.
 * </ol>
 * <p>
 * The API consists of two main objects:
 * <dl>
 * <dt><b>{@link Client}</b></dt>
 * <dd>This contains methods that provide the functionality of the API,
 * including provision of callbacks that notify the application when a message
 * arrives from or is delivered to the messaging server,
 * or when the status of its connection to the messaging server changes.</dd>
 * <dt><b>{@link Message}</b></dt>
 * <dd>This encapsulates the payload of the message along with letious attributes
 * associated with its delivery, in particular the destination to which it has
 * been (or is about to be) sent.</dd>
 * </dl>
 * <p>
 * The programming interface validates parameters passed to it, and will throw
 * an Error containing an error message intended for developer use, if it detects
 * an error with any parameter.
 * <p>
 * Example:
 *
 * <code><pre>
 client = new Client(location.hostname, Number(location.port), "clientId");
 client.onConnectionLost = onConnectionLost;
 client.onMessageArrived = onMessageArrived;
 client.connect({onSuccess:onConnect});

 function onConnect() {
  // Once a connection has been made, make a subscription and send a message.
  console.log("onConnect");
  client.subscribe("/World");
  message = new Message("Hello");
  message.destinationName = "/World";
  client.send(message);
};
 function onConnectionLost(responseObject) {
  if (responseObject.errorCode !== 0)
	console.log("onConnectionLost:"+responseObject.errorMessage);
};
 function onMessageArrived(message) {
  console.log("onMessageArrived:"+message.payloadString);
  client.disconnect();
};
 * </pre></code>
 * @namespace Paho.MQTT
 */


// ------------------------------------------------------------------------
// Public Programming interface.
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
export default Client = function ({ host, port, path = '/mqtt', clientId, storage, webSocket }) {

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

    let ipv6AddSBracket = (host.indexOf(":") != -1 && host.slice(0, 1) != "[" && host.slice(-1) != "]");
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

  let client = new ClientImpl(uri, host, port, path, clientId, storage, webSocket);
  this._getHost = function () {
    return host;
  };
  this._setHost = function () {
    throw new Error(format(ERROR.UNSUPPORTED_OPERATION));
  };

  this._getPort = function () {
    return port;
  };
  this._setPort = function () {
    throw new Error(format(ERROR.UNSUPPORTED_OPERATION));
  };

  this._getPath = function () {
    return path;
  };
  this._setPath = function () {
    throw new Error(format(ERROR.UNSUPPORTED_OPERATION));
  };

  this._getURI = function () {
    return uri;
  };
  this._setURI = function () {
    throw new Error(format(ERROR.UNSUPPORTED_OPERATION));
  };

  this._getClientId = function () {
    return client.clientId;
  };
  this._setClientId = function () {
    throw new Error(format(ERROR.UNSUPPORTED_OPERATION));
  };

  this._getOnConnectionLost = function () {
    return client.onConnectionLost;
  };
  this._setOnConnectionLost = function (newOnConnectionLost) {
    if (typeof newOnConnectionLost === "function")
      client.onConnectionLost = newOnConnectionLost;
    else
      throw new Error(format(ERROR.INVALID_TYPE, [typeof newOnConnectionLost, "onConnectionLost"]));
  };

  this._getOnMessageDelivered = function () {
    return client.onMessageDelivered;
  };
  this._setOnMessageDelivered = function (newOnMessageDelivered) {
    if (typeof newOnMessageDelivered === "function")
      client.onMessageDelivered = newOnMessageDelivered;
    else
      throw new Error(format(ERROR.INVALID_TYPE, [typeof newOnMessageDelivered, "onMessageDelivered"]));
  };

  this._getOnMessageArrived = function () {
    return client.onMessageArrived;
  };
  this._setOnMessageArrived = function (newOnMessageArrived) {
    if (typeof newOnMessageArrived === "function")
      client.onMessageArrived = newOnMessageArrived;
    else
      throw new Error(format(ERROR.INVALID_TYPE, [typeof newOnMessageArrived, "onMessageArrived"]));
  };

  this._getTrace = function () {
    return client.traceFunction;
  };
  this._setTrace = function (trace) {
    if (typeof trace === "function") {
      client.traceFunction = trace;
    } else {
      throw new Error(format(ERROR.INVALID_TYPE, [typeof trace, "onTrace"]));
    }
  };

  /**
   * Connect this Messaging client to its server.
   *
   * @name Client#connect
   * @function
   * @param {Object} connectOptions - attributes used with the connection.
   * @param {number} connectOptions.timeout - If the connect has not succeeded within this
   *                    number of seconds, it is deemed to have failed.
   *                    The default is 30 seconds.
   * @param {string} connectOptions.userName - Authentication username for this connection.
   * @param {string} connectOptions.password - Authentication password for this connection.
   * @param {Message} connectOptions.willMessage - sent by the server when the client
   *                    disconnects abnormally.
   * @param {Number} connectOptions.keepAliveInterval - the server disconnects this client if
   *                    there is no activity for this number of seconds.
   *                    The default value of 60 seconds is assumed if not set.
   * @param {boolean} connectOptions.cleanSession - if true(default) the client and server
   *                    persistent state is deleted on successful connect.
   * @param {boolean} connectOptions.useSSL - if present and true, use an SSL Websocket connection.
   * @param {object} connectOptions.invocationContext - passed to the onSuccess callback or onFailure callback.
   * @param {function} connectOptions.onSuccess - called when the connect acknowledgement
   *                    has been received from the server.
   * A single response object parameter is passed to the onSuccess callback containing the following fields:
   * <ol>
   * <li>invocationContext as passed in to the onSuccess method in the connectOptions.
   * </ol>
   * @config {function} [onFailure] called when the connect request has failed or timed out.
   * A single response object parameter is passed to the onFailure callback containing the following fields:
   * <ol>
   * <li>invocationContext as passed in to the onFailure method in the connectOptions.
   * <li>errorCode a number indicating the nature of the error.
   * <li>errorMessage text describing the error.
   * </ol>
   * @config {Array} [hosts] If present this contains either a set of hostnames or fully qualified
   * WebSocket URIs (ws://example.com:1883/mqtt), that are tried in order in place
   * of the host and port paramater on the construtor. The hosts are tried one at at time in order until
   * one of then succeeds.
   * @config {Array} [ports] If present the set of ports matching the hosts. If hosts contains URIs, this property
   * is not used.
   * @throws {InvalidState} if the client is not in disconnected state. The client must have received connectionLost
   * or disconnected before calling connect for a second or subsequent time.
   */
  this.connect = function (connectOptions) {
    connectOptions = connectOptions || {};
    validate(connectOptions, {
      timeout: "number",
      userName: "string",
      password: "string",
      willMessage: "object",
      keepAliveInterval: "number",
      cleanSession: "boolean",
      useSSL: "boolean",
      hosts: "object",
      ports: "object",
      mqttVersion: "number",
      mqttVersionExplicit: "boolean",
      uris: "object"
    });

    // If no keep alive interval is set, assume 60 seconds.
    if (connectOptions.keepAliveInterval === undefined)
      connectOptions.keepAliveInterval = 60;

    if (connectOptions.mqttVersion > 4 || connectOptions.mqttVersion < 3) {
      throw new Error(format(ERROR.INVALID_ARGUMENT, [connectOptions.mqttVersion, "connectOptions.mqttVersion"]));
    }

    if (connectOptions.mqttVersion === undefined) {
      connectOptions.mqttVersionExplicit = false;
      connectOptions.mqttVersion = 4;
    } else {
      connectOptions.mqttVersionExplicit = true;
    }

    //Check that if password is set, so is username
    if (connectOptions.password !== undefined && connectOptions.userName === undefined)
      throw new Error(format(ERROR.INVALID_ARGUMENT, [connectOptions.password, "connectOptions.password"]))

    if (connectOptions.willMessage) {
      if (!(connectOptions.willMessage instanceof Message))
        throw new Error(format(ERROR.INVALID_TYPE, [connectOptions.willMessage, "connectOptions.willMessage"]));
      // The will message must have a payload that can be represented as a string.
      // Cause the willMessage to throw an exception if this is not the case.
      connectOptions.willMessage.stringPayload;

      if (typeof connectOptions.willMessage.destinationName === "undefined")
        throw new Error(format(ERROR.INVALID_TYPE, [typeof connectOptions.willMessage.destinationName, "connectOptions.willMessage.destinationName"]));
    }
    if (typeof connectOptions.cleanSession === "undefined")
      connectOptions.cleanSession = true;
    if (connectOptions.hosts) {

      if (!(connectOptions.hosts instanceof Array))
        throw new Error(format(ERROR.INVALID_ARGUMENT, [connectOptions.hosts, "connectOptions.hosts"]));
      if (connectOptions.hosts.length < 1)
        throw new Error(format(ERROR.INVALID_ARGUMENT, [connectOptions.hosts, "connectOptions.hosts"]));

      let usingURIs = false;
      for (let i = 0; i < connectOptions.hosts.length; i++) {
        if (typeof connectOptions.hosts[i] !== "string")
          throw new Error(format(ERROR.INVALID_TYPE, [typeof connectOptions.hosts[i], "connectOptions.hosts[" + i + "]"]));
        if (/^(wss?):\/\/((\[(.+)\])|([^\/]+?))(:(\d+))?(\/.*)$/.test(connectOptions.hosts[i])) {
          if (i == 0) {
            usingURIs = true;
          } else if (!usingURIs) {
            throw new Error(format(ERROR.INVALID_ARGUMENT, [connectOptions.hosts[i], "connectOptions.hosts[" + i + "]"]));
          }
        } else if (usingURIs) {
          throw new Error(format(ERROR.INVALID_ARGUMENT, [connectOptions.hosts[i], "connectOptions.hosts[" + i + "]"]));
        }
      }

      if (!usingURIs) {
        if (!connectOptions.ports)
          throw new Error(format(ERROR.INVALID_ARGUMENT, [connectOptions.ports, "connectOptions.ports"]));
        if (!(connectOptions.ports instanceof Array))
          throw new Error(format(ERROR.INVALID_ARGUMENT, [connectOptions.ports, "connectOptions.ports"]));
        if (connectOptions.hosts.length !== connectOptions.ports.length)
          throw new Error(format(ERROR.INVALID_ARGUMENT, [connectOptions.ports, "connectOptions.ports"]));

        connectOptions.uris = [];

        for (let i = 0; i < connectOptions.hosts.length; i++) {
          if (typeof connectOptions.ports[i] !== "number" || connectOptions.ports[i] < 0)
            throw new Error(format(ERROR.INVALID_TYPE, [typeof connectOptions.ports[i], "connectOptions.ports[" + i + "]"]));
          let host = connectOptions.hosts[i];
          let port = connectOptions.ports[i];

          let ipv6 = (host.indexOf(":") !== -1);
          uri = "ws://" + (ipv6 ? "[" + host + "]" : host) + ":" + port + path;
          connectOptions.uris.push(uri);
        }
      } else {
        connectOptions.uris = connectOptions.hosts;
      }
    }


    return new Promise((resolve, reject) => {
      connectOptions.onSuccess = resolve;
      connectOptions.onFailure = reject;
      client.connect(connectOptions);
    });
  };

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
  this.subscribe = function (filter, subscribeOptions) {
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
      client.subscribe(filter, subscribeOptions);
    });
  };

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
  this.unsubscribe = function (filter, unsubscribeOptions) {
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
      client.unsubscribe(filter, unsubscribeOptions);
    });
  };

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
  this.send = function (topic, payload, qos, retained) {
    let message;

    if (arguments.length == 0) {
      throw new Error("Invalid argument." + "length");

    } else if (arguments.length == 1) {

      if (!(topic instanceof Message) && (typeof topic !== "string"))
        throw new Error("Invalid argument:" + typeof topic);

      message = topic;
      if (typeof message.destinationName === "undefined")
        throw new Error(format(ERROR.INVALID_ARGUMENT, [message.destinationName, "Message.destinationName"]));
      client.send(message);

    } else {
      //parameter checking in Message object
      message = new Message(payload);
      message.destinationName = topic;
      if (arguments.length >= 3)
        message.qos = qos;
      if (arguments.length >= 4)
        message.retained = retained;
      client.send(message);
    }
  };

  /**
   * Normal disconnect of this Messaging client from its server.
   *
   * @name Client#disconnect
   * @function
   * @throws {InvalidState} if the client is already disconnected.
   */
  this.disconnect = function () {
    client.disconnect();
  };

  /**
   * Get the contents of the trace log.
   *
   * @name Client#getTraceLog
   * @function
   * @return {Object[]} tracebuffer containing the time ordered trace records.
   */
  this.getTraceLog = function () {
    return client.getTraceLog();
  }

  /**
   * Start tracing.
   *
   * @name Client#startTrace
   * @function
   */
  this.startTrace = function () {
    client.startTrace();
  };

  /**
   * Stop tracing.
   *
   * @name Client#stopTrace
   * @function
   */
  this.stopTrace = function () {
    client.stopTrace();
  };

  this.isConnected = function () {
    return client.connected;
  };
};

Client.prototype = {
  get host() {
    return this._getHost();
  },
  set host(newHost) {
    this._setHost(newHost);
  },

  get port() {
    return this._getPort();
  },
  set port(newPort) {
    this._setPort(newPort);
  },

  get path() {
    return this._getPath();
  },
  set path(newPath) {
    this._setPath(newPath);
  },

  get clientId() {
    return this._getClientId();
  },
  set clientId(newClientId) {
    this._setClientId(newClientId);
  },

  get onConnectionLost() {
    return this._getOnConnectionLost();
  },
  set onConnectionLost(newOnConnectionLost) {
    this._setOnConnectionLost(newOnConnectionLost);
  },

  get onMessageDelivered() {
    return this._getOnMessageDelivered();
  },
  set onMessageDelivered(newOnMessageDelivered) {
    this._setOnMessageDelivered(newOnMessageDelivered);
  },

  get onMessageArrived() {
    return this._getOnMessageArrived();
  },
  set onMessageArrived(newOnMessageArrived) {
    this._setOnMessageArrived(newOnMessageArrived);
  },

  get trace() {
    return this._getTrace();
  },
  set trace(newTraceFunction) {
    this._setTrace(newTraceFunction);
  }

};
