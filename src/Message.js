/* @flow */

import { format, lengthOfUTF8, parseUTF8, stringToUTF8 } from './util';
import { ERROR } from './constants';

type Payload = string | Uint8Array;

/**
 * An application message, sent or received.
 * <p>
 * All attributes may be null, which implies the default values.
 *
 * @name Message
 * @constructor
 * @param {String|ArrayBuffer} newPayload The message data to be sent.
 * <p>
 * @property {string} payloadString <i>read only</i> The payload as a string if the payload consists of valid UTF-8 characters.
 * @property {ArrayBuffer} payloadBytes <i>read only</i> The payload as an ArrayBuffer.
 * <p>
 * @property {string} destinationName <b>mandatory</b> The name of the destination to which the message is to be sent
 *                    (for messages about to be sent) or the name of the destination from which the message has been received.
 *                    (for messages received by the onMessage function).
 * <p>
 * @property {number} qos The Quality of Service used to deliver the message.
 * <dl>
 *     <dt>0 Best effort (default).
 *     <dt>1 At least once.
 *     <dt>2 Exactly once.
 * </dl>
 * <p>
 * @property {Boolean} retained If true, the message is to be retained by the server and delivered
 *                     to both current and future subscriptions.
 *                     If false the server only delivers the message to current subscribers, this is the default for new Messages.
 *                     A received message has the retained boolean set to true if the message was published
 *                     with the retained boolean set to true
 *                     and the subscrption was made after the message has been published.
 * <p>
 * @property {Boolean} duplicate <i>read only</i> If true, this message might be a duplicate of one which has already been received.
 *                     This is only set on messages received from the server.
 *
 */
export default class {
  _payload: Payload;
  _destinationName: string;
  _qos: 0 | 1 | 2 = 0;
  _retained: boolean = false;
  _duplicate: boolean = false;

  constructor(newPayload: Payload) {
    if (!(typeof newPayload === 'string'
        || newPayload instanceof Uint8Array
      )) {
      throw (format(ERROR.INVALID_ARGUMENT, [newPayload.toString(), 'newPayload']));
    }
    this._payload = newPayload;
  }

  get payloadString(): string {
    if (typeof this._payload === 'string') {
      return this._payload;
    } else {
      return parseUTF8(this._payload, 0, this._payload.byteLength);
    }
  }

  get payloadBytes(): Uint8Array {
    const payload = this._payload;
    if (typeof payload === 'string') {
      const buffer = new ArrayBuffer(lengthOfUTF8(payload));
      const byteStream = new Uint8Array(buffer);
      stringToUTF8(payload, byteStream, 0);

      return byteStream;
    } else {
      return payload;
    }
  }

  get destinationName(): string {
    return this._destinationName;
  }

  set destinationName(newDestinationName: string) {
    if (typeof newDestinationName === 'string') {
      this._destinationName = newDestinationName;
    } else {
      throw new Error(format(ERROR.INVALID_ARGUMENT, [newDestinationName, 'newDestinationName']));
    }
  }

  get qos(): 0 | 1 | 2 {
    return this._qos;
  }

  set qos(newQos: 0 | 1 | 2) {
    if (newQos === 0 || newQos === 1 || newQos === 2) {
      this._qos = newQos;
    } else {
      throw new Error('Invalid argument:' + newQos);
    }
  }

  get retained(): boolean {
    return this._retained;
  }

  set retained(newRetained: boolean) {
    if (typeof newRetained === 'boolean') {
      this._retained = newRetained;
    } else {
      throw new Error(format(ERROR.INVALID_ARGUMENT, [newRetained, 'newRetained']));
    }
  }

  get duplicate(): boolean {
    return this._duplicate;
  }

  set duplicate(newDuplicate: boolean) {
    if (typeof newDuplicate === 'boolean') {
      this._duplicate = newDuplicate;
    } else {
      throw new Error(format(ERROR.INVALID_ARGUMENT, [newDuplicate, 'newDuplicate']));
    }
  }
}
