
const net = require('net')

class PeerInfo {

 	constructor(port, host, nodeID) {

 		//this.ipv6 = Buffer.isBuffer(host) && host.length == 16 || typeof host == 'string' && net.isIP(host) == 6
 		this.ipv6 = net.isIP(host) == 6
 		this.port = port
 		this.host = host
 		this.nodeID = nodeID || null //owns this node 
 		
 		this.encrypt = false
 		this.upload_only = false
 		this.uTP = false
 		this.ut_hole_punch = false
 		this.reachable = true

 	}

 	getContactInfo() { //return buffer

 		let portBuf = new Buffer(2), hostBuf
		portBuf.writeUInt16BE(this.port)

 		if(!ipv6)

			hostBuf = Buffer.from(this.host.split('.')).map( x => Number(x) )

		else {

			let host = this.host.split(':').map( x => Number(x) )
			hostBuf = Buffer.from(host)

		}

		return Buffer.concat([hostBuf, portBuf])

	}

	parseFlags(byte) {

		if(Buffer.isBuffer(byte))
			byte = byte.readUInt8()
		else if (typeof byte == 'string')
			byte = Buffer.from(byte).readUInt8()
		//else byte is int
		if( byte & 0x01 > 0 ) this.encrypt = true
		if( byte & 0x02 > 0 ) this.upload_only = true
		if( byte & 0x04 > 0 ) this.uTP = true
		if( byte & 0x08 > 0 ) this.ut_hole_punch = true
		if( byte & 0x10 > 0 ) this.reachable = true

	}

	makeFlags() { // return buffer

		let flags = this.encrypt && 0x1 | this.upload_only && 0x2 | this.uTP && 0x4 | this.ut_hole_punch && 0x8 | this.reachable && 0x10
		return Buffer.alloc(1).writeUInt8(flags)

	}

 }

 function parsePeerContactInfos(compactInfos, nodeID) {

 	compactInfos = compactInfos || []

	var slicer = (buf) => {

		let slices = []
		while(buf.length > 0) {
			slices.push(buf.slice(0, 6))
			buf = buf.slice(6)
		}
		return slices

	}

	return compactInfos.map(info => {

		if(!info)
			return
		
		let parsedHost = info.slice(0,4).toString('hex').match(/.{2}/g).map( num => Number('0x' + num)).join('.') //: host.toString().match(/.{2}/g).map( num => Number(num)).join('.')
		let parsedPort = info.slice(4, 6).readUInt16BE()

		return new Peer(parsedPort, parsedHost)

	})

}

 module.exports = {

 	'PeerInfo' : PeerInfo,
 	'parsePeerContactInfos' : parsePeerContactInfos

 }