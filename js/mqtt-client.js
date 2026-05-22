/**
 * PalmDoor MQTT 客户端封装 - H5 适配版
 * 将微信小程序 API 替换为 Web 标准 API
 */
(function(global) {
  'use strict';

  const DEFAULT_CONFIG = {
    brokerUrl: 'wss://uad395d0.ala.cn-hangzhou.emqxsl.cn:8084/mqtt',
    username: 'palmdoor_device',
    password: 'secure_device_password_123',
    keepAlive: 30,
    clientIdPrefix: 'h5app_',
    autoReconnect: true,
    maxReconnectAttempts: 10,
    reconnectInterval: 3000
  };

  const TOPICS = {
    CMD: 'palmdoor/{sn}/cmd',
    RESP: 'palmdoor/{sn}/resp',
    STATUS: 'palmdoor/{sn}/status'
  };

  function generateMsgId() {
    return 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  function buildTopic(template, deviceSn) {
    return template.replace('{sn}', deviceSn);
  }

  class PalmDoorMqttClient {
    constructor() {
      this._client = null;
      this._config = null;
      this._connected = false;
      this._connecting = false;
      this._deviceSn = '';

      this.onConnectChange = null;
      this.onDeviceStatus = null;
      this.onMessage = null;
      this.onError = null;
      this.onPalmVerify = null;

      this._deviceResponseWatchers = [];
      this._palmVerifyWatchers = new Map();
      this._deviceStatusWatchers = [];
      this._topicCallbacks = new Map();
    }

    connectWithStoredConfig(deviceSn) {
      if (deviceSn) this._deviceSn = deviceSn;
      var config = DEFAULT_CONFIG;
      try {
        var saved = localStorage.getItem('mqttConfig');
        if (saved) config = Object.assign({}, DEFAULT_CONFIG, JSON.parse(saved));
      } catch(e) {}
      this.connect(config);
      return true;
    }

    connect(config) {
      if (this._connected || this._connecting) {
        console.warn('[MQTT] 已连接或正在连接中');
        return;
      }

      if (this._client) {
        try { this._client.end(true); } catch(e) {}
        this._client = null;
      }

      this._config = Object.assign({}, DEFAULT_CONFIG, config);
      this._connecting = true;

      var nav = navigator;
      var model = 'h5_browser';
      try {
        model = (nav.userAgent || 'h5').replace(/\s+/g, '_').substring(0, 30);
      } catch(e) {}
      var clientId = this._config.clientIdPrefix + model + '_' + Date.now().toString(36);

      var brokerUrl = this._config.brokerUrl;

      console.log('[MQTT] 开始连接:', brokerUrl);

      // H5 环境直接使用标准 MQTT.js over WebSocket
      this._client = mqtt.connect(brokerUrl, {
        clientId: clientId,
        username: this._config.username,
        password: this._config.password,
        keepalive: this._config.keepAlive || 30,
        clean: true,
        protocolId: 'MQTT',
        protocolVersion: 4,
        reconnectPeriod: this._config.reconnectInterval || 3000,
        connectTimeout: 10 * 1000
      });

      var self = this;

      this._client.on('connect', function() {
        console.log('[MQTT] 连接成功');
        self._connected = true;
        self._connecting = false;
        if (self.onConnectChange) self.onConnectChange(true);
      });

      this._client.on('close', function() {
        console.log('[MQTT] 连接断开');
        self._connected = false;
        self._connecting = false;
        if (self.onConnectChange) self.onConnectChange(false);
      });

      this._client.on('error', function(err) {
        console.error('[MQTT] 连接错误:', err);
        self._connecting = false;
        if (self.onError) self.onError(err);
      });

      this._client.on('reconnect', function() {
        console.log('[MQTT] 正在重连...');
      });

      this._client.on('message', function(topic, message) {
        var msgStr = message.toString();
        console.log('[MQTT] 收到消息 ' + topic + ':', msgStr);

        if (self.onMessage) self.onMessage(topic, msgStr);

        self._topicCallbacks.forEach(function(cb, subTopic) {
          if (self._matchTopic(subTopic, topic)) {
            cb(topic, msgStr);
          }
        });

        try {
          var data = JSON.parse(msgStr);
          self._dispatchMessage(topic, data, msgStr);
        } catch(e) {}
      });
    }

    reconnect() {
      console.log('[MQTT] 手动触发重连...');
      if (this._client) {
        if (typeof this._client.reconnect === 'function') {
          this._client.reconnect();
        } else {
          this.disconnect();
          this.connectWithStoredConfig(this._deviceSn);
        }
      } else {
        this.connectWithStoredConfig(this._deviceSn);
      }
    }

    _matchTopic(sub, topic) {
      var subParts = sub.split('/');
      var topicParts = topic.split('/');
      if (subParts.length !== topicParts.length) return false;
      for (var i = 0; i < subParts.length; i++) {
        if (subParts[i] !== '+' && subParts[i] !== topicParts[i]) return false;
      }
      return true;
    }

    _dispatchMessage(topic, data, rawMessage) {
      var topicParts = topic.split('/');
      if (topicParts.length >= 3 && topicParts[0] === 'palmdoor') {
        var deviceSn = topicParts[1];
        var msgType = topicParts[2];

        if (msgType === 'resp') {
          this._deviceResponseWatchers.forEach(function(cb) { cb(data); });
        } else if (msgType === 'status') {
          var online = data.status !== 'offline';
          if (this.onDeviceStatus) this.onDeviceStatus(deviceSn, online, data);
          this._deviceStatusWatchers.forEach(function(cb) { cb(deviceSn, online, data); });
        }

        if (data.cmd === 'palm_verify' || data.cmd === 'open_door') {
          var userId = data.user_id;
          var result = data.result;
          if (this.onPalmVerify) this.onPalmVerify(deviceSn, userId, result, data);
          if (this._palmVerifyWatchers.has(deviceSn)) {
            this._palmVerifyWatchers.get(deviceSn)(userId, result, data);
          }
        }
      }
    }

    get isConnected() { return this._connected; }

    disconnect() {
      if (this._client) {
        this._client.end();
        this._client = null;
      }
      this._connected = false;
      this._connecting = false;
    }

    publish(topic, message, options) {
      if (!this._connected || !this._client) {
        console.warn('[MQTT] 未连接，无法发送消息');
        return false;
      }
      var msgStr = typeof message === 'string' ? message : JSON.stringify(message);
      var qos = 0;
      if (typeof options === 'number') qos = options;
      else if (options && typeof options.qos === 'number') qos = options.qos;
      this._client.publish(topic, msgStr, { qos: qos });
      return true;
    }

    subscribe(topic, callback) {
      if (!this._connected || !this._client) return false;
      this._client.subscribe(topic);
      if (callback) this._topicCallbacks.set(topic, callback);
      return true;
    }

    sendCommand(deviceSn, command, extraData) {
      var self = this;
      return new Promise(function(resolve, reject) {
        if (!self._connected) return reject(new Error('MQTT未连接'));
        var topic = buildTopic(TOPICS.CMD, deviceSn);
        var msg = Object.assign({
          cmd: command,
          msgId: generateMsgId(),
          timestamp: Date.now()
        }, extraData || {});
        var success = self.publish(topic, msg, 1);
        if (success) resolve(msg);
        else reject(new Error('发送失败'));
      });
    }

    sendCommandQuick(command) {
      if (!this._connected || !this._deviceSn) return false;
      var topic = buildTopic(TOPICS.CMD, this._deviceSn);
      var msg = { cmd: command, msgId: generateMsgId(), timestamp: Date.now() };
      return this.publish(topic, msg, 1);
    }

    watchDeviceResponse(callback) {
      this._deviceResponseWatchers.push(callback);
    }

    watchPalmVerify(deviceSn, callback) {
      this._palmVerifyWatchers.set(deviceSn, callback);
    }

    watchDeviceStatus(callback) {
      this._deviceStatusWatchers.push(callback);
    }

    unwatchDevice(deviceSn) {
      if (deviceSn) {
        this._palmVerifyWatchers.delete(deviceSn);
      }
      this._deviceResponseWatchers = [];
    }

    clearAllCallbacks() {
      this._deviceResponseWatchers = [];
      this._palmVerifyWatchers.clear();
      this._deviceStatusWatchers = [];
      this._topicCallbacks.clear();
    }

    getDeviceSn() { return this._deviceSn; }
    setDeviceSn(deviceSn) { this._deviceSn = deviceSn; }
  }

  var _mqttInstance = null;
  function getMqttClient() {
    if (!_mqttInstance) _mqttInstance = new PalmDoorMqttClient();
    return _mqttInstance;
  }

  global.PalmDoorMqttClient = PalmDoorMqttClient;
  global.getMqttClient = getMqttClient;
  global.MQTT_TOPICS = TOPICS;
  global.MQTT_DEFAULT_CONFIG = DEFAULT_CONFIG;

})(window);
