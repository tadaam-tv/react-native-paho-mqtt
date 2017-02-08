/**
 * Monitor request completion.
 * @ignore
 */

export default class Timeout {
  constructor(client, timeoutMs, action, args) {
    if (!timeoutMs)
      timeoutMs = 30000;

    this.timeout = setTimeout(() => action.apply(client, args), timeoutMs);

    this.cancel.bind(this);
  }

  cancel() {
    clearTimeout(this.timeout);
  }
}
