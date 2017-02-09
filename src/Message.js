import { format, lengthOfUTF8, parseUTF8, stringToUTF8 } from './util';
import { ERROR } from './constants';

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
  constructor(newPayload) {
    if (!(typeof newPayload === 'string'
        || newPayload instanceof ArrayBuffer
        || newPayload instanceof Int8Array
        || newPayload instanceof Uint8Array
        || newPayload instanceof Int16Array
        || newPayload instanceof Uint16Array
        || newPayload instanceof Int32Array
        || newPayload instanceof Uint32Array
        || newPayload instanceof Float32Array
        || newPayload instanceof Float64Array
      )) {
      throw (format(ERROR.INVALID_ARGUMENT, [newPayload, 'newPayload']));
    }

    const payload = newPayload;

    this._getPayloadString = function () {
      if (typeof payload === 'string') {
        return payload;
      } else {
        return parseUTF8(payload, 0, payload.length);
      }
    };

    this._getPayloadBytes = function () {
      if (typeof payload === 'string') {
        const buffer = new ArrayBuffer(lengthOfUTF8(payload));
        const byteStream = new Uint8Array(buffer);
        stringToUTF8(payload, byteStream, 0);

        return byteStream;
      } else {
        return payload;
      }
    };

    let destinationName;
    this._getDestinationName = function () {
      return destinationName;
    };
    this._setDestinationName = function (newDestinationName) {
      if (typeof newDestinationName === 'string') {
        destinationName = newDestinationName;
      } else {
        throw new Error(format(ERROR.INVALID_ARGUMENT, [newDestinationName, 'newDestinationName']));
      }
    };

    let qos = 0;
    this._getQos = function () {
      return qos;
    };
    this._setQos = function (newQos) {
      if (newQos === 0 || newQos === 1 || newQos === 2) {
        qos = newQos;
      } else {
        throw new Error('Invalid argument:' + newQos);
      }
    };

    let retained = false;
    this._getRetained = function () {
      return retained;
    };
    this._setRetained = function (newRetained) {
      if (typeof newRetained === 'boolean') {
        retained = newRetained;
      } else {
        throw new Error(format(ERROR.INVALID_ARGUMENT, [newRetained, 'newRetained']));
      }
    };

    let duplicate = false;
    this._getDuplicate = function () {
      return duplicate;
    };
    this._setDuplicate = function (newDuplicate) {
      duplicate = newDuplicate;
    };
  }

  get payloadString() {
    return this._getPayloadString();
  }

  get payloadBytes() {
    return this._getPayloadBytes();
  }

  get destinationName() {
    return this._getDestinationName();
  }

  set destinationName(newDestinationName) {
    this._setDestinationName(newDestinationName);
  }

  get qos() {
    return this._getQos();
  }

  set qos(newQos) {
    this._setQos(newQos);
  }

  get retained() {
    return this._getRetained();
  }

  set retained(newRetained) {
    this._setRetained(newRetained);
  }

  get duplicate() {
    return this._getDuplicate();
  }

  set duplicate(newDuplicate) {
    this._setDuplicate(newDuplicate);
  }
}
