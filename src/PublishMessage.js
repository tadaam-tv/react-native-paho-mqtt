/* @flow */

import { encodeMultiByteInteger, lengthOfUTF8, writeString, writeUint16 } from './util';
import { MESSAGE_TYPE } from './constants';
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
  payloadMessage: Message;
  onDispatched: ?() => void;
  pubRecReceived: ?boolean;
  sequence: ?number;

  constructor(payloadMessage: Message, messageIdentifier: ?number = null) {
    this.type = MESSAGE_TYPE.PUBLISH;
    this.payloadMessage = payloadMessage;
    this.messageIdentifier = messageIdentifier;
  }

  encode(): ArrayBuffer {
    // Compute the first byte of the fixed header
    let first = ((this.type & 0x0f) << 4);

    /*
     * Now calculate the length of the variable header + payload by adding up the lengths
     * of all the component parts
     */

    let remLength = 0;
    let payloadBytes: ?Uint8Array;

    // if the message contains a messageIdentifier then we need two bytes for that
    if (this.messageIdentifier) {
      remLength += 2;
    }

    //Publish
    if (this.payloadMessage.duplicate) {
      first |= 0x08;
    }
    first = first |= (this.payloadMessage.qos << 1);
    if (this.payloadMessage.retained) {
      first |= 0x01;
    }
    payloadBytes = this.payloadMessage.payloadBytes;
    const destinationNameLength = lengthOfUTF8(this.payloadMessage.destinationName);
    remLength += destinationNameLength + 2;
    remLength += payloadBytes.byteLength;
    //End publish

    // Now we can allocate a buffer for the message

    const mbi = encodeMultiByteInteger(remLength);  // Convert the length to MQTT MBI format
    let pos = mbi.length + 1;        // Offset of start of variable header
    const buffer = new ArrayBuffer(remLength + pos);
    const byteStream = new Uint8Array(buffer);    // view it as a sequence of bytes

    //Write the fixed header into the buffer
    byteStream[0] = first;
    byteStream.set(mbi, 1);

    pos = writeString(this.payloadMessage.destinationName, destinationNameLength, byteStream, pos);

    // Output the messageIdentifier - if there is one
    if (this.messageIdentifier) {
      pos = writeUint16(this.messageIdentifier, byteStream, pos);
    }

    // PUBLISH has a text or binary payload, if text do not add a 2 byte length field, just the UTF characters.
    payloadBytes && byteStream.set(payloadBytes, pos);

    return buffer;
  }
}
