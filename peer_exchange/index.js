
const EXTENDED_MSG_TYPE = 20 
const PEEREX_MSG_TYPE = 2

const benEncode = require('bencode').encode
const PeerInfo = require('../lib/PeerInfo.js').PeerInfo

var PeerEx  = (SuperClass) => class PeerEx extends SuperClass {
	
	constructor( ...args ) {

		super( ...args )

		this.recvExtensions['ut_pex'] = PEEREX_MSG_TYPE
		this.msgHandlers[EXTENDED_MSG_TYPE][PEEREX_MSG_TYPE] = (this.pPeerExchange).bind(this)

	}

	pPeerExchange (args) {

		let {added, added6, dropped, dropped6} = args
		let addedf = args['added.f'], added6f = args['added6.f']

		if(added && added6f) {
			added = this.parsePeerContactInfosIP4(added) 
			addedf.forEach( (byte, i) => { added[i].parseFlags(byte) } )
		}

		if(added6 && added6f) {
			added6 = this.parsePeerContactInfosIP6(added6)
			added6f.forEach( (byte, i) => { added6[i].parseFlags(byte) } )
		}

		if(dropped)
			dropped = this.parsePeerContactInfosIP4(dropped)

		if(dropped6)
			dropped6 = this.parsePeerContactInfosIP6(dropped6)

		this.emit('peer_exchange', { added : added, added6 : added6, dropped : dropped, dropped6 : dropped6 })

	}

	peerExchange (peerInfos, droppedPeerInfos) {

		if(!this.supportsExtensions['ut_pex'])
			return

		let peerExMsg = {  //strings or buffers ??

			added : peerInfos.filter( peerInfo => !peerInfo.ipv6).map( peerInfo => peerInfo.getContactInfo() ).join(""), 
			added6 : peerInfos.filter( peerInfo => peerInfo.ipv6).map( peerInfo => peerInfo.getContactInfo() ).join(""), 
			dropped : droppedPeerInfos.filter( peerInfo => !peerInfo.ipv6).map( peerInfo => peerInfo.getContactInfo() ).join(""),
			dropped6 : droppedPeerInfos.filter( peerInfo => peerInfo.ipv6).map( peerInfo => peerInfo.getContactInfo() ).join(""), 
			addedf : Buffer.concat( peerInfos.filter(peerInfo => !peerInfo.ipv6).map( peerInfo => peerInfo.makeFlags() )),
			added6f : Buffer.concat( peerInfos.filter(peerInfo => peerInfo.ipv6).map( peerInfo => peerInfo.makeFlags() ))

		}

		this.push(this.makeMsg([EXTENDED_MSG_TYPE, this.supportsExtensions['ut_pex']], bencode(peerExMsg)))
		
	}

	 parsePeerContactInfosIP4(compactInfos, nodeID) {

	 	//compactInfos = compactInfos || []

		var slicer = (buf) => {

			let slices = []
			while(buf.length > 0) {
				slices.push(buf.slice(0, 6))
				buf = buf.slice(6)
			}
			return slices

		}

		return slicer(compactInfos).map(info => {

			if(!info)
				return
			
			let parsedHost = info.slice(0,4).toString('hex').match(/.{2}/g).map( num => Number('0x' + num)).join('.') //: host.toString().match(/.{2}/g).map( num => Number(num)).join('.')
			let parsedPort = info.slice(4, 6).readUInt16BE()

			return new PeerInfo(parsedPort, parsedHost)

		})

	}

	parsePeerContactInfosIP6(compactInfos) {

		var slicer = (buf) => {

			let slices = []
			while(buf.length > 0) {
				slices.push(buf.slice(0, 18))
				buf = buf.slice(18)
			}
			return slices

		}

		return slicer(compactInfos).map(info => {

			if(!info)
				return

			let parsedHost = info.slice(0,16).toString('hex').match(/.{2}/g).map( num => Number('0x' + num)).join(':') //: host.toString().match(/.{2}/g).map( num => Number(num)).join('.')
			let parsedPort = info.slice(16, 18).readUInt16BE()

			return new PeerInfo( parsedPort, parsedHost )

		})
	}
}

module.exports = {
	PeerEx : PeerEx
}