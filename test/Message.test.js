import Message from '../src/Message';

test('check message properties.', function () {
  const strMsg = 'test Msg';
  const strDes = '/test';
  const message = new Message(strMsg);
  message.destinationName = strDes;

  expect(message.qos).toBe(0);
  expect(message.duplicate).toBe(false);
  expect(message.retained).toBe(false);
  expect(message.payloadString).toEqual(strMsg);
  expect(message.payloadBytes.length).toBeGreaterThan(0);
  expect(message.destinationName).toEqual(strDes);

  expect(function () {
    Message();
  }).toThrow();

  message.qos = 0;
  expect(message.qos).toBe(0);
  message.qos = 1;
  expect(message.qos).toBe(1);
  message.qos = 2;
  expect(message.qos).toBe(2);

  //illegal argument exception
  expect(function () {
    message.qos = -1;
  }).toThrow();
  expect(function () {
    message.qos = 1;
  }).not.toThrow();

  const strPayload = 'payload is a string';
  message.payloadString = strPayload;
  expect(message.payloadString).not.toEqual(strPayload);

  message.retained = false;
  expect(message.retained).toBe(false);
  message.retained = true;
  expect(message.retained).toBe(true);

  message.duplicate = false;
  expect(message.duplicate).toBe(false);
  message.duplicate = true;
  expect(message.duplicate).toBe(true);

  //to do , check payload
  /*
   var buffer = new ArrayBuffer(4);
   var uintArr = new Uint8Array(buffer);
   dataView = new DataView(buffer);
   dataView.setInt32(0,0x48656c6c);
   //dataView.setInt
   console.log(dataView.getInt32(0).toString(16));
   //var arrbufPayload = new ArrayBuffer
   var msg = new Paho.MQTT.Message(buffer);
   console.log(msg.payloadBytes,msg.payloadString);
   */
});
