// Generated by CoffeeScript 1.7.1
(function() {
  var SeriesQueue, Tail, assert, async, environment, events, fs, iconv, jschardet, split, us,
    __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
    __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  events = require("events");

  fs = require('fs');

  async = require('uclogs-async');

  jschardet = require('jschardet');

  iconv = require('iconv-lite');

  assert = require('assert');

  us = require('underscore');

  environment = process.env['NODE_ENV'] || 'development';

  split = function(size, chunk_size) {
    var result;
    result = [];
    while (size > 0) {
      if (size >= chunk_size) {
        result.push(chunk_size);
        size -= chunk_size;
      } else {
        result.push(size);
        size = 0;
      }
    }
    return result;
  };

  SeriesQueue = (function() {
    SeriesQueue.prototype.next = function() {
      var element;
      if (this.queue.length >= 1 && !this.lock) {
        element = this.queue.shift();
        this.lock = true;
        return this.task(element, (function(_this) {
          return function() {
            _this.lock = false;
            if (_this.queue.length >= 1) {
              return setImmediate(function() {
                return _this.next();
              });
            }
          };
        })(this));
      }
    };

    function SeriesQueue(task) {
      this.task = task;
      this.queue = [];
      this.lock = false;
    }

    SeriesQueue.prototype.push = function(element) {
      this.queue.push(element);
      return setImmediate((function(_this) {
        return function() {
          return _this.next();
        };
      })(this));
    };

    SeriesQueue.prototype.clean = function() {
      return this.queue = [];
    };

    SeriesQueue.prototype.length = function() {
      return this.queue.length;
    };

    return SeriesQueue;

  })();

  Tail = (function(_super) {
    __extends(Tail, _super);

    Tail.prototype._readBlock = function(block, callback) {
      return fs.fstat(block.fd, (function(_this) {
        return function(err, stat) {
          var end, size, split_size, start;
          if (err) {
            return callback();
          }
          start = _this.bookmarks[block.fd];
          end = stat.size;
          if (start > end) {
            start = 0;
          }
          size = end - start;
          if (_this.maxSize > 0 && size > _this.maxSize) {
            start = end - _this.maxSize;
            size = _this.maxSize;
          }
          if (size === 0) {
            return callback();
          }
          split_size = _this.bufferSize > 0 ? _this.bufferSize : size;
          return async.reduce(split(size, split_size), start, function(start, size, callback) {
            var buff;
            buff = new Buffer(size);
            return fs.read(block.fd, buff, 0, size, start, function(err, bytesRead, buff) {
              var chunk, data, detected_enc, encoding, parts, _i, _len;
              if (err) {
                _this.emit('error', err);
                return callback(err);
              }
              if (_this.encoding !== 'auto') {
                encoding = _this.encoding;
              } else {
                detected_enc = jschardet.detect(buff);
                if (!(detected_enc != null ? detected_enc.encoding : void 0) || detected_enc.confidence < 0.9) {
                  encoding = "utf-8";
                } else if (!iconv.encodingExists(detected_enc.encoding)) {
                  console.error("auto detected " + detected_enc.encoding + " is not supported, use UTF-8 as alternative");
                  encoding = 'utf-8';
                } else {
                  encoding = detected_enc.encoding;
                }
              }
              data = iconv.decode(buff, encoding);
              _this.buffer += data;
              parts = _this.buffer.split(_this.separator);
              _this.buffer = parts.pop();
              for (_i = 0, _len = parts.length; _i < _len; _i++) {
                chunk = parts[_i];
                _this.emit("line", chunk);
              }
              if (_this.buffer.length > _this.maxLineSize) {
                _this.buffer = '';
              }
              _this.bookmarks[block.fd] = start + bytesRead;
              return callback(null);
            });
          }, function(err) {
            if (err) {
              return callback(err);
            }
            if (block.type === 'close') {
              fs.close(block.fd);
              delete _this.bookmarks[block.fd];
            }
            return callback();
          });
        };
      })(this));
    };

    Tail.prototype._checkOpen = function(start, inode) {

      /*
        try to open file
        start: the postion to read file start from. default is file's tail position
        inode: if this parameters present, the start take effect if only file has same inode
       */
      var e, fd, stat;
      try {
        stat = fs.statSync(this.filename);
        if (!stat.isFile()) {
          throw new Error("" + this.filename + " is not a regular file");
        }
        fd = fs.openSync(this.filename, 'r');
        stat = fs.fstatSync(fd);
        this.current = {
          fd: fd,
          inode: stat.ino
        };
        if ((start != null) && start >= 0 && (!inode || inode === stat.ino)) {
          this.bookmarks[fd] = start;
        } else {
          this.bookmarks[fd] = stat.size;
        }
        return this.queue.push({
          type: 'read',
          fd: this.current.fd
        });
      } catch (_error) {
        e = _error;
        if (e.code === 'ENOENT') {
          return this.current = {
            fd: null,
            inode: 0
          };
        } else {
          throw new Error("failed to read file " + this.filename + ": " + e.message);
        }
      }
    };


    /*
    options:
      - separator: default is '\n'
      - start: where start from, default is the tail of file
      - inode: the tail file's inode, if file's inode not equal this will treat a new file
      - interval: the interval millseconds to polling file state. default is 1 seconds
      - maxSize: the maximum byte size to read one time. 0 or nagative is unlimit. 
      - maxLineSize: the maximum byte of one line
      - bufferSize: the memory buffer size. default is 1M. Tail read file content into buffer first. nagative value is no buffer
      - encoding: the file encoding. if absence, encoding will be auto detected
     */

    function Tail(filename, options) {
      var _ref, _ref1, _ref2, _ref3, _ref4;
      this.filename = filename;
      this.options = options != null ? options : {};
      this._readBlock = __bind(this._readBlock, this);
      if (options.start != null) {
        assert.ok(us.isNumber(options.start), "start should be number");
      }
      if (options.inode != null) {
        assert.ok(us.isNumber(options.inode), "inode should be number");
      }
      if (options.interval != null) {
        assert.ok(us.isNumber(options.interval), "interval should be number");
      }
      if (options.maxSize != null) {
        assert.ok(us.isNumber(options.maxSize), "maxSize should be number");
      }
      if (options.maxLineSize != null) {
        assert.ok(us.isNumber(options.maxLineSize), "start maxLineSize should be number");
      }
      if (options.bufferSize != null) {
        assert.ok(us.isNumber(options.bufferSize), "bufferSize should be number");
      }
      this.separator = ((options != null ? options.separator : void 0) != null) || '\n';
      this.buffer = '';
      this.queue = new SeriesQueue(this._readBlock);
      this.isWatching = false;
      this.bookmarks = {};
      this._checkOpen(this.options.start, this.options.inode);
      this.interval = (_ref = this.options.interval) != null ? _ref : 1000;
      this.maxSize = (_ref1 = this.options.maxSize) != null ? _ref1 : -1;
      this.maxLineSize = (_ref2 = this.options.maxLineSize) != null ? _ref2 : 1024 * 1024;
      this.bufferSize = (_ref3 = this.options.bufferSize) != null ? _ref3 : 1024 * 1024;
      this.encoding = (_ref4 = this.options.encoding) != null ? _ref4 : 'utf-8';
      if (this.encoding !== 'auto' && !iconv.encodingExists(this.encoding)) {
        throw new Error("" + this.encoding + " is not supported, check encoding supported list in https://github.com/ashtuchkin/iconv-lite/wiki/Supported-Encodings");
      }
      this.watch();
    }

    Tail.prototype.watch = function() {
      if (this.isWatching) {
        return;
      }
      this.isWatching = true;
      return fs.watchFile(this.filename, {
        interval: this.interval
      }, (function(_this) {
        return function(curr, prev) {
          return _this._watchFileEvent(curr, prev);
        };
      })(this));
    };

    Tail.prototype._watchFileEvent = function(curr, prev) {
      if (curr.ino !== this.current.inode) {
        if (this.current.fd) {
          this.queue.push({
            type: 'close',
            fd: this.current.fd
          });
        }
        this._checkOpen(0);
      }
      if (this.current.fd) {
        return this.queue.push({
          type: 'read',
          fd: this.current.fd
        });
      }
    };

    Tail.prototype.where = function() {
      if (!this.current.fd) {
        return null;
      }
      return {
        inode: this.current.inode,
        pos: this.bookmarks[this.current.fd]
      };
    };

    Tail.prototype.unwatch = function() {
      var fd, memory, pos, _ref;
      this.queue.clean();
      fs.unwatchFile(this.filename);
      this.isWatching = false;
      if (this.current.fd) {
        memory = {
          inode: this.current.inode,
          pos: this.bookmarks[this.current.fd]
        };
      } else {
        memory = {
          inode: 0,
          pos: 0
        };
      }
      _ref = this.bookmarks;
      for (fd in _ref) {
        pos = _ref[fd];
        fs.closeSync(parseInt(fd));
      }
      this.bookmarks = {};
      this.current = {
        fd: null,
        inode: 0
      };
      return memory;
    };

    return Tail;

  })(events.EventEmitter);

  module.exports = Tail;

}).call(this);
