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

var closeTimeout = 30 * 1000; // 30秒内关闭连接

function WebSocket(address, protocols, options) {
    EventEmitter.call(this);

    if(protocols && Array.isArray(protocols) && 'object' === typeof protocols) {
        // 接受options对象作为第二个参数
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
 * 就绪状态
 */
["CONNECTING", "OPEN", "CLOSING", "CLOSED"].forEach(function each(state, index) {
    WebSocket.prototype[state] = WebSocket[state] = index;
});

/**
 * 在发送给服务器一条消息后优~雅~的关闭连接
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
                // 保证连接clean up 即使关闭之后没有response(什么话？？)
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
 * 发送一个ping
 * @param data 要发送给服务器的数据
 * @param options   mask:boolean, binary:boolean
 * @param dontFailWhenClosed 如果连接没开是否抛出异常
 */
WebSocket.prototype.ping = function ping(data, options, dontFailWhenClosed) {
    callPingpong('ping', data, options, dontFailWhenClosed);
};

WebSocket.prototype.pong = function pong(data, options, dontFailWhenClosed) {
    callPingpong('pong', data, options, dontFailWhenClosed);
};

/**
 * 我抽的，ping/pong除了调用方法不一样其余校验都一样简直烦死了throw new Error() throw new Error() throw new Error()
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
 * 发送数据~！！
 * @param data
 * @param options
 * @param cb
 */
WebSocket.prototype.send = function send(data, options, cb) {
    // 没数据的情况。两个参数
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

    //发送的不是二进制~~！
    if(typeof  options.binary === 'undefined') {
        // 注意了啊注意了啊！！！！
        // ArrayBuffer，Buffer，UintArray这几个都是js里面处理二进制数据相关的类型！！
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

    var readable = typeof stream.Readable === 'function' ? stream.Readable : stream.Stream; // 兼容的写法？？
    if(data instanceof readable) {
        startQueue(this);
        var self = this;

        // 发送流
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
            self._sender.send(data, options); // 发送了~~
            if(!final) process.nextTick(cb.bind(null, null, send)); // 只要没结束就一直发发发！！！！！
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
 * 关闭啊啊啊还是一堆校验：状态啦，try啦
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
        // 加一个强力清理！！！保证30秒内kill掉它。不论是否关闭的时候由于种种原因出错了。
        // 先关掉之前强力清理的timer，如果存在的话。否则在`closeTimeout`指定的时间内关闭
        if(this._closeTimer) {clearTimeout(this._closeTimer);}
        this._closeTimer  = setTimeout(cleanupWebSocketResources.bind(this, true), closeTimeout);
    } else if(this.readyState === WebSocket.CONNECTING) {
        cleanupWebSocketResources.call(this, true);
    }
};

/**
 * 暴露 bufferedAmount属性(socket的bufferSize封装)
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
 * 模仿W3C规定的浏览器端WebSocket接口
 *
 * 批量生成get, set属性。来吧！！！！
 *
 * 参看：http://dev.w3.org/html5/websockets/#the-websocket-interface
 *
 */
['open', 'error', 'close', 'message'].forEach(function(method){
    Object.defineProperty(WebSocket.prototype, 'on'+method, {
        get: function get(){
            var listener = this.listeners(method)[0]; // 这个listners是从EventEmit里继承下来的
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
 * W3C 消息事件
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

/**
 * 嘛，看起来hixie-76这个协议是基于binary实现的？？已经过时了……
 * @param req
 * @param socket
 * @param upgradeHead
 * @param options
 */
function initAsServerClient(req, socket, upgradeHead, options){
    options = new Options({
        protocolVersion:protocolVersion,
        protocol:null,
        extensions:{}
    }).merge(options);

    // expose state properties
    this.protocol = options.value.protocol;
    this.protocolVersion = options.value.protocolVersion;
    this.extensions = options.value.extensions;
    this.supports.binary = (this.protocolVersion !== 'hixie-76');
    this.upgradeReq = req;
    this.readyState = WebSocket.CONNECTING;
    this._isServer = true;

    // 开始连接
    if(options.value.protocolVersion === 'hixie-76') {
        establishConnection.call(this, ReceiverHixie, SenderHixie, socket, upgradeHead);
    } else {
        establishConnection.call(this, Receiver, Sender, socket, upgradeHead);
    }
}

/***
 *
 * ！！！！！！！！！！重头戏！！！！！！！！
 * 也米什么。
 * 先校验options，然后按加密与否实例化 httpserver，把options传进去。对于事件一顿校验是否关闭状态，协议，扩展。
 * 具体upgrade事件处理函数转交给establishConnection了....调用req，完。
 *
 * @param address
 * @param protocols
 * @param options
 */
function initAsClient(address, protocols, options){
    options = new Options({
        origin:null,
        protocolVersion:protocolVersion,
        host:null,
        headers:null,
        protocol:protocols.join(','),
        agent:null,

        // ssl-related options
        pfx:null,
        key:null,
        passphrase:null,
        cert:null,
        ca:null,
        ciphers:null,
        rejectUnauthorized:null,
        perMessageDeflate:true
    }).merge(options);

    if(options.value.protocolVersion !== 8 && options.value.protocolVersion !== 13) {
        throw new Error('unsupported protocol version');
    }

    var serverUrl = url.parse(address);
    var isUnixSocket = serverUrl.protocol === 'ws+unix:';
    if(!serverUrl.host && !isUnixSocket) throw new Error('invalid url');
    var isSecure = serverUrl.prototype === 'wss:' || serverUrl.protocol === 'https:';
    var httpObj = isSecure?https:http;
    var port = serverUrl.port || (isSecure ? 443 : 80);//默认端口啦
    var auth = serverUrl.auth;


    // 扩展协议（？？？）
    var extensionsOffer = {};
    var perMessageDeflate;
    // PerMessageDeflate 这个就是用来压缩数据的~~！和一些其他的参数设置...
    if(options.value.perMessageDeflate) {
        perMessageDeflate = new PerMessageDeflate(typeof options.value.perMessageDeflate !== true ? options.value.perMessageDeflate : {}, false);
        extensionsOffer[PerMessageDeflate.extensionName] = perMessageDeflate.offer();
    }

    // 暴露状态
    this._isServer = false;
    this.url = address;
    this.protocolVersion = options.value.protocolVersion;
    this.supports.binary = (this.protocolVersion !== 'hixie-76');

    // 开始握手
    // Buffer.toString('encoding')
    var key = new Buffer(options.value.protocolVersion + '-'+ Date.now()).toString('base64');
    // 258EAFA5-E914-47DA-95CA-C5AB0DC85B11 这个串是固定的！！
    var shasum = crypto.createHash('sha1');
    shasum.update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11');
    var expectedServerKey = shasum.digest('base64');  // base64摘要

    var agent = options.value.agent;

    var headerHost = serverUrl.hostname;
    // 为 host header加上固定端口号。当指定了url而且不是默认的(http的80,https的443)
    if(serverUrl.port) {
        if((isSecure && (port !== 443)) || (!isSecure && (port !== 80))) {
            headerHost = headerHost + ':' + port;
        }
    }

    var requestOptions = {
        port:port,
        host:serverUrl.hostname,
        headers: {
            'Connection':'Upgrade',
            'Upgrade':'websocket',
            'Host': headerHost,
            'Sec-WebSocket-Version':options.value.protocolVersion,
            'Sec-WebSocket-Key':key
        }
    };

    // 如果有基本验证
    if(auth) {
        requestOptions.headers.Authorization = 'Basic ' + new Buffer(auth).toString('base64');
    }

    if(options.value.protocol) {
        requestOptions.headers['Sec-WebSocket-Protocol'] = options.value.protocol;
    }

    if(options.value.host) {
        requestOptions.headers.Host = options.value.host;
    }

    if(options.value.headers) {
        for(var header in options.value.headers) {
            if(options.value.headers.hasOwnProperty(header)) {
                requestOptions.headers[header] = options.value.headers[header];
            }
        }
    }

    if(Object.keys(extensionsOffer).length) {
        requestOptions.headers['Sec-WebSocket-Extensions'] = Extensions.format(extensionsOffer);
    }

    if(options.isDefinedAndNonNull('pfx')
        || options.isDefinedAndNonNull('key')
        || options.isDefinedAndNonNull('passphrase')
        || options.isDefinedAndNonNull('cert')
        || options.isDefinedAndNonNull('ca')
        || options.isDefinedAndNonNull('ciphers')
        || options.isDefinedAndNonNull('rejectUnauthorized')
    ) {
        if(options.isDefinedAndNonNull('pfx')) requestOptions.pfx = options.value.pfx;
        if(options.isDefinedAndNonNull('key')) requestOptions.key = options.value.key;
        if(options.isDefinedAndNonNull('passphrase')) requestOptions.passphrase = options.value.passphrase;
        if(options.isDefinedAndNonNull('cert')) requestOptions.cert = options.value.cert;
        if(options.isDefinedAndNonNull('ca')) requestOptions.ca = options.value.ca;
        if(options.isDefinedAndNonNull('ciphers')) requestOptions.ciphers = options.value.ciphers;
        if(options.isDefinedAndNonNull('rejectUnauthorized')) requestOptions.rejectUnauthorized = options.value.rejectUnauthorized;

        if(!agent) {
            agent = new httpObj.Agent(requestOptions); // 无视客户端的协议
        }
    }

    requestOptions.path = serverUrl.path || '/';

    if(agent) {
        requestOptions.agent = agent;
    }

    if(isUnixSocket) {
        requestOptions.socketPath = serverUrl.pathname;
    }

    if(options.value.origin) {
        if(options.value.protocolVersion < 13) requestOptions.headers['Sec-WebSocket-Origin'] = options.value.origin;
        else requestOptions.headers.Origin = options.value.origin;
    }
    var self = this;

    /********  天啊他终于在这段调用了**********/
    var req = httpObj.request(requestOptions);
    req.on('error', function onerror(error){
        self.emit('error', error);
        cleanupWebSocketResources.call(self, error);
    });

    req.once('response', function response(res){
        var error;

        if(!self.emit('unexcepted-response', req, res)) {
            error = new Error('unexpected server response ('+res.statusCode + ')');
            req.abort();
            self.emit('error', error);
        }
        cleanupWebSocketResources.call(self, error);
    });

    req.once('upgrade', function upgrade(res, socket, upgradeHead){
        if(self.readyState === WebSocket.CLOSED) {
            // 如果发现状态已经变成关闭了，那在接受服务端连接之前就关掉。
            self.emit('close');
            self.removeAllListeners();
            socket.end();
            return;
        }
        var serverKey = res.headers['sec-websocket-accept']; /// 关联的服务端key？？？？
        if(typeof serverKey === 'undefined' || serverKey !== expectedServerKey) {
            self.emit('error', 'invalid server key');
            self.removeAllListeners();
            socket.end();
            return;
        }
        // 校验协议相关的一些东西
        var serverPort = res.headers['sec-websocket-protocol'];
        var protList = (options.value.protocol || "").split(/, */);
        var protError = null;


        if(!options.value.protocol && serverPort) {
            protError = 'server sent a subprotocol event though none requested';
        } else if(options.value.protocol && !serverPort) {
            protError = 'server sent no subprotocol event though requested';
        } else if(serverProt && protList.indexOf(serverProt) === -1) {
            protError = 'server responsed with an invalid protocol';
        }

        if(protError) {
            self.emit('error', protError);
            self.removeAllListeners();
            socket.end();
            return;
        } else if(serverPort) {
            self.protocol = serverPort;
        }

        var serverExtensions = Extensions.parse(res.headers['sec-websocket-extensions']);
        if(perMessageDeflate && serverExtensions[PerMessageDeflate.extensionName]){
            try {
                perMessageDeflate.accept(serverExtensions[PerMessageDeflate.extensionName]);
            } catch(e) {
                self.emit('error', 'invalid extension parameter');
                self.removeAllListeners();
                socket.end();
                return;
            }
            self.extensions[PerMessageDeflate.extensionName] = perMessageDeflate;
        }
        establishConnection.call(self, Receiver, Sender, socket, upgradeHead);

        req.removeAllListeners();
        req = null;
        agent = null;
    });

    req.end();
    this.readyState = WebSocket.CONNECTING;
}

/**
 * 嗷。打开连接，设置好sender receiver!!!!相应的回调函数！！！
 * @param ReceiverClass
 * @param SenderClass
 * @param socket
 * @param upgradeHead
 */
function establishConnection(ReceiverClass, SenderClass, socket, upgradeHead){
    var ultron = this._ultron = new Ultron(socket);
    this._socket = socket;

    socket.setTimeout(0);
    socket.setNoDelay(true);
    var self = this;
    this._receiver = new ReceiverClass(this.extensions);

    ultron.on('end', cleanupWebSocketResources.bind(this));
    ultron.on('close', cleanupWebSocketResources.bind(this));
    ultron.on('error', cleanupWebSocketResources.bind(this));

    // 保证upgradeHead 加入到了receiver
    function firstHandler(data) {
        if(self.readyState !== WebSocket.OPEN && self.readyState !== WebSocket.CLOSING) return;

        if(upgradeHead && upgradeHead.length >0) {
            self.bytesReceived += upgradeHead.length;
            var head = upgradeHead;
            upgradeHead = null;
            self._receiver.add(head);
        }
        dataHandler = realHandler;

        if(data) {
            self.bytesReceived += data.length;
            self._receiver.add(data);
        }
    }

    function realHandler(data) {
        if(data) self.bytesReceived += data.length;
        self._receiver.add(data);
    }
    // 先给firstHandler 把头部加入，再用realHandler填充data
    var dataHandler = firstHandler;

    // 如果data随着http upgrade传递过来，就把它传递给receiver，下个tick才出发，因为caller还没来得及把handler传递给client
    process.nextTick(firstHandler);

    // 设置好_receiver的一些回调
    self._receiver.ontext = function ontext(data, flags) {
        flags = flags || {};
        self.emit('message', data, flags);
    };

    self._receiver.onbinary = function onbinary(data, flags) {
        flags = flags || {};

        flags.binary = true;
        self.emit('message', data, flags);
    };

    self._receiver.onping = function onping(data, flags) {
        flags = flags || {};

        self.pong(data, {mask:!self._isServer, binary:flags.binary === true}, true);
        self.emit('ping', data, flags);
    };

    self._receiver.onpong = function onpong(data, flags) {
        self.emit('pong', data, flags || {});
    };

    self._receiver.onclose = function onclose(data, flags) {
        self._closeReceived = true;
        self.close(code, data);
    };

    self._receiver.onerror = function onerror(data, flags) {
        // 要是receiver报告一个HyBi的错误就关闭连接
        self.close(typeof errorCode !== 'undefined' ? errorCode : 1002, '');
        self.emit('error', reason, errorCode);
    };

    this._sender = new SenderClass(socket, this.extensions);
    this._sender.on('error', function onerror(error) {
        self.close(1002, ''); /// 1002什么鬼？？
        self.emit('error', error);
    });
    this.readyState = WebSocket.OPEN;
    this.emit('open');
    ultron.on('data', dataHandler);
}

function startQueue(instance){
    instance._queue = instance._queue || [];
}
function executeQueueSends(instance){
    var queue = instance._queue; // 这队列里的都是等待回调的函数，具体做啥饿？
    if(typeof queue === 'undefined') return;

    delete instance._queue;
    for(var i= 0, l=queue.length;i<l;++i) {
        queue[i]();
    }
}

/**
 * 这个方法真坑爹！！！！！写了一堆是吧？？？！！！核心就两句话
 * stream.on('data', function(){option.fin=false;})
 * stream.on('end', function(){option.fin=true;})
 *
 * 整了半天就是为了标记有没有读完流 fin
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

    // 是否应该主动emitClose呢~
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

