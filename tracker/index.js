
//var  magnetLink= 'magnet:?xt=urn:btih:32843bef0b20ba67b095ec47d923f90c64bc7787&dn=Wonder.Woman.2017.HDTS.1080P.x264&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969&tr=udp%3A%2F%2Fzer0day.ch%3A1337&tr=udp%3A%2F%2Fopen.demonii.com%3A1337&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Fexodus.desync.com%3A6969'
//const parsedUri = require('magnet-uri').decode(magnetLink)

module.exports = {
	'announce' : announce
}

const dgram = require('dgram')
const randomBytes = require('crypto').randomBytes
const dns = require('dns');

const UDPRes = require('./UDPResponse.js')

function HTTPTracker() {
	
}

function UDPTracker(sock, url, infoHash, peerID) {

	this.canConnect = true 
	this.canConnectTimeout

	this.announce = url
	this.infoHash = infoHash
	this.port = getPortFromUrl(url)
	this.peerID = peerID
	this.stats = null

	//filled by tracker on announce
	this.address = null
	this.numLeechers = null,
	this.numSeeders = null,
	this.interval = null,
	this.peerList = null,
	
	this.client = sock
	this.transactID = null
	this.connectID = null;
	this.connectIDEx = null;
	this.timeoutInterval = 3000
}

UDPTracker.prototype._sendAnnounceRequest = function(request) {
	return new Promise( (resolve, reject) => {
		let timeout = setTimeout(this.timeoutInterval, () => reject('timeout'))
		this.client.once('message', (msg, rsinfo) => {
			clearTimeout(timeout)
			if( Response(msg).getAction() == UDPRes.ANNOUNCE_ACTION)	
				let resp = AnnounceResp(msg)
				if(resp.isValid(this.transactID)) 
					resolve(resp)
			}
			reject("invalid message")
		}
		this.client.send(request)
	}
}
	
UDPTracker.prototype._sendConnectRequest = function(request) {
	return new Promise( (resolve, reject) => {
		let timeout = setTimeout(this.timeoutInterval, () => reject('timeout'))
		this.client.once('message', (msg, rsinfo) => {
			clearTimeout(timeout)
			if( Response(msg).getAction() == UDPRes.CONNECT_ACTION) {
				let resp = RequestResp(msg); 
				if(resp.isValid(this.transactID)) 
					resolve(resp)
			} 
			reject('invalid message')
		}
		this.client.send(request);
	}
}

UDPTracker.prototype.doAnnounce = async function(stats) {

	if(!this.canConnect) throw Error('to soon to connect')
	this.stats = stats

	client.on('error', (err) => {
		console.log("oops: ${err.stack}"); 
	});
	
	this.transactID = randomBytes(4);

	try {
		this.address = await getAddressFromURL(announceUrl)
	} catch (error) {

	}

	try {
		let connReq = _buildConnectReq(this.transactID, this.port, this.address
		connResp = await this._sendConnectRequest(connReq)
		this.connectionID = connResp.getConnectID()
	} catch (error) {

	}

	try {
		let annReq = _buildAnnounceReq(this.transactID, this.port, this.address
		annResp = await this._sendAnnounceRequest(annReq);
		this.numLeechers = annResp.getNumLeechers()
		this.numSeeders = annResp.getNumSeeders()

		this.interval = annResp.getInterval()
		this.canConnect = false
		this.canConnectTimeout = setTimeout(()=> {this.canConnect = true}, this.interval) //seconds or ms ??

		this.peerList = annResp.getPeerList()
	} catch (error) {

	}

	return { 
		'numLeechers' : this.numLeechers,
		'numSeeders' : this.numSeeders,
		'interval' : this.interval,
		'peerList' : this.peerList
	}
}

UDPTracker.prototype = _buildConnectReq() {
	var buf = new Buffer(16)
	buf.writeUIntBE(0x41727101980, 0, 8)
	buf.writeUInt32BE(0x0)
	buf.writeUInt32BE(this.transactID)
	return buf
}

UDPTracker.prototype = _buildAnnounceReq() {
	var key
	var buf = new Buffer(98);
	var ip = 0;
	numWant |= -1;
	buf.writeUIntBE(this.connectID)
	buf.writeUInt32BE(UDPRes.CONNECT_ACTION);
	buf.writeUInt32BE(this.transactID)
	buf.writeUIntBE(this.infoHash, 16, 20)
	buf.writeUIntBE(this.peerID, 36, 20)
	buf.writeUIntBE(this.stats.downloaded, 56, 8)
	buf.writeUIntBE(this.stats.left, 64, 8);
	buf.writeUIntBE(this.stats.uploaded, 72, 8)
	buf.writeUInt32BE(this.stats.ev);
	buf.writeUInt32BE(ip);
	buf.writeUInt32BE(key) //?
	buf.writeUInt32BE(numWant)
	buf.writeUInt16BE(this.port)
	return buf;
}


var getPort = function getPortFromURL(url) {
	return parseInt(url.split(":")[2]);	
}

var getAddr = function getAddressFromURL(url) {
	
	const options = {
		//family: 6,
		options.all = false;
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


