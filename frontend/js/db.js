// ==================== ZenPass IndexedDB 管理器 ====================
// 替代 localStorage 方案，支援大量預約 + 高效查詢
// Version: 1.0

(function() {
  'use strict';
  
  const DB_NAME = 'ZenPassDB';
  const DB_VERSION = 1;
  let dbInstance = null;
  
  function openDB() {
    return new Promise(function(resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function(e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('bookings')) {
          var store = db.createObjectStore('bookings', { keyPath: 'id', autoIncrement: true });
          store.createIndex('courseId', 'courseId', { unique: false });
          store.createIndex('date', 'date', { unique: false });
          store.createIndex('status', 'status', { unique: false });
        }
      };
      req.onsuccess = function(e) { dbInstance = e.target.result; resolve(dbInstance); };
      req.onerror = function(e) { reject(e.target.error); };
    });
  }
  
  function getDB() {
    return dbInstance ? Promise.resolve(dbInstance) : openDB();
  }
  
  window.IDB = {
    // 新增預約
    async add(booking) {
      var db = await getDB();
      var tx = db.transaction('bookings', 'readwrite');
      var store = tx.objectStore('bookings');
      var data = Object.assign({}, booking, { status: 'confirmed', bookedAt: new Date().toISOString() });
      return new Promise(function(resolve, reject) {
        var req = store.add(data);
        req.onsuccess = function() { resolve(req.result); };
        req.onerror = function() { reject(req.error); };
      });
    },
    
    // 取得所有預約
    async getAll() {
      var db = await getDB();
      var tx = db.transaction('bookings', 'readonly');
      var store = tx.objectStore('bookings');
      return new Promise(function(resolve, reject) {
        var req = store.getAll();
        req.onsuccess = function() { resolve(req.result); };
        req.onerror = function() { reject(req.error); };
      });
    },
    
    // 按課程ID查詢
    async getByCourseId(courseId) {
      var db = await getDB();
      var tx = db.transaction('bookings', 'readonly');
      var store = tx.objectStore('bookings');
      var index = store.index('courseId');
      return new Promise(function(resolve, reject) {
        var req = index.getAll(courseId);
        req.onsuccess = function() { resolve(req.result); };
        req.onerror = function() { reject(req.error); };
      });
    },
    
    // 取消預約
    async cancel(id) {
      var db = await getDB();
      var tx = db.transaction('bookings', 'readwrite');
      var store = tx.objectStore('bookings');
      return new Promise(function(resolve, reject) {
        var req = store.delete(id);
        req.onsuccess = function() { resolve(); };
        req.onerror = function() { reject(req.error); };
      });
    },
    
    // 清空所有（測試用）
    async clear() {
      var db = await getDB();
      var tx = db.transaction('bookings', 'readwrite');
      var store = tx.objectStore('bookings');
      return new Promise(function(resolve, reject) {
        var req = store.clear();
        req.onsuccess = function() { resolve(); };
        req.onerror = function() { reject(req.error); };
      });
    }
  };
})();
