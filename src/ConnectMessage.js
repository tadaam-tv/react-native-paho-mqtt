/* @flow */

import { encodeMultiByteInteger, lengthOfUTF8, writeString, writeUint16 } from './util';
import { MESSAGE_TYPE, MqttProtoIdentifierv3, MqttProtoIdentifierv4 } from './constants';
import Message from './Message';

type ConnectOptions = {
  cleanSession: boolean;
  userName: ?string;
  password: ?string;
  mqttVersion: 3 | 4;
  willMessage: ?Message;
  keepAliveInterval: number;
  clientId: string;
}

export default class {
  options: ConnectOptions;

  constructor(options: ConnectOptions) {
    this.options = options;
  }

  encode(): ArrayBuffer {
    const options = this.options;

    // Compute the first byte of the fixed header
    const first = ((MESSAGE_TYPE.CONNECT & 0x0f) << 4);

    /*
     * Now calculate the length of the variable header + payload by adding up the lengths
     * of all the component parts
     */

    let remLength = 0;
    let willMessagePayloadBytes;


    switch (options.mqttVersion) {
      case 3:
        remLength += MqttProtoIdentifierv3.length + 3;
        break;
      case 4:
        remLength += MqttProtoIdentifierv4.length + 3;
        break;
    }

    remLength += lengthOfUTF8(options.clientId) + 2;
    if (options.willMessage) {
      willMessagePayloadBytes = options.willMessage.payloadBytes;
      // Will message is always a string, sent as UTF-8 characters with a preceding length.
      remLength += lengthOfUTF8(options.willMessage.destinationName) + 2;
      if (!(willMessagePayloadBytes instanceof Uint8Array)) {
        willMessagePayloadBytes = new Uint8Array(willMessagePayloadBytes);
      }
      remLength += willMessagePayloadBytes.byteLength + 2;
    }
    if (options.userName) {
      remLength += lengthOfUTF8(options.userName) + 2;
      if (options.password) {
        remLength += lengthOfUTF8(options.password) + 2;
      }
    }

    // Now we can allocate a buffer for the message

    const mbi = encodeMultiByteInteger(remLength);  // Convert the length to MQTT MBI format
    let pos = mbi.length + 1;        // Offset of start of variable header
    const buffer = new ArrayBuffer(remLength + pos);
    const byteStream = new Uint8Array(buffer);    // view it as a sequence of bytes

    //Write the fixed header into the buffer
    byteStream[0] = first;
    byteStream.set(mbi, 1);

    switch (options.mqttVersion) {
      case 3:
        byteStream.set(MqttProtoIdentifierv3, pos);
        pos += MqttProtoIdentifierv3.length;
        break;
      case 4:
        byteStream.set(MqttProtoIdentifierv4, pos);
        pos += MqttProtoIdentifierv4.length;
        break;
    }
    let connectFlags = 0;
    if (options.cleanSession) {
      connectFlags = 0x02;
    }
    if (options.willMessage) {
      connectFlags |= 0x04;
      connectFlags |= (options.willMessage.qos << 3);
      if (options.willMessage.retained) {
        connectFlags |= 0x20;
      }
    }
    if (options.userName) {
      connectFlags |= 0x80;
    }
    if (options.password) {
      connectFlags |= 0x40;
    }
    byteStream[pos++] = connectFlags;
    pos = writeUint16(options.keepAliveInterval, byteStream, pos);

    pos = writeString(options.clientId, lengthOfUTF8(options.clientId), byteStream, pos);
    if (options.willMessage) {
      willMessagePayloadBytes = options.willMessage.payloadBytes;
      pos = writeString(options.willMessage.destinationName, lengthOfUTF8(options.willMessage.destinationName), byteStream, pos);
      pos = writeUint16(willMessagePayloadBytes.byteLength, byteStream, pos);
      byteStream.set(willMessagePayloadBytes, pos);
      pos += willMessagePayloadBytes.byteLength;

    }
    if (options.userName) {
      pos = writeString(options.userName, lengthOfUTF8(options.userName), byteStream, pos);
      if (options.password) {
        writeString(options.password, lengthOfUTF8(options.password), byteStream, pos);
      }
    }
    return buffer;
  }
}
