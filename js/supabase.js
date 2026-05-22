/**
 * PalmDoor H5 - Supabase 客户端 (认证 + 数据同步)
 * 策略：localStorage 为主存储，Supabase 为云端同步
 */
(function(global) {
  'use strict';

  // ============================================================
  // 配置 — 创建 Supabase 项目后替换以下值
  // ============================================================
  var SUPABASE_URL = 'https://czcgororwjntogfxevpp.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_SLzDGFZ4RkFVpFdjPmqt3A_NU4g_43R';

  var _supabase = null;
  var _syncing = false;
  var _syncQueue = [];

  function getClient() {
    if (!_supabase) {
      if (typeof supabase === 'undefined' || !supabase.createClient) {
        console.error('[Supabase] SDK 未加载');
        return null;
      }
      _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return _supabase;
  }

  // ============================================================
  // Auth - 认证模块
  // ============================================================
  var Auth = {
    _user: null,
    _session: null,
    _onChange: null,

    init: function() {
      var self = this;
      var client = getClient();
      if (!client) return;

      // 监听认证状态变化
      client.auth.onAuthStateChange(function(event, session) {
        console.log('[Auth] 状态变化:', event);
        self._session = session;
        self._user = session ? session.user : null;
        if (self._onChange) self._onChange(self._user);
      });

      // 恢复会话
      return client.auth.getSession().then(function(result) {
        var session = result.data.session;
        if (session) {
          self._session = session;
          self._user = session.user;
          console.log('[Auth] 已恢复会话:', self._user.email);
        }
        return self._user;
      }).catch(function(err) {
        console.error('[Auth] 恢复会话失败:', err);
        return null;
      });
    },

    /** 邮箱注册 */
    signUp: function(email, password) {
      var client = getClient();
      if (!client) return Promise.reject(new Error('SDK未加载'));
      return client.auth.signUp({ email: email, password: password });
    },

    /** 邮箱登录 */
    signIn: function(email, password) {
      var client = getClient();
      if (!client) return Promise.reject(new Error('SDK未加载'));
      return client.auth.signInWithPassword({ email: email, password: password });
    },

    /** 登出 */
    signOut: function() {
      var client = getClient();
      if (!client) return Promise.reject(new Error('SDK未加载'));
      return client.auth.signOut().then(function() {
        // 清除本地数据
        localStorage.removeItem('deviceList');
        localStorage.removeItem('person_list');
        localStorage.removeItem('attendance_records');
        localStorage.removeItem('mqttConfig');
      });
    },

    getUser: function() { return this._user; },
    isLoggedIn: function() { return !!this._user; }
  };

  // ============================================================
  // DB - 数据同步层
  // ============================================================

  /** 将本地数据推送到 Supabase（全量覆盖） */
  function _replaceAll(table, userId, rows, idColumn) {
    var client = getClient();
    if (!client || !userId) return Promise.resolve();

    // 先删后插
    return client.from(table).delete().eq('user_id', userId).then(function() {
      if (!rows || rows.length === 0) return;
      var batch = rows.map(function(row) {
        var r = Object.assign({}, row, { user_id: userId });
        // 删除服务端生成的字段
        delete r.id;
        return r;
      });

      // 分批插入（每批最多 500 行）
      var chunks = [];
      for (var i = 0; i < batch.length; i += 500) {
        chunks.push(batch.slice(i, i + 500));
      }

      return chunks.reduce(function(promise, chunk) {
        return promise.then(function() {
          return client.from(table).insert(chunk);
        });
      }, Promise.resolve());
    });
  }

  var DB = {
    _lastSync: {},

    /** 从 Supabase 拉取所有数据到 localStorage */
    pull: function() {
      var client = getClient();
      var userId = Auth._user ? Auth._user.id : null;
      if (!client || !userId) return Promise.resolve(false);

      console.log('[DB] 开始拉取云端数据...');

      var tables = [
        { name: 'devices', key: 'deviceList', order: 'create_time' },
        { name: 'persons', key: 'person_list', order: 'created_at' },
        { name: 'attendance_records', key: 'attendance_records', order: 'check_time' },
        { name: 'mqtt_configs', key: 'mqttConfig', order: null }
      ];

      return Promise.all(tables.map(function(t) {
        var query = client.from(t.name).select('*').eq('user_id', userId);
        if (t.order) query = query.order(t.order, { ascending: false });
        return query.then(function(result) {
          var data = result.data || [];
          if (t.name === 'mqtt_configs') {
            // 取最新配置
            var cfg = data.length > 0 ? data[0].config : null;
            if (cfg) localStorage.setItem(t.key, JSON.stringify(cfg));
          } else {
            // 去除 user_id 字段后存入 localStorage
            var clean = data.map(function(row) {
              var r = Object.assign({}, row);
              delete r.user_id;
              return r;
            });
            localStorage.setItem(t.key, JSON.stringify(clean));
          }
          DB._lastSync[t.key] = Date.now();
          console.log('[DB] 拉取 ' + t.key + ': ' + data.length + ' 条');
        });
      })).then(function() {
        console.log('[DB] 数据拉取完成');
        return true;
      }).catch(function(err) {
        console.error('[DB] 拉取失败:', err);
        return false;
      });
    },

    /** 推送所有本地数据到 Supabase */
    pushAll: function() {
      var client = getClient();
      var userId = Auth._user ? Auth._user.id : null;
      if (!client || !userId) return Promise.resolve(false);

      console.log('[DB] 开始推送数据...');

      var deviceList = [];
      var personList = [];
      var records = [];
      try {
        deviceList = JSON.parse(localStorage.getItem('deviceList') || '[]');
        personList = JSON.parse(localStorage.getItem('person_list') || '[]');
        records = JSON.parse(localStorage.getItem('attendance_records') || '[]');
      } catch(e) {}

      return Promise.all([
        _replaceAll('devices', userId, deviceList),
        _replaceAll('persons', userId, personList),
        _replaceAll('attendance_records', userId, records),
        (function() {
          try {
            var cfg = JSON.parse(localStorage.getItem('mqttConfig') || 'null');
            if (!cfg) return Promise.resolve();
            return client.from('mqtt_configs').delete().eq('user_id', userId).then(function() {
              return client.from('mqtt_configs').insert({ user_id: userId, config: cfg });
            });
          } catch(e) { return Promise.resolve(); }
        })()
      ]).then(function() {
        console.log('[DB] 推送完成');
        return true;
      }).catch(function(err) {
        console.error('[DB] 推送失败:', err);
        return false;
      });
    },

    /** 增量同步：推送单个 key */
    pushKey: function(key) {
      var client = getClient();
      var userId = Auth._user ? Auth._user.id : null;
      if (!client || !userId) return Promise.resolve();

      var tableMap = {
        'deviceList': 'devices',
        'person_list': 'persons',
        'attendance_records': 'attendance_records',
        'mqttConfig': 'mqtt_configs'
      };
      var table = tableMap[key];
      if (!table) return Promise.resolve();

      try {
        if (key === 'mqttConfig') {
          var cfg = JSON.parse(localStorage.getItem(key) || 'null');
          if (!cfg) return Promise.resolve();
          return client.from(table).delete().eq('user_id', userId).then(function() {
            return client.from(table).insert({ user_id: userId, config: cfg });
          });
        } else {
          var rows = JSON.parse(localStorage.getItem(key) || '[]');
          return _replaceAll(table, userId, rows);
        }
      } catch(e) {
        return Promise.resolve();
      }
    }
  };

  // ============================================================
  // SyncStorage - 增强版 Storage，写操作自动同步到 Supabase
  // ============================================================
  var SyncStorage = {
    _debounceTimers: {},

    get: function(key, def) {
      try {
        var v = localStorage.getItem(key);
        return v ? JSON.parse(v) : (def !== undefined ? def : null);
      } catch(e) {
        return def !== undefined ? def : null;
      }
    },

    set: function(key, val) {
      try {
        localStorage.setItem(key, JSON.stringify(val));
        // 登录状态下自动同步（去抖 3 秒）
        if (Auth.isLoggedIn()) {
          var self = this;
          clearTimeout(this._debounceTimers[key]);
          this._debounceTimers[key] = setTimeout(function() {
            DB.pushKey(key);
          }, 3000);
        }
        return true;
      } catch(e) {
        return false;
      }
    },

    remove: function(key) {
      try {
        localStorage.removeItem(key);
      } catch(e) {}
    },

    /** 立即同步所有变更（页面关闭前调用） */
    flush: function() {
      Object.keys(this._debounceTimers).forEach(function(k) {
        clearTimeout(this._debounceTimers[k]);
      }.bind(this));
      this._debounceTimers = {};
      return DB.pushAll();
    }
  };

  // ============================================================
  // 导出
  // ============================================================
  global.SupabaseAuth = Auth;
  global.SupabaseDB = DB;
  global.SyncStorage = SyncStorage;
  global.SupabaseClient = getClient;

})(window);
