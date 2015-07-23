'use strict';

var url = require('url'),
    util = require('util'),
    http = require('http'),
    https = require('https'),
    crypto = require('crypto'),
    stream = require('stream'),
    Ultron = require('ultron'),
    Options = require('options'),
    Sender = require('./Sender'),
    Receiver = require('./Receiver'),
    SenderHixie = require('./Sender.hixie'),
    ReceiverHixie = require('./Receiver.hixie'),
    Extensions = require('./Extensions'),
    PerMessageDeflate = require('./PerMessageDeflate'),
    EventEmitter = require('events').EventEmitter;

var protocolVersion = 13;

var closeTimeout = 30 * 1000; // 30���ڹر�����

function WebSocket(address, protocols, options) {
    EventEmitter.call(this);

    if(protocols && Array.isArray(protocols) && 'object' === typeof protocols) {
        // ����options������Ϊ�ڶ�������
        options = protocols;
        protocols = null;
    }
    if('string' === typeof protocols) {
        protocols = [protocols];
    }

    if(!Array.isArray(protocols)) {
        protocols = [];
    }

    this._socket = null;
    this._ultron = null;
    this._closeReceived = false;
    this.bytesReceived = 0;
    this.readyState = null;
    this.supports = {};
    this.extensions = {};

    if(Array.isArray(address)) {
        initAsServerClient.apply(this, address.concat(options));
    } else {
        initAsClient(this, [address, protocols, options]);
    }
}

util.inherits(WebSocket, EventEmitter);

/**
 * ����״̬
 */
["CONNECTING", "OPEN", "CLOSING", "CLOSED"].forEach(function each(state, index) {
    WebSocket.prototype[state] = WebSocket[state] = index;
});

/**
 * �ڷ��͸�������һ����Ϣ����~��~�Ĺر�����
 * @param code
 * @param data
 */
WebSocket.prototype.close = function close(code, data){
    if(this.readyState === WebSocket.CLOSED) return;
    if(this.readyState === WebSocket.CONNECTING) {
        this.readyState = WebSocket.CLOSED;
        return;
    }
    if(this.readyState === WebSocket.CLOSING) {
        if(this._closeReceived && this._isServer) {
            this.terminate();
        }
        return;
    }

    var self = this;
    try {
        this.readyState = WebSocket.CLOSING;
        this._closeCode = code;
        this._closeMessage = data;
        var mask = !this._isServer;
        this._sender.close(code, data, mask, function(err){
            if(err) self.emit('error', err);

            if(self._closeReceived && self._isServer) {
                self.terminate();
            } else {
                // ��֤����clean up ��ʹ�ر�֮��û��response(ʲô������)
                clearTimeout(self._closeTimer);
                self._closeTimer = setTimeout(cleanupWebSocketResources.bind(self, true), closeTimeout);
            }
        });

    } catch(e){
        this.emit('error', e);
    }
};

WebSocket.prototype.pause = function pauser() {
    if(this.readyState !== WebSocket.OPEN) throw new Error('not opened');
    return this._socket.pause();
};


/**
 * ����һ��ping
 * @param data Ҫ���͸�������������
 * @param options   mask:boolean, binary:boolean
 * @param dontFailWhenClosed �������û���Ƿ��׳��쳣
 */
WebSocket.prototype.ping = function ping(data, options, dontFailWhenClosed) {
    callPingpong('ping', data, options, dontFailWhenClosed);
};

WebSocket.prototype.pong = function pong(data, options, dontFailWhenClosed) {
    callPingpong('pong', data, options, dontFailWhenClosed);
};

/**
 * �ҳ�ģ�ping/pong���˵��÷�����һ������У�鶼һ����ֱ������throw new Error() throw new Error() throw new Error()
 * @param funcname
 * @param data
 * @param options
 * @param dontFailWhenClosed
 * @returns {Function}
 */
function callPingpong(funcname, data, options, dontFailWhenClosed) {
    return function(){
        if(this.readyState !== WebSocket.OPEN) {
            if(dontFailWhenClosed === true) return;
            throw new Error('not opened');
        }

        options = options || {};

        if(typeof options.mask === 'undefined') options.mask = !this._isServer;
        this._sender[funcname](data, options);
    };
}

WebSocket.prototype.resume = function resume() {
    if(this.readyState !== WebSocket.OPEN)  throw new Error('not opened');
    this._socket.resume();
};

/**
 * ��������~����
 * @param data
 * @param options
 * @param cb
 */
WebSocket.prototype.send = function send(data, options, cb) {
    // û���ݵ��������������
    if(typeof options === 'function') {
        cb = options;
        options = [];
    }
    if(this.readyState !== WebSocket.OPEN) {
        if(typeof cb === 'function') cb(new Error('not opened'));
        else throw new Error('not opened');
        return;
    }
    if(!data) data = '';
    if(this._queue) {
        var self = this;
        this._queue.push(function(){self.send(data, options, cb);});
        return;
    }

    options = options || {};
    options.fin = true;

    //���͵Ĳ��Ƕ�����~~��
    if(typeof  options.binary === 'undefined') {
        // ע���˰�ע���˰���������
        // ArrayBuffer��Buffer��UintArray�⼸������js���洦�������������ص����ͣ���
        options.binary = (data instanceof ArrayBuffer || data instanceof Buffer ||
                data instanceof Uint8Array ||
                data instanceof Uint16Array ||
                data instanceof Uint32Array ||
                data instanceof Int8Array ||
                data instanceof Int16Array ||
                data instanceof Int32Array ||
                data instanceof Float32Array ||
                data instanceof Float64Array);
    }

    if(!this.extensions[PerMessageDeflate.extensionName]) {
        options.compress = false;
    }

    var readable = typeof stream.Readable === 'function' ? stream.Readable : stream.Stream; // ���ݵ�д������
    if(data instanceof readable) {
        startQueue(this);
        var self = this;

        // ������
        sendStream(this, data, options, function send(error) {
            process.nextTick(function tock() {
                executeQueueSends(self);
            });
            if(typeof cb === 'function') cb(error);
        });
    } else {
        this._sender.send(data, options, cb);
    }
};

WebSocket.prototype.stream = function stream(options, cb) {
    if(typeof options === 'function') {
        cb = options;
        options = {};
    }
    var self = this;

    if(typeof cb !== 'function') throw new Error('callback must be provided');
    if(this.readyState != WebSocket.OPEN) {
        if(typeof cb === 'function') cb(new Error('not opened'));
        else throw new Error('not opened');
        return;
    }

    if(this._queue) {
        this._queue.push(function () {self.stream(options, cb);});
        return;
    }

    options = options || {};

    if(typeof  options.mask === 'undefined') options.mask = !this._isServer;
    if(typeof  options.compress === 'undefined') options.compress = true;
    if(!this.extensions[PerMessageDeflate.extensionName]) {
        options.compress = false;
    }

    startQueue(this);

    function send(data, final) {
        try {
            if(self.readyState !== WebSocket.OPEN)  throw new Error('not opened');
            options.fin = final === true;
            self._sender.send(data, options); // ������~~
            if(!final) process.nextTick(cb.bind(null, null, send)); // ֻҪû������һֱ����������������
            else executeQueueSends(self);
        } catch(e){
            if(typeof cb === 'function') cb(e);
            else {
                delete self._queue;
                self.emit('error', e);
            }
        }
    }

};

/**
 * �رհ���������һ��У�飺״̬����try��
 */
WebSocket.prototype.terminate = function terminate() {
    if(this.readyState === WebSocket.CLOSED) return;

    if(this._socket) {
        this.readyState = WebSocket.CLOSING;
        try {
            this._socket.end();
        } catch(e) {
            cleanupWebSocketResources.call(this, true);
            return;
        }
        // ��һ��ǿ������������֤30����kill�����������Ƿ�رյ�ʱ����������ԭ������ˡ�
        // �ȹص�֮ǰǿ�������timer��������ڵĻ���������`closeTimeout`ָ����ʱ���ڹر�
        if(this._closeTimer) {clearTimeout(this._closeTimer);}
        this._closeTimer  = setTimeout(cleanupWebSocketResources.bind(this, true), closeTimeout);
    } else if(this.readyState === WebSocket.CONNECTING) {
        cleanupWebSocketResources.call(this, true);
    }
};

/**
 * ��¶ bufferedAmount����(socket��bufferSize��װ)
 */
Object.defineProperty(WebSocket.prototype, 'bufferedAmount', {
    get: function get(){
        var amount = 0;
        if(this._socket) {
            amount = this._socket.bufferSize || 0;
        }
        return amount;
    }
});


/**
 * ģ��W3C�涨���������WebSocket�ӿ�
 *
 * ��������get, set���ԡ����ɣ�������
 *
 * �ο���http://dev.w3.org/html5/websockets/#the-websocket-interface
 *
 */
['open', 'error', 'close', 'message'].forEach(function(method){
    Object.defineProperty(WebSocket.prototype, 'on'+method, {
        get: function get(){
            var listener = this.listeners(method)[0]; // ���listners�Ǵ�EventEmit��̳�������
            return listener ? (listener._listener ? listener._listener  : listener) : undefined;
        },
        set: function set(listener){
            this.removeAllListeners(method);
            this.addEventListener(method, listener);
        }
    })
});


WebSocket.prototype.addEventListener = function(method, listener){
    var target = this;

    function onMessage(data, flags) {
        listener.call(target, new MessageEvent(data, flags.binary?'Binary':'Text', target));
    }

    function onClose(code, message) {
        listener.call(target, new CloseEvent(code, message, target));
    }

    function onError(event) {
        event.target = target;
        listener.call(target, event);
    }

    function onOpen() {
        listener.call(target, new OpenEvent(target));
    }

    if(typeof listener === 'function') {
        if(method === 'message') {
            onMessage._listener = listener;
            this.on(method, onMessage);
        } else if(method === 'close') {
            onClose._listener = listener;
            this.on(method, onClose);
        } else if(method === 'error') {
            onError._listener = listener;
            this.on(method, onError);
        } else if(method === 'open') {
            onOpen._listener = listener;
            this.on(method, onOpen);
        } else {
            this.on(method, listener);
        }
    }
};

module.exports = WebSocket;

/**
 * W3C ��Ϣ�¼�
 */
function MessageEvent(dataArg, typeArg, target){
    this.data = dataArg;
    this.type = typeArg;
    this.target = target;
}
function CloseEvent(code, reason, target){
    this.wasClean = (typeof code === 'undefined' || code === 1000);
    this.code = code;
    this.reason = reason;
    this.target = target;
}
function OpenEvent(target){
    this.target = target;
}

function initAsServerClient(req, socket, upgradeHead, options){}
function initAsClient(address, protocols, options){}
function establishConnection(ReceiverClass, SenderClass, socket, upgradeHead){}
function startQueue(instance){
    instance._queue = instance._queue || [];
}
function executeQueueSends(instance){
    var queue = instance._queue; // �������Ķ��ǵȴ��ص��ĺ�����������ɶ����
    if(typeof queue === 'undefined') return;

    delete instance._queue;
    for(var i= 0, l=queue.length;i<l;++i) {
        queue[i]();
    }
}

/**
 * ���������ӵ�����������д��һ���ǰɣ��������������ľ����仰
 * stream.on('data', function(){option.fin=false;})
 * stream.on('end', function(){option.fin=true;})
 *
 * ���˰������Ϊ�˱����û�ж����� fin
 *
 * @param instance
 * @param stream
 * @param options
 * @param cb
 */
function sendStream(instance, stream, options, cb){
    stream.on('data', function incoming(data){
        if(this.readyState != WebSocket.OPEN) {
            if(typeof cb === 'function') cb(new Error('not opened'));
            else {
                delete  instance._queue;
                instance.emit('error', new Error('not opened'));
            }
            return;
        }

        options.fin = false;
        instance._sender.send(data, options);
    });

    stream.on('end', function end(){
        if(this.readyState != WebSocket.OPEN) {
            if(typeof cb === 'function') cb(new Error('not opened'));
            else {
                delete  instance._queue;
                instance.emit('error', new Error('not opened'));
            }
            return;
        }

        options.fin = true;
        instance._sender.send(data, options);
        if(typeof  cb === 'function') cb(null);
    });
}

function cleanupWebSocketResources(error){
    if(this.readyState === WebSocket.CLOSED) return;

    // �Ƿ�Ӧ������emitClose��~
    var emitClose = this.readyState !== WebSocket.CONNECTING;
    this.readyState = WebSocket.CLOSED;

    clearTimeout(this._closeTimer);
    this._closeTimer = null;

    if(emitClose) {
        this.emit('close', this._closeCode || 1000, this._closeMessage || '');
    }

    if(this._socket) {
        if(this._ultron) this._ultron.destroy();
        this._socket.on('error', function onerror() {
            try{this.destroy();} catch(e){}
        });

        try {
            if(!error) this._socket.end();
            else this._socket.destroy();
        } catch(e) {}

        this._socket = null;
        this._ultron = null;
    }

    if(this._sender) {
        this._sender.removeAllListeners();
        this.sender = null;
    }
    if(this._receiver) {
        this._receiver.cleanup();
        this._receiver = null;
    }
    this.removeAllListeners();
    this.on('error', function onerror(){});
    delete this._queue;
}








