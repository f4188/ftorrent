
module.exports = {
	'Swarm' : Swarm,
	'Downloader' : Downloader
}

net = require('net')

//currently connected peers
function Swarm(fileMetaData) { //ip list

	this.peers = []
	
	this.fileMetaData = fileMetaData

	this.connecting = []
	this.disconnected = []

	this.listeners = {

		'peer_request' : (index, begin, length, peer) => { 
			let start = request.index * piece_length + request.begin
			let end = request.index * piece_length + request.begin + request.length
			let piece = fs.createReadStream(this.path, {'start': start, 'end' : end})
			piece.pipe(peer) // piece -> peer
 		},

		'peer_piece' : (index, begin, length, peer) => { 
			let start = index * this.fileMetaData.pieceLength + begin
			let piece = fs.createWriteStream(this.path, {'start': start, 'mode':'r+'})
			peer.pipe(piece) // peer -> piece
		} 

	}

	this.sockOpts = {'allowHalfOpen' : false, 'pauseOnConnect' : true}

	this.UTPserver = uTP.createServer() // ...

	this.TCPserver = net.createServer(sockOpts, ( sock ) => {

		let peer = new Peer(this.fileMetaData, this.listeners, sock) //peer owns socket
		
		self = this

		peer.on('connected', () => {
			self.emit('new_peer', peer)
		})

	}).listen()

}

Swarm.prototype.connectPeer = function (addr) {
	
	return new Promise((resolve, reject) => {

		let peer = new Peer(this.fileMetaData, this.listeners, null, addr)

		let timeout = setTimeout(()=> {
			reject("peer timeout")
		}, this.defaultTimeout)

		peer.on('connected', () => { //after recieving handshake
			clearTimeout(timeout)
			resolve(peer) 
		})
		
	} )
}

Swarm.prototype.connectManyPeers = function (addrs) {
	return addrs.map( (addr) => connectPeer(addr) )
}

Swarm.prototype.addPeers = function (addrs) {
	connectManyPeers.forEach( async (promise) => {
		try {
			peer = await promise
			this.peers.push(peer)
		} catch (error) {

		}
		// do something
		//if bad peer discard
		//
	})
}

Swarm.prototype.newPeers = function () {

}

Swarm.prototype.piecesByFreq = function () {

	let freq = {}

	this.peers.reduce((peer, freq) => {
		peer.pieces.forEach(piece => {
			if(freq[piece])
				freq[piece]++
			else 
				freq[piece] = 1
		})
		return freq
	}, freq)

	Object.keys(freq).forEach(key => {
		freq[key] /= peers.length
	})

	return freq

}

Swarm.prototype.unChokedPeers = function () {
	return this.peers.filter(peer => !peer.choke)
}

Swarm.prototype.amUnchokedPeers = function () {
	return this.peers.filter(peer => !peer.pChoke)
}



let unChoked = this.peers.filter(peer => !peer.choke)
		let amUnchoked = this.peers.filter(peer => peer.pChoke) //remove idle peers and peers amchoked peers
		let amUnchokedAndIdle = amUnchoked.filter(peer => peer.idle) //currently fulfilling request or having request fulfilled

		candidates = amUnchokedAndIdle.sort( (p1, p2) => p1.uploadRate >= p2.uploadRate)


function Downloader() {

	this.pieces = []

	this.unchoked = []
	this.interested = []
	this.peerID 
	this.port
	//this.amUnchoked = this.swarm.amUnchoked
	//this.amInterested = this.swarm.amInterested

	this.announceUrlList = []

	/*
	this.file  = {
		'infoHash' : 0,
		'name' : , //name of file
		'piece_length' : , //piece length
		'pieces' : , //hashes of pieces
		'length' : 0, //length of file in bytes
	}*/

	this.fileMetaData = {
		'announceUrlList' : "",
		'date' : "", 
		'infoHash' : null,
		'info' : null, //for metaDataExchange - must be buffer
		'infoSize' : 0,
		'name' : "",
		'pieceLength' : null,
		'fileLength' : null, //num pieces = fileLength / pieceLength
		'numPieces' : null,
		'pieceHashes' : [],
		'pieces' : [] //pieces this peer has
	}

	this.file = this.fileMetaData
	
	this.stats = {
		'downloaded': 0,
		'left': 0,
		'uploaded': 0,
		'ev': null //???
	}

	this.pieces = this.fileMetaData.pieces

	this.swarm = new Swarm(this.fileMetaData)

}

Downloader.prototype.setupWithMetaInfoFile = function(metaInfoFilePath) {
	//is path
	let metaInfo
	if(fs.existsSync(metaInfoFilePath)) {
		metaInfo = bdecode(fs.readFileSync(metaInfoFilePath))
	}

	let {announceUrlList, date, info} = metaInfo

	this.metaInfo 

	/*
	this.fileMetaData = {
		'announceUrlList' : "",
		'date' : "", 
		'infoHash' : null,
		'name' : "",
		'pieceLength' : null,
		'fileLength' : null, //num pieces = fileLength / pieceLength
		'pieceHashes' : [],
	}*/

	let fileMetaData = this.fileMetaData

	let m = info

	fileMetaData.announceUrlList = announceUrlList
	//fileMetaData.metaDataSize = null
	fileMetaData.date = date
	fileMetaData.name = m.name
	fileMetaData.pieceLength = m.piece_length
	fileMetaData.fileLength = m.length
	fileMetaData.pieceHashes = m.pieces.toString().match(/.{8}/) //string or buffer ???

}

Downloader.prototype.setupWithMagnetUri = function(magnetUri) {

	//use metaDataEx to acquire info 
	//do announce and get peers


}

Downloader.prototype.checkDisk = function() {

}

//start or resume download or seed
Downloader.prototype.start = function() {
	//read torrent file or parse magnet link
	//this.infoHash

	//on startup check disk
	//if file complete seed
	//if file incomplete, verify pieces, begin leeching


	//announce to trackers
	//get peer lists
	if(this.swarm) { //no peers
		this.peerLists = this.announce().map( x => x.peerList ) 
	}

	//setup swarm
	this.swarm.connectPeers()

	//wait for new peers
	
	//which peers to send interested msg to
	//which peers to unchoke
	//which requests to send

	this.pieceQueue = []

	this.optUnchoke = null

	//chose peers to unchoke - every 10 sec

	var downloadLoop = () => {

		/* this.choked
		* this.unchoked
		*

		sort peers that have unchoked me by upload rate
		filter idle peers 
		select peers with highest upload rate - unchoke
		if not enough unchoke peers with high upload rate that are interested 
		if no upload rate history unchoke random peers that are interested
		or if no interested 

		*/

		//sort by upload rate
		

		//chose best cand and put in this.unchoke
		while() {

			candidate = candidates.shift()
			candidate.unchoke()
			this.unchoked.push(candidate)

		}

		//update pieceQueue - choose next pieces
		hist = this.swarm.piecesByFreq()
		//random from most freq and least freq
		//update interested peers
		this.pieceQueue

		//push requests to peers


	}

	var optUnchokeLoop = () => {

	}

	this.downLoop = setInterval(downloadLoop, 10 * 1e3)

	//chose new optimistic unchoke every 30 sec
	this.optLoop = setInterval(optUnchokeLoop, 30 * 1e3)

}

Downloader.prototype.DHTAnnounce = async function() {

}

//infoHash, peerID, downloaded, left, uploaded, ev, IPAddress, key, numWant, port
//transactID, infoHash, peerID, stats, ip, key, numWant, port
Downloader.prototype.urlAnnounce = async function() {
	//stats = {downloaded, left, uploaded, ev}
	
	let sock = dgram.createSocket('udp4').bind()
	sock.on('listening') //tracker announce)

	let infoHash = this.file.infoHash
	let peerID = this.peerID

	return  this.announceUrlList.map( async (announceUrl) => {		

		if(announceUrl.slice(0,6) == 'udp://') { //udp tracker			
			let tracker = new UDPTracker(sock, announceUrl, infoHash, peerID)
			return await tracker.doAnnounce(this.stats) 

		} else if (announceUrl.slice(0,7) == 'http://') {
			let tracker = new HTTPTracker(sock, announceUrl, infoHash, peerID)
			return await tracker.doAnnounce(this.stats)
		}
	})
}

class Torrent {

	constructor() {

		this.downloader = new Downloader()

	}

}















