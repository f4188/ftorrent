
dgram = require('dgram')
Duplex = require('stream').Duplex
crypto = require('crypto')
util = require('util')
EventEmitter = require('events').EventEmitter
TQueue = require('./lib/tqueue.js')
speedometer = require('speedometer')
PacketBuffer = require('./lib/PacketBuffer.js')
WindowBuffer = require('./lib/sendBuffer.js')
speed = speedometer(1)
Q = require('q')

const ST_DATA = 0  //Data
const ST_FIN = 1
const ST_STATE = 2 //Ack
const ST_RESET = 3  
const ST_SYN  = 4

const VERSION = 1

const INITIAL_TIMEOUT = 5000
const PACKET_SIZE = 1500
const CCONTROL_TARGET = 100000
const MAX_CWND_INCREASE_PACKETS_PER_RTT = PACKET_SIZE
const DEFAULT_WINDOW_SIZE = 1500
const DEFAULT_RECV_WINDOW_SIZE = 100 * 1500
const KEEP_ALIVE_INTERVAL = 60000

function createServer() {
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
		//console.log('Server: packet from', id)
		//console.log('Header')
		//console.log(header)
		if(this.conSockets[id]) {
			this.conSockets[id]._recv(msg);
			return
		} 
		
		if(header.type != ST_SYN) return
		//console.log("New connection")
		//c_id = (header.connection_id + 1)
		//id = rinfo.address + ":" + rinfo.port + "#" + c_id;
		this.conSockets[id] = new Socket(this.udpSock, rinfo.port, rinfo.address)
		this.cheat = this.conSockets[id]
		this.conSockets[id].on('closed', ()=> delete this.conSockets[id])	
		process.stdout.write("Downloading")
		this.conSockets[id].on('data', (data) => {
			this.conSockets[id].total += data.length;  
			console.log("Total:", this.conSockets[id].total, "bytes |" ,"Speed:", speed(data.length)*8 , "bps" );
		})
		this.emit('connection',this.conSockets[id])
		this.conSockets[id]._recv(msg)	
	})
}

Server.prototype.close = function() {
	
}

function createSocket() {
	return new Socket(dgram.createSocket('udp4'))
}

function Socket(udpSock, port, host) {
	Duplex.call(this)	
	this.port = port;
	this.host = host;
	
	this.total = 0

	this.dataBuffer = Buffer.alloc(0)
	this.sendBuffer;
	this.recvWindow;

	this.finished = false
	this.timer;
	
	this.udpSock = udpSock;

	this.connected = false;
	this.connecting = false;
	this.disconnecting = true;
	
	this.dupAck = 0;
	this.packet_size = PACKET_SIZE
	this.windowSizes = []

	this.eof_pkt = null;
	
	this.reply_micro = 250*1000;
	this.default_timeout =  INITIAL_TIMEOUT
	this.timeOutMult = 1
	this.rtt = 500000;
	this.rtt_var = 100000;
	
	this.sendConnectID; 
	this.recvConnectID; 
	
	this.timeOutQueue = new TQueue() 
	this.timeStamp = timeStampF
	this.win_reply_micro = new TQueue()

	this.seqs = []
	this.acks = []
	this.recvSeqs = []

	this.on('finish', ()=>{this.finished = true})
}

util.inherits(Socket, Duplex)

Socket.prototype.remoteAddress = function () { return {'port' : this.port, 'host' : this.host} }

Socket.prototype.connect = function (port, host) {
	this.port = port;
	this.host = host;	
	/*
	this.keepAlive = setInterval(()=> {
		console.log('keep alive')
		this._sendState()
	}, KEEP_ALIVE_INTERVAL);
	*/
	this.udpSock.on('message', (msg, rinfo) => {
		//console.log("Socket: recieved packet")
		//console.log("Header")
		//console.log(getHeaderBuf(msg))
		if(getHeaderBuf(msg).connection_id == this.recvConnectID) 
			this._recv(msg);
	})	
	this.connecting = true;
	this._sendSyn()
}

Socket.prototype._sendSyn = function() { //called by connect
	let seq_nr = crypto.randomBytes(2).readUInt16BE();
	this.recvConnectID = crypto.randomBytes(2).readUInt16BE();
	this.sendConnectID = this.recvConnectID + 1;
	/*
	this.timer = setTimeout(()=> {
		this.timeOutMult *= 2;
		this._send(header)
	}, this.timeOutMult * this.default_timeout) //resend syn
	*/
	this.sendBuffer = new WindowBuffer(seq_nr, DEFAULT_WINDOW_SIZE, -1, this.packet_size)
	let header = this.makeHeader(ST_SYN, seq_nr, null)
	this.timeOutQueue.insert(header.timestamp_microseconds / 1e3, seq_nr)
	this._send(header);
} 

Socket.prototype._recvSyn = function(header) {
	this.sendConnectID = header.connection_id;
	this.recvConnectID = header.connection_id + 1;
	this.recvWindow = new WindowBuffer(header.seq_nr, -1, DEFAULT_RECV_WINDOW_SIZE, this.packet_size)
	let seq_nr = crypto.randomBytes(2).readUInt16BE()
	this.wnd_size = header.wnd_size;
	this.connecting = true;
	this.sendBuffer = new WindowBuffer(seq_nr, DEFAULT_WINDOW_SIZE, header.wnd_size, this.packet_size)
	this._sendState(seq_nr, this.recvWindow.ackNum()) //synack
}

Socket.prototype._sendFin = function() {
	this.disconnecting = true;
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
			let header = this.makeHeader(ST_DATA, next.seq % Math.pow(2,16), this.recvWindow.ackNum())
			this.timeOutQueue.insert(header.timestamp_microseconds / 1e3, next.seq)
			this._send(header, next.elem)
		}
		if(this.seqs.length > 1000) break
	
	}

	if(this.dataBuffer.length < this.packet_size ) this.emit('databuffer:length<packet_size')
}

Socket.prototype._sendState = function(seq_nr, ack_nr) { 
	this._send(this.makeHeader(ST_STATE, seq_nr, ack_nr ))
}

Socket.prototype._send = function(header, data) {
	if(header.type == ST_DATA) this.seqs.push(header.seq_nr) 
	let bufHeader = getBufHeader(header)
	let packet = data != undefined ? Buffer.concat([bufHeader, data]): bufHeader
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
		//console.log("DUPACK")
		console.log("Dup Ack: Expected", (this.sendBuffer.ackNum() + 1), "got", ackNum)
		this.dupAck = 0;
		let size = this.sendBuffer.maxWindowBytes / 2
		if(size < PACKET_SIZE) size = PACKET_SIZE
		let i = this.sendBuffer.changeWindowSize(size)
		this.windowSizes.push(this.sendBuffer.maxWindowBytes)
		this.timeOutQueue.removeAfterElem(i)
		let seq = lastAck + 1
		this._send(this.makeHeader(ST_DATA, seq, this.recvWindow.ackNum()), this.sendBuffer.get(seq))
	}
}

Socket.prototype._calcNewTimeout = function(header) {
	if(this.dupAck != 0) return 
	let packet_rtt = Math.abs(this.timeStamp()) - Math.abs(header.timestamp_microseconds);
	let delta = this.rtt - packet_rtt
	this.rtt_var += (Math.abs(delta) - this.rtt_var)/4
	this.rtt += (packet_rtt - this.rtt) / 8
	this.default_timeout = Math.max(Math.abs(this.rtt + this.rtt_var * 4), 500000)
}

Socket.prototype._changeWindowSizes = function(header) {
	this.sendBuffer.maxRecvWindowBytes = header.wnd_size

	let time = this.timeStamp()
	this.win_reply_micro.insert(Math.abs(this.reply_micro),time/1e3)
	this.win_reply_micro.removeByElem(time/1e3 - 2*60*1e3)
	if(this.win_reply_micro.isEmpty())return
	
	let base_delay = Math.abs(this.win_reply_micro.peekMinTime().time - header.timestamp_difference_microseconds)
	let CCONTROL_TARGET = 300000
	let off_target =  CCONTROL_TARGET - (base_delay/2) ;
	let delay_factor = off_target / CCONTROL_TARGET;
	let window_factor = this.sendBuffer.curWindow() / this.sendBuffer.maxWindowBytes;
	let scaled_gain = MAX_CWND_INCREASE_PACKETS_PER_RTT * delay_factor * window_factor;
	this.sendBuffer.maxWindowBytes += scaled_gain

	if(this.sendBuffer.maxWindowBytes < this.packet_size) this.sendBuffer.maxWindowBytes = this.packet_size
	this.windowSizes.push(this.sendBuffer.maxWindowBytes)
}

Socket.prototype._recv = function(msg) { //called by listener, handle ack in all cases
	header = getHeaderBuf(msg)
	if(header.type == ST_STATE) this.acks.push(header.ack_nr)
	clearTimeout(this.timer)
	this.timeOutMult = 1;
	this.reply_micro = Math.abs(this.timeStamp()) - Math.abs(header.timestamp_microseconds) % Math.pow(2,32)
	
	if(header.type == ST_SYN) { //handle spurious syn and first syn
		if(!this.connected)
			this._recvSyn(header)
		return; 
	} else if (this.connecting & !this.connected) {
		this.connecting = false;
		this.connected = true;
		if(header.type == ST_STATE) { //sender of syn only
			console.log('Finish connection est')
			this.timeOutQueue.removeByElem(this.seq_nr)
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
	this.sendBuffer.removeUpto(header.ack_nr)
	this.timeOutQueue.removeUptoElem(header.ack_nr)

	this._calcNewTimeout(header)
	this._changeWindowSizes(header)

	if(!this.eof_pkt) 
		this._sendData()

	
	if(!this.sendBuffer.isEmpty()) {
		let elap = (this.timeStamp()/1e3 - this.timeOutQueue.peekMinTime().time)
		let elem = this.timeOutQueue.peekMinTime.elem
		this.timer = setTimeout(()=> {
			console.log("TIMEOUT")		
			this.timeOutQueue.empty()
			//this.packet_size = 150
			//this.sendBuffer.packetSize = this.packet_size
			//this.max_window = this.packet_size
			this.sendBuffer.changeWindowSize(PACKET_SIZE)
			this.timeOutMult = 2;
			this._sendData()
		}, this.timeOutMult * (this.default_timeout - elap)) //
	}
	
	if(header.type == ST_STATE) return; //nothing more to do	
	if(header.type == ST_DATA)
		this._recvData(header, msg.slice(20))
}
 
 Socket.prototype._recvData = function(header, data) {
	this.recvSeqs.push(header)
	if(header.seq_nr <= this.recvWindow.ackNum()) return
	
	this.recvWindow.insert(header.seq_nr, data)
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
	//this.emit('closed')
	this.udpSock.close()
}
 
Socket.prototype.close = function() { //send fin, wait for fin reply
	this._sendFin()
	//this.emit('dump', 'fin')
}
/*
Socket.prototype._final = function() {
	this.emit('dump')
	console.log("final")
	
}*/

Socket.prototype._read = function() {}

Socket.prototype._writeable = function() {
	return this.connected & !this.eof_pkt;
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
	//console.log(header)
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

var timeStampF = function () { //microsecond timestamp
	return (Date.now() * 1e3 )  % Math.pow(2,32) 
}

uTP = {
	'Server' : Server,
	'Socket' : Socket,
	'createServer' : createServer,
	'createSocket' : createSocket
}

module.exports = uTP
