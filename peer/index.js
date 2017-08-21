
module.exports = {
	'Peer' : Peer
}

Duplex = require('stream').Duplex
Transform = require('stream').Transform

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

var PEEREX_MSG_TYPE = 1
var METADATAEX_MSG_TYPE = 2

var PPEEREX_MSG_TYPE
var PMETADATAEX_MSG_TYPE 

function Peer(fileMetaData, listeners, sock, addr) { //, file, init) {

	opts = { 'readableObjectMode': true} //allowHalfOpen ??
	Duplex.call(this)

	this.uninitialized = true
	this.connecting = false
	this.connected = false
	this.disconnected = false

	this.STATES = {'uninitialized':0, 'sent_hshake' : 1,'connected':2, 'disconnected': 3}
	this.state = this.STATES.uninitialized

	this.pChoke = true; //i'm choked
	this.choke = true //peer is choked
	this.pInterested = false;
	this.interested = false

	this.supportsExten = false //extended protocol
	this.supportsDHT = false //mainline dht
	
	this.pieces = new Set() //pHave and pBitfield
	
	this.peerID

	//statistics 
	//restart on reconnect?
	this.downloadRate = 0
	this.uploadRate = 0
	this.timeConnected = 0
	this.disconnects = 0

	this.file = fileMetaData

	self = this

	this.addListeners(listeners)

	if(sock) {

		this.sock = sock
		this.host = sock.remoteAddress
		this.port = sock.remotePort

	} else {

		this.host = addr.host
		this.port = addr.port

		sockOpts = { 'allowHalfOpen' : false }
		this.sock = net.createConnection(sockOpts)
		sock.connect(addr.port, addr.host)

		sock.on('connected', () => {	

			self.handshake()
			self.state = this.STATES.sent_hshake

		})

	}

	sock.on('close', () => {

		self.state = this.STATES.disconnected
		//clearout request queues

	})

	var opts = {'end' : false}

	this.parser = new BitTorrentMsgParser

	sock.pipe(this.parser, opts).pipe(this).pipe(sock)

	this.msgHandlers = { 'handshake': this.pHandshake, [KEEPALIVE_MSG_TYPE] : this.pKeepAlive, [CHOKE_MSG_TYPE] : this.pChoke, [UNCHOKE_MSG_TYPE] : this.pUnchoke, [INTERESTED_MSG_TYPE] : this.pInterested, 
	[UNINTERESTED_MSG_TYPE] : this.pUninterested, [HAVE_MSG_TYPE] : this.pHave, [BITFIELD_MSG_TYPE] : this.pBitfield, 
	[REQUEST_MSG_TYPE] : this.pRequests, [PIECE_MSG_TYPE] : this.pPiece, [CANCEL_MSG_TYPE] : this.pCancel, 
	[DHT_PORT_MSG_TYPE] : this.pPort, [EXTENDED_MSG_TYPE] : { [EXTENDED_HANDSHAKE_MSG_TYPE] : this.pExHandShake, 
		[PEEREX_MSG_TYPE] : this.pPeerExchange, [METADATAEX_MSG_TYPE] : { 0: this.pMetaDataExRequest, 1: this.pMetaDataExData, 2: this.pMetaDataExReject} } 
	}

	this.pRequests = [] //serialize requests here so can cancel latter
	this.pRequest = null

	this.recievingPiece = false

	self = this
	//this.parser.on('recving_piece', () => {self.recievingPiece = true})
	//this.parser.on('done_recving_piece', () => {self.recievingPiece = false})
	//this.recievingPiece = 

	this.idle = pPieces.length == 0 && this.pPieces == null && !this.parser.recievingPiece
}

util.inherits(Peer, Duplex)

Peer.prototype.piece = funcion(index, begin, piece) {

	this.pause()
	this.sock.write(this.makePieceMsgHeader(request.index, request.begin, request.length))
	this.sock.write(piece)

	
		//this.resume()
	this.finishRequest()
	//}).bind(this))

}


Peer.prototype.finishRequest = function() {

	this.pRequest = null

	if(this.pRequest.length > 0) {
		this.pRequest = this.pRequests.shift()
		this.fulfillRequest()
	}

}

Peer.prototype.addListeners = function(emitter, listeners) {

	for( var event in listeners) {
		emitter.on(event, listeners[event])
	}
	
}

Peer.prototype.pKeepAlive = function () {

}

Peer.prototype.pHandshake = function (peerID, supportsDHT, supportsExten) {

	this.peerID = peerID
	this.supportsDHT = supportsDHT
	this.supportsExten = supportsExten

	if(this.state != this.STATES.sent_shake) { //already sent handshake

		this.state = this.STATES.connected
		this.handshake()
		this.emit('connected')

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

	pieceList.forEach((function(pieceIndex) { this.pHave(pieceIndex) }).bind(this))

}

Peer.prototype.pRequest = function(index, begin, length) { //index, begin, length

	if(this.choked) return
	this.pRequest.push( { index : index, begin: begin, length : length })
	this.fulfillRequest()

}

Peer.prototype.fulfillRequest = function() {

	if(this.pRequest != null) 
		return
	
	this.pRequest = this.pRequest.shift()

	this.emit('peer_request', this.pRequest.index, this.pRequest.begin, this.pRequest.length, this)

}

Peer.prototype.pPiece = function (index, begin, piece) { //index, begin, length, piece

	if(this.pChoke) return //discard piece

	this.emit('peer_piece', index, begin, length, piece)

}

Peer.prototype.pCancel = function (index, begin, length) {

	let pos = this.pRequests.findIndex( request => request.index == index && request.begin == begin && request.length == length)
	if(pos != -1)
		this.pRequests.splice(pos, 0)

}

Peer.prototype.pMetaDataExRequest = function (piece) {

	//payload
	//let {piece} = payload
	//if do not have whole metadata reject
	if(this.file.info != null)
		this.metaDataExData(piece, this.file.info.slice(piece * (2 ** 16), (piece + 1) * 2 ** 16))
	else 
		this.metaDataExDataReject(piece)

}

Peer.prototype.pMetaDataExData = function(piece, total_size, data) {

	//let {piece, total_size} = payload

	this.metaInfoPieces.push({'piece': piece, 'data': data})

	//if(this.metaInfoPieces.map(infoPieces => infoPieces.data.length).reduce( (a,b) => a + b, 0 )
	//	== total_size) {
		//this.file.info = this.metaInfoPieces.map(infoPieces => infoPieces.data).reduce( (a,b) => Buffer.concat([a,b]), Buffer.alloc(0))
		//check hash
	//}

}

Peer.prototype.pMetaDataExReject = function(piece) {

	//let {piece} = payload

}

Peer.prototype.metaDataExRequest = function (index) {

	let reqMsg = benEncode({'msg_type': 0, 'piece': index })
	this.push(this.makeMsg([EXTENDED_MSG_TYPE, PMETADATAEX_MSG_TYPE], reqMsg))

}

Peer.prototype.metaDataExData = function(index, data) {

	let dataMsg = benEncode({'msg_type': 1, 'piece': index, 'total_size': this.file.infoSize})
	this.push(this.makeMsg([EXTENDED_MSG_TYPE, PMETADATAEX_MSG_TYPE], dataMsg))

}

Peer.prototype.metaDataExDataReject = function(index) {
	
	let rejectMsg = benEncode({'msg_type': 2, 'piece': index})
	this.push(this.makeMsg([EXTENDED_MSG_TYPE, PMETADATAEX_MSG_TYPE], rejectMsg))

}

Peer.prototype.pPeerExchange = function (added, added6, dropped, dropped6) {

	peerEx = {}

	//let {added, added6, dropped, dropped6} = payload
	let [addedf, added6f] = [payload['added.f'], payload['added6.f']]

	peerEx.added = parsePeerContactInfosIP4(added) 
	addedf.forEach( (byte, i) => { peerEx.added[i].parseFlags(byte) } )

	peerEx.added6 = parsePeerContactInfosIP6(added6)
	added6f.forEach( (byte, i) => { peerEx.added6[i].parseFlags(byte) } )

	peerEx.dropped = parsePeerContactInfosIP4(dropped)
	peerEx.dropped6 = parsePeerContactInfosIP6(dropped6)

	this.emit('peer_exchange', peerEx)
	//{added : [peer1, peer2, ... ], added6 : [], ...}

}

Peer.prototype.PeerExchange = function (peerInfos, droppedPeerInfos) {

	let peerExMsg = {  //strings or buffers ??
		added : Buffer.from(peerInfos.filter( peerInfo => !peerInfo.ipv6).map( peerInfo => peerInfo.getContactInfo() ).join("")), 
		added6 : Buffer.from(peerInfos.filter( peerInfo => peerInfo.ipv6).map( peerInfo => peerInfo.getContactInfo() ).join("")), 
		dropped : Buffer.from(droppedPeerInfos.filter( peerInfo => !peerInfo.ipv6).map( peerInfo => peerInfo.getContactInfo() ).join("")),
		dropped6 : Buffer.from(droppedPeerInfos.filter( peerInfo => peerInfo.ipv6).map( peerInfo => peerInfo.getContactInfo() ).join("")), 
		addedf : Buffer.concat( peerInfos.filter(peerInfo => !peerInfo.ipv6).map( peerInfo => peerInfo.makeFlags() )),
		added6f : Buffer.concat( peerInfos.filter(peerInfo => peerInfo.ipv6).map( peerInfo => peerInfo.makeFlags() ))
	}

	this.push(this.makeMsg([EXTENDED_MSG_TYPE, PPEEREX_MSG_TYPE], bencode(peerExMsg)))
	
}

Peer.prototype.pPort = function (payload) {

	let pPort = payload
	this.nodePort = pPort
	this.emit('DHT_port', pPort, this.hostIP)

}

Peer.prototype.handshake = function() {

	let nt = new Buffer(1)
	nt.writeUInt8(0x13)

	let bitTorrent = Buffer.from('BitTorrent')

	let buf = Buffer.concat([nt, bitTorrent, Buffer.alloc(8), this.file.infoHash, this.peerId])

	//only check extension supported by this client
	buf.writeUInt8(buf.readUInt8(24) | 0x10) 
	buf.writeUInt8(buf.readUInt8(27) | 0x01)
	this.push(buf)

	this.exHandShake()

}

Peer.prototype.keepAlive = function() {

	this.push(Buffer.alloc(4))

}

Peer.prototype.port = function(port) {

	let bufPort = Buffer.alloc(2)
	bufPort.writeUInt16BE(port)
	this.push(makeMsg(DHT_PORT_MSG_TYPE, bufPort))

}

Peer.prototype.pExHandShake = function(payload) {

	let {m, p, v, yourip, ipv6, ipv4, reqq, metadata_size} = payload
	
	this.fileMetaData.infoSize = metadata_size
	this.m = m
	this.pVersion = v
	PPEEREX_MSG_TYPE = m['ut_pex']
	PMETADATAEX_MSG_TYPE = m['ut_metadata']
	
}

Peer.prototype.exHandShake = function() {

	let yourip = this.sock.address().address
	if(this.sock.address().family == 'IPv4')
		yourip = yourip.split('.')
	else 
		yourip = yourip.split(':')

	let exHandShake = { m : {'ut_pex' : PEEREX_MSG_TYPE, 'ut_metadata' : METADATAEX_MSG_TYPE}, 
	p : this.sock.address().port, v : this.version, yourip : yourip, reqq : 16 } 

	let payload = benEncode(exHandShake)
	this.push(this.makeMsg([EXTENDED_MSG_TYPE, EXTENDED_HANDSHAKE_MSG_TYPE], payload))

}

Peer.prototype.makeMsg = function(type, ...args) { // ...args = [int1, int2, buffer1, int3, ... ]

	var bufferFrom = (num) => { let buf = Buffer.alloc(4); buf.writeUInt32BE(num); return buf}

	let buf = Buffer.alloc(6)
	let msgLen = 0

	if(Array.isArray(type)) {
		buf.writeUInt8(type[0], 4)
		buf.writeUInt8(type[1], 4 + 1)
		msglen ++
	} else {
		buf = buf.slice(0,5).writeUInt8(type, 4)
	}

	msgLen += 1 + args.map(arg => Number.isInteger(arg) ? 4 : arg.length).reduce((a,b) => a+b, 0)
	buf.writeUInt32BE(msglen, 0)

	let argBuf = Buffer.concat(args.map(arg => Buffer.isBuffer(arg) ? arg : bufferFrom(arg)))

	return Buffer.concat([buf, argBuf])

}

Peer.prototype.choke = function() {

	this.choke = true
	this.push(this.makeMsg(CHOKE_MSG_TYPE))

}

Peer.prototype.unchoke = function() {

	this.choke = false
	this.push(this.makeMsg(UNCHOKE_MSG_TYPE))

}

Peer.prototype.interested = function() {

	this.interested = true
	this.push(this.makeMsg(INTERESTED_MSG_TYPE))

}

Peer.prototype.unInterested = function() {

	this.interested = false
	this.push(this.makeMsg(UNINTERESTED_MSG_TYPE))

}

Peer.prototype.have = function(pieceIndex) {

	this.push(makeMsg(HAVE_MSG_TYPE, pieceIndex))

}

Peer.prototype.bitfield = function () {

	this.push(makeBitFieldMsg(this.file.pieces))

}

Peer.prototype.request = function(index, begin, length) {

	this.push(makeMsg(REQUEST_MSG_TYPE, index, begin, length))

}

Peer.prototype.cancel = function (index, begin, length) {

	this.push(this.makeMsg(CANCEL_MSG_TYPE, index, begin, length))

}

Peer.prototype.makeBitFieldMsg = function(pieces) {

	let bitFieldLength = pieces % 8 == 0 ? pieces / 8 : ((pieces / 8) + 1)
	
	bitField = Buffer.alloc(bitFieldLength)

	this.pieces.forEach(function(pieceIndex) {
		var byte = bitField.readUInt32BE(pieceIndex / 8)
		byte &= pieceIndex % 8
		bitField.writeUInt32BE(byte)
	}) 

	return this.push(this.makeMsg(BITFIELD_MSG_TYPE, bitField))

}

Peer.prototype._final = function() {

	//socket writes end when dead
	//_final called before end completes

}

Peer.prototype._write = function(obj, encoding, callback) {

	let type = obj.type
	let exType = obj.exType
	let handler 

	if(exType && exType != METADATAEX_MSG_TYPE) { //either handshake or peer exchange

		handler = this.handler[type][exType]
		//handler(obj.args)

	} else if(exType && exType == METADATAEX_MSG_TYPE) {

		let msg_type = obj.payload.msg_type
		handler = this.handler[type][exType][msg_type]
		//handler(obj.args)

	} else //reg msg 
		handler = this.handler[type]

	handler( ... Object.values(obj.args) )
	  //{type : _ , args : { _ }} or {type : _ , args : [ extype ,  payload]} 

	callback()

}

function parsePeerContactInfosIP4(compactInfos) {

	return compactInfos.match(/.{6}/).map(info => new PeerInfo( info.slice(4,6).readUInt16BE(), info.slice(0,4)) )

}

function parsePeerContactInfosIP6(compactInfos) {

	return compactInfos.match(/.{18}/).map(info => new PeerInfo( info.slice(16,18).readUInt16BE(), info.slice(0,16)) )

}

class BitTorrentMsgParser extends Transform {

	constructor(file) {

		//reader reads objects, writer writes buffers
		opts = { readableObjectMode : true, highWaterMark : 16384 * 2 }

		super(opts)

		this.file = file
		this.msgBuffer = Buffer.alloc(0);
		this.nextMsgLength = HANDSHAKE_LENGTH;
		this.nextMsgParser = parseHandShake; //initially

	}

	getType(msg) {

		return msg[0].readUInt8()

	}
	
	parseHandshake(msg) { //maybe garbled
		
		if(!msg.readUInt8(0) != 0x13
			|| !msg.slice(1,20).toString() == 'BitTorrent protocol'
			|| msg.slice(28,48) != this.file.infoHash) return {}
	
		//only check extension supported by this client
		let supportsExten = msg.readUInt8(24) & 0x10
		let supportsDHT = msg.readUInt8(27) & 0x01 //last bit

		let peerID = msg.slice(48,68)

		this.nextMsgParser = parseMsgLength;
		this.nextMsgLength = 4;
		//reset keepalive timer

		this.push( {type : 'handshake' , args: {'peerID': peerID, 'supportsDHT': supportsDHT, 'supportsExten': supportsExten} })

	}

	parseMsgLength(msg) { //always valid

		if(msg.readUInt32BE(0) > 0) { //handle keepalive

			this.nextMsgLength = msg.readUInt32BE(0)
			this.nextMsgParser = parseMsgPayLoad

		} else {

			return { type: 'KEEPALIVE_MSG_TYPE', payload: null }

		}
		//reset keepalive timer	

	}
	
	parseMsgPayLoad(msg) { //maybe garbled

		//this.keepAliveTimer goes off if no message for _ min/sec
		//checks if nothing going in the other direction

		let msgLen = this.nextMsgLength //assert(this.nextMsgLength == msg.length)

		this.nextMsgParser = parseMsgLength;
		this.nextMsgLength = 4

		//reset keepalive timer

		let msgType = getType(msg) //string
		msg = msg.slice(1)

		let parsedMsg = { type : msgType, args : {} }

		switch ( msgType ) {
			case HAVE_MSG_TYPE :  
				parsedMsg.args = parseHaveMsg(msg)
				break
			case BITFIELD_MSG_TYPE :  
				parsedMsg.args = parseBitFieldMsg(msg)
				break
			case REQUEST_MSG_TYPE : 
				parsedMsg.args = parseRequestMsg(msg)
				break
			case PIECE_MSG_TYPE :  
				parsedMsg.args = parsePieceMsg(msg)
				break
			case CANCEL_MSG_TYPE : 
				parsedMsg.args = parseCancelMsg(msg)
				break
			case DHT_PORT_MSG_TYPE :
				if(msgLen == 2)
					parsedMsg.args = msg.readUInt16BE()
				break
			case EXTENDED_MSG_TYPE : 
				let {exType, args} = parseExtendedMsg()
				parsedMsg.exType = exType
				parsedMsg.args = args
				break
			default : 
				return
				//ignore unrecognized messages
				
		}

		if( parseMsg.args == undefined ) {
			//something bad
		}

		//if(parsedMsg.payload != undefined  && Object.keys(parseMsg.payload).length == 0) 
		//	return
		
		//parsedMsg = { type : _ , exType : _, args : { _ , _ , data = _ }}
		this.push(parsedMsg)  // push to peer

	}

	parseHaveMsg(msg) {

		return msg.readUInt32BE() //just return int

	}

	parseBitFieldMsg(msg) {

		bitField = []

		msg.forEach(function(byte, i, v) {

			while(byte >>= 1) 
				bitField.push(i++)

		})

		return bitField

	}

	parseRequestMsg(msg) {

		let index = msg.readUInt32BE(0)
		let begin = msg.readUInt32BE(4)
		let length = msg.readUInt32BE(8)

		if(index > this.file.numPieces && begin >= 0 && begin < this.file.pieceLength 
			&& length > 0 && length < this.file.pieceLength) 
			return { index : index, begin : begin, length : length }
	}

	parseCancelMsg(index, begin, length) {

		let index = msg.readUInt32BE(0)
		let begin = msg.readUInt32BE(4)
		let length = msg.readUInt32BE(8)

		if(index > this.file.numPieces && begin > 0 && begin < this.file.pieceLength
			&& length >= 0 && length < this.file.pieceLength) 
			return { index : index, begin : begin, length : length }

	}

	parsePieceMsg(msg) {

		let index = msg.readUInt32BE(0)
		let begin = msg.readUInt32BE(4)
		
		if(index < this.file.numPieces && begin > 0 && begin < this.file.pieceLength) {
			return { index : index, begin : begin, piece : msg.slice(8) }
		}

	}	

	parseExtendedMsg(msg) {

		let type = msg[0].readUInt8()
		//benDecode must only parse longest valid bencoded string
		let payload = benDecode(msg.slice(1))
		payload.data = msg.slice(payload.length)

		return { extype : type, args : payload } //{extpe: _ , args : { _ , _ , data : ... }}

	}

	//eats msgs - on piece msg waits for entire msg and then pushes {index, begin, piece} to peer
	//recvPiece true for this time
	_transform(chunk, encoding, callback) {

		this.msgBuffer = Buffer.concat(this.msgBuffer, chunk)

		var nextMsg

		while(this.msgBuffer.length > this.nextMsgLength) {
			
			nextMsg = msgBuffer.slice(0,this.nextMsgLength)
			this.msgBuffer = msgBuffer.slice(this.nextMsgLength)

			this.nextMsgParser(nextMsg)

	 	}

	 	this.recievingPiece = this.msgBuffer.length > 4 && this.msgBuffer.readUInt8(4) == PIECE_MSG_TYPE
	
	}

}














