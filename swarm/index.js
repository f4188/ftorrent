
net = require('net')

benDecode = require('bencode').decode 
benEncode = require('bencode').encode

EventEmitter = require('events').EventEmitter

NSet = require('../lib/NSet.js').NSet
ActivePieces = require('./piece.js').ActivePieces
Pieces = require('./piece.js').Pieces

const UDPTracker = require('../tracker/index.js').UDPTracker
const Peer = require('../peer/index.js').Peer

const NUM_REQUESTS_PER_PEER = 5
const NUM_OUTSTANDING_REQS = 200
const NUM_ACTIVE_PIECES = 12
const NUM_CONNECTIONS = 50

var byFreq = (arr, prop) => {

	let freqs = arr.reduce( (freqs, elem) => {
		if(freqs[elem[prop]]) 
			freqs[elem[prop]] ++
		else 
			freqs[elem[peer]] = 1
		
	}, {})

	Object.keys(freqs).forEach(key => {
		freqs[key] /= arr.length
	})

	let freqArray = []

	for(key in Object.keys(freqs)) 
		freqArray.push({key : key, freq : freqs[key]})

	freqArray.sort( (kv1, kv2) => kv1.freq - kv2.freq ) //sort by smallest

	return freqArray //remove freq

}

getUDPSocket = function(port) { //run tests

	let sock = dgram.createSocket('udp4').bind(port)

	return new Promise ( (resolve, reject) => {
		
		sock.on('listening', () => { resolve(sock) } )

	})

}

//currently connected peers
class Swarm extends EventEmitter { //ip list

	constructor(fileMetaData, myIP, myPort) {

		super()

		this.peerStats = new Map()
		this.peers = []
		
		this.fileMetaData = fileMetaData

		this.connecting = []
		this.disconnected = []
		this.defaultTimeout = 3 * 1e3

		
		this.myIP = myIP
		this.myPort = myPort

		let self = this

		this.listeners = {

			'piece_sent' : ( peer ) => {

				let stats = self.peerStats.get(peer.peerID)
				stats.downloadTime = peer.downloadTime//+= uploadTime
				stats.downloadBytes = peer.downloadBytes //+= piecelet.length

			},

			'connected' : ( peer ) => {

				let stats = self.peerStats

				if(!stats.has(peer.peerID)) 
					stats.set(peer.peerID, {'uploadedTime' : 0, 'downloadTime' : 0,'uploadBytes': 0, 'downloadBytes': 0,
						'disconnects' : 0, 'firstConnect' : Date.now()})

			},

			'disconnected' : ( peer ) => {

				let stats = self.peerStats.get(peer.peerID)
				stats.disconnects++
				let pos = self.peers.findIndex( p => p.peerID == peer.peerID )
				console.log('splicing', pos)
				if(pos != -1)
					self.peers.splice(pos, 1)

			},

			'peer_piece' : (peer, index, begin, piecelet, uploadTime) => { 
			
				let stats = self.peerStats.get(peer.peerID)
				stats.uploadTime = this.uploadTime
				stats.uploadBytes = this.uploadBytes

			}

		}

		var sockOpts = {'allowHalfOpen' : false, 'pauseOnConnect' : true}

		//this.UTPserver = uTP.createServer() // ...
		//let self = this

		this.TCPserver = net.createServer(sockOpts, ( sock ) => {
			
			if(self.peers.some( peer => peer.host == sock.remoteAddress && peer.port == sock.remotePort ))
				return
			console.log("connecting", sock.remoteAddress, sock.remotePort)
			let peer = new Peer(this.fileMetaData, self.listeners, sock) //peer owns socket

			peer.on('connected', (peer) => {

				self.emit('new_peer', peer)

			})

		}).listen(this.myPort)

		this.on('new_peer', (peer) => self.peers.push(peer) )

	}

	connectPeer (addr) {
		console.log("try connecting addr:", addr)
		
		
		return new Promise((resolve, reject) => {

			if(this.peers.some( peer => peer.host == addr.host && peer.port == addr.port) || addr.port == this.myPort)
				reject('already connected or myself')

			let peer = new Peer(this.fileMetaData, this.listeners, null, addr)

			let timeout = setTimeout(()=> {
				reject("peer timeout")
			}, this.defaultTimeout)

			peer.on('connected', (peer) => { //after recieving handshake
				clearTimeout(timeout)
				console.log('resolve peer', peer.peerID)
				resolve(peer) 
			})
			
		})
	}

	addPeers (addrs) {
		
		addrs.forEach( async addr => {

			try {

				let peer = await this.connectPeer(addr)
				this.peers.push(peer)

			} catch (error) {

				console.log(error)

			}
			
		})

	}

	piecesByFreq (peerSet) {

		let peers  
		if(peerSet)
			peers = Array.from(peerSet) 

		peers = this.peers

		let have = this.fileMetaData.pieces.has
		let peerPieceList = peers.map( peer => Array.from(peer.pieces).map({ peer : peer, pieceIndex : peers.pieces } ) )
		let dontHavePieceList = peerPieceList.filter( peerPieces => !have(peerPieces.pieces) )

		return byFreq(dontHavePieceList, 'pieceIndex').map( kv => kv.key )

	}

	//set of pieces these peers have
	pieces(peers) { 
		peers = peers || NSet(this.peers)
		let pieces 
		peers.forEach( peer => pieces.union( peer.pieces ) )
		return pieces
	}

	//set of peers that have index piece
	havePiece(index, peers) {
		peers = peers || NSet(this.peers)
		return NSet(Array.from(peers).filter( peer => peer.pieces.have(index)))
	}

	get leechers() {
		return new NSet( this.peers.filter(peer => !peer.isSeeder()) )
	}

	get seeders() {
		return new NSet(this.peers.filter(peer => peer.isSeeder()))
	}

	get optimisticUnchokePeers () {
		return new NSet(this.peers.filter( peer => peer.optUnchoke ))
	}

	get unchokedPeers () {
		return new NSet(this.peers.filter(peer => !peer.choked))
	}

	get chokedPeers () {
		return new NSet(this.peers).difference(this.unchokedPeers)
	}

	get amUnchokedPeers () {
		return new NSet(this.peers.filter(peer => !peer.pChoked))
	}

	get amChokedPeers () {
		return new NSet(this.peers).difference(this.amUnchokedPeers)
	}

	get interestedPeers () {
		return new NSet(this.peers.filter(peer => peer.interested))
	}

	get unInterestedPeers () {
		return new NSet(this.peers).difference(this.interestedPeers)
	}
	 
	get amInterestedPeers () {
		return new NSet(this.peers.filter( peer => peer.pInterested ))
	}

	get amUnInterestedPeers () {
		return new NSet(this.peers).difference(this.amInterestedPeers)
	}

}

function Downloader(myPort, peerID) { //extends eventEmitter

	EventEmitter.call(this)

	this.myIP = ""
	this.myPort = myPort //listen port for new peers
	this.peerID = crypto.randomBytes(20)
	this.port

	this.uLoop = null
	this.optLoop = null
	this.sLoop = null
	this.annLoop = null

	this.activePieces = new Map()
	this.pieces = new Map()

	this.announceUrlList = []
	this.requests = []



	this.fileMetaData = {

		'peerID' : this.peerID,
		'activePieces' : this.activePieces,
		'pieces' : this.pieces, //pieces this peer has
		'announceUrlList' : [],
		'date' : "", 
		'infoHash' : null,
		'metaInfoSize' : null,
		'name' : "",
		'pieceLength' : null,
		'fileLength' : null, 
		'numPieces' : null,
		'pieceHashes' : [],

	}
	
	let self = this, file = this.fileMetaData
	this.stats = {

		get downloaded() { return self.pieces.has(file.numPieces - 1) ? (file.pieces.size - 1) * file.pieceLength +  file.fileLength % file.pieceLength : file.pieces.size * file.pieceLength },
		get left() { return file.fileLength - self.stats.downloaded} ,
		get uploaded() {  },
		ev : 2 //???

	}

	this.swarm = new Swarm(this.fileMetaData, this.myIP, this.myPort)	

	self = this

	this.swarm.listeners['peer_request'] = async (peer, index, begin, length) => {  //fulfill all requests from unchoked peers

			let piece = this.pieces.get(index)
			let buf = await piece.readPiecelet(begin, length)
			peer.piece(index, begin, buf)

	}

	this.swarm.listeners['peer_piece'] = (index, begin, piecelet, uploadTime) => { 

		let piece = this.activePieces.get(index)
		piece.add(index, begin, piecelet)

		self.requests = this.requests.filter( req => req.index != index && req.begin != begin && req.length != piecelet.length)

		if(piece.isComplete && piece.assemble()) { //copy to disk		

			self.activePieces.delete(piece)
			self.fileMetaData.pieces.add(index)
			self.swarm.havePiece(index)
							
			if(this.pieces.size == this.file.numPieces) {
				self.seeding = true
				self.seed()	
				return		
			} 

			self.pieces.set(index, this.Piece(index))
			self.emit('recieved_piece') //call downloadPiece before downloadPiecelet


		} 

		self.emit('recieved_piecelet')
				
	}

	

}

util.inherits(Downloader, EventEmitter)

Downloader.prototype.setMetaInfoFile = async function (metaInfoFilePath) {
	
	if(!fs.existsSync(metaInfoFilePath))
		return

	let metaInfo = fs.readFileSync(metaInfoFilePath)

	let {announce, info} = benDecode(metaInfo)

	this.fileMetaData.announceUrlList = Array.isArray(announce) ? announce.map( url => url.toString()) : [announce.toString()]
	
	return await this.setMetaInfo(benEncode(info))//.catch(err => console.log(err))
	
}

Downloader.prototype.setMagnetUri = function(magnetUri) {

	if(magnetUri.slice(0, 8) != "magnet:?")
		throw new Error()

	let {xt, dn, tr} = querystring.parse(magnetUri.slice(8))
	
	fileMetaData.infoHash = xt.slice(9)
	fileMetaData.name = dn
	fileMetaData.announceUrlList = tr

}

Downloader.prototype.setMetaInfo = async function (info) {

	let fileMetaData = this.fileMetaData

	fileMetaData.metaInfoRaw = info
	fileMetaData.metaInfoSize = info.length
	fileMetaData.infoHash = new Buffer(crypto.createHash('sha1').update(info).digest('hex'), 'hex')
	//fileMetaData.date = ['creation date']

	let m = benDecode(info)
	fileMetaData.name = m.name.toString()
	fileMetaData.pieceLength = m['piece length']
	fileMetaData.pieceHashes = m.pieces.toString('hex').match(/.{40}/g) //string or buffer ???

	if(m.length) {

		fileMetaData.isDirectory = false
		fileMetaData.fileLength = m.length
		fileMetaData.fileLengthList = [fileMetaData.fileLength]
		fileMetaData.path = "./" + fileMetaData.name
		fileMetaData.pathList = [ fileMetaData.path ]
		console.log('pathList',fileMetaData.pathList)

	} else { // if(m.files) {

		fileMetaData.isDirectory = true
		fileMetaData.fileLengthList = m.files.map( pairs => pairs.length )
		fileMetaData.fileLength = fileMetaData.fileLengthList.reduce( (a, b) => a + b, 0)
		fileMetaData.pathList = m.files.map( pairs => pairs.path ).map( name => './' + name)

	}

	fileMetaData.numPieces = Math.ceil( fileMetaData.fileLength / fileMetaData.pieceLength) 

	console.log(fileMetaData)

	this.Piece = Pieces(fileMetaData)
	this.ActivePiece = ActivePieces(fileMetaData)
	for(let idx = 0; idx < fileMetaData.numPieces; idx ++ ) {

		let piece = new this.Piece(idx)
		if(await piece.verify())
			this.pieces.set(idx, piece)

	}

	return this.seeding = this.pieces.size == fileMetaData.numPieces

}

Downloader.prototype.start = async function() {

	//dont start until metaData filled - pieces checked

	let { numLeechers, numSeeders, interval, peerList } = await this.waitUrlAnnounce()
	this.addPeers(peerList)

	if (this.seeding)
		this.seed()
	else
		this.leech()

}

Downloader.prototype.leech = function() {

	//clearInterval(this.sloop)
	this.announceLoop()
	this.annLoop = setInterval((this.announceLoop).bind(this), 300 * 1e3)

	this.on('new_peers', (this.optUnchokeLoop).bind(this))
	this.optLoop = setInterval((this.optUnchokeLoop).bind(this), 30 * 1e3)

	this.on('recieved_piece', (this.downloadPieces).bind(this))
	this.on('recieved_piecelet', (this.downloadPiecelets).bind(this))
	this.on('request_timeout', (this.downloadPiecelets).bind(this))

	this.on('new_peers', (this.unchokeLoop).bind(this))
	this.uLoop = setInterval((this.unchokeLoop).bind(this), 10 * 1e3)

	this.downloadPieces()
	this.downloadPiecelets()

}

Downloader.prototype.seed = function () {

	clearInterval(this.uLoop)
	//clear listeners ??

	//this.announceLoop()
	this.annLoop = setInterval((this.announceLoop).bind(this), 300 * 1e3) 

	this.on('new_peers', (this.optUnchokeLoop).bind(this))
	this.optLoop = setInterval((this.optUnchokeLoop).bind(this), 30 * 1e3)

	this.on('new_peers', (this.seedLoop).bind(this))
	this.sLoop = setInterval((this.seedLoop).bind(this), 30 * 1e3)

}

Downloader.prototype.announceLoop = function() {
	
	this.urlAnnounce()
	this.DHTAnnounce()

}

Downloader.prototype.seedLoop = function() {

		let swarm = this.swarm
		let peerMap = this.swarm.peerStats

		console.log("seed loop:", Date.now())

		swarm.leechers.intersection(swarm.amUnInterestedPeers).intersection(swarm.unchokedPeers).forEach( peer => peer.choke() )

		let interestedPeers = swarm.leechers.intersection(swarm.amInterestedPeers)

		let unchokeCandidates = Array.from(interestedPeers).sort( (p1, p2) => {

			let p1Stats = peerMap.get(p1), p2Stats = peerMap.get(p2)
			return (p1Stats.downloadBytes / p1Stats.downloadBytes) < (p2Stats.downloadBytes / p2Stats.downloadBytes)

		})
		//console.log("unchokeCandidates:", unchokeCandidates)
		for(let numUnchoked = 0; numUnchoked < 12 && unchokeCandidates.length > 0; numUnchoked++) { //maybe add randomness ??

			candidate = unchokeCandidates.shift()
			//console.log("Unchoking:", candidate)
			if(candidate.choked) //if already unchoked do nothing
				candidate.unchoke()

		}

		unchokeCandidates.filter(peer => !peer.choked).forEach( peer => peer.choke())

}

Downloader.prototype.optUnchokeLoop = function() {

		//pick opts unchoke -- 3
		//optUnchoke randomly but give weight to new peers
		//this.optimisticUnchokePeers
		if(this.seeding) {

		}

		let swarm = this.swarm, peerMap = this.swarm.peerStats

		let interestedAndChoked = swarm.leechers.intersection(swarm.interestedPeers).intersection(swarm.chokedPeers)

		swarm.optimisticUnchokePeers.forEach( peer => peer.choke() )
	
		let unchokeCandidates = Array.from(interestedAndChoked).sort( (p1, p2) => (peerMap.get(p1).firstConnect) < (peerMap.get(p2).firstConnect ) )
		//!!!!!!!!! should favor new peers !!!!!!!!!!!

		//chose best and unchoke
		
		for(let numUnchoked = 0; numUnchoked < 3 && unchokeCandidates.length > 0; numUnchoked++) { //maybe add randomness ??

			let randIdx = Math.floor(Math.random() ** 2 * unchokeCandidates.length)
			let candidate = unchokeCandidates[randIdx]
			candidate.unchoke()

		}

}

Downloader.prototype.unchokeLoop = function() {

	let swarm = this.swarm

	//choke any peer that chokes me and is not opt unchoke
	let peers = swarm.leechers.difference(swarm.optimisticUnchokePeers)
	let unchoked = peers.intersection(swarm.unchokedPeers)

	unchoked.intersection(swarm.amChokedPeers).forEach( peer => peer.choke() )
	
	//mutually interested peers -- initially near zero --- must add group (3) peers when sending requests
	let mutuallyInterestedPeers = swarm.leechers.intersection(swarm.interestedPeers).intersection(swarm.amInterestedPeers).difference(swarm.optimisticUnchokePeers)

	let amUnchoked = mutuallyInterestedPeers.intersection(swarm.amUnchokedPeers)

	let peerMap = this.swarm.peerStats
	let unchokeCandidates = Array.from(amUnchoked).sort( (p1, p2) => {

		let p1Stats = peerMap.get(p1), p2Stats = peerMap.get(p2)

		return (p1Stats.uploadBytes/p1Stats.uploadTime) < (p2Stats.uploadBytes/ p2Stats.uploadTime)

	})

	//chose best and unchoke
	let numUnchoked = 0 //amUnchoked.size
	while(numUnchoked < 8 && unchokeCandidates.length > 0) {

		candidate = unchokeCandidates.shift()
		if(candidate.choke) //if already unchoked do nothing
			candidate.unchoke()
		numUnchoked++

	}

	//choke rest of candidates
	unchokeCandidates.filter(peer => !peer.choked).forEach( peer => peer.choke())

	if(numUnchoked < 8) { // 
		//maybe optimistically unchoke more candidates
		//so 8 mutually unchoked and 2 opt unchoked
		//if 8 - k mutually unchoked then 2 + k opt unchoked ??
	}

	//download from amUnchoked peers - includes peers unchoked here 
	//plus group peers that have chosen me as opt unchoke (amOpt) - group (3) plus some group (1) peers

}

//piece downloader - only called when pieces available
Downloader.prototype.downloadPieces = function() {

	peers = this.swarm.amUnchokedPeers.intersection(this.swarm.amInterestedPeers)
	//get resend requests sent to peers that are now choked

	hist = this.swarm.piecesByFreq(peers) //assume peers are representative
	//random from most freq and least freq
	//update interested peers
	while( this.activePieces < 10 && this.pieces.size < this.fileMetaData.numPieces) {
		let randArrIdx = Math.floor(Math.pow(Math.random(), 3))
		let pIndex = hist[randArrIdx]
		console.log(pIndex)
		if(!this.pieces.has(pIndex)) 
			this.activePieces.add(new this.ActivePiece(pIndex))
	}

	//download pieces from mutually unchoked peers in group (1) and amUnchoked peers in group (3)
	//swarm.amUnchokedPeers

}

Downloader.prototype.downloadPiecelets = function() {

	let swarm = this.swarm, requests = this.requests, peers = swarm.amUnchokedPeers.intersection(swarm.amInterestedPeers)
	
	this.requests.filter( request => request.peer.pChoked ).map( req => clearTimeout(req.timeout) )
	this.requests.filter( request => request.peer.pChoked || request.timeout._called ).forEach( req => req.putBack(req) )

	this.requests = this.requests.filter( request => !request.peer.pChoked && !request.timeout_called )

	var reqToPeer = (( peer, req ) => {

		req.timeout = setTimeout(()=>{ this.emit('request_timeout') }, 30 * 1e3)
		this.requests.push(req)

		peer.request(start, begin, length)

	}).bind(this)

	var randReqToPeer = ((peer) => {

		let pieceletReq, randomIndex, piece
		let iters = 0

		let pieces = peer.pieces.intersection(new NSet(this.activePieces.keys())) //swarm.pieces(peers)

		do { //randomly select piece, get piecelet or if no piecelet then repeat

			randomIndex = Math.floor(Math.random() * pieces.size) //maybe favour pieces that idle peers have ??
			piece = Array.from(pieces)[randomIndex]

			pieceletReq = piece.randPieceletReq()
			iters++

		} while (!pieceletReq && iters < this.activePieces.size) //fix infinite loop

		if(iters < this.activePieces.size) //no more piecelets left
			reqToPeer( peer, pieceletReq )

		return iters < this.activePieces.size

	}).bind(this)

	//always interested in these peers
	while(this.requests.length < peers.size * 4 && peers.size > 0) {

		//randomly select peer - more heavily weight idle peers
		let freqArr = byFreq(this.requests, 'peer')
		//remove peers with more than x reqs outstanding
		freqArr = freqArray.filter( req => req.freq > 8 / this.requests.length )
		
		let rand = Math.random()
		let randomPeer = Array.from(peers)[Math.floor(rand * rand * peers.size)]	


		if( randReqToPeer(randomPeer) ) //no more piecelets
			peers = peers.difference(NSet(randomPeer))

	}

	//enough outstanding requests or no piecelets for active pieces ...

}

Downloader.prototype.pruneConn = function() {

	//disconnect peers that are seeding if seeding
	//disconnect peers that refuse requests
	//disconnect peers that never unchoke even when interested (in me)

	//get connections under limit by randomly disconnecting slow peers or infrequent or short time unchokers (1)
	//peer leeching but mutually uninterested

	//average total bandwidth available
	// Z peeri * upload speed < average total bandwidth
	//randomly disconnect one at a time from(1) and monitor download speed - stop when download speed decreases

}

Downloader.prototype.addPeers = function(peers) {
	console.log(peers)
	//apply filters
	if(!peers)
		return


	//if my address discard
	//if already connected discard
	//keep registry of nodes - discard ip if already in registry
	//random connect new peers ? 


	this.swarm.addPeers(peers.map( (tuple) => { return { host : tuple[0], port : tuple[1] } } ))

	this.pruneConn()

	this.emit('new_peers')

}

Downloader.prototype.DHTAnnounce = async function() {

}

Downloader.prototype.urlAnnounce = function() {
	
	let infoHash = this.fileMetaData.infoHash
	let peerID = this.peerID

	getUDPSocket().then( (sock) => {

		this.fileMetaData.announceUrlList.forEach( (announceUrl) => {

			let u = new url.URL(announceUrl)		
			console.log(u)
			if(u.protocol == 'udp:') { //udp tracker		

				let tracker = new UDPTracker(sock, u, infoHash, peerID)
				console.log(tracker)
				tracker.doAnnounce(this.stats, this.myPort).then(resp => this.addPeers(resp.peerList)).catch(err => console.log(err))
			
			} else if (u.protocol == 'http:') {

				//let tracker = new HTTPTracker(sock, announceUrl, infoHash, peerID)
				//let resp await tracker.doAnnounce(this.stats)

			}
		})

	})
}

Downloader.prototype.waitUrlAnnounce = async function() {
	
	let infoHash = this.fileMetaData.infoHash
	let peerID = this.peerID

	let sock = await getUDPSocket() //.then( (sock) => {

	return await Promise.race(this.fileMetaData.announceUrlList.map( async (announceUrl) => {

		let u = new url.URL(announceUrl)		
		console.log(u)
		if(u.protocol == 'udp:') { //udp tracker		

			let tracker = new UDPTracker(sock, u, infoHash, peerID)
			console.log(tracker)
			return await tracker.doAnnounce(this.stats, this.myPort)
		
		} else if (u.protocol == 'http:') {

			//let tracker = new HTTPTracker(sock, announceUrl, infoHash, peerID)
			//let resp await tracker.doAnnounce(this.stats)

		}
	}))

	
}


class Client {

	constructor() {

		this.downloadeders = []
	}

	add() {

		let downloader = new Downloader()

		downloader.setMetaInfoFile()
		this.downloadeders.push(downloadeder)
	}

}

module.exports = {
	'Swarm' : Swarm,
	'Downloader' : Downloader
}

