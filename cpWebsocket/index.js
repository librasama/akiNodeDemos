'use strict'

var AWS = module.exports = require('./AWebSocket'); 
AWS.Server = require('./lib/WebSocketServer');
AWS.Sender = require('./lib/Sender');
AWS.Receiver = require('./lib/Receiver');

/**
 * �󶨷����/�ͻ��˴���ģ��
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


