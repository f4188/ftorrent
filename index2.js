
dgram = require('dgram')
Duplex = require('stream').Duplex
crypto = require('crypto')
util = require('util')
EventEmitter = require('events').EventEmitter
TQueue = require('./lib/tqueue.js')
speedometer = require('speedometer')
WindowBuffer = require('./lib/sendBuffer.js')
speed = speedometer(4)
Q = require('q')
winston = require('winston')

var logger = new winston.Logger()

const ST_DATA = 0  //Data
const ST_FIN = 1
const ST_STATE = 2 //Ack
const ST_RESET = 3  
const ST_SYN  = 4

const VERSION = 1

const INITIAL_PACKET_SIZE = 1500
const CCONTROL_TARGET = 300000
const MAX_CWND_INCREASE_PACKETS_PER_RTT =  INITIAL_PACKET_SIZE
const DEFAULT_INITIAL_WINDOW_SIZE = 1500 * 2
const DEFAULT_RECV_WINDOW_SIZE = 4 * 1500
const KEEP_ALIVE_INTERVAL = 120000 //millis
const MIN_DEFAULT_TIMEOUT = 500000 //micros

function createServer() {
	logger.add(winston.transports.File, { filename: './server.log' });
	return new Server()
}

function Server() {
	EventEmitter.call(this)
	this.udpSock;
	this.conSockets = {};
	this.cheat;
}

util.inherits(Server, EventEmitter)

Server.prototype.listen = function(port, connectListener) { 
	
	this.udpSock = dgram.createSocket('udp4');
	this.udpSock.bind(port);
	
	this.udpSock.on('message', (msg, rinfo) => {
		var header = getHeaderBuf(msg)
		var id = rinfo.address + ":" + rinfo.port + "#" + ((header.type != ST_SYN) ? header.connection_id : (header.connection_id + 1));
		if(this.conSockets[id]) 
			return this.conSockets[id]._recv(msg);
		
		if(header.type != ST_SYN) 
			return

		this.conSockets[id] = new Socket(this.udpSock, rinfo.port, rinfo.address)
		this.cheat = this.conSockets[id]
		this.conSockets[id].on('closed', ()=> delete this.conSockets[id])	
		console.log("New connection | id:", id)
		this.conSockets[id].on('data', (data) => {
			this.conSockets[id].total += data.length; 
			process.stdout.clearLine() 
			process.stdout.cursorTo(0)

			process.stdout.write("Total: " + (this.conSockets[id].total / 1000) + " KB | Download rate: " + (speed(data.length)*8 / 1000) + " Kbps | Base delay: " + this.conSockets[id].base_delay );
		})
		this.emit('connection',this.conSockets[id])
		this.conSockets[id]._recv(msg)	
	})
}

Server.prototype.close = function() {
	
}

function createSocket() {
	logger.add(winston.transports.File, { filename: './socket.log' });
	return new Socket(dgram.createSocket('udp4'))
}

function Socket(udpSock, port, host) {
	Duplex.call(this)	
	this.port = port;
	this.host = host;
	this.base_delay = 300
	this.total = 0

	this.dataBuffer = Buffer.alloc(0)
	this.sendBuffer;
	this.recvWindow;

	this.keepAlive;
	this.synTimer;
	
	this.udpSock = udpSock;

	this.connected = false;
	this.connecting = false;
	this.disconnecting = false;
	this.finished = false
	
	this.delayedAcks = []

	this.dupAck = 0;
	this.packet_size = INITIAL_PACKET_SIZE
	this.windowSizes = []

	this.eof_pkt = null;
	
	this.reply_micro = 250*1e3
	this.default_timeout = MIN_DEFAULT_TIMEOUT
	this.rtt = 500000;
	this.rtt_var = 100000;
	
	this.sendConnectID; 
	this.recvConnectID; 
	
	this.timeStamp = function () { return (Date.now() * 1e3 )  % Math.pow(2,32) }

	this.win_reply_micro = new TQueue()
	this.timestamp_difference_microseconds = 250*1e3

	this.on('finish', ()=>{this.finished = true})
}

util.inherits(Socket, Duplex)

Socket.prototype.remoteAddress = function () { return {'port' : this.port, 'host' : this.host} }

Socket.prototype.connect = function (port, host) {
	this.port = port;
	this.host = host;	
	/*
	if()
	this.keepAlive = setInterval(()=> {
		console.log('keep alive')
		this._sendState(this.sendBuffer.seqNum(), this.recvWindow.ackNum())
	}, KEEP_ALIVE_INTERVAL);
	*/
	this.udpSock.on('message', (msg, rinfo) => {
		if(getHeaderBuf(msg).connection_id == this.recvConnectID) 
			this._recv(msg);
	})	

	var scaledGain = function(minTime, timestampDiff, curWindow, maxWindow, packet_size) {
		let base_delay = Math.abs(minTime - timestampDiff)
		let delay_factor = (CCONTROL_TARGET - base_delay) / CCONTROL_TARGET;
		maxWindow +=  MAX_CWND_INCREASE_PACKETS_PER_RTT * delay_factor * (curWindow / maxWindow)	
		return (maxWindow < packet_size)? packet_size : maxWindow
	}
	
	let self = this
	setTimeout(function() {
		self.sendBuffer.maxWindowBytes = scaledGain(self.timestamp_difference_microseconds, self.win_reply_micro.peekMinTime(), self.sendBuffer.curWindow(), self.sendBuffer.maxWindowBytes, self.packet_size)
	}, self.rtt)

	this.connecting = true;
	this._sendSyn()
}

Socket.prototype._sendSyn = function() { //called by connect
	let seq_nr = crypto.randomBytes(2).readUInt16BE();
	this.recvConnectID = crypto.randomBytes(2).readUInt16BE();
	this.sendConnectID = this.recvConnectID + 1;
	/* function syn(i) {
		this._send(header)
		if(i > 0) this.synTimer = setTimeout(syn, this.default_timeout)
	} */
	this.sendBuffer = new WindowBuffer(seq_nr, DEFAULT_INITIAL_WINDOW_SIZE, -1, this.packet_size)
	let header = this.makeHeader(ST_SYN, seq_nr, null)
	//syn(3)
	this._send(header);
} 

Socket.prototype._recvSyn = function(header) {
	this.sendConnectID = header.connection_id;
	this.recvConnectID = header.connection_id + 1;
	this.recvWindow = new WindowBuffer(header.seq_nr, -1, DEFAULT_RECV_WINDOW_SIZE, this.packet_size)
	let seq_nr = crypto.randomBytes(2).readUInt16BE()
	this.wnd_size = header.wnd_size;
	this.connecting = true;
	this.sendBuffer = new WindowBuffer(seq_nr, DEFAULT_INITIAL_WINDOW_SIZE, header.wnd_size, this.packet_size)
	this._sendState(seq_nr, this.recvWindow.ackNum()) //synack
}

Socket.prototype._sendFin = function() {
	this.disconnecting = true
	this._send(this.makeHeader(ST_FIN))
}

Socket.prototype._sendData = function() {

	while((!this.sendBuffer.isBufferFull() && (this.dataBuffer.length > this.packet_size || (!this.finished && this.dataBuffer.length)))
		|| (this.sendBuffer.hasNext() && !this.sendBuffer.isWindowFull())) {

		if(!this.sendBuffer.isBufferFull() && (this.dataBuffer.length > this.packet_size || (!this.finished && this.dataBuffer.length))) {	
			let nextData = this.dataBuffer.slice(0,this.packet_size)
			this.dataBuffer = this.dataBuffer.slice(this.packet_size)
			this.sendBuffer.insert(null, nextData)	
		}

		if(this.sendBuffer.hasNext() && !this.sendBuffer.isWindowFull())  {
			let next = this.sendBuffer.getNext()
			let time = this.timeStamp()
			next.timeStamp = time
			next.timer = setTimeout((function() {
				console.log("current seq num", this.sendBuffer.ackNum())
				this.sendBuffer.changeWindowSize(this.packet_size); console.log("Timeout:", next.seq, "| Time:", time/1e3, "| default_timeout:",this.default_timeout)
				this._sendData()
			}).bind(this) , this.default_timeout  / 1000)

			let header = this.makeHeader(ST_DATA, next.seq % Math.pow(2,16), this.recvWindow.ackNum())
			this._send(header, next.elem)
		}
	}

	if(this.dataBuffer.length < this.packet_size ) this.emit('databuffer:length<packet_size')
}

Socket.prototype._sendState = function(seq_nr, ack_nr) { 
	this._send(this.makeHeader(ST_STATE, seq_nr, ack_nr ))
}

Socket.prototype._send = function(header, data) {
	let bufHeader = getBufHeader(header)
	let packet = data != undefined ? Buffer.concat([bufHeader, data]) : bufHeader
	this.udpSock.send(packet, this.port, this.host)
} 

Socket.prototype._handleDupAck = function (ackNum) {
	if(this.sendBuffer.isEmpty()) return
	let lastAck = this.sendBuffer.ackNum()
	if(ackNum != lastAck)
		this.dupAck = 0
	else 
		this.dupAck++;

	if(this.dupAck == 3) {
		console.log("Dup Ack: Expected", (this.sendBuffer.ackNum() + 1), "got", ackNum)
		this.dupAck = 0;
		let size = this.sendBuffer.maxWindowBytes / 2
		if(size < this.packet_size) size = this.packet_size
		let i = this.sendBuffer.changeWindowSize(size)
		this.windowSizes.push(this.sendBuffer.maxWindowBytes)
		let seq = lastAck + 1
		this._send(this.makeHeader(ST_DATA, seq, this.recvWindow.ackNum()), this.sendBuffer.get(seq))
	}
}

Socket.prototype._calcNewTimeout = function(timeStamps) {
	if(this.dupAck != 0) return 
	let time = this.timeStamp()
	timeStamps.map((x)=>{ return time - x}).forEach((function(packet_rtt) {
		let delta = this.rtt - packet_rtt
		this.rtt_var += (Math.abs(delta) - this.rtt_var)/4
		this.rtt += (packet_rtt - this.rtt) / 8
		this.default_timeout = Math.max(this.rtt + this.rtt_var * 4, MIN_DEFAULT_TIMEOUT)
	}).bind(this))
}

Socket.prototype._updateWinReplyMicro = function(header) {
	this.sendBuffer.maxRecvWindowBytes = header.wnd_size

	let time = this.timeStamp()
	this.win_reply_micro.insert(Math.abs(this.reply_micro),time/1e3)
	this.win_reply_micro.removeByElem(time/1e3 - 20*1e3)
	//if(this.win_reply_micro.isEmpty())return
	
}

Socket.prototype._recv = function(msg) { 
	header = getHeaderBuf(msg)
	this.timestamp_difference_microseconds = header.timestamp_difference_microseconds
	this.timeOutMult = 1;
	this.reply_micro = Math.abs(Math.abs(this.timeStamp()) - Math.abs(header.timestamp_microseconds) % Math.pow(2,32))
	
	if(header.type == ST_SYN) { //handle spurious syn and first syn
		if(!this.connected)
			this._recvSyn(header)
		return; 
	} else if (this.connecting & !this.connected) {
		this.connecting = false;
		this.connected = true;
		console.log('Connection established')
		if(header.type == ST_STATE) { //sender of syn only			
			this.sendBuffer.maxRecvWindowBytes = header.wnd_size
			this.recvWindow = new WindowBuffer(header.seq_nr, -1, DEFAULT_RECV_WINDOW_SIZE, this.packet_size)	
			this.emit('connected')
		}
	} else if (header.type == ST_FIN) {
		this.disconnecting = true
		this.eof_pkt = header.seq_nr;
	} else if (header.type == ST_RESET) {
		this._close()
		return;
	}

	this._handleDupAck(header.ack_nr)
	let timeStamps = this.sendBuffer.removeUpto(header.ack_nr)
	this._calcNewTimeout(timeStamps)
	this._updateWinReplyMicro(header)

	if(!this.eof_pkt) 
		this._sendData()
	
	if(header.type == ST_STATE) return; //nothing more to do	
	if(header.type == ST_DATA)
		this._recvData(header, msg.slice(20))
}
 
 Socket.prototype._recvData = function(header, data) {
	logger.info(header.timestamp_microseconds, header.seq_nr)

	//wrap around seq num rejected
	//assume send window is never larger then 100 packets. also since acknum > beginning of send window, worst case no ack has reached sender and send window
	//is max send window behind recieve window. Special case if ackNum is within max send window of 0. Then nums close to 2^16 should also be rejected
	//smallest packet size 150 bytes, max send/recv buffers around 200 kB ~ 1000 packets - rare condition
	let pktzn = 1000
	if (header.seq_nr <= this.recvWindow.ackNum() && header.seq_nr > this.recvWindow.ackNum() - pktzn && this.recvWindow.ackNum() > pktzn 
	|| this.recvWindow.ackNum() < pktzn && header.seq_nr > Math.pow(2,16) - pktzn) return
	//if(header.seq_nr <= this.recvWindow.ackNum() && !((this.recvWindow.ackNum() > 100) && header.seq_nr < this.recvWindow.ackNum() - 100)) return 
	
	this.recvWindow.insert(header.seq_nr, data) //assumes seqnum > acknum
	let packs = this.recvWindow.removeSequential()	
	while(packs.length > 0)
		this.push(packs.shift())
	
	if(this.disconnecting && this.eof_pkt & (this.ack_nr == this.eof_pkt)) {
		if(this.connected) {
			this._sendFin()
			this.connected = false;
		}
		this._close() //final shutdown
		return
	}

	this._sendState(this.sendBuffer.seqNum() - 1, this.recvWindow.ackNum());
 }
 
Socket.prototype._close = function() { //fin exchanged
	//this._sendFin()
}
 
Socket.prototype.close = function() { //send fin, wait for fin reply
	this._sendFin()
}

Socket.prototype._read = function() {}

Socket.prototype._writeable = function() {
	return this.connected & !this.eof_pkt
} 

Socket.prototype._write = function(data, encoding, callback) { //node does buffering
	if(!this.connected)
		this.once('connected', ()=>{this._write(data,encoding, callback)})

	this.dataBuffer = Buffer.concat([this.dataBuffer, data])
	this.once('databuffer:length<packet_size', callback)
	this._sendData()	
}

function getHeaderBuf(buf) {
	return {
		'type' : buf.readUInt8(0) >> 4,
		'ver' : buf.readUInt8(0) & 0x0f,
		'extension' : buf.readUInt8(1),
		'connection_id' : buf.readUInt16BE(2),
		'timestamp_microseconds' : buf.readUInt32BE(4),
		'timestamp_difference_microseconds' : buf.readUInt32BE(8),
		'wnd_size' : buf.readUInt32BE(12),
		'seq_nr' : buf.readUInt16BE(16),
		'ack_nr' : buf.readUInt16BE(18)
	}
}

function getBufHeader(header) {
	let buf = Buffer.alloc(20)
	buf.writeUInt8(header.type << 4 | header.ver, 0)
	buf.writeUInt8(header.extension, 1)
	buf.writeUInt16BE(header.connection_id, 2)
	buf.writeUInt32BE(header.timestamp_microseconds, 4)
	buf.writeUInt32BE(header.timestamp_difference_microseconds, 8)
	buf.writeUInt32BE(header.wnd_size, 12)
	buf.writeUInt16BE(header.seq_nr, 16)
	buf.writeUInt16BE(header.ack_nr, 18)
	return buf
}

Socket.prototype.makeHeader = function(type, seq_nr, ack_nr) { //no side effects
	return {
		'type' : type,
		'ver' : VERSION,
		'connection_id' : type == ST_SYN ? this.recvConnectID : this.sendConnectID,
		'timestamp_microseconds' : this.timeStamp(),  
		'timestamp_difference_microseconds' : Math.abs(this.reply_micro % Math.pow(2,32)),
		'wnd_size' : DEFAULT_RECV_WINDOW_SIZE,
		'seq_nr' : seq_nr ? seq_nr : this.seq_nr,
		'ack_nr' : ack_nr ? ack_nr : this.ack_nr,
	}
}

uTP = {
	'Server' : Server,
	'Socket' : Socket,
	'createServer' : createServer,
	'createSocket' : createSocket
}

module.exports = uTP
