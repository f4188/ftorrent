
/*
*  HTTPTracker and UDPTracker
*	
*  
*
*/

const dgram = require('dgram')
const randomBytes = require('crypto').randomBytes
const dns = require('dns')
const request = require('request')
const benDecode = require('bencode').decode
const http = require('http')
const net = require('net')
const querystring = require('querystring')
const url = require('url')

const UDPRes = require('./UDPResponse.js')
const AnnounceResp = UDPRes.AnnounceResp
const RequestResp = UDPRes.RequestResp
const Response = UDPRes.Response

var getAddr = function getAddressFromURL(url) {
	
	const options = { all : false }
	
	return new Promise ((resolve ,reject) => {
		dns.lookup(url, options, (err, address, family) => {
			if(err) 
				reject(err)
			else 
				resolve(address)
		})
	})

}


getUDPSocket = function(port) { //run tests

	let sock = dgram.createSocket('udp4').bind(port)

	return new Promise ( (resolve, reject) => {
		
		sock.on('listening', () => { resolve(sock) } )

	})

}

class HTTPTracker {

	constructor(file, download, url) {

		this.file = file
		this.download = download
		this.url = url.href
		this.host = url.hostname
		this.interval = null
		this.default_timeout = 3000
		this.online = true
		this.timeout = null

	}

	async doAnnounce(port) {

		let percentEscape = (buf) => buf.toString('hex').match(/.{2}/g).map( x => {
			if(parseInt("0x" + x) >= 0x80) {
				return "%" + x
			} else {
				return querystring.escape(Buffer.from( [parseInt("0x" + x)] ).toString('ascii') )
			}
		}).join("") 


		let info = percentEscape(this.file.infoHash)
		let peerID = percentEscape(this.download.peerID)


		var params = { 
			
			port : port,
			uploaded : this.download.stats.uploaded,
			downloaded : this.download.stats.downloaded,
			left : this.download.stats.left,
			compact : 1,
			event : 'started'//this.download.stats.ev

		}

		let resp, decodedResp

		try {

			resp = await this.request(params, info, peerID)
			//decodedResp = benDecode(resp) 
			console.log(resp)
			let {interval, peers, complete, incomplete} = {}// decodedResp || {}
			
			let pIdx = resp.indexOf('5:peers')
			let peerBuf = resp.slice(pIdx + 7)
			let idx = peerBuf.indexOf(':')
			peers = peerBuf.slice(idx + 1).slice(0, -1)

			return {

				'numLeechers' : incomplete || 0,
				'numSeeders' : complete || 0,
				'interval' : this.interval || 600 * 1e3,
				'peerList' : this.getPeerList(peers) || []

			}

		} catch (error) {

			console.log(error)
			return {}

		}

	}

	getPeerList(buf) {

		let numAddrs = Math.floor(buf.length/6);
		let addrs = []
		let addr, host, port

		for(var i = 0; i < numAddrs; ++i ) {
			addr = buf.slice(i * 6, i * 6 + 6)
			host = addr.slice(0,4).map(byte => byte).join('.')
			port = addr.slice(4,6).readUInt16BE()
			addrs.push({ip : host , 'port' : port})
		}

		return addrs;
	}

	request (params, info, peerID) {

		let self = this
		return new Promise( (resolve, reject) => {

			let reqUrl = self.url + "?" + 'info_hash=' + info + "&peer_id=" + peerID + "&" + querystring.stringify(params)

			request({url : reqUrl, encoding : null}, (err, response, body) => {

				if(err)
					reject(err)
				else
					resolve(body)

			})

		})

	}

}

function UDPTracker(url, infoHash, peerID, stats) {

	this.canConnect = true 
	this.canConnectTimeout

	//this.client = sock
	this.address = net.isIP(url.hostname) ?  url.hostname : this.address = null

	//tracker address
	this.host = url.hostname
	this.port = parseInt(url.port)
	this.online = true

	this.infoHash = infoHash
	this.peerID = peerID

	//this.stats = null
	this.stats = stats
	//filled by tracker on announce
	this.numLeechers = null,
	this.numSeeders = null,
	this.interval = null,
	this.peerList = null,
	
	this.transactID = null
	this.connectID = null;
	this.connectIDEx = null;
	this.default_timeout = 3000


}

UDPTracker.prototype._sendAnnounceRequest = function(request) {

	return new Promise( (resolve, reject) => {

		let timeout = setTimeout(() => { reject('timeout') } , this.default_timeout)

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

		let timeout = setTimeout( () => { reject('timeout') } , this.default_timeout)

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

UDPTracker.prototype.doAnnounce = async function(myPort) {

	this.client = await getUDPSocket()

	this.myPort = myPort

	if(!this.canConnect) throw Error('to soon to connect')
	//this.stats = stats

	this.client.on('error', (err) => {
	//	console.log("oops: ${err.stack}"); 
	});
	
	this.transactID = randomBytes(4);

	try {
	
		if(!this.address)
			this.address = await getAddr(this.host)

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

		let peerList = annResp.getPeerList() || []
		this.peerList = peerList.map( pair => {return {'ip': pair[0], 'port' : pair[1]}} )

	} catch (error) {

		this.online = false
		//console.log(error)

	}

	this.online = true

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


module.exports = {

	'UDPTracker' : UDPTracker,
	'HTTPTracker' : HTTPTracker

}