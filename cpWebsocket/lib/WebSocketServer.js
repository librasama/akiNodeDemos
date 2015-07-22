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
    events.EventEmitter.call(this); // ��ʼ������super(options)�ĸо�����

    options = new Options({
        host: '0.0.0.0',
        port:null,   // ָ���˿�/IP
        server:null, // Ҳ���������ʼ����һ��serverȻ�󴫽���
        verifyClient:null,
        handleProtocols:null,
        path:null,      // �����ʲôʹ��
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
        //���˹��ˡ�ԭ���ǻ���httpЭ��ʵ�ֵ�websocket!!Ҳ�� = =|||
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
            // ��һ��path,��ֹʹ��ͬһ��http server�Ķ��websocket server��ͻ
            if(this._server._webSocketPaths && options.value.server._webSocketPaths[options.value.path]) {
                throw new Error('two instances of WebSocketServer cannot listen on the same http server path');
            }
            // ��ʼ��һ��
            if(typeof this._server._webSocketPaths !== 'object') {
                this._server._webSocketPaths = {};
            }
            // ������path�Ѿ���websocket serverʹ����
            this._server._webSocketPaths[options.value.path] = 1;
        }
    }
    if(this._server) this._server.once('listening', function () {self.emit('listening')}); // ��ʼ���ú󣬼�������server��listening�������ҽ�����һ��listening�¼�

    if(typeof this._server != 'undefined') {
        this._server.on('error', function (error) {
            self.emit('error', error);
        });
        // httpЭ����õ����¼�
        this._server.on('upgrade', function (req, socket, upgradeHead) {
            // copy upgradeHead��ֹռ�ô�����buffer��Դ
            var head = new Buffer(upgradeHead.length);
            upgradeHead.copy();
            //��Ҳ����ת��һ�£���һ�㴦��
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
 * �رշ����
 */
WebSocketServer.prototype.close = function(){
    // ��ֹ�������ӵ�client
    var error = null;
    try {
        for (var i = 0; i < this.clients.length; i++) {
            this.clients[i].terminate(); // ����ͬ���������𣿣���
        }
    } catch (e) {
        error = e;
    }
    // �Ƴ�path ���
    if(this.path && this._server._webSocketPaths) {
        delete this._server._webSocketPaths[this.path];
        if(Object.keys(this._server._webSocketPaths).length == 0) {
            delete this._server._webSocketPaths;
        }
    }
    try {
        if(typeof this._closeServer !== 'undefined') {
            this._closeServer(); // �ر�ǰ���Ӵ���
        }
    } finally {
        delete this._server;
    }
    if(error) throw error;
};


/**
 * HTTP Upgrade�����󣿣�
 * @param req
 * @param socket
 * @param upgradeHead
 * @param cb
 */
WebSocketServer.prototype.handleUpgrade = function (req, socket, upgradeHead, cb) {
    //���˷Ƿ�����
    if(this.options.path) {
        var u = url.parse(req.url);
        if(u && u.pathname !== this.options.path) return; // �ͻ���ws��ַ����ƥ��
    }
    if(typeof req.headers.upgrade === 'undefined' || req.headers.upgrade.toLowerCase() !== 'websocket') {
        abortConnection(socket, 400, 'Bad Request'); // header��upgrade��Ϣ������websocket��ws��Э���~~��
    }
    //���ܵ�/�Ǽ��ܵ����ִ���
    if(req.headers['sec-websocket-key1']) handleHixieUpgrade.apply(this. arguments); // �л�������
    else handleHybiUpgrade.apply(this, arguments);

};

module.exports = WebSocketServer;

/**
 * ʵ��˽�е�API
 */

/**
 * ����Ǽ��ܵ�����
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
    // У��key�Ƿ������
    if(!req.headers['sec-websocket-key']) {
        abortConnection(socket, 400, 'Bad Request');
        return;
    }
    // У��汾
    var version = req.headers['sec-websocket-version'];
    if([8, 13].indexOf(version) === -1) { // ʲô��ѧУ���أ�����(Ц���汾�ű�����8����13��
        abortConnection(socket, 400, 'Bad Request');
        return;
    }
    // У��Э��
    var protocols = req.headers['sec-websocket-protocols'];

    // У��ͻ���
    var origin = version<13 ? req.headers['sec-websocket-protocol'] : req.headers['origin']; // ����version=8Ҫ����origin�ֶ���Ϣ��13Ҫ����protocol�ֶ���Ϣ

    // ������չ
    var extensionsOffer = Extensions.parse(req.headers['sec-websocket-extensions']);
    // �����Ӿ���ʱ����
    var self = this;

    var completeHybiUpgrade2 = function (protocol) {

        // ����key
        var key = req.headers['sec-websocket-key'];
        var shasum = crypto.createHash('sha1');
        shasum.update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11');
        key = shasum.digest('base64');

        //����ͷ��
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
            acceptExtensions.call(self, extensionsOffer);//��չЭ���б�
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
        // ���ֵ�ͷ�����������޸�/����
        self.emit('headers', headers);
        socket.setTimeout(0);
        socket.setNoDelay(true);// ����Nagle�㷨
        try {
            // ��ʽƴ�ַ�������û�У��ܳ��õļ��ɣ�����concat��
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

    // �ڵ���2֮ǰ���Ȱ�ѡ�������չЭ��
    var completeHybiUpgrade1 = function () {
        // ѡ����Э��
        if(typeof self.options.handleProtocols == 'function') {
            var protList = (protocols || "").split(/, */);
            var callbackCalled = false;
            var res = self.options.handleProtocols(protList, function (result, protocol) {
                callbackCalled = true;
                if(!result) abortConnection(socket, 401, 'Unauthorized');
                else completeHybiUpgrade2(protocol);
            });
            if(!callbackCalled) {
                // û�ж�Ӧ�Ĵ���handler
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


