import WireMessage from "./WireMessage";
import { ERROR, MESSAGE_TYPE } from "./constants";
import { format } from "./util";

/**
 * Repeat keepalive requests, monitor responses.
 * @ignore
 */
export default class {
  constructor(client, window, keepAliveInterval) {
    this._client = client;
    this._keepAliveInterval = keepAliveInterval * 1000;
    this.isReset = false;

    let pingReq = new WireMessage(MESSAGE_TYPE.PINGREQ).encode();

    /** @ignore */
    const doPing = () => {
      if (!this.isReset) {
        this._client._trace("Pinger.doPing", "Timed out");
        this._client._disconnected(ERROR.PING_TIMEOUT.code, format(ERROR.PING_TIMEOUT));
      } else {
        this.isReset = false;
        this._client._trace("Pinger.doPing", "send PINGREQ");
        this._client.socket.send(pingReq);
        this.timeout = setTimeout(() => doPing(), this._keepAliveInterval);
      }
    }


    this.cancel.bind(this);
    this.reset.bind(this);
  }

  reset() {
    this.isReset = true;
    clearTimeout(this.timeout);
    if (this._keepAliveInterval > 0)
      this.timeout = setTimeout(() => doPing(), this._keepAliveInterval);
  }

  cancel() {
    clearTimeout(this.timeout);
  }
}