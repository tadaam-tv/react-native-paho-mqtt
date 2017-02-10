/* @flow */

import { encodeMBI, format, lengthOfUTF8, writeString, writeUint16 } from './util';
import { ERROR, MESSAGE_TYPE } from './constants';
import Message from './Message';

/**
 * Construct an MQTT wire protocol message.
 * @param type MQTT packet type.
 * @param options optional wire message attributes.
 *
 * Optional properties
 *
 * messageIdentifier: message ID in the range [0..65535]
 * payloadMessage:  Application Message - PUBLISH only
 * topics:      array of strings (SUBSCRIBE, UNSUBSCRIBE)
 * requestQoS:    array of QoS values [0..2]
 *
 * @private
 * @ignore
 */
export default class {
  type: number;
  messageIdentifier: ?number = null;
  payloadMessage: ?Message = null;
  topics: ?string[];
  requestedQos: ?(0 | 1 | 2)[];
  clientId: ?string;
  sessionPresent: ?boolean;
  returnCode: ?(number | Uint8Array);
  onSuccess: ?Function;
  onFailure: ?Function;
  timeOut: ?number;
  pubRecReceived: ?boolean;
  callback: ?Function;
  sequence: ?number;

  constructor(type: number, options: {
    messageIdentifier?: number;
    payloadMessage?: Message;
    topics?: string[];
    requestedQos?: (0 | 1 | 2)[];
    clientId?: string
  } = {}) {
    this.type = type;
    const self: Object = this;
    Object.keys(options).forEach((name) => {
      self[name] = options[name];
    });
  }

  encode(): ArrayBuffer {
    // Compute the first byte of the fixed header
    let first = ((this.type & 0x0f) << 4);

    /*
     * Now calculate the length of the variable header + payload by adding up the lengths
     * of all the component parts
     */

    let remLength = 0;
    const topicStrLength = [];
    let destinationNameLength = 0;
    let payloadBytes: ?Uint8Array;

    // if the message contains a messageIdentifier then we need two bytes for that
    if (this.messageIdentifier) {
      remLength += 2;
    }

    switch (this.type) {
      // Subscribe, Unsubscribe can both contain topic strings
      case MESSAGE_TYPE.SUBSCRIBE:
        first |= 0x02; // Qos = 1;
        if (!this.topics) {
          throw new Error(format(ERROR.INVALID_STATE, ['SUBSCRIBE WireMessage with no topics']));
        }
        if (!this.requestedQos) {
          throw new Error(format(ERROR.INVALID_STATE, ['SUBSCRIBE WireMessage with no requestedQos']));
        }
        for (let i = 0; i < this.topics.length; i++) {
          topicStrLength[i] = lengthOfUTF8(this.topics[i]);
          remLength += topicStrLength[i] + 2;
        }
        remLength += this.requestedQos.length; // 1 byte for each topic's Qos
        // QoS on Subscribe only
        break;

      case MESSAGE_TYPE.UNSUBSCRIBE:
        first |= 0x02; // Qos = 1;
        if (!this.topics) {
          throw new Error(format(ERROR.INVALID_STATE, ['UNSUBSCRIBE WireMessage with no topics']));
        }
        for (let i = 0; i < this.topics.length; i++) {
          topicStrLength[i] = lengthOfUTF8(this.topics[i]);
          remLength += topicStrLength[i] + 2;
        }
        break;

      case MESSAGE_TYPE.PUBREL:
        first |= 0x02; // Qos = 1;
        break;

      case MESSAGE_TYPE.PUBLISH:
        if (!this.payloadMessage) {
          throw new Error(format(ERROR.INVALID_STATE, ['PUBLISH WireMessage with no payload']));
        }
        if (this.payloadMessage.duplicate) {
          first |= 0x08;
        }
        first = first |= (this.payloadMessage.qos << 1);
        if (this.payloadMessage.retained) {
          first |= 0x01;
        }
        payloadBytes = this.payloadMessage.payloadBytes;
        destinationNameLength = lengthOfUTF8(this.payloadMessage.destinationName);
        remLength += destinationNameLength + 2;
        remLength += payloadBytes.byteLength;
        break;

      case MESSAGE_TYPE.DISCONNECT:
        break;

      default:
    }

    // Now we can allocate a buffer for the message

    const mbi = encodeMBI(remLength);  // Convert the length to MQTT MBI format
    let pos = mbi.length + 1;        // Offset of start of variable header
    const buffer = new ArrayBuffer(remLength + pos);
    const byteStream = new Uint8Array(buffer);    // view it as a sequence of bytes

    //Write the fixed header into the buffer
    byteStream[0] = first;
    byteStream.set(mbi, 1);

    // If this is a PUBLISH then the variable header starts with a topic
    if (this.type === MESSAGE_TYPE.PUBLISH) {
      if (!this.payloadMessage) {
        throw new Error(format(ERROR.INVALID_STATE, ['PUBLISH WireMessage with no payload']));
      }
      pos = writeString(this.payloadMessage.destinationName, destinationNameLength, byteStream, pos);
    }

    // Output the messageIdentifier - if there is one
    if (this.messageIdentifier) {
      pos = writeUint16(this.messageIdentifier, byteStream, pos);
    }

    switch (this.type) {
      case MESSAGE_TYPE.PUBLISH:
        // PUBLISH has a text or binary payload, if text do not add a 2 byte length field, just the UTF characters.
        payloadBytes && byteStream.set(payloadBytes, pos);
        break;

      case MESSAGE_TYPE.SUBSCRIBE:
        if (!this.topics) {
          throw new Error(format(ERROR.INVALID_STATE, ['SUBSCRIBE WireMessage with no topics']));
        }
        // SUBSCRIBE has a list of topic strings and request QoS
        for (let i = 0; i < this.topics.length; i++) {
          pos = writeString(this.topics[i], topicStrLength[i], byteStream, pos);
          if (!this.requestedQos || typeof this.requestedQos[i] === 'undefined') {
            throw new Error(format(ERROR.INVALID_STATE, ['SUBSCRIBE WireMessage topic with no corresponding requestedQos']));
          }
          byteStream[pos++] = this.requestedQos[i];
        }
        break;

      case MESSAGE_TYPE.UNSUBSCRIBE:
        if (!this.topics) {
          throw new Error(format(ERROR.INVALID_STATE, ['UNSUBSCRIBE WireMessage with no topics']));
        }
        // UNSUBSCRIBE has a list of topic strings
        for (let i = 0; i < this.topics.length; i++) {
          pos = writeString(this.topics[i], topicStrLength[i], byteStream, pos);
        }
        break;

      default:
      // Do nothing.
    }

    return buffer;
  }
}
