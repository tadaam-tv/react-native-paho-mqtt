/* @flow */

import WireMessage from './WireMessage';
import { ERROR, MESSAGE_TYPE } from './constants';
import { format } from './util';
import ClientImplementation from './ClientImplementation';

/**
 * Repeat keepalive requests, monitor responses.
 * @ignore
 */
export default class {
  _client: ClientImplementation;
  _keepAliveInterval: number;
  isReset: boolean = false;
  pingReq: ArrayBuffer = new WireMessage(MESSAGE_TYPE.PINGREQ).encode();
  timeout: ?number;

  constructor(client: ClientImplementation, keepAliveIntervalMs: number) {
    this._client = client;
    this._keepAliveInterval = keepAliveIntervalMs;
    this.reset();
  }

  _doPing() {
    if (!this.isReset) {
      this._client._trace('Pinger.doPing', 'Timed out');
      this._client._disconnected(ERROR.PING_TIMEOUT.code, format(ERROR.PING_TIMEOUT));
    } else {
      this.isReset = false;
      this._client._trace('Pinger.doPing', 'send PINGREQ');
      this._client.socket && this._client.socket.send(this.pingReq);
      this.timeout = setTimeout(() => this._doPing(), this._keepAliveInterval);
    }
  }

  reset() {
    this.isReset = true;
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    if (this._keepAliveInterval > 0) {
      this.timeout = setTimeout(() => this._doPing(), this._keepAliveInterval);
    }
  }

  cancel() {
    clearTimeout(this.timeout);
    this.timeout = null;
  }
}
