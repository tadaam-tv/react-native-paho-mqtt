function ensureValue(prop, value) {
  if (prop == "" || prop[0] == "$") {
    return value;
  }
  return prop;
}

module.exports = {
  server: ensureValue("${test.server}", "iot.eclipse.org"),
  port: parseInt(ensureValue("${test.server.port}", "80")),
  path: ensureValue("${test.server.path}", "/ws"),
  webSocket: require('websocket').w3cwebsocket,
  storage: require('node-localstorage'),
  mqttVersion: parseInt(ensureValue("${test.server.mqttVersion}", "3")),
  interopServer: ensureValue("${test.interopServer}", "iot.eclipse.org"),
  interopPort: parseInt(ensureValue("${test.interopPort}", "80")),
  interopPath: ensureValue("${test.interopPath}", "/ws")
}
