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
 * ����״̬
 */
["CONNECTING", "OPEN", "CLOSING", "CLOSED"].forEach(function each(state, index) {
    WebSocket.prototype[state] = WebSocket[state] = index;
});

WebSocket.prototype.close = function close(code, data){};

WebSocket.prototype.pause = function pauser() {

};


/**
 * ����һ��ping
 * @param data Ҫ���͸�������������
 * @param options   mask:boolean, binary:boolean
 * @param dontFailWhenClosed �������û���Ƿ��׳��쳣
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
 * ��¶ bufferedAmount����
 */
Object.defineProperty(WebSocket.prototype, 'bufferedAmount', {});


/**
 * ģ��W3C�涨���������WebSocket�ӿ�
 *
 * �ο���http://dev.w3.org/html5/websockets/#the-websocket-interface
 *
 */
['open', 'error', 'close', 'message'].forEach(function(method){
    Object.defineProperty(WebSocket.prototype, 'on'+method, {})
});


WebSocket.prototype.addEventListener = function(method, listener){};

module.exports = WebSocket;

/**
 * W3C ��Ϣ�¼�
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
















