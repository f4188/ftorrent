
Duplex = require('stream').Duplex
Transform = require('stream').Transform
benDecode = require('bencode').decode 
benEncode = require('bencode').encode
PassThrough = require('stream').PassThrough

const HANDSHAKE_LENGTH = 1 + 19 + 8 + 20 + 20 

const KEEPALIVE_MSG_TYPE = null
const CHOKE_MSG_TYPE = 0
const UNCHOKE_MSG_TYPE = 1
const INTERESTED_MSG_TYPE = 2
const UNINTERESTED_MSG_TYPE = 3
const HAVE_MSG_TYPE = 4
const BITFIELD_MSG_TYPE = 5
const REQUEST_MSG_TYPE = 6
const PIECE_MSG_TYPE = 7
const CANCEL_MSG_TYPE = 8
const DHT_PORT_MSG_TYPE = 9
const EXTENDED_MSG_TYPE = 20 

const EXTENDED_HANDSHAKE_MSG_TYPE = 0

function Peer(fileMetaData, download, sock, checkID) {

	//opts = { 'readableObjectMode' : true, 'objectMode' : true } //allowHalfOpen ??
	Duplex.call(this, { 'readableObjectMode' : true, 'objectMode' : true })

	this.checkID = checkID

	this.fileMetaData = fileMetaData
	this.download = download

	this.STATES = { uninitialized : 0, sent_hshake : 1, connected : 2, disconnected : 3 }
	this.state = this.STATES.uninitialized

	this.pChoked = true; //i'm choked
	this.choked = true //peer is choked
	this.optUnchoked = false //separate boolean
	this.pInterested = false;
	this.interested = false

	this.supportsExten = false //extended protocol
	this.supportsDHT = false //mainline dht
	this.supportedExtensions = {}
	this.recvExtensions = {}
	
	this.pieces = new NSet() //_pHave and _pBitfield
	
	this.peerID = null// = fileMetaData.peerID
	this.myPeerID = null
	
	this.sock = sock

	let self = this

	this.keepA = null
	this.on('connected', () => { self.keepA = setInterval( (self.keepAlive).bind(self) , 60 * 1e3) })

	var _handleDisconnect = () => {

		if(self.state == self.STATES.connected) {
			//self.emit('peer_choked', self)
			self.emit('disconnected', self)
		}
		self.state = self.STATES.disconnected

	}

	this.sock.on('close', _handleDisconnect)
	this.sock.on('error', _handleDisconnect)

	this.msgHandlers = { '_handshake': (this._pHandshake).bind(this), [KEEPALIVE_MSG_TYPE] : (this.pKeepAlive).bind(this), 
		[CHOKE_MSG_TYPE] : (this._pChoke).bind(this), [UNCHOKE_MSG_TYPE] : (this._pUnchoke).bind(this), 
		[INTERESTED_MSG_TYPE] : (this._pInterested).bind(this), [UNINTERESTED_MSG_TYPE] : (this._pUninterested).bind(this), 
		[HAVE_MSG_TYPE] : (this._pHave).bind(this), [BITFIELD_MSG_TYPE] : (this._pBitfield).bind(this), 
		[REQUEST_MSG_TYPE] : (this._pRequest).bind(this), [PIECE_MSG_TYPE] : (this._pPiece).bind(this), 
		[CANCEL_MSG_TYPE] : (this._pCancel).bind(this), [DHT_PORT_MSG_TYPE] : (this._pPort).bind(this), 
		[EXTENDED_MSG_TYPE] : { [EXTENDED_HANDSHAKE_MSG_TYPE] : (this._pExHandShake).bind(this) }
	}

	//this.requestList = []

	this.pRequestList = [] //serialize requests here so can cancel latter
	this.pRequest = null

	this.parser = new BitTorrentMsgParser(this.fileMetaData)

	var opts = {'end' : false}
	this.sock.pipe(this.parser, opts).pipe(this).pipe(this.sock)
	this.sock.resume()

}

util.inherits(Peer, Duplex)

Peer.prototype.piece = function(index, begin, piece) {

	this.pause()
	let p = new PassThrough() //set highwatermark
	this.pRequest.p = p
	p.pipe(this.sock, {'end' : false, 'highWaterMark' : 2 ** 15})

	let self = this

	p.on('end', () => { 

		self._finishRequest() 
		self.emit('piece_sent', self)

	})

	p.on('error', (this._finishRequest).bind(this) ) 
	p.on('unpipe', (this._finishRequest).bind(this) )
	
	p.end(this._makeMsg(PIECE_MSG_TYPE, index, begin, piece))

}

Peer.prototype._finishRequest = function() {

	this.resume()
	this.pRequest = null

	if(this.pRequestList.length > 0)
		this._fulfillRequest()

}

Peer.prototype.addListeners = function(listeners) {

	for( var event in listeners) 
		this.on(event, listeners[event])
	
}

Peer.prototype.pKeepAlive = function () {

}

Peer.prototype._pHandshake = function (peerID, supportsDHT, supportsExten) {

	this.peerID = peerID.toString('hex')
	this.supportsDHT = supportsDHT
	this.supportsExten = supportsExten

	if(!this.checkID(peerID.toString('hex'))) {

		this.sock.end() 
		this.emit('reject id', this)
		return

	}

	if(this.state != this.STATES.sent_hshake) {

		this._handshake()
		this.exHandShake()
		this.bitfield()

	}

	this.state = this.STATES.connected
	
	this.emit('connected', this)

	return true

}

Peer.prototype._pChoke = function () {

	this.pChoked = true //kill all requests??

	/*this.requestList.forEach( req => {
		clearTimeout(req.timeout)
		req.putBack()
	})

	this.requestList = []*/

	this.emit('peer_choked', this)

}

Peer.prototype._pUnchoke = function() {

	this.pChoked = false
	this.emit('peer_unchoked')

}

Peer.prototype._pInterested = function() {

	this.pInterested = true
	this.emit('peer_interested')

}

Peer.prototype._pUninterested = function() {

	this.pInterested = false
	this.emit('peer_uninterested')

}

//actually interested
Peer.prototype.aInterested = function() {
 
	return (this.pieces.difference(new NSet(this.download.pieces.keys())).size > 0)

}

//call on have or bitField message - also when downloader makes new activePiece - and piece downloaded
Peer.prototype.updateInterested = function() {

	var _interest = () => this.pieces.difference(new NSet(this.download.activePieces.keys())).size > 0

	if(_interest() && !this.interested) 
		this.sendInterested()
	else if(!_interest() && this.interested)
		this.unInterested()


}

Peer.prototype._newPieces = function(pieceIndex) {

	this.updateInterested()

	if(this.aInterested())
		this.emit('new_pieces', this)

}

Peer.prototype._pHave = function(pieceIndex) { 

	this.pieces.add(pieceIndex)
	this._newPieces()
	
}

Peer.prototype._pBitfield = function (pieceList) { 

	let pieces = this.pieces
	pieceList.forEach( (pieceIndex) => { pieces.add(pieceIndex) } )
	this._newPieces()
	
}

Peer.prototype.isSeeder = function() {

	return this.pieces.size >= this.fileMetaData.numPieces

}

Peer.prototype._pRequest = function(index, begin, length) { 

	if(this.choked) return
	this.pRequestList.push( { index : index, begin: begin, length : length })
	this._fulfillRequest()

}

Peer.prototype._fulfillRequest = function() { //expects pRequest to be null and pRequestList to have requests - called by _pRequest and _finishRequest

	if(this.pRequest != null) 
		return

	this.pRequest = this.pRequestList.shift()

	this.emit('peer_request', this, this.pRequest.index, this.pRequest.begin, this.pRequest.length)

}

Peer.prototype._pPiece = function (index, begin, piece) {//, uploadTime) {

	/*let pos = this.requestList.findIndex( req => req.index == index && req.begin == begin && req.length == piece.length)
	if(pos != -1)
		this.requestList.splice(pos, pos)*/

	this.emit('peer_piece', this, index, begin, piece)

}

Peer.prototype._pCancel = function (index, begin, length) {

	if(this.pRequest != null && this.pRequest.index == index && this.pRequest.begin == begin && this.pRequest.length == length)
		this.pRequest.p.unpipe(this.sock)

	else {
		let pos = this.pRequestList.findIndex( request => request.index == index && request.begin == begin && request.length == length)
		if(pos != -1)
			this.pRequestList.splice(pos, 0)
	}
	
}

Peer.prototype._pPort = function (payload) {

	this.nodePort = payload
	this.emit('DHT_port', payload)

}

Peer.prototype.handshake = function() {

	let self = this
	this.sock.on('connect', () => {

		self._handshake()
		self.state = self.STATES.sent_hshake

	})

	return this

}

Peer.prototype._handshake = function() {

	let nt = new Buffer(1)
	nt.writeUInt8(0x13)

	let bitTorrent = Buffer.from('BitTorrent protocol')
	let buf = Buffer.concat([nt, bitTorrent, Buffer.alloc(8), this.fileMetaData.infoHash, Buffer.from(this.download.peerID,'hex')])
	
	//only check extension supported by this client
	buf.writeUInt8(0x10, 25) 
	buf.writeUInt8(0x01, 27)
	this.push(buf)

	this.exHandShake()
	this.bitfield()

}

Peer.prototype.keepAlive = function() {

	this.push(Buffer.alloc(4))

}

Peer.prototype.port = function(port) {

	let bufPort = Buffer.alloc(2)
	bufPort.writeUInt16BE(port)
	this.push(_makeMsg(DHT_PORT_MSG_TYPE, bufPort))

}

Peer.prototype._pExHandShake = function(payload) {

	let {m, p, v, yourip, ipv6, ipv4, reqq, metadata_size} = payload
	
	this.fileMetaData.metaInfoSize = metadata_size
	this.m = m
	this.pVersion = v

	this.supportedExtensions = m

	this.emit('connected_extensions', this)
	
}

Peer.prototype.exHandShake = function() {

	let yourip = this.sock.address().address

	if(this.sock.address().family == 'IPv4')
		yourip = Buffer.from(yourip.split('.').map( str => Number(str).toString(16) ))
	else if(this.sock.address().family == 'IPv6')
		yourip = Buffer.from(yourip.split(':').map( str => Number(str).toString(16) ))

	let exHandShake = { m : this.recvExtensions, p : this.sock.address().port, v : this.version, yourip : yourip, reqq : 16 } 

	let payload = benEncode(exHandShake)
	this.push(this._makeMsg([EXTENDED_MSG_TYPE, EXTENDED_HANDSHAKE_MSG_TYPE], payload))

}

//make sep factory object
Peer.prototype._makeMsg = function(type, ...args) { // ...args = [int1, int2, buffer1, int3, ... ]

	var bufferFrom = (num) => { let buf = Buffer.alloc(4); buf.writeUInt32BE(num); return buf}

	let buf = Buffer.alloc(6)
	let msgLen = 0

	if(Array.isArray(type)) {

		buf.writeUInt8(type[0], 4)
		buf.writeUInt8(type[1], 4 + 1)
		msgLen++

	} else {

		buf = buf.slice(0,5)
		buf.writeUInt8(type, 4)

	}

	msgLen += 1 + args.map(arg => Number.isInteger(arg) ? 4 : arg.length).reduce( (a,b) => a + b, 0 )
	buf.writeUInt32BE(msgLen, 0)

	let argBuf = Buffer.concat(args.map( arg => Buffer.isBuffer(arg) ? arg : bufferFrom(arg)) )

	return Buffer.concat([buf, argBuf])

}

Peer.prototype.choke = function() {

	this.choked = true
	this.push(this._makeMsg(CHOKE_MSG_TYPE))

}

Peer.prototype.unchoke = function() {

	this.choked = false
	this.push(this._makeMsg(UNCHOKE_MSG_TYPE))

}

Peer.prototype.sendInterested = function() {

	this.interested = true
	this.push(this._makeMsg(INTERESTED_MSG_TYPE))

}

Peer.prototype.unInterested = function() {

	this.interested = false
	this.push(this._makeMsg(UNINTERESTED_MSG_TYPE))

}

Peer.prototype.have = function(pieceIndex) {

	this.push(this._makeMsg(HAVE_MSG_TYPE, pieceIndex))
	if(this.interested && this.pieces.difference(this.download.pieces).size == 0) 
		this.unInterested()

}

Peer.prototype.bitfield = function () {

	let pieces = Array.from(this.download.pieces).map(pairs => pairs[0]).sort( (a, b) => a - b  )
	let bitFieldLength = Math.ceil(this.fileMetaData.numPieces / 8)

	let bitField = Buffer.alloc(bitFieldLength)

	pieces.forEach(function(pieceIndex) {

		var byte = bitField.readUInt8(Math.floor(pieceIndex / 8))
		byte |= (2**7 >> (pieceIndex % 8))
		bitField.writeUInt8(byte, Math.floor(pieceIndex / 8))

	})

	this.push(this._makeMsg(BITFIELD_MSG_TYPE, bitField))

}

Peer.prototype.request = function(request) {

	//this.requestList.push(request)
	this.push(this._makeMsg(REQUEST_MSG_TYPE, request.index, request.begin, request.length))

}

Peer.prototype.cancel = function (index, begin, length) {

	this.push(this._makeMsg(CANCEL_MSG_TYPE, index, begin, length))

}

Peer.prototype._final = function() {

	//socket writes end when dead
	//_final called before end completes

}

Peer.prototype._read = function() {}

Peer.prototype._write = function(obj, encoding, callback) {

	let type = obj.type
	let exType = obj.exType
	let handler 
	
	if(exType != undefined) { //either _handshake or peer exchange
	
		handler = this.msgHandlers[type][exType]
		handler(obj.args)

	} else {

		handler = this.msgHandlers[type]
		try {
		handler( ... Object.values(obj.args) )
		} catch(error) {
			console.log(error)
			console.log(obj)
		}

	}
	  //{type : _ , args : { _ }} or {type : _ , args : [ extype ,  payload]} 

	callback()

}

class BitTorrentMsgParser extends Transform {

	constructor(file) {

		let opts = { 'objectMode': true, 'writableObjectMode' : true, 'highWaterMark' : 16384 * 2 }

		super(opts)

		this.file = file
		this.msgBuffer = Buffer.alloc(0);
		this.nextMsgLength = HANDSHAKE_LENGTH;
		this.nextMsgParser = this.parseHandshake

	}

	getType(msg) {

		return msg.readUInt8(0)

	}
	
	parseHandshake(msg) { //maybe garbled
		
		if(msg.readUInt8(0) != 0x13
			|| msg.slice(1,20).toString() != 'BitTorrent protocol'
			|| !msg.slice(28, 48).equals(this.file.infoHash)
			|| msg.length != 68) return 

		//only check extension supported by this client
		let supportsExten = msg.readUInt8(25) & 0x10
		let supportsDHT = msg.readUInt8(27) & 0x01 //last bit

		let peerID = msg.slice(48,68)

		this.nextMsgParser = this.parseMsgLength;
		this.nextMsgLength = 4;
		//reset keepalive timer

		this.push( {type : '_handshake' , args: {'peerID': peerID, 'supportsDHT': supportsDHT, 'supportsExten': supportsExten} })

	}

	parseMsgLength(msg) { 

		if(msg.readUInt32BE(0) > 0) { //handle keepalive

			this.nextMsgLength = msg.readUInt32BE(0)
			this.nextMsgParser = this.parseMsgPayLoad

		} else {

			return { type: 'KEEPALIVE_MSG_TYPE', payload: null }

		}
		//reset keepalive timer	

	}
	
	parseMsgPayLoad(msg) {//, uploadTime) { //maybe garbled

		//this.keepAliveTimer goes off if no message for _ min/sec
		//checks if nothing going in the other direction

		let msgLen = this.nextMsgLength //assert(this.nextMsgLength == msg.length)

		this.nextMsgParser = this.parseMsgLength;
		this.nextMsgLength = 4

		let msgType = this.getType(msg) 
		msg = msg.slice(1)

		let parsedMsg = { type : msgType, args : {} }

		switch ( msgType ) {
			case HAVE_MSG_TYPE :  
				parsedMsg.args = this.parseHaveMsg(msg)
				break
			case BITFIELD_MSG_TYPE :  
				parsedMsg.args = this.parseBitFieldMsg(msg)
				break
			case REQUEST_MSG_TYPE : 
				parsedMsg.args = this.parseRequestMsg(msg)
				break
			case PIECE_MSG_TYPE :  
				parsedMsg.args = this.parsePieceMsg(msg)//, uploadTime)
				break
			case CANCEL_MSG_TYPE : 
				parsedMsg.args = this.parseCancelMsg(msg)
				break
			case DHT_PORT_MSG_TYPE :
				parsedMsg.args = msg.readUInt16BE()
				break
			case EXTENDED_MSG_TYPE : 
				let {exType, args} = this.parseExtendedMsg(msg)
				parsedMsg.exType = exType
				parsedMsg.args = args
				break
			default : 
				//return
				//ignore unrecognized messages
				
		}
		
		//parsedMsg = { type : _ , exType : _, args : { _ , _ , data = _ }}
		this.push(parsedMsg)  // push to peer

	}

	parseHaveMsg(msg) {

		return msg.readUInt32BE(0) //just return int

	}

	parseBitFieldMsg(msg) {

		let bitField = []
		let self = this

		msg.forEach( function(byte, i, v) {

			for (let j = 0 ; j < 8 ; j++) {
				if ( byte & 0x80 )//&& (i * 8 + j) ) //< self.file.numPieces)
					bitField.push(i * 8 + j)
				byte <<= 1
			}

		})

		return { bitField : bitField }

	}

	parseRequestMsg(msg) {

		let index = msg.readUInt32BE(0)
		let begin = msg.readUInt32BE(4)
		let length = msg.readUInt32BE(8)
		return { index : index, begin : begin, length : length }
	}

	parseCancelMsg(msg) {

		let index = msg.readUInt32BE(0)
		let begin = msg.readUInt32BE(4)
		let length = msg.readUInt32BE(8)
		return { index : index, begin : begin, length : length }

	}

	parsePieceMsg(msg) {//, uploadTime) {

		let index = msg.readUInt32BE(0)
		let begin = msg.readUInt32BE(4)
		return { index : index, begin : begin, piece : msg.slice(8) }//, uploadTime : uploadTime }

	}	

	parseExtendedMsg(msg) {

		let type = msg.readUInt8(0)
		//benDecode must only parse longest valid bencoded string
		let payload = benDecode(msg.slice(1)), payloadLength = benEncode(payload).length
		payload.data = msg.slice(payloadLength + 1)

		return { exType : type, args : payload } //{extype: _ , args : { _ , _ , data : ... }}

	}

	//eats msgs - on piece msg waits for entire msg and then pushes {index, begin, piece} to peer
	//recvPiece true for this time
	_transform(chunk, encoding, callback) {

		this.msgBuffer = Buffer.concat([this.msgBuffer, chunk])

		var nextMsg

		while(this.msgBuffer.length >= this.nextMsgLength) {
			
			nextMsg = this.msgBuffer.slice(0,this.nextMsgLength)
			this.msgBuffer = this.msgBuffer.slice(this.nextMsgLength)
			this.nextMsgParser(nextMsg) 

	 	}

	 	callback()
	
	}

}

module.exports = {

	'Peer' : Peer,
	'Parser' : BitTorrentMsgParser

}














