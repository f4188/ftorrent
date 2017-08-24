
//EXTENDED_MSG_TYPE
const EXTENDED_MSG_TYPE = 20 
const PEEREX_MSG_TYPE = 1
//PPEEREX_MSG_TYPE

benEncode = require('bencode').encode
var PeerInfo = require('PeerInfo.js')

let PeerEx  = (SuperClass) => class PeerEx extends SuperClass {
	
	constructor(args...) {

		super(args)
		this.recvExtensions['ut_pex'] = [PEEREX_MSG_TYPE]
		this.msgHandlers[EXTENDED_MSG_TYPE][PEEREX_MSG_TYPE] = this.pPeerExchange

	}

	pPeerExchange (args) {

		let {added, added6, dropped, dropped6} = args

		let addedf = args['added.f'], added6f = args['added6.f']

		added = this.parsePeerContactInfosIP4(added) 
		addedf.forEach( (byte, i) => { peerEx.added[i].parseFlags(byte) } )

		added6 = this.parsePeerContactInfosIP6(added6)
		added6f.forEach( (byte, i) => { peerEx.added6[i].parseFlags(byte) } )

		dropped = this.parsePeerContactInfosIP4(dropped)
		dropped6 = this.parsePeerContactInfosIP6(dropped6)

		this.emit('peer_exchange', { added : added, added6 : added6, dropped : dropped, dropped6 : dropped6 })

	}

	PeerExchange (peerInfos, droppedPeerInfos) {

		if(!this.supportsExtensions['ut_pex'])
			return

		let peerExMsg = {  //strings or buffers ??
			added : Buffer.from(peerInfos.filter( peerInfo => !peerInfo.ipv6).map( peerInfo => peerInfo.getContactInfo() ).join("")), 
			added6 : Buffer.from(peerInfos.filter( peerInfo => peerInfo.ipv6).map( peerInfo => peerInfo.getContactInfo() ).join("")), 
			dropped : Buffer.from(droppedPeerInfos.filter( peerInfo => !peerInfo.ipv6).map( peerInfo => peerInfo.getContactInfo() ).join("")),
			dropped6 : Buffer.from(droppedPeerInfos.filter( peerInfo => peerInfo.ipv6).map( peerInfo => peerInfo.getContactInfo() ).join("")), 
			addedf : Buffer.concat( peerInfos.filter(peerInfo => !peerInfo.ipv6).map( peerInfo => peerInfo.makeFlags() )),
			added6f : Buffer.concat( peerInfos.filter(peerInfo => peerInfo.ipv6).map( peerInfo => peerInfo.makeFlags() ))
		}

		this.push(this.makeMsg([EXTENDED_MSG_TYPE, this.supportsExtensions['ut_pex']], bencode(peerExMsg)))
		
	}

	parsePeerContactInfosIP4(compactInfos) {

		return compactInfos.match(/.{6}/).map(info => new PeerInfo( info.slice(4,6).readUInt16BE(), info.slice(0,4)) )

	}

	parsePeerContactInfosIP6(compactInfos) {

		return compactInfos.match(/.{18}/).map(info => new PeerInfo( info.slice(16,18).readUInt16BE(), info.slice(0,16)) )

	}

}

module.exports = {
	PeerEx : PeerEx
}