
//var  magnetLink= 'magnet:?xt=urn:btih:32843bef0b20ba67b095ec47d923f90c64bc7787&dn=Wonder.Woman.2017.HDTS.1080P.x264&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969&tr=udp%3A%2F%2Fzer0day.ch%3A1337&tr=udp%3A%2F%2Fopen.demonii.com%3A1337&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Fexodus.desync.com%3A6969'
//const parsedUri = require('magnet-uri').decode(magnetLink)

module.exports = {

	'UDPTracker' : UDPTracker

}

const dgram = require('dgram')
const randomBytes = require('crypto').randomBytes
const dns = require('dns');

const UDPRes = require('./UDPResponse.js')
const AnnounceResp = UDPRes.AnnounceResp
const RequestResp = UDPRes.RequestResp
const Response = UDPRes.Response

var getAddr = function getAddressFromURL(url) {
	
	const options = {
		//family: 6,
		all : false
		//hints: dns.ADDRCONFIG | dns.V4MAPPED,
	}
	
	return new Promise ((resolve ,reject) => {
		dns.lookup(url, options, (err, address, family) => {
			if(err) 
				reject(err)
			else 
				resolve(address)
		})
	})
// addresses: [{"address":"2606:2800:220:1:248:1893:25c8:1946","family":6}]
}

function HTTPTracker() {
	
}

function UDPTracker(sock, url, infoHash, peerID) {

	this.canConnect = true 
	this.canConnectTimeout

	this.client = sock
	this.address = net.isIP(url.hostname) ?  url.hostname : this.address = null

	//tracker address
	this.host = url.hostname
	this.port = parseInt(url.port)

	this.infoHash = infoHash
	this.peerID = peerID

	this.stats = null

	//filled by tracker on announce
	this.numLeechers = null,
	this.numSeeders = null,
	this.interval = null,
	this.peerList = null,
	
	this.transactID = null
	this.connectID = null;
	this.connectIDEx = null;
	this.timeoutInterval = 3000

}

UDPTracker.prototype._sendAnnounceRequest = function(request) {

	return new Promise( (resolve, reject) => {

		let timeout = setTimeout(() => { reject('timeout') } , this.timeoutInterval)
		this.client.once('message', (msg, rsinfo) => {
			
			if( new Response(msg).getAction() == UDPRes.ANNOUNCE_ACTION) {

				clearTimeout(timeout)
				let resp = new AnnounceResp(msg)
				if(resp.isValid(this.transactID)) 
					resolve(resp)
				else
					reject("invalid message")

			}
			
		})

		this.client.send(request, this.port, this.address)

	} )
}
	
UDPTracker.prototype._sendConnectRequest = function(request) {

	return new Promise( (resolve, reject) => {

		let timeout = setTimeout( () => { reject('timeout') } , this.timeoutInterval)

		this.client.once('message', (msg, rsinfo) => {
		
			if( new Response(msg).getAction() == UDPRes.CONNECT_ACTION) {

				clearTimeout(timeout)
				let resp = new RequestResp(msg); 
				if(resp.isValid(this.transactID)) 
					resolve(resp)
				else
					reject('invalid message')
			} 

		})

		this.client.send(request, this.port, this.address)

	})

}

UDPTracker.prototype.doAnnounce = async function(stats, myPort) {

	this.stats = stats
	this.myPort = myPort

	if(!this.canConnect) throw Error('to soon to connect')
	this.stats = stats

	this.client.on('error', (err) => {
		console.log("oops: ${err.stack}"); 
	});
	
	this.transactID = randomBytes(4);

	
	if(!this.address)
		this.address = await getAddr(this.host)

	try {

		let connReq = this._buildConnectReq()
		connResp = await this._sendConnectRequest(connReq)
		this.connectID = connResp.getConnectID()

		let annReq = this._buildAnnounceReq()
		annResp = await this._sendAnnounceRequest(annReq)
		this.numLeechers = annResp.getNumLeechers()
		this.numSeeders = annResp.getNumSeeders()

		this.interval = annResp.getInterval()
		this.canConnect = false
		this.canConnectTimeout = setTimeout( (()=> { this.canConnect = true }).bind(this), this.interval) //seconds or ms ??

		this.peerList = annResp.getPeerList()

	} catch (error) {
		console.log(error)
	}

	return { 

		'numLeechers' : this.numLeechers,
		'numSeeders' : this.numSeeders,
		'interval' : this.interval,
		'peerList' : this.peerList

	}

}

UDPTracker.prototype._buildConnectReq = function() {

	var buf = new Buffer(16)
	Buffer.from([0x0, 0x0, 0x4, 0x17, 0x27, 0x10, 0x19, 0x80]).copy(buf, 0, 0, 8)
	buf.writeUInt32BE(0x0, 8)
	this.transactID.copy(buf, 12, 0, 4)
	return buf

}

UDPTracker.prototype._buildAnnounceReq = function() {

	var key
	var buf = new Buffer(98);
	var ip = 0;
	var numWant = -1;
	this.connectID.copy(buf, 0, 0, 8)
	buf.writeUInt32BE(UDPRes.ANNOUNCE_ACTION, 8)
	this.transactID.copy(buf, 12, 0, 4)
	this.infoHash.copy(buf, 16, 0, 20)
	this.peerID.copy(buf, 36, 0, 20)
	buf.writeUInt32BE(Math.floor(this.stats.downloaded / 2**32), 56)
	buf.writeUInt32BE(this.stats.downloaded % 2**32, 56 + 4)
	buf.writeUInt32BE(Math.floor(this.stats.left / 2**32), 64 )
	buf.writeUInt32BE(this.stats.left % 2**32, 64 + 4)
	buf.writeUInt32BE(Math.floor(this.stats.uploaded) / 2**32, 72)
	buf.writeUInt32BE(this.stats.uploaded % 2**32, 72 + 4)
	buf.writeUInt32BE(this.stats.ev, 80); //event - 0:none, 1:complete, 2:started, 3:stopped
	buf.writeUInt32BE(ip, 84);
	buf.writeUInt32BE(key, 88) //?
	buf.writeInt32BE(numWant, 92)
	buf.writeUInt16BE(this.myPort , 96)
	return buf

}

