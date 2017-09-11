
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

		this.push( {type : '_handshake' , args: {'peerID': peerID, 'supportsDHT': supportsDHT, 'supportsExten': supportsExten} })

	}

	parseMsgLength(msg) { 

		if(msg.readUInt32BE(0) > 0) { //handle keepalive

			this.nextMsgLength = msg.readUInt32BE(0)
			this.nextMsgParser = this.parseMsgPayLoad

		} else {

			return { type: '_keepalive', payload: null }

		}

	}
	
	parseMsgPayLoad(msg) {

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

				if ( byte & 0x80 )
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

	parsePieceMsg(msg) {
		
		let index = msg.readUInt32BE(0)
		let begin = msg.readUInt32BE(4)
		return { index : index, begin : begin, piece : msg.slice(8) }

	}	

	parseExtendedMsg(msg) {

		let type = msg.readUInt8(0)
		//benDecode must only parse longest valid bencoded string
		let payload = benDecode(msg.slice(1)), payloadLength = benEncode(payload).length
		payload.data = msg.slice(payloadLength + 1)

		return { exType : type, args : payload } //{extype: _ , args : { _ , _ , data : ... }}

	}

	//eats msgs - on piece msg waits for entire msg and then pushes {index, begin, piece} to peer
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

	'Parser' : BitTorrentMsgParser

}





