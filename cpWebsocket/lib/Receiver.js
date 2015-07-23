var util = require('util'),
    Validation = require('./Validation').Validation,
    ErrorCodes = require('./ErrorCodes'),
    BufferPool = require('./BufferPool'),
    bufferUtil = require('./BufferUtil').BufferUtil,
    PerMessageDeflate = require('./PerMessageDeflate');

function Receiver(extensions){}


Receiver.prototype.add = function(data){};

Receiver.prototype.cleanup = function(data){};

Receiver.prototype.expectHandler = function(length, handler){};


/**
 * 等到积攒到一定数量的数据发送，再触发callback
 * @param length
 * @param handler
 */
Receiver.prototype.expectData = function(length, handler){};


Receiver.prototype.allocateFromPool = function(length, isFragmented){};


/**
 * 处理新的packet
 * @param data
 */
Receiver.prototype.processPacket = function(data){};

Receiver.prototype.endPacket = function(){};

Receiver.prototype.reset = function(){};

Receiver.prototype.unmask = function(mask, buf, binary){};


Receiver.prototype.concatBuffers = function(buffers){};

Receiver.prototype.error = function(reason, protocolErrorCode){};

Receiver.prototype.flush = function(){};

Receiver.prototype.applyExtensions = function(messageBuffer, fin, compressed, callback){};

/**
 * Buffer 工具
 */

function readUInt16BE(start) {
}

function readUInt32BE(start) {
}

function fastCopy(length, srcBuffer, dstBuffer, dstOffset){}

function clone(obj){}


/**
 * 操作码及其处理函数
 * @type {{}}
 */
var opcodes = {};
