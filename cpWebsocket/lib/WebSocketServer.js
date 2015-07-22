var util = require('util'),
    events = require('events'),
    http = require('http'),
    crypto = require('crypto'),
    Options = require('options'),
    WebSocket = require('./WebSocket'),
    Extensions = require('./Extenstions'),
    PerMessageDeflate = require('./PerMessageDeflate'),
    tls = require('tls'),
    url = require('url');

function WebSocketServer(options, callback) {
    events.EventEmitter.call(this); // 初始化？？super(options)的感觉？？

    options = new Options({
        host: '0.0.0.0',
        port:null,   // 指定端口/IP
        server:null, // 也可以外面初始化好一个server然后传进来
        verifyClient:null,
        handleProtocols:null,
        path:null,      // 不造干什么使的
        noServer:false,
        disabelHixie:false,
        clientTracking:true,
        perMessageDeflate:true
    }).merge(options);

    if(!options.isDefinedAndNonNUll('port') && !options.isDefinedAndNonNUll('server') && !options.value.noServer) {
        throw new TypeError('`port` or a `server` must be provided');
    }

    var self = this;

    if(options.isDefinedAndNonNUll('port')) {
        //日了狗了。原来是基于http协议实现的websocket!!也好 = =|||
        this._server = http.createServer(function (req, res) {
            res.writeHead(200, {'Content-type':'text-plain'});
            res.end('Not implemented');
        });
        this._server.listen(options.value.port, options.value.host, callback);
        this._closeServer = function () {if(self._server) self._server.close();}
    }
    else if(options.value.server) {
        this._server = options.value.server;
        if(options.vlaue.path) {
            // 记一下path,防止使用同一个http server的多个websocket server冲突
            if(this._server._webSocketPaths && options.value.server._webSocketPaths[options.value.path]) {
                throw new Error('two instances of WebSocketServer cannot listen on the same http server path');
            }
            // 初始化一下
            if(typeof this._server._webSocketPaths !== 'object') {
                this._server._webSocketPaths = {};
            }
            // 标记这个path已经有websocket server使用了
            this._server._webSocketPaths[options.value.path] = 1;
        }
    }
    if(this._server) this._server.once('listening', function () {self.emit('listening')}); // 初始化好后，监听真正server的listening，触发且仅触发一次listening事件

    if(typeof this._server != 'undefined') {
        this._server.on('error', function (error) {
            self.emit('error', error);
        });
        // http协议会用到的事件
        this._server.on('upgrade', function (req, socket, upgradeHead) {
            // copy upgradeHead防止占用大量的buffer资源
            var head = new Buffer(upgradeHead.length);
            upgradeHead.copy();
            //看也就是转发一下，加一层处理
            self.handleUpgrade(req, socket, head, function (client) {
                self.emit('connection'+req.url, client);
                self.emit('connection', client);
            });
        });
    }
    this.options = options.value;
    this.path = options.value.path;
    this.clients = [];

};

util.inherits(WebSocketServer, events.EventEmitter);

/**
 * 关闭服务端
 */
WebSocketServer.prototype.close = function(){
    // 终止所有连接的client
    var error = null;
    try {
        for (var i = 0; i < this.clients.length; i++) {
            this.clients[i].terminate(); // 都是同步的吗吗吗？？？
        }
    } catch (e) {
        error = e;
    }
    // 移除path 标记
    if(this.path && this._server._webSocketPaths) {
        delete this._server._webSocketPaths[this.path];
        if(Object.keys(this._server._webSocketPaths).length == 0) {
            delete this._server._webSocketPaths;
        }
    }
    try {
        if(typeof this._closeServer !== 'undefined') {
            this._closeServer(); // 关闭前钩子处理
        }
    } finally {
        delete this._server;
    }
    if(error) throw error;
};


/**
 * HTTP Upgrade的请求？？
 * @param req
 * @param socket
 * @param upgradeHead
 * @param cb
 */
WebSocketServer.prototype.handleUpgrade = function (req, socket, upgradeHead, cb) {
    //过滤非法请求
    if(this.options.path) {
        var u = url.parse(req.url);
        if(u && u.pathname !== this.options.path) return; // 客户端ws地址请求匹配
    }
    if(typeof req.headers.upgrade === 'undefined' || req.headers.upgrade.toLowerCase() !== 'websocket') {
        abortConnection(socket, 400, 'Bad Request'); // header的upgrade信息必须是websocket。ws的协议吧~~？
    }
    //加密的/非加密的两种处理
    if(req.headers['sec-websocket-key1']) handleHixieUpgrade.apply(this. arguments); // 切换上下文
    else handleHybiUpgrade.apply(this, arguments);

};

module.exports = WebSocketServer;

/**
 * 实体私有的API
 */

/**
 * 处理非加密的请求
 * @param req
 * @param socket
 * @param upgradeHead
 * @param cb
 */
function handleHybiUpgrade(req, socket, upgradeHead, cb) {
    var errorHandler = function () {
        try{socket.destroy();} catch(e){}
    }
    socket.on('error', errorHandler);
    // 校验key是否存在了
    if(!req.headers['sec-websocket-key']) {
        abortConnection(socket, 400, 'Bad Request');
        return;
    }
    // 校验版本
    var version = req.headers['sec-websocket-version'];
    if([8, 13].indexOf(version) === -1) { // 什么科学校验呢？？？(笑。版本号必须是8或者13？
        abortConnection(socket, 400, 'Bad Request');
        return;
    }
    // 校验协议
    var protocols = req.headers['sec-websocket-protocols'];

    // 校验客户端
    var origin = version<13 ? req.headers['sec-websocket-protocol'] : req.headers['origin']; // 看来version=8要附加origin字段信息，13要附加protocol字段信息

    // 处理扩展
    var extensionsOffer = Extensions.parse(req.headers['sec-websocket-extensions']);
    // 当连接就绪时调用
    var self = this;

    var completeHybiUpgrade2 = function (protocol) {

        // 计算key
        var key = req.headers['sec-websocket-key'];
        var shasum = crypto.createHash('sha1');
        shasum.update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11');
        key = shasum.digest('base64');

        //构建头部
        var headers = [
            'HTTP/1.1 101 Switching Protocols',
            'Upgrade: websocket',
            'Connection: upgrade',
            'Sec-WebSocket-Accept: ' + key
        ];
        if(typeof protocol != 'undefined') {
            headers.push('Sec-WebSocket-Protocol: '+protocol);
        }
        var extensions = {};
        try{
            acceptExtensions.call(self, extensionsOffer);//扩展协议列表？
        } catch(err) {
            abortConnection(socket, 400, 'Bad Request');
            return;
        }

        if(Object.keys(extensions).length) {
            var serverExtensions = {};
            Object.keys(extensions).forEach(function(token) {
                serverExtensions[token] = [extendsions[token].params];
            });
            headers.push('Sec-WebSocket-Extensions: ' + Extensions.format(serverExtensions));
        }
        // 握手的头部允许额外的修改/检视
        self.emit('headers', headers);
        socket.setTimeout(0);
        socket.setNoDelay(true);// 禁用Nagle算法
        try {
            // 花式拼字符串（并没有，很常用的技巧：数组concat）
            socket.write(headers.concat('', '').join('\r\n'));
        } catch(e) {
            try{socket.destroy();} catch(ee){}
            return;
        }

        var client = new WebSocket([req, socket, upgradeHead], {
            protocolVersion:version,
            protocol:protocol,
            extensions:extensions
        });

        if(self.options.clientTracking) {
            self.clients.push(client);
            client.on('close', function () {
                var index = self.clients.indexOf(client);
                if(index != -1) {
                    self.clients.splice(index, 1);
                }
            });
        }
        socket.removeListener('error', errorHandler());
        cb(client);
    }

    // 在调用2之前，先按选项调用扩展协议
    var completeHybiUpgrade1 = function () {
        // 选择子协议
        if(typeof self.options.handleProtocols == 'function') {
            var protList = (protocols || "").split(/, */);
            var callbackCalled = false;
            var res = self.options.handleProtocols(protList, function (result, protocol) {
                callbackCalled = true;
                if(!result) abortConnection(socket, 401, 'Unauthorized');
                else completeHybiUpgrade2(protocol);
            });
            if(!callbackCalled) {
                // 没有对应的处理handler
                abortConnection(socket, 501, 'Could not process protocols');
            }
            return;
        } else {
            if(typeof protocols != 'undefined') {
                completeHybiUpgrade2(protocols.split(/, */)[0]);
            } else {
                completeHybiUpgrade2();
            }
        }
    }

    if(typeof this.options.verifyClient == 'function') {
        var info = {origin:origin, secure:typeof req.connection.authorized != 'undefined' || typeof req.connection.encrypted != 'undefined', req:req};
        if(this.options.verifyClient.length == 2) {
            this.options.verifyClient(info, function (result, code, name) {
                if(typeof code === 'undefined') code = 401;
                if(typeof name === 'undefined') name = http.STATUS_CODES[code];

                if(!result) abortConnection(socket, code, name);
                else completeHybiUpgrade1();
            });
            return;
        } else if(!this.options.verifyClient(info)) {
            abortConnection(socket, 401, 'Unauthorized');
            return;
        }
    }
    completeHybiUpgrade1();
}

function handleHixieUpgrade(req, socket, upgradeHead, cb) {

}

function acceptExtensions(offer) {
    var extensions = {};
    var options = this.options.perMessageDeflate;
    if(options && offer[PerMessageDeflate.extensionName]) {
        var perMessageDeflate = new PerMessageDeflate(options !== true ? options : {}, true);
        perMessageDeflate.accept(offer[PerMessageDeflate.extensionName]);
        extensions[PerMessageDeflate.extensionName] = perMessageDeflate;
    }
    return extensions;
}

function abortConnection(socket, code, name) {
    try {
        var response = [
            'HTTP/1.1 ' + code + ' '+ name,
            'Content-type: text/html'
        ];
        socket.write(response.concat('', '').join('\r\n'));
    } catch(e){}
    finally {
        try {socket.destroy();} catch(e){}
    }
}


