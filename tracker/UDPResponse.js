
module.exports = {
	'AnnounceResp' : AnnounceResp,
	'RequestResp' : RequestResp,
	//'getAction' : getAction,
	'CONNECT_ACTION' : RESQUEST_ACTION,
	'ANNOUNCE_ACTION' : ANNOUNCE_ACTION
}

const RESQUEST_ACTION = 0
const ANNOUNCE_ACTION = 1

//Connect Response
class RequestResp extends Response() {
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
class AnnounceResp extends Response() {

	constructor(rsp) {
		super(rsp)
	}

	isValid(transactID) {
		return this.length() >= 20 & this.getTransactID().equal(transactID)
	}
	
	getAddrList() {
		if(!this.action) throw new Error()
		numAddr = (this.length()-20)/6;
		addrs = []
		let addr, host, port
		for(var i = 0; i < numAddrs; ++i ) {
			addr = rsp.slice(20 + i * 6, 20 + i * 6 + 6)
			host = addr.slice(0,4).map(bytes=>bytes.toString()).join('.')
			port = addr.slice(4,6).readUInt16()
			addrs.push([host, port])
		}
		return addrs;
	}

	getTimeoutInterval() {}

	numleechers() {}	

	numseeders() {}
}

//Base Object
class Response() {
	constructor(rsp) {
		this.rsp = rsp;
		this.action = this.getAction();
	}
	
	getAction = function() {
		return this.rsp.slice(0,4).readUInt32BE() == 1 ? ANNOUNCE_ACTION : RESQUEST_ACTION
	}
	
	getTransactID = function() {
		return this.rps.slice(4,8)
	}
	
	length() {
		return this.rsp.length 
	}

}
