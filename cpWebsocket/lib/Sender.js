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
    if(typeof code !== 'undefined') {
        if(typeof code !== 'number' || !ErrorCodes.isValidErrorCode(code)) throw Error('first argument must be a valid error code number');
    }
    code = code || 100;
    var dataBuffer = new Buffer(2 + (data ? Buffer.byteLength(data) : 0));
    writeUInt16BE.call(dataBuffer, code, 0);
    if(dataBuffer.length>2) dataBuffer.write(data, 2);

    var self = this;
    this.messageHandlers.push(function (callback) {
        self.frameAndSend(0x8, dataBuffer, true, mask);
        callback();
        if(typeof cb == 'function') cb();
    });
    this.flush();
};


Sender.prototype.ping = function (data, options) {
    var mask = options && options.mask;
    var self = this;
    this.messageHandlers.push(function(callback){
        self.frameAndSend(0x9, data || '', true, mask);
        callback();
    });
    this.flush();
};

Sender.prototype.pong = function (data, options) {
    var mask = options && options.mask;
    var self = this;
    this.messageHandlers.push(function(callback){
        self.frameAndSend(0xa, data || '', true, mask);
        callback();
    });
    this.flush();
};


Sender.prototype.send = function (data, options, cb) {

};

/**
 * HyBi WebSocket协议的数据帧，并发送
 * @param opcode  操作码：8关闭 9 ping 10 pang
 * @param data
 * @param finalFragment
 * @param maskData
 * @param compressed
 * @param cb
 */
Sender.prototype.frameAndSend = function (opcode, data, finalFragment, maskData, compressed, cb) {
    var canModifyData = false;

    if(!data) {
        try{
            this._socket.write(new Buffer([opcode | (finalFragment ? 0x80: 0) | (maskData ? 0x80 : 0)].concat(maskData ? [0, 0, 0, 0]: [])), 'binary', cb);
        }  catch(e) {
            if (typeof cb == 'function') cb(e);
            else this.emit('error', e);
        }
        return;
    }

    // data不是buffer ?? 那是啥。ArrayBuffer 或者 ArrayBufferView???
    if(!Buffer.isBuffer(data)){
        canModifyData = true;
        if(data && (typeof data.byteLength !== 'undefined' || typeof data.buffer !== 'undefined')){
            data = getArrayBuffer(data);
        } else {
            data = new Buffer(data);
        }
    }

    var dataLength = data.length,
        dataOffset = maskData ? 6 :2, //这句是什么意思。协议的那部分呢？
        secondByte = dataLength;

    // 分片？应该是协议的一部分
    if(dataLength >= 65536) {
        dataOffset += 8;
        secondByte = 127;
    }
    else if (dataLength > 125) {
        dataOffset += 2;
        secondByte = 126;
    }

    var mergeBuffers = dataLength < 32768 || (maskData && !canModifyData);//数据报文小于一半长度||不可修改且有掩码
    var totalLength = mergeBuffers ? dataLength + dataOffset : dataOffset;
    var outputBuffer = new Buffer(totalLength);
    outputBuffer[0] = finalFragment ? opcode  | 0x80 : opcode; // 为啥要按位或？
    if(compressed) outputBuffer[0] |= 0x40;

    switch (secondByte) {
        case 126:
            writeUInt16BE.call(outputBuffer, dataLength, 2);
            break;
        case 127:
            writeUInt32BE.call(outputBuffer, 0, 2);
            writeUInt32BE.call(outputBuffer, dataLength, 6);
    }

    if(maskData) {
        outputBuffer[1] = secondByte | 0x80; //操作码
        var mask = this._randomMask || (this._randomMask = getRandomMask());
        outputBuffer[dataOffset -4] = mask[0];
        outputBuffer[dataOffset -3] = mask[1];
        outputBuffer[dataOffset -2] = mask[2];
        outputBuffer[dataOffset -1] = mask[3];
        if(mergeBuffers) {
            bufferUtil.mask(data, mask, outputBuffer, dataOffset, dataLength);
            try {
                this._socket.write(outputBuffer, 'binary', cb);
            } catch(e){
                if (typeof cb == 'function') cb(e);
                else this.emit('error', e);
            }
        } else {
            bufferUtil.mask(data, mask, data, 0, dataLength);
            try {
                this._socket.write(outputBuffer, 'binary');
                this._socket.write(data, 'bianry', cb);
            } catch(e) {
                if (typeof cb == 'function') cb(e);
                else this.emit('error', e);
            }
        }
    }
    else {
        // 没有掩码比较简单的情况
        outputBuffer[1] = secondByte;
        if(mergeBuffers) {
            data.copy(outputBuffer, dataOffset);
            try {
                this._socket.write(outputBuffer, 'binary', cb);
            } catch(e) {
                if (typeof cb == 'function') cb(e);
                else this.emit('error', e);
            }
        } else {
            try {
                this._socket.write(outputBuffer, 'binary');
                this._socket.write(data, 'binary', cb);
            } catch(e) {
                if (typeof cb == 'function') cb(e);
                else this.emit('error', e);
            }
        }


    }
};

Sender.prototype.flush = function () {
    if(this.processing) return;

    var handler = this.messageHandlers.shift(); // pop()的感觉
    if(!handler) return;
    // 因为单线程加个状态flag就行了
    this.processing = true;

    var self = this;
    // 递归回调
    handler(function () {
        self.processing = true;
        self.flush();
    });

};

Sender.prototype.applyExtensions = function (data, fin, compress, callback) {
    // 如果需要压缩~！就走extensions的逻辑，不然直接回调
    if(compress && data) {
        this.extensions[PerMessageDeflate.extensionName].compress(data, fin, callback);
    } else {
        callback(null, data);
    }
};

module.exports = Sender;

function writeUInt16BE(value, offset) {
    this[offset] = (value & 0xff00) >> 8; //2个16进制位代表8位bit，与运算取高位的值，放在后面的位置上
    this[offset+1] = value & 0xff;
}
function writeUInt32BE(value, offset) {
    this[offset] =(value & 0xff000000) >> 24;
    this[offset+1] =(value & 0xff0000) >> 16;
    this[offset+2] =(value & 0xff00) >> 8;
    this[offset+3] =(value & 0xff);
}

/**
 * 分割ArrayBuffer？？？
 * @param data
 * @returns {Buffer}
 */
function getArrayBuffer(data) {
    // data 是ArrayBuffer 或者 ArrayBufferView类型的。这两个类型都是什么鬼？？
    var array = new Uint8Array(data.buffer || data),
        l = data.length || data.length,
        o = data.byteOffset || 0,
        buffer = new Buffer(l);
    for (var i = 0; i < l; ++i) {
        buffer[i] = array[o+i];
    }
    return buffer;
}
function getRandomMask(){
    return new Buffer([
        ~~Math.random() * 255,
        ~~Math.random() * 255,
        ~~Math.random() * 255,
        ~~Math.random() * 255
    ]);
}



