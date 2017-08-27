
class PeerInfo {

 	constructor(port, host, nodeID) {
 		this.ipv6 = Buffer.isBuffer(host) && host.length == 16 || typeof host == 'string' && host.length == 16 * 8 + 7
 		this.port = port
 		this.host = host
 		this.nodeID = nodeID //owns this node 
 		
 		this.encrypt = false
 		this.upload_only = false
 		this.uTP = false
 		this.ut_hole_punch = false
 		this.reachable = true
 	}

 	getContactInfoString() { //return buffer

 		/*
 		if(!ipv6) {
			let contactInfo = Buffer.alloc(6)
			let host
			if(typeof this.host == 'string')
				host = this.host.split('.')
			contactInfo.writeUInt32BE(this.host, 0)
			contactInfo.writeUInt16BE(this.port, 4)
			return contactInfo
		} else {
			//let contactInfo = Buffer.alloc(18)
			//contactInfo.writeUInt32BE(this.host, 0)
			let host
			if(typeof this.host == 'string' && this.host.length == 16 * 8 + 7)
				host = host.split(':').join("") 
			let contactInfoHost = Buffer.from(host)
			let contactInfoPort = Buffer.alloc(2)
			contactInfoPort.writeUInt16BE(this.port)
			return Buffer.concat([contactInfo, contactInfoPort])
			//return contactInfo
		}*/

		//if(!ipv6) {
		//	let host = this.host.split('.')
		//}
		return this.host + this.port

	}

	getContactInfoBuffer() {
		
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

 module.exports = {
 	'PeerInfo' : PeerInfo
 }