/**
 * PalmDoor H5 - 主应用
 * 路由 + 存储 + UI 组件 + 全部12个页面
 */
(function() {
  'use strict';

  // ============================================================
  // Storage 封装 (SyncStorage = localStorage + Supabase 自动同步)
  // ============================================================
  var Storage = {
    get: function(key, def) { return SyncStorage.get(key, def); },
    set: function(key, val) { return SyncStorage.set(key, val); },
    remove: function(key) { SyncStorage.remove(key); }
  };

  // ============================================================
  // UI 组件
  // ============================================================
  var Toast = {
    _timer: null,
    show: function(msg, icon, duration) {
      icon = icon || 'none'; duration = duration || 2000;
      var el = document.getElementById('toast');
      el.textContent = msg; el.className = 'toast ' + icon + ' show';
      clearTimeout(this._timer);
      this._timer = setTimeout(function() { el.className = 'toast'; }, duration);
    },
    success: function(msg, d) { this.show(msg, 'success', d || 2000); },
    error: function(msg, d) { this.show(msg, 'error', d || 2000); },
    info: function(msg, d) { this.show(msg, 'info', d || 2000); }
  };

  var Modal = {
    show: function(opts) {
      document.getElementById('modal-title').textContent = opts.title || '提示';
      document.getElementById('modal-body').innerHTML = (opts.content || '') +
        (opts.editable ? '<input id="modal-input" placeholder="' + (opts.placeholder || '') + '" value="' + (opts.inputValue || '') + '" style="margin-top:0.2rem">' : '');
      var actions = document.getElementById('modal-actions');
      actions.innerHTML = '';
      var cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn-cancel'; cancelBtn.textContent = opts.cancelText || '取消';
      cancelBtn.onclick = function() { Modal.hide(); if (opts.onCancel) opts.onCancel(); };
      actions.appendChild(cancelBtn);
      var confirmBtn = document.createElement('button');
      confirmBtn.className = 'btn-confirm' + (opts.confirmColor === 'danger' ? ' danger' : '');
      confirmBtn.textContent = opts.confirmText || '确定';
      confirmBtn.onclick = function() {
        Modal.hide();
        if (opts.onConfirm) {
          var inputVal = null;
          if (opts.editable) { var inp = document.getElementById('modal-input'); if (inp) inputVal = inp.value; }
          opts.onConfirm(inputVal);
        }
      };
      actions.appendChild(confirmBtn);
      document.getElementById('modal-overlay').className = 'modal-overlay show';
    },
    hide: function() { document.getElementById('modal-overlay').className = 'modal-overlay'; },
    alert: function(title, content, cb) {
      this.show({ title: title, content: content, cancelText: '', confirmText: '确定', onConfirm: cb || function(){} });
      document.querySelector('#modal-actions .btn-cancel').style.display = 'none';
    }
  };

  var Loading = {
    show: function(msg) {
      document.getElementById('loading-text').textContent = msg || '加载中...';
      document.getElementById('loading-overlay').className = 'loading-overlay show';
    },
    hide: function() { document.getElementById('loading-overlay').className = 'loading-overlay'; }
  };

  // Vibration
  function vibrate(ms) { try { navigator.vibrate(ms || 15); } catch(e) {} }

  // ============================================================
  // Router
  // ============================================================
  var Router = {
    _currentPage: 'index',
    _currentParams: {},
    _pageStack: [],
    _tabPages: ['index', 'my'],

    init: function() {
      var self = this;
      window.addEventListener('hashchange', function() { self._handleHash(); });
      this._handleHash();
    },

    navigate: function(page, params) {
      this._pageStack.push({ page: this._currentPage, params: this._currentParams });
      this._showPage(page, params);
    },

    goBack: function() {
      if (this._pageStack.length === 0) { this.switchTab('index'); return; }
      var prev = this._pageStack.pop();
      this._showPage(prev.page, prev.params);
    },

    switchTab: function(page) {
      this._pageStack = [];
      this._showPage(page, {});
    },

    _showPage: function(page, params) {
      // 认证守卫：非认证页需要登录
      if (page !== 'auth' && !SupabaseAuth.isLoggedIn()) {
        this._showPage('auth', {});
        return;
      }
      this._currentPage = page;
      this._currentParams = params || {};
      // Hide all pages
      var pages = document.querySelectorAll('.page');
      for (var i = 0; i < pages.length; i++) { pages[i].classList.remove('active'); }
      // Show target
      var el = document.getElementById('page-' + page);
      if (el) el.classList.add('active');
      // Tab bar
      var tabBar = document.getElementById('tab-bar');
      var isTab = this._tabPages.indexOf(page) >= 0;
      if (isTab) { tabBar.classList.add('visible'); }
      else { tabBar.classList.remove('visible'); }
      // Update tab active state
      var tabs = document.querySelectorAll('.tab-item');
      for (var j = 0; j < tabs.length; j++) {
        var t = tabs[j]; var tp = t.getAttribute('data-tab');
        if (tp === page) { t.classList.add('active'); t.querySelector('img').src = 'images/tab-' + tp + '-active.png'; }
        else { t.classList.remove('active'); t.querySelector('img').src = 'images/tab-' + tp + '.png'; }
      }
      // Trigger page onShow
      if (Pages[page] && typeof Pages[page].onShow === 'function') {
        Pages[page].onShow(params);
      }
      window.location.hash = page;
      window.scrollTo(0, 0);
    },

    _handleHash: function() {
      var hash = window.location.hash.replace('#', '');
      if (!hash) { this.switchTab('index'); return; }
      var parts = hash.split('?'); var page = parts[0]; var params = {};
      if (parts[1]) {
        var pairs = parts[1].split('&');
        for (var i = 0; i < pairs.length; i++) {
          var kv = pairs[i].split('='); params[kv[0]] = decodeURIComponent(kv[1] || '');
        }
      }
      if (this._tabPages.indexOf(page) >= 0) this.switchTab(page);
      else this._showPage(page, params);
    },

    getCurrentPage: function() { return this._currentPage; },
    getParams: function() { return this._currentParams; }
  };

  // ============================================================
  // App 全局
  // ============================================================
  var App = {
    mqttClient: null,
    globalData: { needRefreshDeviceList: false, mqttConnected: false },
    _homePage: null,

    init: function() {
      var self = this;
      this.initData();
      Loading.show('加载中...');

      // 先检查登录状态，再初始化路由（避免内容闪现）
      SupabaseAuth.init().then(function(user) {
        Router.init();
        if (user) {
          return SupabaseDB.pull().then(function() {
            Loading.hide();
            Router._showPage('index', {});
          });
        } else {
          Loading.hide();
          Router._showPage('auth', {});
        }
      }).catch(function() {
        Router.init();
        Loading.hide();
        Router._showPage('auth', {});
      });

      try { this.initMqtt(); } catch(e) { console.error('[App] MQTT init error:', e); }
      // Periodically update MQTT status display
      setInterval(function() {
        var el = document.getElementById('mqtt-status-text');
        if (el && self.mqttClient) {
          el.textContent = self.mqttClient.isConnected ? '已连接' : '未连接';
          el.style.color = self.mqttClient.isConnected ? '#b7eb8f' : '#ffccc7';
        }
      }, 3000);
    },

    initData: function() {
      if (!Storage.get('deviceList')) Storage.set('deviceList', []);
      if (!Storage.get('person_list')) Storage.set('person_list', []);
      if (!Storage.get('attendance_records')) Storage.set('attendance_records', []);
    },

    initMqtt: function() {
      this.mqttClient = getMqttClient();
      var self = this;
      this.mqttClient.onConnectChange = function(connected) {
        console.log('[App] MQTT 连接状态:', connected);
        self.globalData.mqttConnected = connected;
      };
      this.mqttClient.onError = function(err) {
        console.error('[App] MQTT 错误:', err);
      };
      this.mqttClient.onDeviceStatus = function(deviceSn, online) {
        var deviceList = Storage.get('deviceList') || [];
        var idx = -1;
        for (var i = 0; i < deviceList.length; i++) { if (deviceList[i].sn === deviceSn) { idx = i; break; } }
        if (idx >= 0) {
          deviceList[idx].status = online ? 'online' : 'offline';
          if (online) deviceList[idx].lastOnline = new Date().toLocaleString();
          Storage.set('deviceList', deviceList);
          self.globalData.needRefreshDeviceList = true;
        }
      };
      this.mqttClient.connectWithStoredConfig();
    },

    addDevice: function(device) {
      var deviceList = Storage.get('deviceList') || [];
      var exists = false;
      for (var i = 0; i < deviceList.length; i++) { if (deviceList[i].sn === device.sn) { exists = true; break; } }
      if (exists) return false;
      deviceList.push(Object.assign({
        id: Date.now(), createTime: new Date().toISOString(),
        online: false, lastUpdate: null, status: 'offline',
        icon: 'images/device-door.png'
      }, device));
      Storage.set('deviceList', deviceList);
      this.globalData.needRefreshDeviceList = true;
      return true;
    }
  };

  // ============================================================
  // 页面实现
  // ============================================================
  var Pages = {};

  // ---------- index (首页-设备列表) ----------
  Pages.index = {
    onShow: function() {
      this.renderDeviceList();
      var app = App;
      if (app.globalData.needRefreshDeviceList) {
        app.globalData.needRefreshDeviceList = false;
      }
    },
    renderDeviceList: function() {
      var deviceList = Storage.get('deviceList') || [];
      var container = document.getElementById('device-list-container');
      if (!container) return;
      if (deviceList.length === 0) {
        container.innerHTML = '<div class="empty-state" style="padding-top:2rem"><div class="empty-icon">📱</div><div class="empty-text">暂无设备</div><div class="empty-tip">点击下方按钮添加设备</div></div>';
        return;
      }
      var html = '';
      for (var i = 0; i < deviceList.length; i++) {
        var d = deviceList[i];
        var online = d.status === 'online';
        var disabled = d.disabled ? ' device-card-disabled' : '';
        html += '<div class="device-card' + disabled + '" onclick="Pages.index.goToDetail(' + d.id + ')">' +
          '<div class="device-icon-img"><img src="' + (d.icon || 'images/device-door.png') + '" onerror="this.style.display=\'none\'"></div>' +
          '<div class="device-info"><div class="device-name">' + (d.name || '未命名') + '</div>' +
          '<div class="device-status"><span class="status-dot ' + (online ? 'online' : 'offline') + '"></span>' +
          '<span>' + (online ? '在线' : '离线') + '</span></div>' +
          '<div class="device-sn">SN: ' + (d.sn || 'N/A') + '</div></div>' +
          '<div class="device-arrow">›</div></div>';
      }
      container.innerHTML = html;
    },
    goToDetail: function(id) { Router.navigate('device-detail', { id: id }); }
  };

  // ---------- device-detail (设备详情) ----------
  Pages['device-detail'] = {
    _deviceId: null, _deviceInfo: null,
    onShow: function(params) {
      this._deviceId = params ? Number(params.id) : this._deviceId;
      this.loadDevice();
    },
    loadDevice: function() {
      var deviceList = Storage.get('deviceList') || [];
      var device = null;
      for (var i = 0; i < deviceList.length; i++) { if (Number(deviceList[i].id) === this._deviceId) { device = deviceList[i]; break; } }
      if (!device) { Toast.error('设备不存在'); setTimeout(function() { Router.goBack(); }, 1500); return; }
      this._deviceInfo = device;
      document.getElementById('detail-title').textContent = device.name;
      document.getElementById('detail-content').innerHTML = this._buildHTML(device);
      this._setupListeners(device);
    },
    _buildHTML: function(d) {
      var online = d.status === 'online';
      var disabled = d.disabled;
      return '<div class="device-status-section">' +
        '<div class="device-name-container"><span class="detail-device-name">' + (d.name || '') + '</span>' +
        '<span class="status-badge ' + (online ? 'online' : 'offline') + '">' + (online ? '在线' : '离线') + '</span></div>' +
        '<div class="detail-device-sn">设备SN: ' + (d.sn || '') + '</div></div>' +
        '<div class="menu-container">' +
        this._group('人员管理', [
          { icon:'add', emoji:'👤', title:'人员添加', desc:'添加新用户并录入信息', action:'goAddPerson' },
          { icon:'manage', emoji:'📋', title:'人员管理', desc:'查看、编辑、删除用户', action:'goPersonManage' },
          { icon:'export', emoji:'📤', title:'考勤导出', desc:'导出考勤记录报表', action:'goAttendance' }
        ]) +
        this._group('设备控制', [
          { icon:'remote', emoji:'🚪', title:'远程开门', desc:'点击远程打开门锁', action:'goRemoteOpen' },
          { icon:'restart', emoji:'🔄', title:'设备重启', desc:'重启设备系统', action:'rebootDevice' },
          { icon:'disable', emoji:'⏸️', title: disabled ? '设备启用' : '设备禁用', desc: disabled ? '点击启用设备' : '点击禁用设备', action:'toggleDisable' }
        ]) +
        this._group('系统设置', [
          { icon:'info', emoji:'📱', title:'系统信息', desc:'查看设备详情和状态', action:'goSystemInfo' },
          { icon:'ota', emoji:'⬆️', title:'固件升级', desc:'选择固件并升级设备', action:'startOta' },
          { icon:'transfer', emoji:'🔄', title:'管理员转让', desc:'转让设备管理员权限', action:'goAdminTransfer' }
        ]) +
        this._groupDanger('危险操作', [
          { icon:'delete', emoji:'🗑️', title:'删除设备', desc:'永久删除此设备及相关数据', action:'deleteDevice', danger:true }
        ]) + '</div>';
    },
    _group: function(title, items) {
      var h = '<div class="menu-group"><div class="group-title">' + title + '</div>';
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        h += '<div class="menu-item large" data-action="' + it.action + '"><div class="item-left">' +
          '<div class="item-icon ' + it.icon + '">' + it.emoji + '</div>' +
          '<div class="item-content"><div class="item-title">' + it.title + '</div>' +
          '<div class="item-desc">' + it.desc + '</div></div></div>' +
          '<div class="item-arrow">›</div></div>';
      }
      return h + '</div>';
    },
    _groupDanger: function(title, items) {
      var h = '<div class="menu-group danger-group"><div class="group-title">' + title + '</div>';
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        h += '<div class="menu-item large danger" data-action="' + it.action + '"><div class="item-left">' +
          '<div class="item-icon ' + it.icon + '">' + it.emoji + '</div>' +
          '<div class="item-content"><div class="item-title danger-text">' + it.title + '</div>' +
          '<div class="item-desc">' + it.desc + '</div></div></div>' +
          '<div class="item-arrow">›</div></div>';
      }
      return h + '</div>';
    },
    _setupListeners: function(device) {
      var self = this;
      var items = document.querySelectorAll('#detail-content .menu-item');
      for (var i = 0; i < items.length; i++) {
        items[i].onclick = function() {
          var action = this.getAttribute('data-action');
          if (self['_act_' + action]) self['_act_' + action](device);
        };
      }
    },
    _act_goAddPerson: function(d) { Router.navigate('add-person', { id: d.id, name: d.name, sn: d.sn }); },
    _act_goPersonManage: function() { Router.navigate('person-manage'); },
    _act_goAttendance: function(d) { Router.navigate('attendance', { deviceId: d.id, deviceSn: d.sn, deviceName: d.name }); },
    _act_goRemoteOpen: function(d) { Router.navigate('remote-open', { id: d.id }); },
    _act_goSystemInfo: function() { Router.navigate('system-info'); },
    _act_goAdminTransfer: function() { Router.navigate('admin-transfer'); },
    _act_rebootDevice: function(d) {
      Modal.show({
        title: '设备重启', content: '设备将重启，期间无法使用，是否继续？',
        confirmText: '确认重启', confirmColor: 'danger',
        onConfirm: function() {
          var client = getMqttClient();
          if (client.isConnected && d.sn) {
            Loading.show('发送重启指令...');
            client.publish('palmdoor/' + d.sn + '/cmd', JSON.stringify({ type:'control_command', cmd:'restart', msgId:'reboot_'+Date.now(), timestamp:Date.now(), device:d.sn, client:'h5app' }), 0);
            setTimeout(function() { Loading.hide(); Toast.success('重启指令已下发'); }, 800);
          } else { Toast.error('设备离线或无网络'); }
        }
      });
    },
    _act_toggleDisable: function(d) {
      var disabled = d.disabled || false;
      var action = disabled ? '启用' : '禁用';
      Modal.show({
        title: action + '设备',
        content: '确定要' + action + '设备"' + d.name + '"吗？' + (disabled ? '' : '禁用后刷掌模组将断电停止工作。'),
        confirmText: '确认' + action, confirmColor: disabled ? '' : 'danger',
        onConfirm: function() {
          var client = getMqttClient();
          if (!client.isConnected) { Toast.error('MQTT未连接'); return; }
          client.publish('palmdoor/' + d.sn + '/cmd', JSON.stringify({ cmd:'set_disabled', disabled:!disabled, msgId:'disable_'+Date.now() }), { qos: 1 });
          Loading.show(disabled ? '正在启用...' : '正在禁用...');
          setTimeout(function() {
            Loading.hide();
            d.disabled = !disabled;
            var list = Storage.get('deviceList') || [];
            for (var i = 0; i < list.length; i++) { if (list[i].id === d.id) { list[i].disabled = d.disabled; break; } }
            Storage.set('deviceList', list);
            Toast.success(d.disabled ? '设备已禁用' : '设备已启用');
            Pages['device-detail'].loadDevice();
          }, 800);
        }
      });
    },
    _act_deleteDevice: function(d) {
      Modal.show({
        title: '删除设备', content: '确定要删除"' + d.name + '"并清空所有掌纹数据吗？此操作不可撤销。',
        confirmText: '确认删除', confirmColor: 'danger',
        onConfirm: function() {
          Loading.show('正在删除...');
          var client = getMqttClient();
          if (client.isConnected && d.sn) {
            client.publish('palmdoor/' + d.sn + '/cmd', JSON.stringify({ type:'command', cmd:'000', msgId:'delete_all_'+Date.now(), timestamp:Date.now(), device:d.sn, action:'delete_all', client:'h5app' }), 1);
          }
          setTimeout(function() {
            var list = Storage.get('deviceList') || [];
            list = list.filter(function(item) { return item.id !== d.id; });
            Storage.set('deviceList', list);
            Loading.hide(); Toast.success('删除成功');
            Router.goBack();
          }, 1000);
        }
      });
    },
    _act_startOta: function(d) {
      Modal.show({
        title: '固件升级', content: '请输入固件下载地址（HTTP/HTTPS）',
        editable: true, placeholder: 'https://example.com/firmware.bin',
        confirmText: '开始升级',
        onConfirm: function(url) {
          if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) { Toast.error('URL格式不正确'); return; }
          var client = getMqttClient();
          if (!client.isConnected) { Toast.error('设备离线'); return; }
          client.publish('palmdoor/' + d.sn + '/cmd', JSON.stringify({ cmd:'ota_update', url:url, msgId:'ota_'+Date.now() }), { qos: 1 });
          Toast.success('升级指令已下发');
        }
      });
    }
  };

  // ---------- add-device (AP配网添加设备) ----------
  Pages['add-device'] = {
    _step: 1, _scanning: false, _devices: [], _selectedDevice: null, _scanTimer: null,
    _ssid: '', _password: '', _configuring: false, _deviceSN: '', _formName: '', _formLocation: '',

    onShow: function() {
      this._render();
    },
    _render: function() {
      var container = document.getElementById('add-device-content');
      if (!container) return;
      var self = this;
      var h = '<div class="ios-progress-container"><div class="ios-progress-bar"><div class="ios-progress-fill" style="width:' + (self._step === 1 ? '33%' : (self._step === 2 ? '66%' : '100%')) + '"></div></div>' +
        '<div class="ios-progress-text">步骤 ' + self._step + ' : ' + (self._step === 1 ? '搜索设备热点' : (self._step === 2 ? '配置 WiFi 网络' : '完善设备信息')) + '</div></div>';

      if (self._step === 1) {
        h += '<div class="ios-section-desc">请确保门禁设备已上电，设备热点将自动开启（SSID格式：PalmDoor_XXXXXX）。</div>';
        if (self._devices.length > 0) {
          h += '<div class="ios-card-group">';
          for (var i = 0; i < self._devices.length; i++) {
            var dev = self._devices[i];
            h += '<div class="ios-cell" data-device-index="' + i + '"><div class="ios-cell-left"><div class="ios-cell-title">' + dev.SSID + '</div><div class="ios-cell-subtitle">信号强度: ' + (dev.rssiText || '未知') + '</div></div><div class="ios-cell-right"><span class="ios-rssi">' + (dev.rssiText || '') + '</span><span class="ios-chevron">›</span></div></div>';
          }
          h += '</div>';
        } else if (!self._scanning) {
          h += '<div class="ios-empty"><div class="ios-empty-text">附近暂无 PalmDoor 设备热点</div><div class="ios-empty-hint">请确认设备已上电并处于配网模式</div></div>';
        }
        h += '<button class="ios-btn ' + (self._scanning ? 'ios-btn-secondary' : 'ios-btn-primary') + '" id="btn-scan-toggle">' + (self._scanning ? '◌ 停止搜索...' : '搜索设备') + '</button>';
      } else if (self._step === 2) {
        h += '<div class="ios-section-desc">已选择设备热点 <b>' + (self._selectedDevice ? self._selectedDevice.SSID : '') + '</b></div>';
        if (!self._configuring) {
          h += '<div class="ios-card-group">' +
            '<div class="ios-cell ios-input-cell"><span class="ios-cell-label">WiFi 名称</span><input class="ios-input" id="input-ssid" placeholder="目标 WiFi SSID" value="' + (self._ssid||'') + '" maxlength="64"></div>' +
            '<div class="ios-cell ios-input-cell"><span class="ios-cell-label">密码</span><input class="ios-input" id="input-password" type="password" placeholder="输入密码" value="' + (self._password||'') + '" maxlength="64"><span class="ios-icon-btn" id="btn-toggle-pwd">显示</span></div>' +
            '</div>' +
            '<div class="ios-btn-group"><button class="ios-btn ios-btn-primary" id="btn-start-config">开始配网</button><button class="ios-btn ios-btn-text" id="btn-back-step1">重新选择设备</button></div>';
        } else {
          h += '<div class="ios-config-panel"><span class="ios-spinner large">◌</span><div class="ios-config-status" id="config-status-text">正在配网...</div><div class="ios-config-bar"><div class="ios-config-fill" id="config-progress-bar" style="width:10%"></div></div></div>';
        }
      } else if (self._step === 3) {
        h += '<div class="ios-section-desc">设备已成功连接至网络，请为它命名。</div>' +
          '<div class="ios-card-group">' +
          '<div class="ios-cell ios-input-cell"><span class="ios-cell-label">名称</span><input class="ios-input" id="input-dev-name" placeholder="例如：前门门禁" value="' + (self._formName||'') + '" maxlength="20"></div>' +
          '<div class="ios-cell ios-input-cell"><span class="ios-cell-label">位置</span><input class="ios-input" id="input-dev-location" placeholder="例如：一楼大厅" value="' + (self._formLocation||'') + '" maxlength="50"></div>' +
          '</div>' +
          '<div class="ios-footer-note"><div>设备类型：热点配网设备</div><div>设备 SN：' + (self._deviceSN || '自动生成') + '</div><div>已连网络：' + (self._ssid || '') + '</div></div>' +
          '<button class="ios-btn ios-btn-primary" id="btn-submit-device">完成添加</button>';
      }
      container.innerHTML = h;
      this._bindEvents();
    },
    _bindEvents: function() {
      var self = this;
      var btnScan = document.getElementById('btn-scan-toggle');
      if (btnScan) btnScan.onclick = function() { if (self._scanning) self._stopScan(); else self._startScan(); };
      var btnBack1 = document.getElementById('btn-back-step1');
      if (btnBack1) btnBack1.onclick = function() { self._step = 1; self._selectedDevice = null; self._configuring = false; self._render(); };
      var btnConfig = document.getElementById('btn-start-config');
      if (btnConfig) btnConfig.onclick = function() { self._startConfig(); };
      var btnTogglePwd = document.getElementById('btn-toggle-pwd');
      if (btnTogglePwd) btnTogglePwd.onclick = function() {
        var inp = document.getElementById('input-password');
        if (inp.type === 'password') { inp.type = 'text'; btnTogglePwd.textContent = '隐藏'; }
        else { inp.type = 'password'; btnTogglePwd.textContent = '显示'; }
      };
      var btnSubmit = document.getElementById('btn-submit-device');
      if (btnSubmit) btnSubmit.onclick = function() { self._submitDevice(); };
      // Device list click
      var cells = document.querySelectorAll('#add-device-content .ios-cell[data-device-index]');
      for (var i = 0; i < cells.length; i++) {
        cells[i].onclick = function() {
          var idx = parseInt(this.getAttribute('data-device-index'));
          self._selectedDevice = self._devices[idx];
          self._step = 2; self._configuring = false; self._render();
        };
      }
    },
    _startScan: function() {
      this._scanning = true; this._devices = []; this._render();
      var self = this;
      // Simulation: In real H5, WiFi scanning isn't available.
      // Instead, show manual connection instructions.
      setTimeout(function() {
        Modal.show({
          title: '搜索设备热点',
          content: 'H5 环境无法直接扫描 Wi-Fi。请手动连接到设备热点（SSID 以 "PalmDoor_" 开头），连接成功后点击"确定"。',
          confirmText: '已连接', cancelText: '取消',
          onConfirm: function() {
            self._devices = [{ SSID: 'PalmDoor_DEVICE', BSSID: '00:00:00:00', rssiText: '中', signalStrength: -65 }];
            self._scanning = false; self._render();
          },
          onCancel: function() { self._scanning = false; self._render(); }
        });
      }, 1500);
    },
    _stopScan: function() { this._scanning = false; clearTimeout(this._scanTimer); this._render(); },
    _startConfig: function() {
      var ssidInp = document.getElementById('input-ssid');
      var pwdInp = document.getElementById('input-password');
      this._ssid = ssidInp ? ssidInp.value.trim() : '';
      this._password = pwdInp ? pwdInp.value.trim() : '';
      if (!this._ssid) { Toast.error('请输入WiFi名称'); return; }
      this._configuring = true; this._render();
      var self = this;
      // Simulate provisioning
      var progress = 10;
      var statuses = ['正在连接设备热点...', '已连接，正在发送WiFi配置...', '设备正在连接目标网络...', '配网成功！'];
      var i = 0;
      var timer = setInterval(function() {
        if (i < statuses.length) {
          document.getElementById('config-status-text').textContent = statuses[i];
          progress += 25;
          var bar = document.getElementById('config-progress-bar');
          if (bar) bar.style.width = Math.min(progress, 100) + '%';
          i++;
        } else {
          clearInterval(timer);
          self._deviceSN = 'PALM_' + Date.now().toString(36).toUpperCase().substr(-8);
          self._configuring = false; self._step = 3; self._render();
          Toast.success('配网成功！');
        }
      }, 1500);
    },
    _submitDevice: function() {
      var nameInp = document.getElementById('input-dev-name');
      var locInp = document.getElementById('input-dev-location');
      this._formName = nameInp ? nameInp.value.trim() : '';
      this._formLocation = locInp ? locInp.value.trim() : '';
      if (!this._formName || !this._formLocation) { Toast.error('请填写设备名称和安装位置'); return; }
      var newDevice = {
        id: Date.now(), name: this._formName, sn: this._deviceSN || ('DEV_' + Math.random().toString(36).substr(2,6).toUpperCase()),
        location: this._formLocation, icon: 'images/device-door.png',
        status: 'online', version: 'v1.0.0', lastOnline: new Date().toLocaleString(),
        createTime: new Date().toISOString()
      };
      Loading.show('保存中...');
      var self = this;
      setTimeout(function() {
        App.addDevice(newDevice);
        Loading.hide(); Toast.success('添加成功');
        setTimeout(function() { Router.goBack(); }, 1200);
      }, 500);
    }
  };

  // ---------- add-person (人员添加+掌纹注册) ----------
  Pages['add-person'] = {
    _deviceInfo: {}, _mqtt: null, _mqttConnected: false,
    _formName: '', _formUserId: '', _formCardNo: '', _formDept: '', _formPerm: 'normal',
    _palmStatus: 'ready', _palmId: '', _palmQuality: 0, _palmRegisteredAt: '',
    _scanning: false, _scanProgress: 0, _scanStep: 0, _scanError: null, _scanSuccess: false,
    _departments: ['技术部','行政部','人事部','财务部','市场部','销售部','研发部','运维部','保安部','其他'],
    _permissions: [{name:'普通用户',value:'normal'},{name:'管理员',value:'admin'},{name:'超级管理员',value:'super'}],
    _selectedDept: 0, _selectedPerm: 0,
    _registrationTimeout: null,

    onShow: function(params) {
      var p = params || Router.getParams();
      var id = p.id; var sn = p.sn || ''; var name = p.name || '';
      if (!sn) {
        var list = Storage.get('deviceList') || [];
        var dev = null;
        for (var i = 0; i < list.length; i++) { if (Number(list[i].id) === Number(id)) { dev = list[i]; break; } }
        if (dev) { sn = dev.sn; name = dev.name; }
        else if (list.length > 0) { dev = list[0]; sn = dev.sn; name = dev.name; }
        else { sn = '1020BA76B888'; name = '默认设备'; }
      }
      this._deviceInfo = { id: Number(id) || 1, sn: sn, name: name, status: 'offline', online: false };
      this._mqtt = getMqttClient();
      this._mqttConnected = this._mqtt.isConnected;
      this._render();
      this._setupMqttListeners();
    },
    _setupMqttListeners: function() {
      var self = this;
      this._mqtt.onMessage = function(topic, message) {
        try {
          var data = typeof message === 'string' ? JSON.parse(message) : message;
          if (topic.indexOf('/resp') >= 0) self._handleDeviceResponse(data);
        } catch(e) {}
      };
    },
    _handleDeviceResponse: function(response) {
      if (this._palmStatus === 'success') return;
      if (response.result === 'success' || response.ret_code === 0) {
        this._palmId = (response.user_id !== undefined ? response.user_id : (response.userId || response.userID)) || '';
        this._palmQuality = response.quality || 100;
        this._palmRegisteredAt = new Date().toISOString();
        this._palmStatus = 'success'; this._scanning = false; this._scanProgress = 100;
        this._scanSuccess = true; this._scanError = null;
        if (this._palmId && !this._formUserId) { this._formUserId = String(this._palmId).padStart(4, '0'); }
        clearTimeout(this._registrationTimeout);
        Toast.success('掌纹注册成功');
        vibrate(15);
        this._render();
      } else {
        this._palmStatus = 'error'; this._scanning = false;
        this._scanError = response.message || response.error || '注册失败';
        clearTimeout(this._registrationTimeout);
        this._render();
      }
    },
    _render: function() {
      var c = document.getElementById('add-person-content');
      if (!c) return;
      var self = this;
      var deptOpts = '', permOpts = '';
      for (var i = 0; i < this._departments.length; i++) deptOpts += '<option value="' + i + '"' + (i === this._selectedDept ? ' selected' : '') + '>' + this._departments[i] + '</option>';
      for (var j = 0; j < this._permissions.length; j++) permOpts += '<option value="' + j + '"' + (j === this._selectedPerm ? ' selected' : '') + '>' + this._permissions[j].name + '</option>';

      var scanCardClass = '';
      if (this._scanning) scanCardClass = ' scanning';
      else if (this._scanSuccess) scanCardClass = ' success';
      else if (this._scanError) scanCardClass = ' error';

      var scanMsg = this._scanSuccess ? '掌纹已录入' : (this._scanning ? '扫描中...' : '准备扫描');
      var scanDesc = this._scanning ? '请保持手掌稳定' : (this._scanSuccess ? '掌纹录入成功' : '点击下方按钮开始扫描');

      // Scan status card
      var scanHTML = '<div class="scan-section"><div class="section-title"><span class="title-text">掌纹信息</span>' +
        '<span class="title-status"><span class="status-icon">👋</span><span class="status-text">' + (this._palmId ? '已录入' : '未录入') + '</span></span></div>' +
        '<div class="scan-status-card' + scanCardClass + '">' +
        '<div class="palm-icon-container"><div class="palm-icon-bg' + (this._scanning ? ' scanning' : '') + '"><span class="palm-icon-text">👋</span></div>' +
        (this._scanning ? '<div class="scan-ring scan-ring-1"></div><div class="scan-ring scan-ring-2"></div><div class="scan-ring scan-ring-3"></div>' : '') +
        '</div><div class="status-display"><div class="status-main' + (this._scanSuccess ? ' success' : '') + (this._scanError ? ' error' : '') + '">' + scanMsg + '</div>' +
        '<div class="status-desc">' + scanDesc + '</div></div>';

      if (this._scanProgress > 0 || this._scanning) {
        scanHTML += '<div class="progress-container"><div class="progress-info"><span class="progress-label">扫描进度</span><span class="progress-value">' + (this._scanProgress || 0) + '%</span></div>' +
          '<div class="progress-bar-container"><div class="progress-fill" style="width:' + (this._scanProgress || 0) + '%"></div></div></div>';
      }
      if (this._scanError) {
        scanHTML += '<div class="error-panel"><span class="error-icon">⚠️</span><div class="error-content"><span class="error-title">扫描失败</span><span class="error-text">' + this._scanError + '</span></div></div>';
      }
      scanHTML += '</div>';

      if (this._palmId) {
        scanHTML += '<div class="palm-info-card"><div class="palm-info-header"><span class="palm-info-title">📄 掌纹信息</span>' +
          '<span class="palm-info-status">' + (this._palmQuality >= 80 ? '优质' : (this._palmQuality >= 60 ? '良好' : '需重录')) + '</span></div>' +
          '<div class="palm-info-list"><div class="info-row"><span class="info-label">掌纹ID:</span><span class="info-value">' + (this._palmId || '--') + '</span></div>' +
          '<div class="info-row"><span class="info-label">质量评分:</span><span class="info-value ' + (this._palmQuality >= 80 ? 'good' : (this._palmQuality >= 60 ? 'normal' : 'poor')) + '">' + (this._palmQuality || 0) + '</span></div>' +
          '<div class="info-row"><span class="info-label">录入时间:</span><span class="info-value">' + (this._palmRegisteredAt || '--') + '</span></div></div></div>';
      }

      scanHTML += '<div class="scan-btn-container"><button class="scan-btn' + (this._scanning ? ' scanning' : '') + (this._scanSuccess ? ' success' : '') + '" id="btn-scan-palm" ' + (this._scanning ? 'disabled' : '') + '>' +
        '<span class="btn-content"><span class="btn-icon-text">' + (this._scanning ? '⏸️' : (this._scanSuccess ? '✓' : '👋')) + '</span>' +
        '<span class="btn-text">' + (this._scanning ? '扫描中...' : (this._scanSuccess ? '重新录入掌纹' : '开始录入掌纹')) + '</span>' +
        (!this._scanning && !this._scanSuccess ? '<span class="btn-subtext">点击开始</span>' : '') + '</span></button></div>';

      if (!this._scanning && !this._scanSuccess) {
        scanHTML += '<div class="scan-tips-card"><div class="tip-header"><span class="tip-icon">📋</span><span class="tip-title">扫描提示</span></div>' +
          '<div class="tip-list"><div class="tip-item"><span class="tip-number">1</span><span class="tip-text">将手掌平放在设备扫描区域</span></div>' +
          '<div class="tip-item"><span class="tip-number">2</span><span class="tip-text">保持手掌稳定3-5秒</span></div>' +
          '<div class="tip-item"><span class="tip-number">3</span><span class="tip-text">确保光线充足，手掌干净</span></div>' +
          '<div class="tip-item"><span class="tip-number">4</span><span class="tip-text">避免戴手套或手部有污渍</span></div></div></div>';
      }
      scanHTML += '</div>';

      // Form
      var nameValid = this._formName.length >= 2 && this._formName.length <= 20;
      var userIdValid = /^[A-Za-z0-9_]{4,20}$/.test(this._formUserId);
      var formComplete = nameValid && userIdValid && !!this._palmId;

      scanHTML += '<div class="form-section"><div class="section-header"><span class="section-icon">👤</span><span class="section-title-text">人员信息</span></div>' +
        '<div class="form-item"><div class="form-label"><span class="required-star">*</span>姓名</div>' +
        '<div class="form-input-container"><span class="input-icon">👤</span><input class="form-input' + (this._formName ? (nameValid ? ' valid' : ' invalid') : '') + '" id="input-name" placeholder="请输入姓名（2-20个字符）" value="' + this._formName + '" maxlength="20"></div></div>' +
        '<div class="form-item"><div class="form-label"><span class="required-star">*</span>用户ID</div>' +
        '<div class="form-input-container"><span class="input-icon">🆔</span><input class="form-input' + (this._formUserId ? (userIdValid ? ' valid' : ' invalid') : '') + '" id="input-userid" placeholder="用户ID（4-20位字母数字）" value="' + this._formUserId + '" maxlength="20"></div></div>' +
        '<div class="form-item"><div class="form-label">卡号</div>' +
        '<div class="form-input-container"><span class="input-icon">💳</span><input class="form-input" id="input-cardno" placeholder="请输入卡号（选填）" value="' + (this._formCardNo||'') + '" maxlength="20"></div></div>' +
        '<div class="form-item"><div class="form-label">部门</div>' +
        '<div class="picker-container"><span class="picker-icon">🏢</span><select class="form-input" id="select-dept" style="padding-left:0.5rem">' + deptOpts + '</select></div></div>' +
        '<div class="form-item"><div class="form-label">权限</div>' +
        '<div class="picker-container"><span class="picker-icon">🔐</span><select class="form-input" id="select-perm" style="padding-left:0.5rem">' + permOpts + '</select></div></div>';

      if (!formComplete) {
        scanHTML += '<div class="form-validation"><span class="validation-icon">⚠️</span><span class="validation-text">' +
          (!nameValid ? '请填写正确的姓名' : (!userIdValid ? '请填写正确的用户ID' : (!this._palmId ? '请先录入掌纹' : '请填写完整信息'))) + '</span></div>';
      }
      scanHTML += '</div>';

      // Actions
      scanHTML += '<div class="action-section"><div class="action-buttons">' +
        '<button class="action-btn btn-clear" id="btn-clear-form">清空</button>' +
        '<button class="action-btn btn-save' + (formComplete ? '' : ' disabled') + '" id="btn-save-person" ' + (!formComplete ? 'disabled' : '') + '>保存人员</button>' +
        '</div></div>';

      c.innerHTML = scanHTML;
      this._bindFormEvents();
    },
    _bindFormEvents: function() {
      var self = this;
      var btnScan = document.getElementById('btn-scan-palm');
      if (btnScan) btnScan.onclick = function() { self._startPalmRegistration(); };
      var btnClear = document.getElementById('btn-clear-form');
      if (btnClear) btnClear.onclick = function() {
        self._formName = ''; self._formUserId = ''; self._formCardNo = ''; self._formDept = ''; self._formPerm = 'normal';
        self._palmId = ''; self._palmQuality = 0; self._palmRegisteredAt = ''; self._palmStatus = 'ready';
        self._scanning = false; self._scanProgress = 0; self._scanSuccess = false; self._scanError = null;
        self._selectedDept = 0; self._selectedPerm = 0; self._render();
      };
      var btnSave = document.getElementById('btn-save-person');
      if (btnSave) btnSave.onclick = function() { self._savePerson(); };

      var inpName = document.getElementById('input-name');
      if (inpName) inpName.oninput = function() { self._formName = this.value.trim(); self._render(); };
      var inpUserId = document.getElementById('input-userid');
      if (inpUserId) inpUserId.oninput = function() { self._formUserId = this.value.trim(); self._render(); };
      var inpCard = document.getElementById('input-cardno');
      if (inpCard) inpCard.oninput = function() { self._formCardNo = this.value.trim(); };
      var selDept = document.getElementById('select-dept');
      if (selDept) selDept.onchange = function() { self._selectedDept = parseInt(this.value); self._formDept = self._departments[self._selectedDept]; };
      var selPerm = document.getElementById('select-perm');
      if (selPerm) selPerm.onchange = function() { self._selectedPerm = parseInt(this.value); self._formPerm = self._permissions[self._selectedPerm].value; };
    },
    _startPalmRegistration: function() {
      if (!this._formName) { Toast.error('请先填写姓名'); return; }
      if (!this._mqttConnected) { Toast.error('设备未连接'); return; }
      var self = this;
      this._palmStatus = 'registering'; this._scanning = true; this._scanProgress = 10; this._scanStep = 1; this._scanError = null; this._scanSuccess = false;
      this._render();
      var deviceSn = this._deviceInfo.sn;
      var cmdData = { type:'command', cmd:'111', msgId:'palm_register_'+Date.now()+'_'+Math.random().toString(36).substr(2,9), timestamp:Date.now(), device:deviceSn, action:'register_palm', client:'h5app', userInfo:{name:this._formName} };
      try {
        this._mqtt.publish('palmdoor/' + deviceSn + '/cmd', JSON.stringify(cmdData), 1);
        this._scanProgress = 50; this._scanStep = 2; this._render();
        this._registrationTimeout = setTimeout(function() {
          if (self._palmStatus === 'registering') {
            self._palmStatus = 'error'; self._scanning = false;
            self._scanError = '设备响应超时，请检查设备状态'; self._render();
          }
        }, 30000);
      } catch(e) {
        this._palmStatus = 'error'; this._scanning = false; this._scanError = '发送指令失败'; this._render();
      }
    },
    _savePerson: function() {
      var nameValid = this._formName.length >= 2;
      var userIdValid = /^[A-Za-z0-9_]{4,20}$/.test(this._formUserId);
      if (!nameValid || !userIdValid || !this._palmId) { Toast.error('请填写完整信息并录入掌纹'); return; }
      var personList = Storage.get('person_list') || [];
      for (var i = 0; i < personList.length; i++) { if (personList[i].userId === this._formUserId) { Toast.error('该用户ID已存在'); return; } }
      var personData = {
        name: this._formName, userId: this._formUserId, cardNo: this._formCardNo,
        department: this._departments[this._selectedDept], permission: this._permissions[this._selectedPerm].value,
        palmData: { hasPalm: true, palmId: this._palmId, palmQuality: this._palmQuality, palmRegisteredAt: this._palmRegisteredAt },
        createdAt: new Date().toISOString(), status: 'active', deviceSn: this._deviceInfo.sn
      };
      personList.push(personData);
      Storage.set('person_list', personList);
      // Send to device
      var palmIdNum = parseInt(this._palmId, 10);
      if (this._mqtt.isConnected && !isNaN(palmIdNum) && this._deviceInfo.sn) {
        this._mqtt.publish('palmdoor/' + this._deviceInfo.sn + '/cmd', JSON.stringify({ type:'control_command', cmd:'add_person', palm_id:palmIdNum, name:this._formName, work_no:this._formUserId, msgId:'add_person_'+Date.now() }), { qos: 1 });
      }
      Toast.success('人员保存成功');
      setTimeout(function() { Router.goBack(); }, 1500);
    }
  };

  // ---------- person-manage (人员管理) ----------
  Pages['person-manage'] = {
    _personList: [],
    onShow: function() {
      this._loadData();
      this._render();
    },
    _loadData: function() {
      var list = Storage.get('person_list') || [];
      this._personList = [];
      for (var i = 0; i < list.length; i++) {
        var p = list[i]; var pd = p.palmData || {};
        this._personList.push({
          id: p.userId || ('P' + (i+1)), userId: p.userId || '', workNumber: p.userId || ('UID'+(i+1)),
          name: p.name || '未命名', department: p.department || '未分配部门',
          cardNo: p.cardNo || '', permission: p.permission || '', createdAt: p.createdAt || '',
          hasPalm: pd.hasPalm || false, palmId: pd.palmId || '', palmQuality: pd.palmQuality || 0,
          palmRegisteredAt: pd.palmRegisteredAt || '',
          palmStatus: pd.hasPalm ? (pd.palmQuality >= 80 ? 'normal' : (pd.palmQuality >= 60 ? 'warning' : 'abnormal')) : 'abnormal'
        });
      }
    },
    _render: function() {
      var c = document.getElementById('person-list-container');
      if (!c) return;
      var keyword = (document.getElementById('person-search') || {}).value || '';
      var filtered = this._personList;
      if (keyword) {
        var kw = keyword.toLowerCase();
        filtered = this._personList.filter(function(p) {
          return (p.name && p.name.toLowerCase().indexOf(kw) >= 0) ||
            (p.workNumber && p.workNumber.toString().indexOf(kw) >= 0) ||
            (p.userId && p.userId.toString().indexOf(kw) >= 0) ||
            (p.department && p.department.toLowerCase().indexOf(kw) >= 0);
        });
      }
      document.getElementById('person-search-clear').style.display = keyword ? '' : 'none';
      if (filtered.length === 0) {
        c.innerHTML = '<div class="empty-state"><div class="empty-icon">👤</div><div class="empty-text">' + (keyword ? '未找到匹配的人员' : '暂无人员信息') + '</div></div>';
        return;
      }
      var h = '';
      for (var i = 0; i < filtered.length; i++) {
        var p = filtered[i];
        h += '<div class="person-card">' +
          '<div class="card-header"><div class="user-info"><div class="user-avatar"><span>' + (p.name.charAt(0) || '?') + '</span></div>' +
          '<div class="user-main"><div class="user-name">' + p.name + '</div><div class="user-id">工号: ' + p.workNumber + '</div></div></div>' +
          '<div class="user-status ' + p.palmStatus + '"><span>' + (p.palmStatus === 'normal' ? '✓' : '⚠️') + '</span><span>' + (p.palmStatus === 'normal' ? '正常' : (p.palmStatus === 'warning' ? '警告' : '异常')) + '</span></div></div>' +
          '<div class="card-body"><div class="info-row"><div class="info-item"><span class="detail-label">部门</span><span class="detail-value">' + p.department + '</span></div>' +
          '<div class="info-item"><span class="detail-label">录入时间</span><span class="detail-value">' + (p.createdAt || '-') + '</span></div></div>' +
          '<div class="palm-info-section"><div class="palm-header"><span class="palm-label">掌纹状态</span><span class="palm-indicator ' + (p.hasPalm ? 'has-palm' : 'no-palm') + '">' + (p.hasPalm ? '已录入' : '未录入') + '</span></div>' +
          (p.hasPalm ? '<div class="palm-detail"><div class="detail-row"><span class="detail-label">质量评分</span><span class="quality-badge ' + (p.palmQuality >= 80 ? 'good' : (p.palmQuality >= 60 ? 'normal' : 'poor')) + '">' + p.palmQuality + '</span></div>' +
          '<div class="detail-row"><span class="detail-label">录入时间</span><span class="detail-value">' + (p.palmRegisteredAt || '-') + '</span></div></div>' : '') + '</div></div>' +
          '<div class="card-actions">' +
          '<button class="btn-action btn-detail" data-action="detail" data-idx="' + i + '">👁️ 详情</button>' +
          '<button class="btn-action btn-delete" data-action="delete" data-idx="' + i + '">🗑️ 删除</button></div></div>';
      }
      c.innerHTML = h;
      this._bindEvents(filtered);
    },
    _bindEvents: function(filtered) {
      var self = this;
      var btns = document.querySelectorAll('#person-list-container .btn-action');
      for (var i = 0; i < btns.length; i++) {
        btns[i].onclick = function() {
          var idx = parseInt(this.getAttribute('data-idx'));
          var p = filtered[idx]; if (!p) return;
          var action = this.getAttribute('data-action');
          if (action === 'detail') {
            Modal.alert('人员详情', '姓名: ' + p.name + '\n工号: ' + p.workNumber + '\n部门: ' + p.department + '\n掌纹状态: ' + (p.palmStatus === 'normal' ? '正常' : (p.palmStatus === 'warning' ? '警告' : '异常')) + '\n质量评分: ' + p.palmQuality + '\n录入时间: ' + p.createdAt);
          } else if (action === 'delete') {
            Modal.show({
              title: '确认删除', content: '确定要删除"' + p.name + '"吗？',
              confirmText: '删除', confirmColor: 'danger',
              onConfirm: function() {
                var list = Storage.get('person_list') || [];
                list = list.filter(function(item) { return item.userId !== p.userId; });
                Storage.set('person_list', list);
                // Send delete to device
                var client = getMqttClient();
                if (client.isConnected) {
                  var devList = Storage.get('deviceList') || [];
                  var devSn = devList.length > 0 ? (devList[0].sn || '') : '';
                  if (devSn && p.palmId) {
                    var pid = parseInt(p.palmId, 10);
                    if (!isNaN(pid)) client.publish('palmdoor/' + devSn + '/cmd', JSON.stringify({ type:'delete_palm', cmd:'delete_palm', user_id:pid, msgId:'del_'+Date.now() }), { qos: 1 });
                  }
                }
                Toast.success('删除成功');
                self._loadData(); self._render();
              }
            });
          }
        };
      }
    },
    filter: function() { this._render(); },
    clearSearch: function() { document.getElementById('person-search').value = ''; this._render(); }
  };

  // ---------- remote-open (远程开门) ----------
  Pages['remote-open'] = {
    _device: null, _mqtt: null, _mqttConnected: false, _doorStatus: 'normal',
    onShow: function(params) {
      var p = params || Router.getParams(); var id = Number(p.id);
      var list = Storage.get('deviceList') || [];
      for (var i = 0; i < list.length; i++) { if (Number(list[i].id) === id) { this._device = list[i]; break; } }
      if (!this._device) { Toast.error('设备不存在'); setTimeout(function() { Router.goBack(); }, 1500); return; }
      this._mqtt = getMqttClient(); this._mqttConnected = this._mqtt.isConnected;
      this._render();
    },
    _render: function() {
      var c = document.getElementById('remote-open-content'); if (!c) return;
      var d = this._device; var online = d.status === 'online';
      var isOpening = this._doorStatus === 'opening', isAlwaysOpen = this._doorStatus === 'always_open', isClosed = this._doorStatus === 'closed';
      var doorText = isOpening ? '正在开门' : (isAlwaysOpen ? '常开' : '正常');
      var orbClass = isOpening ? ' orb-opening' : (isAlwaysOpen ? ' orb-always-open' : ' orb-closed');
      var orbEmoji = isOpening ? '🔓' : (isAlwaysOpen ? '⏳' : '🔒');
      var statusColorClass = isOpening ? ' text-green' : (isAlwaysOpen ? ' text-orange' : ' text-red');

      var h = '<div class="device-header-card"><div class="device-basic"><div class="device-icon-box">🚪</div>' +
        '<div><div class="device-name-text">' + (d.name || '智能门禁') + '</div><div class="device-sn-text">SN: ' + (d.sn || '获取中...') + '</div></div></div>' +
        '<div class="status-badges"><span class="badge ' + (online ? 'badge-online' : 'badge-offline') + '"><span class="dot"></span>' + (online ? '设备在线' : '设备离线') + '</span>' +
        '<span class="badge ' + (this._mqttConnected ? 'badge-mqtt-on' : 'badge-mqtt-off') + '">MQTT: ' + (this._mqttConnected ? '已连接' : '未连接') + '</span></div></div>' +
        '<div class="status-display-section"><div class="status-orb' + orbClass + '"><div class="orb-inner"><span class="orb-icon">' + orbEmoji + '</span></div></div>' +
        '<div class="status-title' + statusColorClass + '">' + doorText + '</div><div class="status-subtitle">物理门锁: 未知</div></div>' +
        '<div class="control-grid">' +
        '<div class="grid-card card-primary" id="btn-open"><div class="card-icon-wrapper">🔓</div><div class="card-title">远程开门</div><div class="card-desc">单次解锁开门</div></div>' +
        '<div class="grid-card card-danger" id="btn-close"><div class="card-icon-wrapper">🔒</div><div class="card-title">关门落锁</div><div class="card-desc">立即关闭门锁</div></div>' +
        '<div class="grid-card ' + (isAlwaysOpen ? 'card-warning-active' : 'card-warning') + '" id="btn-always"><div class="card-icon-wrapper">' + (isAlwaysOpen ? '🛑' : '⚙️') + '</div><div class="card-title">' + (isAlwaysOpen ? '关闭常开' : '保持常开') + '</div><div class="card-desc">' + (isAlwaysOpen ? '正在通道模式' : '进入通道模式') + '</div></div>' +
        '<div class="grid-card card-neutral" id="btn-reboot"><div class="card-icon-wrapper">🔄</div><div class="card-title">设备重启</div><div class="card-desc">远程重启门禁</div></div>' +
        '</div>';
      c.innerHTML = h;
      this._bindEvents();
    },
    _bindEvents: function() {
      var self = this;
      var open = document.getElementById('btn-open'); if (open) open.onclick = function() { self._sendCommand('door_open'); };
      var close = document.getElementById('btn-close'); if (close) close.onclick = function() { self._sendCommand('door_close'); };
      var always = document.getElementById('btn-always'); if (always) always.onclick = function() { self._sendCommand(self._doorStatus === 'always_open' ? 'door_cancel_always_open' : 'door_always_open'); };
      var reboot = document.getElementById('btn-reboot'); if (reboot) reboot.onclick = function() {
        Modal.show({ title: '重启设备', content: '确定要远程重启门禁设备吗？', confirmText: '确认重启', confirmColor: 'danger',
          onConfirm: function() {
            if (self._mqtt.isConnected && self._device.sn) {
              self._mqtt.publish('palmdoor/' + self._device.sn + '/cmd', JSON.stringify({ type:'control_command', cmd:'restart', msgId:'reboot_'+Date.now(), timestamp:Date.now(), device:self._device.sn, client:'h5app' }), 0);
              Toast.success('重启指令已发送');
            } else { Toast.error('设备离线'); }
          }
        });
      };
    },
    _sendCommand: function(cmd) {
      if (!this._mqttConnected) { Toast.error('MQTT未连接'); return; }
      if (!this._device || this._device.status !== 'online') { Toast.error('设备离线'); return; }
      var cmdMap = { door_open: 'door_open', door_close: 'door_close', door_always_open: 'door_always_open', door_cancel_always_open: 'door_cancel_always_open' };
      var action = cmdMap[cmd] || cmd;
      Loading.show('发送指令中...');
      var self = this;
      try {
        this._mqtt.publish('palmdoor/' + this._device.sn + '/cmd', JSON.stringify({ type:'control_command', cmd:action, msgId:'door_'+action+'_'+Date.now(), timestamp:Date.now(), device:this._device.sn, action:cmd, client:'h5app' }), 0);
        setTimeout(function() { Loading.hide(); Toast.success('指令已发送'); }, 500);
      } catch(e) { Loading.hide(); Toast.error('发送失败'); }
    }
  };

  // ---------- device (设备指令调试) ----------
  Pages.device = {
    _deviceSn: '', _deviceName: '', _logMessages: [],
    onShow: function(params) {
      var p = params || Router.getParams();
      this._deviceSn = p.sn || ''; this._deviceName = p.name || '';
      if (!this._deviceSn) {
        var list = Storage.get('deviceList') || [];
        if (list.length > 0) { this._deviceSn = list[0].sn; this._deviceName = list[0].name; }
        else { document.getElementById('device-content').innerHTML = '<p style="padding:1rem;text-align:center">未找到设备信息</p>'; return; }
      }
      this._render();
    },
    _render: function() {
      var c = document.getElementById('device-content'); if (!c) return;
      var client = getMqttClient();
      var connected = client.isConnected;
      var h = '<div class="status-bar">' + (connected ? '已连接 (' + this._deviceSn + ')' : 'MQTT 未连接') + '</div>' +
        '<div class="control-section"><button class="ctrl-btn ctrl-btn-primary" id="btn-connect" ' + (connected ? 'disabled' : '') + '>' + (connected ? 'MQTT已连接' : '连接MQTT') + '</button>' +
        '<button class="ctrl-btn ctrl-btn-warn" id="btn-disconnect" ' + (!connected ? 'disabled' : '') + '>断开连接</button></div>' +
        '<div class="quick-commands">' +
        '<button class="quick-btn" data-cmd="000" ' + (!connected ? 'disabled' : '') + '>删除全部掌纹</button>' +
        '<button class="quick-btn" data-cmd="111" ' + (!connected ? 'disabled' : '') + '>注册掌纹</button>' +
        '<button class="quick-btn" data-cmd="222" ' + (!connected ? 'disabled' : '') + '>识别掌纹</button></div>' +
        '<div class="input-section"><input id="input-custom-cmd" placeholder="输入自定义指令"><button class="ctrl-btn ctrl-btn-primary" id="btn-send-custom" ' + (!connected ? 'disabled' : '') + ' style="flex:0 0 auto">发送</button></div>' +
        '<div class="log-section"><div class="log-header"><span>设备响应日志</span><button id="btn-clear-log" style="cursor:pointer;border:none;background:#eee;padding:0.05rem 0.15rem;border-radius:0.1rem;font-size:0.22rem">清空</button></div>' +
        '<div class="log-container" id="log-container">' + this._buildLogHTML() + '</div></div>';
      c.innerHTML = h;
      this._bindEvents();
    },
    _buildLogHTML: function() {
      var h = '';
      for (var i = 0; i < this._logMessages.length; i++) {
        h += '<div class="log-item"><span class="log-time">[' + this._logMessages[i].time + ']</span><span class="log-text">' + this._logMessages[i].text + '</span></div>';
      }
      return h;
    },
    _addLog: function(text) {
      var now = new Date();
      var time = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0') + ':' + String(now.getSeconds()).padStart(2,'0');
      this._logMessages.push({ time: time, text: text });
      if (this._logMessages.length > 100) this._logMessages.shift();
      var lc = document.getElementById('log-container');
      if (lc) { lc.innerHTML = this._buildLogHTML(); lc.scrollTop = lc.scrollHeight; }
    },
    _bindEvents: function() {
      var self = this; var client = getMqttClient();
      var btnConnect = document.getElementById('btn-connect');
      if (btnConnect) btnConnect.onclick = function() { client.connectWithStoredConfig(); self._addLog('正在连接MQTT...'); setTimeout(function() { self._render(); }, 2000); };
      var btnDisconnect = document.getElementById('btn-disconnect');
      if (btnDisconnect) btnDisconnect.onclick = function() { client.disconnect(); self._addLog('主动断开连接'); self._render(); };
      var btnClearLog = document.getElementById('btn-clear-log');
      if (btnClearLog) btnClearLog.onclick = function() { self._logMessages = []; self._render(); };
      var btnSendCustom = document.getElementById('btn-send-custom');
      if (btnSendCustom) btnSendCustom.onclick = function() {
        var inp = document.getElementById('input-custom-cmd'); var cmd = inp ? inp.value.trim() : '';
        if (!cmd) { Toast.error('指令不能为空'); return; }
        self._addLog('发送: ' + cmd);
        try { client.sendCommand(self._deviceSn, cmd); } catch(e) { self._addLog('错误: ' + e.message); }
        if (inp) inp.value = '';
      };
      var quickBtns = document.querySelectorAll('#device-content .quick-btn');
      for (var i = 0; i < quickBtns.length; i++) {
        quickBtns[i].onclick = function() {
          var cmd = this.getAttribute('data-cmd');
          if (!client.isConnected) { Toast.error('请先连接MQTT'); return; }
          var cmdMap = { '000':'删除全部掌纹', '111':'注册掌纹', '222':'识别掌纹' };
          self._addLog('发送: ' + (cmdMap[cmd] || cmd));
          try { client.sendCommand(self._deviceSn, cmd); } catch(e) { self._addLog('错误: ' + e.message); }
        };
      }
    }
  };

  // ---------- my (我的) ----------
  Pages.my = {
    onShow: function() {
      var c = document.getElementById('my-content'); if (!c) return;
      var user = SupabaseAuth.getUser();
      var email = user ? user.email : '未登录';
      var h = '<div class="my-header"><div class="my-avatar">👤</div><div class="my-name">' + email + '</div><div class="my-role">设备管理系统</div></div>' +
        '<div class="my-menu">' +
        '<div class="my-menu-item" onclick="Router.navigate(\'mqtt-settings\')"><div class="my-menu-icon" style="background:#e6f7ff">⚙️</div><span class="my-menu-text">MQTT 配置</span><span class="my-menu-arrow">›</span></div>' +
        '<div class="my-menu-item" onclick="Router.navigate(\'system-info\')"><div class="my-menu-icon" style="background:#f6ffed">📱</div><span class="my-menu-text">系统信息</span><span class="my-menu-arrow">›</span></div>' +
        '<div class="my-menu-item" onclick="Router.navigate(\'person-manage\')"><div class="my-menu-icon" style="background:#fff7e6">👥</div><span class="my-menu-text">人员管理</span><span class="my-menu-arrow">›</span></div>' +
        '</div>' +
        '<div class="my-menu" style="margin-top:0.3rem">' +
        '<div class="my-menu-item" id="btn-logout" style="justify-content:center;color:#ff4d4f"><span style="font-size:0.3rem">退出登录</span></div>' +
        '</div>' +
        '<div style="text-align:center;color:#999;font-size:0.24rem;padding:0.5rem">PalmDoor 设备管理系统 v1.0.0</div>';
      c.innerHTML = h;
      var btnLogout = document.getElementById('btn-logout');
      if (btnLogout) btnLogout.onclick = function() {
        Modal.show({
          title: '退出登录', content: '确定要退出当前账户吗？',
          confirmText: '退出', confirmColor: 'danger',
          onConfirm: function() {
            Loading.show('退出中...');
            SyncStorage.flush().then(function() {
              return SupabaseAuth.signOut();
            }).then(function() {
              Loading.hide();
              try { App.mqttClient.disconnect(); } catch(e) {}
              Router._showPage('auth', {});
            }).catch(function() {
              Loading.hide();
              Toast.error('退出失败');
            });
          }
        });
      };
    }
  };

  // ---------- system-info (系统信息) ----------
  Pages['system-info'] = {
    onShow: function() {
      var c = document.getElementById('system-info-content'); if (!c) return;
      var client = getMqttClient();
      var deviceList = Storage.get('deviceList') || [];
      var personList = Storage.get('person_list') || [];
      var records = Storage.get('attendance_records') || [];
      var h = '<div class="info-card"><h3 style="margin:0 0 0.2rem">系统信息</h3>' +
        '<div class="info-item"><span class="info-label">MQTT状态</span><span class="info-value">' + (client.isConnected ? '已连接' : '未连接') + '</span></div>' +
        '<div class="info-item"><span class="info-label">设备数量</span><span class="info-value">' + deviceList.length + '</span></div>' +
        '<div class="info-item"><span class="info-label">人员数量</span><span class="info-value">' + personList.length + '</span></div>' +
        '<div class="info-item"><span class="info-label">考勤记录</span><span class="info-value">' + records.length + '</span></div>' +
        '<div class="info-item"><span class="info-label">平台</span><span class="info-value">H5 (Browser)</span></div>' +
        '<div class="info-item"><span class="info-label">UserAgent</span><span class="info-value" style="font-size:0.22rem;word-break:break-all">' + navigator.userAgent + '</span></div>' +
        '</div>';
      if (deviceList.length > 0) {
        h += '<div class="info-card"><h3 style="margin:0 0 0.2rem">设备列表</h3>';
        for (var i = 0; i < deviceList.length; i++) {
          var d = deviceList[i];
          h += '<div class="info-item"><span class="info-label">' + (d.name || '设备'+(i+1)) + '</span><span class="info-value">' + (d.status === 'online' ? '在线' : '离线') + ' | ' + (d.sn || 'N/A') + '</span></div>';
        }
        h += '</div>';
      }
      c.innerHTML = h;
    }
  };

  // ---------- mqtt-settings (MQTT配置) ----------
  Pages['mqtt-settings'] = {
    onShow: function() {
      var c = document.getElementById('mqtt-settings-content'); if (!c) return;
      var config = MQTT_DEFAULT_CONFIG;
      try { var saved = Storage.get('mqttConfig'); if (saved) config = saved; } catch(e) {}
      var h = '<div class="form-group"><h3 style="margin:0 0 0.3rem">MQTT 配置</h3>' +
        '<div class="form-item"><div class="form-label">Broker URL</div><input class="form-input" id="cfg-broker" value="' + (config.brokerUrl || '') + '"></div>' +
        '<div class="form-item"><div class="form-label">用户名</div><input class="form-input" id="cfg-username" value="' + (config.username || '') + '"></div>' +
        '<div class="form-item"><div class="form-label">密码</div><input class="form-input" type="password" id="cfg-password" value="' + (config.password || '') + '"></div>' +
        '<div class="form-item"><div class="form-label">Keep Alive (秒)</div><input class="form-input" type="number" id="cfg-keepalive" value="' + (config.keepAlive || 30) + '"></div>' +
        '<button class="ios-btn ios-btn-primary" id="btn-save-mqtt">保存配置</button>' +
        '<button class="ios-btn ios-btn-secondary" id="btn-reconnect-mqtt" style="margin-top:0.15rem">重新连接</button></div>';
      c.innerHTML = h;
      document.getElementById('btn-save-mqtt').onclick = function() {
        var newConfig = {
          brokerUrl: document.getElementById('cfg-broker').value.trim(),
          username: document.getElementById('cfg-username').value.trim(),
          password: document.getElementById('cfg-password').value.trim(),
          keepAlive: parseInt(document.getElementById('cfg-keepalive').value) || 30
        };
        Storage.set('mqttConfig', newConfig);
        Toast.success('配置已保存');
      };
      document.getElementById('btn-reconnect-mqtt').onclick = function() {
        var client = getMqttClient();
        client.disconnect();
        setTimeout(function() { client.connectWithStoredConfig(); Toast.info('正在重新连接...'); }, 500);
      };
    }
  };

  // ---------- admin-transfer (管理员转让) ----------
  Pages['admin-transfer'] = {
    onShow: function() {
      var c = document.getElementById('admin-transfer-content'); if (!c) return;
      var personList = Storage.get('person_list') || [];
      var h = '<div class="form-group"><h3 style="margin:0 0 0.3rem">管理员转让</h3>' +
        '<p style="color:#999;font-size:0.26rem;margin-bottom:0.3rem">选择一位人员，将管理员权限转让给对方。转让后当前管理员将降级为普通用户。</p>' +
        '<div class="form-item"><div class="form-label">选择新管理员</div><select class="form-input" id="select-new-admin" style="padding-left:0.2rem">';
      for (var i = 0; i < personList.length; i++) {
        h += '<option value="' + i + '">' + personList[i].name + ' (' + (personList[i].userId || 'N/A') + ')</option>';
      }
      if (personList.length === 0) h += '<option>暂无人员</option>';
      h += '</select></div>' +
        '<button class="ios-btn ios-btn-primary" id="btn-transfer">确认转让</button></div>';
      c.innerHTML = h;
      var btn = document.getElementById('btn-transfer');
      if (btn) btn.onclick = function() {
        var sel = document.getElementById('select-new-admin');
        if (!sel || personList.length === 0) { Toast.error('暂无人员可转让'); return; }
        var idx = parseInt(sel.value);
        var person = personList[idx];
        Modal.show({
          title: '确认转让', content: '确定要将管理员权限转让给 "' + person.name + '" 吗？此操作不可撤销。',
          confirmText: '确认转让', confirmColor: 'danger',
          onConfirm: function() {
            for (var i = 0; i < personList.length; i++) { personList[i].permission = 'normal'; }
            personList[idx].permission = 'super';
            Storage.set('person_list', personList);
            Toast.success('管理员权限已转让');
            setTimeout(function() { Router.goBack(); }, 1500);
          }
        });
      };
    }
  };

  // ---------- attendance (考勤记录) ----------
  Pages.attendance = {
    _deviceId: null, _deviceSn: '', _deviceName: '',
    onShow: function(params) {
      var p = params || Router.getParams();
      this._deviceId = p.deviceId || ''; this._deviceSn = p.deviceSn || ''; this._deviceName = decodeURIComponent(p.deviceName || '') || '设备';
      this._render();
    },
    _render: function() {
      var c = document.getElementById('attendance-content'); if (!c) return;
      var records = Storage.get('attendance_records') || [];
      // Filter by device
      var filtered = records;
      if (this._deviceSn) {
        filtered = records.filter(function(r) { return r.deviceSn === this._deviceSn; }.bind(this));
      }
      var h = '<div class="attendance-header"><span class="attendance-title">考勤记录 (' + (this._deviceName || '全部') + ')</span>' +
        '<button class="attendance-btn" id="btn-export-att">导出</button></div>';
      if (filtered.length === 0) {
        h += '<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-text">暂无考勤记录</div></div>';
      } else {
        h += '<div style="overflow-x:auto"><table class="attendance-table"><thead><tr><th>姓名</th><th>工号</th><th>日期</th><th>打卡时间</th><th>状态</th></tr></thead><tbody>';
        for (var i = filtered.length - 1; i >= 0; i--) {
          var r = filtered[i];
          h += '<tr><td>' + (r.name || '-') + '</td><td>' + (r.workNumber || '-') + '</td><td>' + (r.date || '-') + '</td><td>' + (r.checkTime || '-') + '</td><td>' + (r.status || '正常') + '</td></tr>';
        }
        h += '</tbody></table></div>';
      }
      c.innerHTML = h;
      var btnExport = document.getElementById('btn-export-att');
      if (btnExport) btnExport.onclick = function() {
        Toast.info('H5环境下请使用浏览器截图或复制功能导出数据');
        // Build CSV
        var csv = '姓名,工号,日期,打卡时间,状态\n';
        for (var i = 0; i < filtered.length; i++) {
          csv += filtered[i].name + ',' + filtered[i].workNumber + ',' + filtered[i].date + ',' + filtered[i].checkTime + ',' + filtered[i].status + '\n';
        }
        // Download CSV
        var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = 'attendance_' + new Date().toISOString().slice(0,10) + '.csv';
        a.click(); URL.revokeObjectURL(url);
        Toast.success('导出完成');
      };
    }
  };

  // ---------- auth (登录/注册) ----------
  Pages.auth = {
    _mode: 'login',
    _email: '',
    _password: '',

    onShow: function() { this._render(); },

    _render: function() {
      var c = document.getElementById('auth-content');
      if (!c) return;
      var self = this;
      var isLogin = this._mode === 'login';
      var h = '<div class="auth-container">' +
        '<div class="auth-card">' +
        '<div class="auth-logo">🔐</div>' +
        '<div class="auth-app-name">设备管理系统</div>' +
        '<div class="auth-subtitle">' + (isLogin ? '登录你的账户' : '创建新账户') + '</div>' +
        '<div class="auth-form">' +
        '<div class="auth-input-group"><span class="auth-input-icon">📧</span>' +
        '<input class="auth-input" id="auth-email" type="email" placeholder="邮箱地址" value="' + this._email + '" autocomplete="email"></div>' +
        '<div class="auth-input-group"><span class="auth-input-icon">🔒</span>' +
        '<input class="auth-input" id="auth-password" type="password" placeholder="密码（至少6位）" value="' + this._password + '" autocomplete="' + (isLogin ? 'current-password' : 'new-password') + '"></div>' +
        '<div class="auth-error" id="auth-error" style="display:none"></div>' +
        '<button class="auth-btn" id="btn-auth-submit">' + (isLogin ? '登 录' : '注 册') + '</button>' +
        '</div>' +
        '<div class="auth-switch">' +
        (isLogin ? '还没有账户？' : '已有账户？') +
        '<span class="auth-link" id="btn-auth-switch">' + (isLogin ? '立即注册' : '去登录') + '</span>' +
        '</div></div></div>';
      c.innerHTML = h;

      document.getElementById('btn-auth-submit').onclick = function() { self._submit(); };
      document.getElementById('btn-auth-switch').onclick = function() {
        self._mode = isLogin ? 'register' : 'login';
        self._render();
      };
      var inpPwd = document.getElementById('auth-password');
      if (inpPwd) inpPwd.onkeydown = function(e) { if (e.key === 'Enter') self._submit(); };
      var inpEmail = document.getElementById('auth-email');
      if (inpEmail) inpEmail.oninput = function() { self._email = this.value.trim(); };
      if (inpPwd) inpPwd.oninput = function() { self._password = this.value; };
    },

    _submit: function() {
      var emailInp = document.getElementById('auth-email');
      var pwdInp = document.getElementById('auth-password');
      var email = emailInp ? emailInp.value.trim() : '';
      var password = pwdInp ? pwdInp.value : '';
      var errEl = document.getElementById('auth-error');

      if (!email || email.indexOf('@') < 0) {
        if (errEl) { errEl.textContent = '请输入有效的邮箱地址'; errEl.style.display = 'block'; }
        return;
      }
      if (password.length < 6) {
        if (errEl) { errEl.textContent = '密码至少需要6位'; errEl.style.display = 'block'; }
        return;
      }
      if (errEl) errEl.style.display = 'none';

      var self = this;
      var btn = document.getElementById('btn-auth-submit');
      if (btn) { btn.disabled = true; btn.textContent = '处理中...'; }

      var action = this._mode === 'login'
        ? SupabaseAuth.signIn(email, password)
        : SupabaseAuth.signUp(email, password);

      action.then(function(result) {
        if (self._mode === 'register') {
          // 注册成功
          if (result.data.user && result.data.session) {
            // 邮箱已确认或未启用确认
            self._onLoginSuccess();
          } else {
            // 需要确认邮箱
            if (btn) { btn.disabled = false; btn.textContent = '注 册'; }
            Toast.success('注册成功！如需邮箱验证，请查收邮件后登录。');
            self._mode = 'login';
            self._render();
          }
        } else {
          // 登录成功
          self._onLoginSuccess();
        }
      }).catch(function(err) {
        if (btn) { btn.disabled = false; btn.textContent = self._mode === 'login' ? '登 录' : '注 册'; }
        var msg = err.message || '操作失败';
        if (msg.indexOf('Invalid login credentials') >= 0) msg = '邮箱或密码错误';
        if (msg.indexOf('already registered') >= 0) { msg = '该邮箱已注册，请直接登录'; self._mode = 'login'; self._render(); return; }
        if (msg.indexOf('Email not confirmed') >= 0) msg = '邮箱未验证，请先查收验证邮件';
        if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
      });
    },

    _onLoginSuccess: function() {
      Loading.show('同步数据中...');
      var self = this;
      SupabaseDB.pull().then(function() {
        Loading.hide();
        var authPage = document.getElementById('page-auth');
        if (authPage) authPage.classList.remove('active');
        Router.switchTab('index');
        Pages.index.renderDeviceList();
      }).catch(function() {
        Loading.hide();
        var authPage = document.getElementById('page-auth');
        if (authPage) authPage.classList.remove('active');
        Router.switchTab('index');
      });
    }
  };

  // ============================================================
  // 全局事件
  // ============================================================
  document.getElementById('btn-add-device').addEventListener('click', function() {
    Router.navigate('add-device');
  });

  // ============================================================
  // 导出全局 API
  // ============================================================
  window.Router = Router;
  window.Pages = Pages;
  window.App = App;
  window.Toast = Toast;
  window.Modal = Modal;
  window.Loading = Loading;
  window.Storage = Storage;

  // ============================================================
  // 启动
  // ============================================================
  document.addEventListener('DOMContentLoaded', function() {
    App.init();
  });

})();
