var util = require('util'),
    Validation = require('./Validation').Validation,
    ErrorCodes = require('./ErrorCodes'),
    BufferPool = require('./BufferPool'),
    bufferUtil = require('./BufferUtil').BufferUtil,
    PerMessageDeflate = require('./PerMessageDeflate');

function Receiver(extensions) {
	var fragmentedPoolPrevUsed = -1;
	this.fragmentedBufferPool = new BufferPool(1024, function (db, length) {
		return db.used + length;
	}, function (db) {
		return fragmentedPoolPrevUsed = fragmentedPoolPrevUsed > 0 ? (fragmentedPoolPrevUsed+db.used) /2 : db.used;
	});

	// 没分片的消息的内存池
	var unfragmentPoolPrevUsed = -1;
	this.unfragmentedBufferPool = new BufferPool(1024, function (db, length) {
		return db.used + length;
	}, function (db) {
		return unfragmentPoolPrevUsed >= 0 ? (unfragmentPoolPrevUsed + db.used)/2 : db.used;
	});

	this.extensions = extensions || {};
	this.state = {
		activeFragmentedOperation : null,
		lastFragment : false,
		masked:false,
		opcode:0,
		fragmentedOperation:false
	};
	this.overflow = [];
	this.headerBuffer = new Buffer[10];
	this.expectOffset = 0;
	this.expectBuffer = null;
	this.expectHandler = null;
	this.currentMessage = [];
	this.messageHandlers = [];
	this.expectHeader(2, this.processPacket);
	this.dead = false;
	this.processing = false;

	this.onerror = function () {};
	this.ontext = function () {};
	this.onbinary = function () {};
	this.onclose = function () {};
	this.onping = function () {};
	this.onpong = function () {};
}

module.exports = Receiver;

Receiver.prototype.add = function (data) {
	var dataLength = data.length;
	if(dataLength == 0) return;
	if(this.expectBuffer == null) {
		this.overflow.push(data);
		return;
	}
	var toRead = Math.min(dataLength, this.expectBuffer.length - this.expectOffset);
	fastCopy(toRead, data, this.expectBuffer, this.expectOffset);
	this.expectOffset += toRead;
	if(toRead < dataLength) {
		this.overflow.push(data.slice(toRead));
	}
	while(this.expectBuffer && this.expectOffset == this.expectBuffer.length) {
		this.bufferForHandler = this.expectBuffer;
		this.expectBuffer = null;
		this.expectOffset = 0;
		this.expectHandler.call(this, bufferForHandler);
	}
};

Receiver.prototype.cleanup = function (data) {
	this.dead = true;
	this.overflow = null;
	this.headerBuffer = null;
	this.expectBuffer = null;
	this.expectHandler = null;
	this.unfragmentedBufferPool = null;
	this.fragmentedBufferPool = null;
	this.state = null;
	this.currentMessage = null;
	this.onerror = null;
	this.ontext = null;
	this.onbinary = null;
	this.onclose = null;
	this.onping = null;
	this.onpong = null;
};

/**
 * 其实这段slice不是很懂。overflow这个名字也搞不懂。说到底这方法到底干什么的？？
 * @param length
 * @param handler
 */
Receiver.prototype.expectHandler = function (length, handler) {
	if(length == 0) {
		handler(null);
		return;
	}
	this.expectBuffer = this.headerBuffer.slice(this.expectOffset, this.expectOffset + length);
	this.expectHeader = handler;
	var toRead = length;
	while(toRead > 0 && this.overflow.length >0) {
		var fromOverflow = this.overflow.pop();
		if(toRead < fromOverflow.length) this.overflow.push(fromOverflow.slice(toRead));
		var read = Math.min(fromOverflow.length, toRead);
		fastCopy(read, fromOverflow, this.expectBuffer, this.expectOffset);
		this.expectOffset += read;
		toRead -= read;
	}
};


/**
 * 等到积攒到一定数量的数据发送，再触发callback
 * @param length
 * @param handler
 */
Receiver.prototype.expectData = function (length, handler) {
	if(length == 0) {
		handler(null);return;
	}
	this.expectHandler = this.allocateFromPool(length, this.state.fragmentedOperation);
	var toRead = length;
	while(toRead >0 && this.overflow.length >0) {
		var fromOverflow = this.overflow.pop();
		if(toRead < fromOverflow.length) this.overflow.push(fromOverflow.slice(toRead));
		var read = Math.min(fromOverflow.length, toRead);
		fastCopy(read, fromOverflow, this.expectBuffer, this.expectOffset);
		this.expectOffset += read;
		toRead -= read;
	}
};

/**
 * 从buffer池里分配内存
 * @param length
 * @param isFragmented
 */
Receiver.prototype.allocateFromPool = function (length, isFragmented) {
	return (isFragmented? this.fragmentedBufferPool : this.unfragmentedBufferPool).get(length);
};


/**
 * 处理新的packet
 * @param data
 */
Receiver.prototype.processPacket = function (data) {
	if(this.extensions[PerMessageDeflate.extensionName]) {
		// 处理标识位？？
		if((data[0] & 0x30) != 0) {
			this.error('reserved fields (2,3) must be empty', 1002);
			return;
		}
	}
	else {
		if((data[0] & 0x70) != 0) {
			this.error('reserved fields must be empty', 1002);
			return;
		}
	}
	this.state.lastFragment = (data[0] & 0x80) == 0x80;
	this.state.masked = (data[1] & 0x80) == 0x80;
	var compressed = (data[0] & 0x40) == 0x40;
	var opcode = data[0] & 0xf;
	if(opcode === 0 ) {
		// 没有opcode就是状态100的继续包？
		if(compressed) {
			this.error('continuation frame cannot have the Per-message Compressed bits', 1002);
			return;
		}
		this.state.fragmentedOperation = true;
		this.state.opcode = this.state.activeFragmentedOperation;
		if(!(this.state.opcode == 1 || this.state.opcode == 2)) {
			this.error('continuation frame cannot follow current opcode', 1002);
			return;
		}
	}
	// 这是真正想做事情的部分
	else {
		if(opcode < 3 && this.state.activeFragmentedOperation != null) {
			this.error('data frame after the initial data frame must have opcode 0', 1002); // 继续包的话必须是0。条件里的opcode和activeFragmentedOperation是矛盾的
			return;
		}
		/// ping/pong
		if(opcode >= 8 && compressed){
			this.error('control frames cannot have the Per-message Compressed bits', 1002);
			return;
		}
		this.state.compressed = compressed;
		this.state.opcode = opcode;
		if(this.state.lastFragment === false) {
			this.state.fragmentedOperation = true;
			this.state.activeFragmentedOperation = opcode; // 看看这个地方。设置了这帧的操作
		}
		else this.state.fragmentedOperation = false;
	}
	var handler = opcodes[this.state.opcode];
	if(typeof handler == 'undefined') this.error('no handler for opcode '+this.state.opcode, 1002);
	else {
		handler.start.call(this, data); // 从start方法开始调用。
	}
};

/**
 * 包结束。主要是重置一下buffer内存池的状态？opcode的状态？？
 * 为了下一个包？
 */
Receiver.prototype.endPacket = function () {
	if(!this.state.fragmentedOperation) this.unfragmentedBufferPool.reset(true);
	else if(this.state.lastFragment) this.fragmentedBufferPool.reset(false);
	this.expectOffset = 0;
	this.expectBuffer = null;
	this.expectHandler = null;
	if(this.state.lastFragment && this.state.opcode === this.state.activeFragmentedOperation) {
		this.state.activeFragmentedOperation = null;
	}
	this.state.lastFragment = false;
	this.state.opcode = this.state.activeFragmentedOperation != null ? this.state.activeFragmentedOperation : 0;
	this.state.masked = false;
	this.expectHeader(2, this.processPacket);
};

/**
 * 应该是连接/会话级别的重置
 */
Receiver.prototype.reset = function () {
	if(this.dead) return;
	this.state = {
		activeFragmentedOperation:null,
		lastFragment:false,
		masked:false,
		opcode:false,
		fragmentedOperation:false
	};
	this.fragmentedBufferPool.reset(true);
	this.unfragmentedBufferPool.reset(true);
	this.expectOffset = 0;
	this.expectBuffer = null;
	this.expectHandler = null;
	this.overflow = [];
	this.currentMessage = [];
	this.messageHandlers = [];

};

Receiver.prototype.unmask = function (mask, buf, binary) {
	if(mask != null && buf != null) bufferUtil.umask(buf, mask);
	if(binary) return buf;
	return buf!= null ? buf.toString('utf8'):'';
};

/**
 * 将小的缓冲区统一合并为大的缓冲，提高写入性能
 * @param buffers
 * @returns {Buffer}
 */
Receiver.prototype.concatBuffers = function (buffers) {
	var length = 0;
	for(var i= 0, l=buffers.length;i<l;++i) length += buffers[i].length;
	var mergeBuffer = new Buffer(length);
	bufferUtil.merge(mergeBuffer, buffers);
	return mergeBuffer;
};

/**
 * 调用外部注入的错误处理
 * @param reason
 * @param protocolErrorCode
 * @returns {Receiver}
 */
Receiver.prototype.error = function (reason, protocolErrorCode) {
	this.reset();
	this.onerror(reason, protocolErrorCode);
	return this;
};

/**
 * 递归调用触发
 */
Receiver.prototype.flush = function () {
	if(this.processing || this.dead) return;

	var handler = this.messageHandlers.shift();
	var self = this;
	// 执行后回调递归
	handler(function () {
		self.processing = true;
		self.flush();
	});

};

Receiver.prototype.applyExtensions = function (messageBuffer, fin, compressed, callback) {
};

/**
 * Buffer 工具
 */

function readUInt16BE(start) {
	return (this[start+1]<<8) + (this[start]);
}

function readUInt32BE(start) {
	return (this[start]<<24) + (this[start+1]<<16) + (this[start+2]<<8) + (this[start+3]);
}

function fastCopy(length, srcBuffer, dstBuffer, dstOffset) {
	switch(length) {
		default : srcBuffer.copy(dstBuffer, dstOffset, 0, length); break;
		case 16 : dstBuffer[dstOffset+15] = srcBuffer[15];
		case 15 : dstBuffer[dstOffset+14] = srcBuffer[14];
		case 14 : dstBuffer[dstOffset+13] = srcBuffer[13];
		case 13 : dstBuffer[dstOffset+12] = srcBuffer[12];
		case 12 : dstBuffer[dstOffset+11] = srcBuffer[11];
		case 11 : dstBuffer[dstOffset+10] = srcBuffer[10];
		case 10 : dstBuffer[dstOffset+9] = srcBuffer[9];
		case 9 : dstBuffer[dstOffset+8] = srcBuffer[8];
		case 8 : dstBuffer[dstOffset+7] = srcBuffer[7];
		case 7 : dstBuffer[dstOffset+6] = srcBuffer[6];
		case 6 : dstBuffer[dstOffset+5] = srcBuffer[5];
		case 5 : dstBuffer[dstOffset+4] = srcBuffer[4];
		case 4 : dstBuffer[dstOffset+3] = srcBuffer[3];
		case 3 : dstBuffer[dstOffset+2] = srcBuffer[2];
		case 2 : dstBuffer[dstOffset+1] = srcBuffer[1];
		case 1 : dstBuffer[dstOffset] = srcBuffer[15];
	}
}

function clone(obj) {
	var cloned = {};
	for(var k in obj) {
		if(obj.hasOwnProperty(k)) {
			cloned[k] = obj[k];
		}
	}
	return cloned;
}




/**
 * 操作码及其处理函数
 * @type {{}}
 */
var opcodes = {
	// 文本
	'1':{
		start: function (data) {
			var self = this;
			// 计算长度
			var firstLength = data[1] & 0x7f; // 后七位 01111111
			if(firstLength < 126) {
				opcodes['1'].getData.call(self, firstLength);
			}
			else if(firstLength == 126) {
				self.expectHeader(2, function (data) {
					opcodes['1'].getData.call(self, readUInt16BE.call(data, 0));
				});
			}
			else if(firstLength == 127) {
				self.expectHeader(8, function (data) {
					if(readUInt32BE.call(data, 0) != 0) {
						self.error('packet with length spanning more than 32 bit is currently not supported', 1008);
						return;
					}
					opcodes['1'].getData.call(self, readUInt32BE.call(data, 4));
				});
			}
		},
		getData: function (length) {
			var self = this;
			if(self.state.masked) {
				self.expectHeader(4, function (data) {
					var mask = data;
					self.expectData(length, function (data) {
						opcodes['1'].finish.call(self, mask, data);
					})
				});
			} else {
				self.expectData(length, function (data) {
					opcodes['1'].finish.call(self, null, data);
				});
			}
		},
		finish: function (mask, data) {
			var self = this;
			var packet = this.unmask(mask, data, true) || new Buffer(0);
			var state = clone(this.state);
			this.messageHandlers.push(function (callback) {
				self.applyExtensions(packet, state.lastFragment, state.compressed, function (err, buffer) {
					if(err) return self.error(err.message, 1007);
					if(buffer != null) self.currentMessage.push(buffer);

					if(state.lastFragment) {
						var messageBuffer = self.createBuffers(self.currentMessage);
						self.currentMessage = [];
						if(!Validation.isValidUTF8(messageBuffer)) {
							self.error('invalid utf8 sequence', 1007);
							return;
						}
						self.ontext(messageBuffer.toString('utf8'), {masked:state.masked, buffer:messageBuffer});
					}
					callback();
				});
			});
			this.flush();
			this.endPacket();
		}
	},
	// 二进制
	'2':{
		start: function (data) {
			var self = this;
			var firstLength = data[1] & 0x7f;
			if(firstLength < 126) {
				opcodes['2'].getData.call(self, firstLength);
			} else if(firstLength == 126) {
				self.expectHeader(2, function (data) {
					opcodes['2'].getData.call(self, readUInt16BE.call(data, 0));
				});
			} else if(firstLength == 127) {
				self.expectHeader(8, function (data) {
					if(readUInt32BE.call(data, 0) != 0) {
						self.error('packet with length more than 32 bit is currently not supported', 1008);
						return;
					}
					opcodes['2'].getData.call(self, readUInt32BE.call(data, 4, true));
				});
			}
		},
		getData: function (length) {
			var self = this;
			if(self.state.masked) {
				self.expectHeader(4, function (data) {
					var mask = data;
					self.expectData(length, function(data){
						opcodes['2'].finish.call(self, mask, data);
					});
				});
			}
		},
		finish: function (mask, data) {
			self.expectData(length, function (data) {
				opcodes['2'].finish.call(self, null, data);
			});
		}
	},
	'8':{
		start: function (data) {
			var self = this;
			if(self.state.lastFragment == false) {
				self.error('fragmented close is not supported', 1002);
				return;
			}

			var firstLength = data[1] & 0x7f;
			if(firstLength < 126) {
				opcodes['8'].getData.call(self, firstLength);
			} else {
				self.error('control frames cannot have more than 125 bytes of data', 1002);
			}
		},
		getData: function (length) {
			var self = this;
			if(self.state.masked) {
				self.expectHeader(4, function (data) {
					var mask = data;
					self.expectData(length, function (data) {
						opcodes['8'].finish.call(self, mask, data);
					});
				});
			}
			else {
				self.expectData(length, function (data) {
					opcodes['8'].finish.call(self, null, data);
				});
			}
		},
		finish: function (mask, data) {
			var self = this;
			data = self.unmask(mask, data, true);

			var state = clone(this.state);
			this.messageHandlers.push(function () {
					if(data && data.length == 1) {

					}
					var code = data && data.length >1 ? readUInt16BE.call(data, 0) : 1000;
					if(!ErrorCodes.isValidErrorCode(code)) {

					}
					var message = '';
					if(data && data.length >2) {
						var messageBuffer = data.slice(2);
						if(!Validation.isValidUTF8(messageBuffer)) {
							self.error('invalid utf8 sequence', 1007);
							return;
						}
						message = messageBuffer.toString('utf8');
					}
				self.onclose(code, message, {masked:state.masked});
				self.reset();
			});
			this.flush();

		}
	},
	// ping
	'9':{
		start: function (data) {
			var self = this;
			if(self.state.lastFragment == false) {
				self.error('fragmented ping is not supported', 1002);
				return;
			}

			// decode length
			var firstLength = data[1] & 0x7f;
			if(firstLength < 126) {
				opcodes['9'].getData.call(self, firstLength);
			} else {
				self.error('control frames cannot have more than 125 bytes of data', 1002);
			}
		},
		getData: function (length) {
			var self = this;
			if(self.state.masked) {
				self.expectHandler(4, function (data) {
					var mask = data;
					self.expectData(length, function (data) {
						opcodes['9'].finish.call(self, mask, data);
					});
				});
			}
			else {
				self.expectData(length, function(data){
					opcodes['9'].finish.call(self, null, data);
				});
			}
		},
		finish: function (mask, data) {
			var self = this;
			data = this.unmask(mask, data, true);
			var state = clone(this.state);
			this.messageHandlers.push(function(callback){
				self.onping(data, {masked:state.masked, binary:true});
				callback();
			});
			this.flush();
			this.endPacket();
		}
	},
	'10':{
		start: function (data) {
			var self = this;
			if(self.state.lastFragment == false) {
				self.error('fragmented ping is not supported', 1002);
				return;
			}
		},
		getData: function (length) {
			var self = this;
			if(self.state.masked) {
				self.expectHandler(4, function (data) {
					var mask = data;
					self.expectData(length, function (data) {
						opcodes['10'].finish.call(self, mask, data);
					});
				});
			}
			else {
				self.expectData(length, function(data){
					opcodes['10'].finish.call(self, null, data);
				});
			}
		},
		finish: function (mask, data) {
			var self = this;
			data = this.unmask(mask, data, true);
			var state = clone(this.state);
			this.messageHandlers.push(function(callback){
				self.onping(data, {masked:state.masked, binary:true});
				callback();
			});
			this.flush();
			this.endPacket();
		}
	}
};
