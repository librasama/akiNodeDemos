'use strict'

var AWS = module.exports = require('./AWebSocket'); 
AWS.Server = require('./lib/WebSocketServer');
AWS.Sender = require('./lib/Sender');
AWS.Receiver = require('./lib/Receiver');

/**
 * 绑定服务端/客户端处理模块
 * @param options
 * @param fn
 * @returns {*|Server}
 */
AWS.createServer = function (options, fn) {
  var server = new AWS.Server(options);
    if(typeof fn === 'function') {
        server.on('connection', fn);
    }
    return server;
};

AWS.connect = AWS.createConnection = function connect(address, fn) {
    var client = new AWS(address);
    if(typeof client === 'function') {
        client.on('open', fn);
    }
    return client;
}


