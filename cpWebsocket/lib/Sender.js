var events = require('events'),
    util = require('util'),
    EventEmitter = events.EventEmitter,
    ErrorCodes = require('./ErrorCode'),
    bufferUtil = require('./BufferUtil').BufferUtil,
    PerMessageDeflate = require('./PerMessageDeflate');

/**
 *  HyBi Sender的实现
 */
function Sender(socket, extensions) {

}

util.inherits(Sender, events.EventEmitter);

Sender.prototype.close = function (code, data, mask, cb) {
    
};


Sender.prototype.ping = function (data, options) {
    
};

Sender.prototype.pong = function (data, options) {

};


Sender.prototype.send = function (data, options, cb) {

};

/**
 * HyBi WebSocket协议的数据帧，并发送
 * @param opcode
 * @param data
 * @param finalFragment
 * @param maskData
 * @param compressed
 * @param cb
 */
Sender.prototype.frameAndSend = function (opcode, data, finalFragment, maskData, compressed, cb) {

};

Sender.prototype.flush = function () {

};

Sender.prototype.applyExtensions = function (data, fin, compress, callback) {
    
};

module.exports = Sender;

function writeUInt16BE(value, offset) {

}
function writeUInt32BE(value, offset) {

}
function getArrayBuffer(data) {

}
function getRandomMask(){
    return new Buffer([
        ~~Math.random() * 255,
        ~~Math.random() * 255,
        ~~Math.random() * 255,
        ~~Math.random() * 255
    ]);
}



