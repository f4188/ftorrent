
Duplex = require('stream').Duplex

const HANDSHAKE_LENGTH

const CHOKE_MSG_TYPE = 0;
const UNCHOKE_MSG_TYPE = 1;
const INTERESTED_MSG_TYPE = 2
const UNINTERESTED_MSG_TYPE = 3
const HAVE_MSG_TYPE = 4
const BITFIELD_MSG_TYPE = 5
const REQUEST_MSG_TYPE = 6
const PIECE_MSG_TYPE = 7
const CANCEL_MSG_TYPE = 8
const DHT_PORT_MSG_TYPE = 9
const EXTENDED_MSG_TYPE = 20

//emit amchoked, amunchoked, aminterested, amuninterest
//handshake and piece

function Peer(sock, file, init) {
	Duplex.call(this)

	this.sock = sock

	this.msgBuffer = Buffer.alloc(0);
	this.nextMsgLength = HANDSHAKE_LENGTH;
	this.nextMsgParser = parseHandShake; //initially

	this.uninitialized = true
	this.connecting = false
	this.connected = false
	this.disconnected = false

	this.STATES = {'uninitialized':0, 'sent_hshake' : 1,'connected':2, 'idle':3, 'disconnected'}
	this.state = STATES.uninitialized

	//stuff about peers state
	//choke, interested state variables
	this.pChoke = true; //i'm choked
	this.choke = true //peer is choked
	this.pInterested = false;
	this.interested = false

	this.supportsExten = false //extended protocol
	this.supportsDHT = false //mainline dht
	this.pieces = new Set() //pHave and pBitfield
	this.peerID
	this.nodeID

	//requests from peer
	this.pRequests = [] //serialize requests here so can cancel latter
	this.pRequest = null //request being handled

	//my requests - remove on cancel or pPiece message - not really necessary
	this.requests = []

	//statistics 
	this.downloadRate = 0
	this.uploadRate = 0
	this.timeConnected = 0
	this.disconnects = 0
	this.rtt
	this.rttVar

	//setup request handlers

	//from info dict of torrent file`
	this.file = file

	var getType = function(msg) {
		return msg[0]
	}
	
	var parseHandshake = function (msg) { //maybe garbled
		if(!this.pHandshake(msg)) 
			return // end connection emit('invalid')
		this.nextMsgParser = parseMsgLength;
		this.nextMsgLength = 4;
		//reset keepalive timer
	}

	var parseMsgLength = function (msg) { //always valid
		if(msg.readUInt32BE(0) > 0) { //handle keepalive
			this.nextMsgLength = msg.readUInt32BE(0);
			this.nextMsgParser = parseMsgPayLoad;
		}
		//reset keepalive timer		
	}
	
	var parseMsgPayLoad = function (msg) { //maybe garbled
		//msg length always nextMsgLength

		//peer already connected via tcp or utp
		//this.keepAliveTimer goes off if no message for _ min/sec
		//checks if nothing going in the other direction

		let msgLen = this.nextMsgLength //assert(this.nextMsgLength == msg.length)
		this.nextMsgParser = parseMsgLength;
		this.nextMsgLength = 4

		//reset keepalive timer
		switch (getType(msg)) {
			//empty messages
			case CHOKE_MSG_TYPE : 
				if(msgLen == 1) return pChoke() 
				break
			case UNCHOKE_MSG_TYPE : 
				if(msgLen == 1) return pUnchoke() 
				break
			case INTERESTED_MSG_TYPE : 
				if(msgLen == 1) return pInterested() 
				break
			case UNINTERESTED_MSG_TYPE : 
				if(msgLen == 1) return pUnInterested() 
				break
			//single int message
			case HAVE_MSG_TYPE : 
				let hMsg = parseHaveMsg(msg)
				if(hMsg) return pHave(hMsg) 
				break
			//multiple values or file piece
			case BITFIELD_MSG_TYPE : 
				let bMsg = parseBitFieldMsg(msg)
				if(bMsg) return pBitfield(bMsg) 
				break
			case REQUEST_MSG_TYPE : 
				let rMsg = parseRequestMsg(msg)
				if(rMsg) return pRequest(rMsg)
				break
			case PIECE_MSG_TYPE : 
				let pMsg = parsePieceMsg(msg)
				if(pMsg) return pPiece(pMsg) 
				break
			case CANCEL_MSG_TYPE : 
				let cMsg = parseCancelMsg(msg)
				if(cMsg) return pCancel(msg) 
				break
			case DHT_PORT_MSG_TYPE :
				if(msgLen == 3) return pPort(msg)
				break
			case EXTENDED_MSG_TYPE : return pExtended(msg) 
			default : 
				//ignore unrecognized messages
				return
		}
		//handle invalid message with recognized type
		//maybe ignore
	}	

	self = this
	sock.on('close', ()=> {
		self.state = this.STATES.disconnected
		//clearout request queues
	})
	//peer outlive sock
	//sock cannot end peer but peer can end sock 
	var opts = {'end' : false}
	sock.pipe(this, opts).pipe(sock)  
	sock.resume()
	if(init) {
		this.handshake()
		this.state = this.STATES.sent_hshake
	}

}

util.inherit(Duplex)

Peer.prototype.pHandshake = function (msg) {
	if(!msg.readUInt8(0) != 0x13) return false
	if(!msg.slice(1,20).toString() == 'BitTorrent protocol') return false
	if(msg.slice(28,48) != this.file.infoHash) return false
	
	//only check extension supported by this client
	this.supportsExten = msg.readUInt8(24) & 0x10
	this.supportsDHT = msg.readUInt8(27) & 0x01 //last bit

	this.peerID = msg.slice(48,68)

	if(this.state == this.STATES.unitialized || this.state == this.STATES.disconnected
		|| this.state == this.STATES.sent_shake) { //already sent handshake

		this.state = this.STATES.connected
		this.emit('connected')

		if(this.state == this.STATES.sent_shake) 
			this.handshake()

	} else {
		//connected
	}

	this.bitField()

	return true
}

Peer.prototype.pChoke = function () {
	this.pChoke = true //kill all requests??
	this.emit('peer_choked')
}

Peer.prototype.pUnchoke = function() {
	this.pChoke = false
	this.emit('peer_unchoked')
}

Peer.prototype.pInterested = function() {
	this.pInterested = true
	this.emit('peer_interested')
}

Peer.prototype.pUninterested = function() {
	this.pInterested = false
	this.emit('peer_uninterested')
}

Peer.prototype.pHave = function(pieceIndex) { //just a piece index
	this.pieces.add(pieceIndex)
}

Peer.prototype.pBitfield = function (pieceList) { //[1,4,6,...]
	pieceList.forEach((function(pieceIndex) {this.pHave(pieceIndex)}).bind(this))
}

Peer.prototype.pRequest = function(request) { //index, begin, length
	if(this.choked) return //error?
	this.pRequests.push(request)
	if(!this.pRequest) {
		this.pRequest = this.pRequests.pop()
		self = this
		this.emit('peer_request', self.request)
	}

}
//me
//request => pPiece
//peer
//pRequest => piece
Peer.prototype.pPiece = function (piece) {
	//check piece hash
	//remove request from queue
	if(this.pChoke) {
		//do something/
	}
	var i = 0
	for(; i < this.requests; i++) {
		let {rindex, rbegin, rlength} = this.requests[i]
		if(rindex == piece.index && rbegin == piece.begin && rlength == piece.piece.length)
			this.requests.splice(i, 1)
	}
	if(i != this.requests.length)
		this.emit('peer_piece', piece)
}

Peer.prototype.pCancel = function (index, begin, length) {
	//what if serving request now ?
	for(var i = 0; i < this.pRequests; i++) {
		let {rindex, rbegin, rlength} = this.pRequests[i]
		if(rindex == index && rbegin == begin && rlength == length)
			this.pRequests.splice(i, 1)
	}
	if( == this.pRequest) 
		this.pRequest.piece.unpipe(this.sock)
}

Peer.prototype.pExtended = function (msg) {
	if(msg[0] == 0x0) { //handshake
		//m dict, p tcp listen port, v client name & ver, yourip , ipv6, ipv4, reqq total req mes without dropping
		let {m, p, v, yourip, ipv6, ipv4, reqq, reqq} = bdecode(msg)
		this.m = m
		//ut_pex, ut_metadata	
	} else if(msg[0] == this.m['ut_pex']) {
		payload = bdecode(msg)
		let {added, added6, dropped, dropped6} = payload
		let addedf, added6f = payload['added.f'], payload['added6.f']
		parsePeerContactInfos()
	} else if(msg[0] == this.m['ut_metadata']) {
		
		
	}
}

Peer.prototype.pPort = function (msg) {
	this.nodeID = msg.readUInt16BE()
}


Peer.prototype.handshake = function() {
	let nineteen = new Buffer(1).writeUInt8
	let bitTorrent = new Buffer()
	let buf = Buffer.concat([nineteen, bitTorrent, Buffer.alloc(8), this.file.infoHash, this.peerId])

	//only check extension supported by this client
	buf.writeUInt8(buf.readUInt8(24) | 0x10) 
	buf.writeUInt8(buf.readUInt8(27) | 0x01)
	this.connecting = true
	this.push(buf)
}

Peer.prototype.choke = function() {
	this.choke = true
	let buf = Buffer.alloc(5)
	buf.writeUInt32BE(1, 0)
	buf.writeUInt8(CHOKE_MSG_TYPE, 5)
	this.push(buf)
}

Peer.prototype.unchoke = function() {
	this.choke = false
	let buf = Buffer.alloc(5)
	buf.writeUInt32BE(1, 0)
	buf.writeUInt8(UNCHOKE_MSG_TYPE, 5)
	this.push(buf)
}

Peer.prototype.interested = function() {
	this.interested = true
	let buf = Buffer.alloc(5)
	buf.writeUInt32BE(1, 0)
	buf.writeUInt8(INTERESTED_MSG_TYPE, 5)
	this.push(buf)
}

Peer.prototype.unInterested = function() {
	this.interested = false
	let buf = Buffer.alloc(5)
	buf.writeUInt32BE(1, 0)
	buf.writeUInt8(UNINTERESTED_MSG_TYPE, 5)
	this.push(buf)
}

Peer.prototype.have = function(pieceIndex) {
	this.push(makeHaveMsg(pieceIndex))
}

Peer.prototype.bitfield = function () {
	let pieceIndexList = this.pieceIndexList
	this.push(makeBitFieldMsg(pieceIndexList))
}

Peer.prototype.request = function(index, begin, length) {
	//send request 
	this.requests.push({'index':index, 'begin':begin, 'length':length})
	this.push(makeRequestMsg(index, begin, length))
}

//called by peer_request listener
Peer.prototype.piece = function (index, begin, length, piece) {
	this.push(makePieceMsg(index, begin, length))
	this.pause()
	self = this
	var finishRequest = function() {
		self.unpause(); 
		self.request = null; 
		if(self.pRequests.length != 0) {
			self.pRequest = self.pRequests.pop()
			self.emit('peer_request', self.request)
		}
	}

	piece.on('end', finishRequest)
	piece.on('unpipe', finishRequest)
	this.pRequest.piece = piece
	piece.pipe(this.sock, {'end': false}) //piece -> peer - pause everything until done

}

Peer.prototype.cancel = function (index, begin, length) {
	var i = 0
	for(; i < this.requests; i++) {
		let {rindex, rbegin, rlength} = this.requests[i]
		if(rindex == index && rbegin == begin && rlength == length)
			this.requests.splice(i, 1)
	}
	if(i != this.requests.length)
		this.push(makeCancelMsg(index, begin, length))
}

Peer.prototype. __ = function () {

}



Peer.prototype.parseHaveMsg = function(msg) {
	return msg.readUInt32BE() //just return int
}

Peer.prototype.makeHaveMsg = function(pieceIndex) {
	return Buffer.alloc(4).writeUInt32BE(pieceIndex)
}

Peer.prototype.parseBitFieldMsg = function(msg) {
	//check bitfield length
	bitField = []
	bitFieldLength = this.file.pieces % 8 == 0 ? this.file.pieces / 8 : (this.file.pieces / 8 + 1)
	if(msg.length != bitFieldLength && (msg.slice(-1) & // ) ) return ret

	msg.forEach(function(byte, i, v) {
		while(byte >>= 1) 
			bitField.push(i++)
	})
	return bitField
}

Peer.prototype.makeBitFieldMsg = function(pieceIndexList) {
	let buf = this.pieces % 8 == 0 ? this.pieces / 8 : ((this.pieces / 8) + 1)
	
	bitField = Buffer.alloc(bitFieldLength)
	pieceIndexList.forEach(function(pieceIndex) {
		var byte = bitField.readUInt32BE(pieceIndex / 8)
		byte &= pieceIndex % 8
		bitField.writeUInt32BE(byte)
	}) 

	return buf
}

Peer.prototype.parseRequestMsg = function(msg) {
	//index, begin, length
	request = {}
	if(msg.length == 12) {
		let index = msg.readUInt32BE(0)
		if(index > this.file.length) 
			request.index = index
		let begin = msg.readUInt32BE(4)
		if(begin >= 0 && begin < this.file.piece_length)
			request.begin = begin
		let length = msg.readUInt32BE(8)
		if(length > 0 && length < this.file.piece_length)
			request.length = length
	}
	return request
}

Peer.prototype.makeRequestMsg = function(index, begin, length) {
	let msgLen = 4 + 1 + 12
	let buf = Buffer.alloc(msgLen)
	buf.writeUInt32BE(msgLen, 0)
	buf.writeUInt8(REQUEST_MSG_TYPE, 4)
	buf.writeUInt32BE(index, 5)
	buf.writeUInt32BE(begin, 9)
	buf.writeUInt32BE(length, 13)
	return buf
}

Peer.prototype.parseCancelMsg = function(index, begin, length) {
	cancel = {}
	if(msg.length == 12) {
		let index = msg.readUInt32BE(0)
		if(index > this.file.length) 
			cancel.index = index
		let begin = msg.readUInt32BE(4)
		if(begin > 0 && begin < this.file.piece_length)
			cancel.begin = begin
		let length = msg.readUInt32BE(8)
		if(length > )
			cancel.length = length
	}
	return cancel
}

Peer.prototype.makeCancelMsg = function(index, begin, length) {
	let msgLen = 4 + 1 + 12
	let buf = Buffer.alloc(msgLen)
	buf.writeUInt32BE(msgLen, 0)
	buf.writeUInt8(CANCEL_MSG_TYPE, 4)
	buf.writeUInt32BE(index, 5)
	buf.writeUInt32BE(begin, 9)
	buf.writeUInt32BE(length, 13)
	return buf
}

Peer.prototype.parsePieceMsg = function(msg) {
	piece = {}
	//if(msg.length == 12) {
	let index = msg.readUInt32BE(0)
	if(index > this.file.length) 
		piece.index = index
	let begin = msg.readUInt32BE(4)
	if(begin > 0 && begin < this.file.piece_length)
		piece.begin = begin
	piece.piece = msg.slice(8)
	//}
	return piece
}

Peer.prototype.makePieceMsgHeader = function(index, begin, length) { //piece is already buffer
	let buf = Buffer.alloc(4 + 1 + 4 + 4)
	buf.writeUInt32BE(13 + length, 0)
	buf.writeUInt8(PIECE_MSG_TYPE, 4)
	buf.writeUInt32BE(index, 5)
	buf.writeUInt32BE(begin, 9)
	return buf//Buffer.concat([buf, piece])
}

Peer.prototype._final() {
	//socket writes end when dead
	//_final called before end completes

}

Peer.prototype._read() {}

//if next message is large i.e. a piece message then this function called repeatedly until entire message concatenated to this.msgBuffer
Peer.prototype._write(chunk, encoding, callback) {
	
	this.msgBuffer = Buffer.concat(this.msgBuffer, chunk);
	var nextMsg;
	while(this.msgBuffer.length > this.nextMsgLength) {
		//have whole message
		nextMsg = msgBuffer.slice(0,this.nextMsgLength)
		this.msgBuffer = msgBuffer.slice(this.nextMsgLength)
		this.nextMsgParser(nextMsg); 
		//nextMsgLength changed, nextMsg sliced

		//maybe reset keepalive here
 	}
	callback()
}


function parsePeerContactInfos(compactInfos) {
	return compactInfos.map(info => new Peer(info.slice(0,2), info.slice(2,6))
}