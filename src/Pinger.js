import WireMessage from "./WireMessage";
import { ERROR, MESSAGE_TYPE } from "./constants";
import { format } from "./util";

/**
 * Repeat keepalive requests, monitor responses.
 * @ignore
 */
export default class {
  constructor(client, keepAliveIntervalMs) {
    this._client = client;
    this._keepAliveInterval = keepAliveIntervalMs;
    this.isReset = false;

    this.pingReq = new WireMessage(MESSAGE_TYPE.PINGREQ).encode();
  }

  _doPing() {
    if (!this.isReset) {
      this._client._trace("Pinger.doPing", "Timed out");
      this._client._disconnected(ERROR.PING_TIMEOUT.code, format(ERROR.PING_TIMEOUT));
    } else {
      this.isReset = false;
      this._client._trace("Pinger.doPing", "send PINGREQ");
      this._client.socket.send(this.pingReq);
      this.timeout = setTimeout(() => this._doPing(), this._keepAliveInterval);
    }
  }

  reset() {
    this.isReset = true;
    clearTimeout(this.timeout);
    if (this._keepAliveInterval > 0)
      this.timeout = setTimeout(() => this._doPing(), this._keepAliveInterval);
  }

  cancel() {
    clearTimeout(this.timeout);
  }
}
