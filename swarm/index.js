
net = require('net')

benDecode = require('bencode').decode 
benEncode = require('bencode').encode

EventEmitter = require('events').EventEmitter

NSet = require('../lib/NSet.js').NSet
Pieces = require('./piece.js').Pieces

const UDPTracker = require('../tracker/index.js').UDPTracker
const Peer = require('../peer/index.js').Peer

//constants
//outstanding requests per peer
//number of outstanding requests
//number of active pieces
const NUM_REQUESTS_PER_PEER = 5
const NUM_OUTSTANDING_REQS = 200
const NUM_ACTIVE_PIECES = 12
const NUM_CONNECTIONS = 50

// peer requests = [{peer, ... }, ... ]
// peer pieces = [ { - , pieceIndex}, ... ]

var byFreq = (arr, prop) => {

	let freqs = arr.reduce( (freqs, elem) => {
		if(freqs[elem[prop]]) {
			freqs[elem[prop]] ++
		} else {
			freqs[elem[peer]] = 1
		}
	}, {})

	Object.keys(freqs).forEach(key => {
		freqs[key] /= arr.length
	})

	let freqArray = []

	let keys = Object.keys(freqs)

	for(key in keys) {
		freqArray.push({key : key, freq : freqs[key]})
	}

	freqArray.sort( (kv1, kv2) => kv1.freq > kv2.freq ) //sort by smallest

	return freqArray //remove freq

}

//currently connected peers
class Swarm extends EventEmitter { //ip list

	constructor(fileMetaData, myIP, myPort) {

		super()

		this.peerIDs = new Map()
		this.peers = []
		//this.optPeers = []
		
		this.fileMetaData = fileMetaData

		this.connecting = []
		this.disconnected = []
		this.defaultTimeout = 3 * 1e3

		this.listeners = {}
		this.myIP = myIP
		this.myPort = myPort

		var sockOpts = {'allowHalfOpen' : false, 'pauseOnConnect' : true}

		//this.UTPserver = uTP.createServer() // ...
		let self = this

		this.TCPserver = net.createServer(sockOpts, ( sock ) => {

			sock.on('data', (data) => console.log(data, data.length))
			
			//sock.remote.address, sock.remote.port
			if(this.peers.some( peer => peer.host == sock.remoteAddress && peer.port == sock.remotePort ))
				return

			console.log('got connection', self.myPort, sock.remotePort)

			let peer = new Peer(this.fileMetaData, self.listeners, sock) //peer owns socket

			peer.on('connected', () => {
				self.emit('new_peer', peer)
			})

		}).listen(this.myPort)

		this.on('new_peer', (peer) => self.peers.push(peer) )

		//Object.defineProperty

	}

	connectPeer (addr) {
		
		return new Promise((resolve, reject) => {

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
		
		console.log("Adding peers", addrs)

		//addrs.map( (addr) => this.connectPeer(addr) ).forEach( async (promise) => {
		addrs.forEach( async addr => {

			try {

				let peer = await this.connectPeer(addr)
				this.peers.push(peer)

			} catch (error) {

				//console.log(peer)
				console.log(error)

			}
			// do something
			//if bad peer discard
			//
		})

	}

	newPeers () {

	}

	piecesByFreq (peerSet) {

		let peers  
		if(peerSet)
			peers = Array.from(peerSet) 

		peers = this.peers

		//return this.byFreq(peers)
		let have = this.fileMetaData.pieces.has
		let peerPieceList = peers.map( peer => Array.from(peer.pieces).map({ peer : peer, pieceIndex : peers.pieces } ) )
		let dontHavePieceList= peerPieceList.filter( peerPieces => !have(peerPieces.pieces) )

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

	//havePiece (pieceIndex) {
	//	this.peers.forEach( peer =>  peer.have(pieceIndex) )
	//}

	get leechers() {
		return new NSet(this.peers.filter(peer => !peer.isSeeder()))
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

	/*get idlePeers () {
		return NSet(this.peers.filter( peer => peer.idle ))
	}

	get activePeers () {
		return new NSet(this.peers).difference(this.idle())
	}*/

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

function Downloader(myPort) { //extends eventEmitter

	//this.pieces = new Set()

	EventEmitter.call(this)

	this.myIP = ""
	this.myPort = myPort //listen port for new peers
	this.peerID = crypto.randomBytes(20)
	this.port

	this.uLoop = null
	this.optLoop = null
	this.sLoop = null

	this.activePieces = new Set()
	this.pieces = new Map()

	this.announceUrlList = []
	this.requests = []

	this.fileMetaData = {
		'peerID' : this.peerID,
		'activePieces' : this.activePieces,
		'announceUrlList' : [],
		'date' : "", 
		'infoHash' : null,
		//'raw' : null,
		'metaInfoSize' : 0,
		//'info' : null, //for metaDataExchange - must be buffer
		//'infoSize' : 0,
		'name' : "",
		'pieceLength' : null,
		'fileLength' : null, 
		'numPieces' : null,
		'pieceHashes' : [],
		'pieces' : this.pieces //pieces this peer has
	}

	this.Piece = Pieces(this.fileMetaData)
	
	let file = this.fileMetaData
	
	self = this
	this.stats = {

		get downloaded() { return self.pieces.has(file.numPieces - 1) ? (file.pieces.size - 1) * file.pieceLength +  file.fileLength % file.pieceLength : file.pieces.size * file.pieceLength },
		get left() { return file.fileLength - self.stats.downloaded} ,
		get uploaded() {  },
		ev : 2 //???

	}

	this.swarm = new Swarm(this.fileMetaData, this.myIP, this.myPort)	



	this.swarm.listeners = {

		'connected' : (( peer ) => {

			let peerIDs = this.swarm.peerIDs, peerID = peer.peerID

			if(!peerIDs.has(peerID)) 
				peerIDs.set(peerID, {'uploadedTime' : 0, 'downloadTime' : 0,'uploadBytes': 0, 'downloadBytes': 0,
					'disconnects' : 0, 'firstConnect' : Date.now()})

		}).bind(this),

		'disconnected' : (( peer ) => {

			let peerStats = this.swarm.peerIDs.get(peer.peerID)
			peerStats.disconnects++
			let pos = this.peers.findIndex(peer)
			if(pos != -1)
				this.peers.splice(pos, 1)

		}).bind(this),

		'peer_request' : ((index, begin, length, peer) => {  //fulfill all requests from unchoked peers

			let start = index * this.fileMetaData.pieceLength + begin, end = index * this.fileMetaData.pieceLength + begin + length - 1
			let pieceStream = fs.createReadStream(this.path, {'start': start, 'end' : end})

			pieceStream.on('readable', () => {

				let piece = pieceStream.read(length)

				if(piece != null) 
					peer.piece(index, begin, piece)

			})

		}).bind(this),

		'piece_sent' : (peer) => {

			let peerStats = this.swarm.peerIDs.get(peer.peerID)
			peerStats.downloadTime = peer.downloadTime//+= uploadTime
			peerStats.downloadBytes = peer.downloadBytes //+= piecelet.length

		},

		'peer_piece' : ((index, begin, piecelet, peer, uploadTime) => { 

			let start = index * this.fileMetaData.pieceLength + begin
			let piece = this.pieces.get(index)
			piece.add(index, begin, piecelet)

			let peerStats = this.swarm.peerIDs.get(peer.peerID)
			peerStats.uploadTime = peer.uploadTime//+= uploadTime
			peerStats.uploadBytes = peer.uploadBytes//+= piecelet.length

			this.requests = this.requests.filter( req => req.index == index && req.begin == begin && req.length == piecelet.length)

			if(piece.isComplete && piece.assemble()) { //copy to disk		

				this.activePieces.delete(piece)
				this.fileMetaData.pieces.add(index)
				this.swarm.havePiece(index)
								
				if(this.pieces.size == this.file.numPieces) {
					//done
					//begin seeding
					//clear downloadPieceLoop
					//downloadPieceletLoop
					//seedLoop()
					//setInterval(seedLoop, 30 * 1e3)
					return
				}				

				this.pieces.set(index, null)
				this.emit('recieved_piece') //call downloadPiece before downloadPiecelet

			} 

			this.emit('recieved_piecelet')
					
		}).bind(this)

	}

}

util.inherits(Downloader, EventEmitter)

Downloader.prototype.setupWithMetaInfoFile = function (metaInfoFilePath) {
	
	let metaInfo
	if(fs.existsSync(metaInfoFilePath))
		metaInfo = fs.readFileSync(metaInfoFilePath)
	else 
		return

	let {announce, info} = benDecode(metaInfo)

	//this.metaInfo 

	let fileMetaData = this.fileMetaData

	let m = info

	fileMetaData.infoHash = new Buffer(crypto.createHash('sha1').update(benEncode(info)).digest('hex'), 'hex')
	fileMetaData.metaInfoRaw = metaInfo
	fileMetaData.announceUrlList = Array.isArray(announce) ? announce.map( url => url.toString()) : [announce.toString()]
	fileMetaData.metaInfoSize = metaInfo.length
	//fileMetaData.date = ['creation date']
	fileMetaData.name = m.name.toString()
	fileMetaData.pieceLength = m['piece length']
	fileMetaData.fileLength = m.length
	fileMetaData.pieceHashes = m.pieces.toString('hex').match(/.{40}/g) //string or buffer ???
	fileMetaData.numPieces = Math.ceil(fileMetaData.fileLength / fileMetaData.pieceLength) 

	this.path = "./" + fileMetaData.name

	if(m.length) {
		//single file
		fileMetaData.isDirectory = false

	} else if(m.files) {

		fileMetaData.isDirectory = true
		fileMetaData.fileList = m.files

	}


}

Downloader.prototype.setupWithMagnetUri = function(magnetUri) {

	//use metaDataEx to acquire info 
	//do announce and get peers
	//parse uri
	//get infohash
	
	fileMetaData.infoHash = infoHash


}

Downloader.prototype.checkDisk = async function() {

	if(!this.fileMetaData.isDirectory) {
		return await this.checkFile(this.path, 0)
	}

}

Downloader.prototype.checkFile = async function(path, offSet) {

	//let path  this.fileMetaData.name
	let size, stats
	let pieceLength = this.fileMetaData.pieceLength
	let lastPieceLength = this.fileMetaData.fileLength % this.pieceLength

	if(fs.existsSync(path))
		stats = await this.getFileStats(path)

	size = stats.size
	
	console.log('size', size)

	var readStreamFunc = async (pieceStream, pieceLength) => {

		return new Promise( (resolve, reject) => {

			pieceStream.on('readable', () => { 
				let data = pieceStream.read(pieceLength)  
				if(data)
					resolve(data) 
			})

		})

	}

	let pieces = this.pieces// new Set()
	let haveAtMostNumPieces = Math.ceil(size / pieceLength)

	let start = 0, end = pieceLength
	let buf
	
	for(let pieceIndex = 0; pieceIndex < haveAtMostNumPieces; pieceIndex++) {
	
		let pieceStream = fs.createReadStream(path, {start : start , end : end})
		let pLength = pieceLength

		if(pieceIndex == this.fileMetaData.numPieces - 1)
			pLength = lastPieceLength
		
		buf = await readStreamFunc(pieceStream, pLength)

		let hash = crypto.createHash('sha1').update(buf).digest('hex')
		if(hash == this.fileMetaData.pieceHashes[pieceIndex + 0])
			pieces.set(pieceIndex, hash)

		start += pieceLength
		end += pieceLength

	}

	return this.pieces.size == this.fileMetaData.numPieces 

}

Downloader.prototype.getFileStats = function (path) {

	return new Promise( (resolve, reject) => {
		fs.stat(path, (err, stats) => resolve(stats))
	})

}

//start or resume download or seed
Downloader.prototype.start = async function() {

	//read torrent file or parse magnet link
	
	//on startup check disk
	//if file complete, verify, then seed
	//if file incomplete, verify pieces, begin leeching
	this.seeding = await this.checkDisk(this.path, 0)  //discard corrupt pieces


	console.log('Checked disk. Have file:', this.seeding)
	let peers
	let resps 
	//setup swarm
	if(!this.fileMetaData.announceUrlList) { //dht announce

		//peers = dht.announce(this.fileMetaData.infoHash)
		this.DHTAnnounce()
		
	} else { 
		
		//while(!peers) {
			console.log('announcing')
			//resps = 
			
			peers = await this.urlAnnounce()
			
			
			peers = peers[0].peerList.filter( elem => elem[1] != this.myPort )
			console.log("peers", peers, this.myPort)

		//}
	} 

	if(!peers) {
		//oh shit
	}

	this.swarm.addPeers(peers.map( (tuple) => { return { host : tuple[0], port : tuple[1] } } ))

	if(this.seeding)
		this.seed()
	else
		this.leech()

}

Downloader.prototype.leech = function() {

	clearInterval(this.sloop)

	this.optUnchokeLoop()
	this.optLoop = setInterval((this.optUnchokeLoop).bind(this), 30 * 1e3)

	this.on('recieved_piece', (this.downloadPiece).bind(this))
	this.on('recieved_piecelet', (this.downloadPiecelets).bind(this))
	this.on('request_timeout', (this.downloadPiecelets).bind(this))

	this.unchokeLoop()
	this.uLoop = setInterval((this.unchokeLoop).bind(this), 10 * 1e3)

	//called again by listeners
	this.downloadPiece()
	this.downloadPiecelets()

}

Downloader.prototype.seed = function () {

	clearInterval(this.uLoop)
	//clear listeners ??

	this.optUnchokeLoop()
	this.optLoop = setInterval((this.optUnchokeLoop).bind(this), 30 * 1e3)

	this.seedLoop()
	this.sLoop = setInterval((this.seedLoop).bind(this), 30 * 1e3)

}

Downloader.prototype.pruneConn = function() {
	//add new connections
		//get peers from dht ?
		//peerex

		//prune connections
	//discover more peers
	//urlAnnounce()
	//DHTAnnounce
	//Peerexchange


	//disconnect lowest upload rate ???

}


Downloader.prototype.seedLoop = function() {

		let swarm = this.swarm
		let peerMap = this.swarm.peerIDs

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

		let swarm = this.swarm, peerMap = this.swarm.peerIDs

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

	/* :::: for leechers ::::

	(1) only mutually interested 
	unamchoked --- unchoked - (if active do nothing - if idle) unchoke by upload -- should be 8
	unamchoked --- choked - unchoke by upload            --have unchoked me - maybe have chosen me as opt unchoke (amOpt)
	amchoked ----- unchoked - choke                      --have choked me  -- maybe choose as opt unchoke if new (opt)
	amchoked ----- choke - do nothing                    -- not interested
	 

	(2) amUnInterested - interested  ------- select as opt unchoke (opt)
		amchoked -- choked

	(3) amInterested - unInterested  ------- might select me as opt unchoke (amOpt)
		amchoked -- choked
		
	(4) mutually uninterested     - have same pieces or no pieces or both seeders
		amchoked -- choked
	*/

	//blacklist peers that do not answer requests ?
	let swarm = this.swarm

	//choke any peer that chokes me and is not opt unchoke
	let peers = swarm.leechers.difference(swarm.optimisticUnchokePeers)
	let unchoked = peers.intersection(swarm.unchokedPeers)

	unchoked.intersection(swarm.amChokedPeers).forEach( peer => peer.choke() )
	
	//mutually interested peers -- initially near zero --- must add group (3) peers when sending requests
	let mutuallyInterestedPeers = swarm.leechers.intersection(swarm.interestedPeers).intersection(swarm.amInterestedPeers).difference(swarm.optimisticUnchokePeers)

	let amUnchoked = mutuallyInterestedPeers.intersection(swarm.amUnchokedPeers)

	let peerMap = this.swarm.peerIDs
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
Downloader.prototype.downloadPiece = function() {

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
			this.activePieces.add(new this.Piece(pIndex))
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

		let pieces = peer.pieces.intersection(this.activePieces) //swarm.pieces(peers)

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

Downloader.prototype.DHTAnnounce = async function() {

}

//infoHash, peerID, downloaded, left, uploaded, ev, IPAddress, key, numWant, port
//transactID, infoHash, peerID, stats, ip, key, numWant, port
Downloader.prototype.urlAnnounce = async function() {
	//stats = {downloaded, left, uploaded, ev}
	
	//tracker announce)
	let sock = await this.getUDPSocket()

	let infoHash = this.fileMetaData.infoHash
	let peerID = this.peerID

	return await Promise.all(this.fileMetaData.announceUrlList.map( async (announceUrl) => {		

		if(announceUrl.slice(0,6) == 'udp://') { //udp tracker			
			let tracker = new UDPTracker(sock, announceUrl, infoHash, peerID)
			//console.log(tracker)
			return await tracker.doAnnounce(this.stats, this.myPort) 
			

		} else if (announceUrl.slice(0,7) == 'http://') {
			let tracker = new HTTPTracker(sock, announceUrl, infoHash, peerID)
			return await tracker.doAnnounce(this.stats)
		}
	}))

}

Downloader.prototype.getUDPSocket = function(port) {

	let sock = dgram.createSocket('udp4').bind()

	return new Promise ( (resolve, reject) => {
		
		sock.on('listening', () => { resolve(sock) } )

	})

}

module.exports = {
	'Swarm' : Swarm,
	'Downloader' : Downloader
}

