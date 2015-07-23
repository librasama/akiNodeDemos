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

var closeTimeout = 30 * 1000;

function WebSocket(address, protocols, options) {

}

util.inherits(WebSocket, EventEmitter);

/**
 * 就绪状态
 */
["CONNECTING", "OPEN", "CLOSING", "CLOSED"].forEach(function each(state, index) {
    WebSocket.prototype[state] = WebSocket[state] = index;
});

WebSocket.prototype.close = function close(code, data){};

WebSocket.prototype.pause = function pauser() {

};


/**
 * 发送一个ping
 * @param data 要发送给服务器的数据
 * @param options   mask:boolean, binary:boolean
 * @param dontFailWhenClosed 如果连接没开是否抛出异常
 */
WebSocket.prototype.ping = function ping(data, options, dontFailWhenClosed) {

};


WebSocket.prototype.pong = function pong(data, options, dontFailWhenClosed) {

};

WebSocket.prototype.resume = function resume() {

};

WebSocket.prototype.send = function send(data, options, cb) {

};

WebSocket.prototype.stream = function stream(options, cb) {

};

WebSocket.prototype.terminate = function terminate(options, cb) {

};

/**
 * 暴露 bufferedAmount属性
 */
Object.defineProperty(WebSocket.prototype, 'bufferedAmount', {});


/**
 * 模仿W3C规定的浏览器端WebSocket接口
 *
 * 参看：http://dev.w3.org/html5/websockets/#the-websocket-interface
 *
 */
['open', 'error', 'close', 'message'].forEach(function(method){
    Object.defineProperty(WebSocket.prototype, 'on'+method, {})
});


WebSocket.prototype.addEventListener = function(method, listener){};

module.exports = WebSocket;

/**
 * W3C 消息事件
 */
function MessageEvent(dataArg, typeArg, target){}
function CloseEvent(dataArg, typeArg, target){}
function OpenEvent(dataArg, typeArg, target){}

function initAsServerClient(req, socket, upgradeHead, options){}
function initAsClient(address, protocols, options){}
function establishConnection(ReceiverClass, SenderClass, socket, upgradeHead){}
function startQueue(instance){}
function executeQueueSends(instance){}
function sendStream(){}
function cleanupWebSocketResources(error){}
















