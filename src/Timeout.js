/**
 * Monitor request completion.
 * @ignore
 */

export default class Timeout {
  constructor(client, window, timeoutSeconds, action, args) {
    if (!timeoutSeconds)
      timeoutSeconds = 30;

    this.timeout = setTimeout(() => action.apply(client, args), timeoutSeconds * 1000);

    this.cancel.bind(this);
  }

  cancel() {
    clearTimeout(this.timeout);
  }
}
