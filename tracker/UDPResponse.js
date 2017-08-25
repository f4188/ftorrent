
const RESQUEST_ACTION = 0
const ANNOUNCE_ACTION = 1

//Base Object
class Response {
	constructor(rsp) {
		this.rsp = rsp;
		this.action = this.getAction();
	}
	
	getAction() {
		return this.rsp.slice(0,4).readUInt32BE() == 1 ? ANNOUNCE_ACTION : RESQUEST_ACTION
	}
	
	getTransactID() {
		return this.rsp.slice(4,8)
	}
	
	length() {
		return this.rsp.length 
	}

}

//Connect Response
class RequestResp extends Response {
	constructor(rsp) {
		super(rsp)
	}

	isValid(transactID) {
		return this.length() == 16 & this.getTransactID().equals(transactID)
	}

	getConnectID() {
		return this.rsp.slice(8,16)
	}
}

//Announce Response
class AnnounceResp extends Response {

	constructor(rsp) {
		super(rsp)
	}

	isValid(transactID) {
		return this.length() >= 20 & this.getTransactID().equals(transactID)
	}
	
	getPeerList() {
		//if(!this.action) throw new Error()
		let numAddrs = (this.length()-20)/6;
		let addrs = []
		let addr, host, port

		for(var i = 0; i < numAddrs; ++i ) {

			addr = this.rsp.slice(20 + i * 6, 20 + i * 6 + 6)
			host = addr.slice(0,4).map(bytes => bytes.toString()).join('.')
			port = addr.slice(4,6).readUInt16BE()
			addrs.push([host, port])
		}

		return addrs;
	}

	getInterval() {
		this.rsp.readUInt32BE(8)
	}

	getNumLeechers() {
		this.rsp.readUInt32BE(12)
	}	

	getNumSeeders() {
		this.rsp.readUInt32BE(16)
	}

}

module.exports = {

	'AnnounceResp' : AnnounceResp,
	'RequestResp' : RequestResp,
	'Response' : Response,
	'CONNECT_ACTION' : RESQUEST_ACTION,
	'ANNOUNCE_ACTION' : ANNOUNCE_ACTION
	
}
