
net = require('net')

const benDecode = require('bencode').decode 
const benEncode = require('bencode').encode
const async = require('async')

EventEmitter = require('events').EventEmitter

const NSet = require('../lib/NSet.js').NSet
const ActivePieces = require('./piece.js').ActivePieces
const Pieces = require('./piece.js').Pieces
const UDPTracker = require('../tracker/index.js').UDPTracker
const HTTPTracker = require('../tracker/index.js').HTTPTracker
const DHT = require('../dht/index.js').DHT
const Peer = require('../peer/index.js').Peer

const NUM_REQUESTS_PER_PEER = 5
const NUM_OUTSTANDING_REQS = 200
const NUM_ACTIVE_PIECES = 12
const NUM_CONNECTIONS = 50

var i = 0

var byFreq = (arr, prop) => {
	//let freqs = arr.reduce( (f, elem) => {
	let freqs = {}
	while(arr.length > 0) {
		let elem = arr.shift()
		if(freqs[elem[prop]]) 
			freqs[elem[prop]] ++
		else 
			freqs[elem[prop]] = 1
	}

	let freqArray = []

	for(key in Object.keys(freqs)) 
		freqArray.push({key : key, freq : freqs[key] /= arr.length})

	freqArray.sort( (kv1, kv2) => kv1.freq - kv2.freq ) //sort by smallest

	return freqArray //remove freq

}

getUDPSocket = function(port) { //run tests

	let sock = dgram.createSocket('udp4').bind(port)

	return new Promise ( (resolve, reject) => {
		
		sock.on('listening', () => { resolve(sock) } )

	})

}

class Swarm extends EventEmitter {

	constructor(fileMetaData, download, myIP, myPort) {

		super()

		this.peerStats = new Map()
		this.peers = new Map()
		
		this.fileMetaData = fileMetaData
		this.download = download

		this.defaultTimeout = 3 * 1e3
		
		this.myIP = myIP
		this.myPort = myPort

		let self = this

		this.listeners = {

			'connected' : ( peer ) => {

				let stats = self.peerStats

				if(!stats.has(peer.peerID)) 
					stats.set(peer.peerID, {'uploadedTime' : 0, 'downloadTime' : 0,'uploadBytes': 0, 'downloadBytes': 0,
						'disconnects' : 0, 'firstConnect' : Date.now()})
				self.emit('peer_connected')

			},

			'disconnected' : ( peer ) => {

				console.log("deleting", peer.peerID)

				if(self.peers.has(peer.peerID))
					self.peers.delete(peer.peerID, peer)

				if(self.peerStats.has(peer.peerID))
					self.peerStats.get(peer.peerID).disconnects++

				self.emit('peer_disconnected')

			}, 

			'new_peers' : () => { 

				self.emit('new_peers') 

			},

			'peer_unchoked' : () => {

				self.emit('peer_unchoked')

			},

			'peer_choked' : () => {

				self.emit('peer_choked')

			},

			'new_pieces' : (peer) => {

				self.emit('new_pieces')

			},
 
			'peer_piece' : (peer, index, begin, piecelet) => { 
			
				let stats = self.peerStats.get(peer.peerID)
				stats.uploadTime = peer.uploadTime
				stats.uploadBytes = peer.uploadBytes

			},

			'piece_sent' : ( peer ) => {

				let stats = self.peerStats.get(peer.peerID)
				stats.downloadTime = peer.downloadTime//+= uploadTime
				stats.downloadBytes = peer.downloadBytes //+= piecelet.length

			}

		}

		var sockOpts = {'allowHalfOpen' : false, 'pauseOnConnect' : true}

		//this.UTPserver = uTP.createServer() // ...
		//let self = this

		this.TCPserver = net.
		createServer(sockOpts, ( sock ) => {
			
			console.log("server connection", sock.remoteAddress, sock.remotePort)
			//let peer = new Peer(this.fileMetaData, this.download, self.listeners, sock, null, (self.checkPeerID).bind(this)) //peer owns socket
			//let peer new Peer(sock, null)
			let peer = this.makePeer(sock)
			
			peer.on('connected', (peer) => {

				self.emit('new_peer', peer)

			})

		}).listen(this.myPort)

		this.on('new_peer', (peer) => {
			if(!self.peers.has(peer.peerID))
				self.peers.set(peer.peerID, peer)
		})

	}

	makePeer(sock, addr) {

		if(!sock) {

			let sockOpts = { 'allowHalfOpen' : false }
			sock = new net.Socket(sockOpts)
			sock.connect(addr.port, addr.host)		

		}

		let peer = new Peer(this.fileMetaData, this.download, sock, (this.checkPeerID).bind(this))
		this.addListeners(peer, this.listeners)

		return peer.handshake()

	}

	addListeners(peer, listeners) {

		for( var event in listeners)
			peer.on(event, listeners[event])
		
	}


	checkPeerID(peerID) { //maybe keep registry of peerIDs and addresses ?

		if(peerID == (this.fileMetaData.peerID))
			return false
		if(this.peers.has(peerID))
			return false
		return true 

	}

	connectPeer (addr) {
		
		return new Promise((resolve, reject) => {

			//let peer = makePeer()
			let peer = this.makePeer(null, addr)
		
			let timeout = setTimeout(()=> {
				reject("peer timeout")
			}, this.defaultTimeout)

			peer.on('connected', (peer) => { //after recieving handshake
				clearTimeout(timeout)
				console.log('resolve peer', peer.peerID)
				resolve(peer) 
			})

			peer.on('reject id', (peer) => {
				clearTimeout(timeout)
				reject(new Error('rejected id')) 
			})
			
		})
	}

	addPeers (addrs) {
		
		let self = this
		var _addPeer = async function (addr, callback) {

			try {

				let peer = await self.connectPeer(addr)
				if(!self.peers.has(peer.peerID))
					self.peers.set(peer.peerID, peer)

			} catch (error) {

				console.log(error)

			}

			callback()
			
		}

		async.each(addrs, _addPeer, function (err) {

			self.emit('new_peers')

		})

	}

	piecesByFreq (peers) {

		peers = peers || new NSet(this.peers.keys())

		let allPieces = this.allPieces(peers), file = this.fileMetaData
		let interestedPieces = Array.from(allPieces).filter( pIdx => !file.pieces.has(pIdx) && !file.activePieces.has(pIdx))
		//return byFreq(dontHavePieceList, 'pieceIndex').map( pair => pair.key)
		return interestedPieces

	}

	//set of peers that have index piece
	peersWithPiece(index, peers) {

		peers = peers || new NSet(this.peers.keys())
		return new NSet(Array.from(peers).filter( peer => this.peers.get(peer).pieces.has(index)))

	}

	//set of pieces these peers have
	allPieces(peers) {

		peers = peers || new NSet(this.peers.keys())
		let allPieces = new NSet()

		for( let peer of peers) 
			allPieces = allPieces.union(this.peers.get(peer).pieces)

		return allPieces
	}


	havePiece(index) {

		this.peers.forEach( peer => peer.have(index) )
		this.peers.forEach( peer => peer.updateInterested() )		

	}

	get leechers() {
		return new NSet( Array.from(this.peers.keys()).filter(peer => !this.peers.get(peer).isSeeder()) )
	}

	get seeders() {
		return new NSet(Array.from(this.peers.keys()).filter(peer => this.peers.get(peer).isSeeder()))
	}

	get optimisticUnchokePeers () {
		return new NSet(Array.from(this.peers.keys()).filter( peer => this.peers.get(peer).optUnchoke ))
	}

	get unchokedPeers () {
		return new NSet(Array.from(this.peers.keys()).filter(peer => !this.peers.get(peer).choked))
	}

	get chokedPeers () {
		return new NSet(Array.from(this.peers.keys())).difference(this.unchokedPeers)
	}

	get amUnchokedPeers () {
		return new NSet(Array.from(this.peers.keys()).filter(peer => !this.peers.get(peer).pChoked))
	}

	get amChokedPeers () {
		return new NSet(Array.from(this.peers.keys())).difference(this.amUnchokedPeers)
	}

	get interestedPeers () {
		return new NSet(Array.from(this.peers.keys()).filter(peer => this.peers.get(peer).interested))
	}

	get aInterestedPeers () {
		return new NSet(Array.from(this.peers.values()).filter(peer => peer.aInterested ).map(peer => peer.peerID))
	}

	get unInterestedPeers () {
		return new NSet(Array.from(this.peers.keys())).difference(this.interestedPeers)
	}
	 
	get amInterestedPeers () {
		return new NSet(Array.from(this.peers.keys()).filter( peer => this.peers.get(peer).pInterested ))
	}

	get amUnInterestedPeers () {
		return new NSet(Array.from(this.peers.keys())).difference(this.amInterestedPeers)
	}

}

function Downloader(myPort, peerID) { //extends eventEmitter

	EventEmitter.call(this)

	this.myIP = ""
	this.myPort = myPort //listen port for new peers
	this.peerID = Buffer.concat( [Buffer.from('-fz1000-', 'ascii'), crypto.randomBytes(12)] ).toString('hex')
	this.port

	this.uLoop = null
	this.optLoop = null
	this.sLoop = null
	this.annLoop = null

	this.announceUrlList = []
	this.trackers = []

	this.trackerless = false
	this.dht = null
	this.dhtPort = 6881
	this.enableDHT = false
	
	this.requests = []

	this.activePieces = new Map()
	this.pieces = new Map()
	this.seeding = false

	this.fileMetaData = {

		'peerID' : this.peerID, //kill
		'activePieces' : this.activePieces, //kill
		'pieces' : this.pieces, //pieces this peer has //kill
		'announceUrlList' : [], 
		'date' : "", 
		'infoHash' : null,
		'metaInfoSize' : null,
		'name' : "",
		'pieceLength' : null,
		'fileLength' : null, 
		'numPieces' : null,
		'pieceHashes' : []

	}

	let self = this, file = this.fileMetaData

	this.stats = {

		get downloaded() { return self.pieces.has(file.numPieces - 1) ? (file.pieces.size - 1) * file.pieceLength +  file.fileLength % file.pieceLength : file.pieces.size * file.pieceLength },
		get left() { return file.fileLength - self.stats.downloaded} ,
		get uploaded() { return 0 },
		ev : 2 //???

	}

	this.download = {

		peerID : this.peerID,
		pieces : this.pieces,
		activePieces : this.activePieces,
		seeding : this.seeding,
		stats : this.stats

	}

	this.swarm = new Swarm(this.fileMetaData, this.download, this.myIP, this.myPort)

	var updateActivePieces = () => {
	
		let peers = this.swarm.amUnchokedPeers.intersection(this.swarm.aInterestedPeers)
		if(peers.size == 0) 
			peers = this.swarm.aInterestedPeers

		for(index of self.activePieces.keys()) {
			if(self.swarm.peersWithPiece(index, peers).size == 0) 
				this.activePieces.delete(index)
		}

	}	

	this.swarm.listeners['peer_disconnected'] = () => {
		
		updateActivePieces()

	}
	
	this.swarm.listeners['peer_choked'] = () => {

		updateActivePieces()

	}

	this.swarm.listeners['peer_request'] = async (peer, index, begin, length) => {  //fulfill all requests from unchoked peers

			let piece = this.pieces.get(index)
			let buf = await piece.readPiecelet(begin, length)
			peer.piece(index, begin, buf)

	}	

	this.swarm.listeners['peer_piece'] = (peer, index, begin, piecelet) => { 

		if(!self.activePieces.has(index))
			return

		let piece = self.activePieces.get(index)
		piece.add(index, begin, piecelet)

		self.requests = this.requests.filter( req => req.index != index && req.begin != begin && req.length != piecelet.length)

		if(piece.isComplete && piece.assemble()) { //copy to disk		
			
			console.log(Math.floor(self.pieces.size / self.fileMetaData.numPieces * 100), '% | Got piece:', index)
			self.activePieces.delete(index)
			self.pieces.set(index, new self.Piece(index))
			self.swarm.havePiece(index)
							
			if(self.pieces.size == self.fileMetaData.numPieces) {
				self.seeding = true
				self.seed()	
				return		
			} 

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

	let announceList = benDecode(metaInfo)['announce-list']

	//this.fileMetaData.announceUrlList = //announceList.map(x => x.toString())//
	this.trackerless = ! (announceList || announce)
	
	if(!this.trackerless)
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
	this.trackerless = true

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
		console.log('pathList', fileMetaData.pathList)

	} else { 

		fileMetaData.isDirectory = true
		fileMetaData.fileLengthList = m.files.map( pairs => pairs.length )
		fileMetaData.fileLength = fileMetaData.fileLengthList.reduce( (a, b) => a + b, 0)
		fileMetaData.pathList = m.files.map( pairs => pairs.path ).map( name => './' + name)

	}

	fileMetaData.numPieces = Math.ceil( fileMetaData.fileLength / fileMetaData.pieceLength) 

	this.Piece = Pieces(fileMetaData)
	this.ActivePiece = ActivePieces(fileMetaData)

	for(let idx = 0; idx < fileMetaData.numPieces; idx ++ ) {

		let piece = new this.Piece(idx)
		if(await piece.verify()) {
			this.pieces.set(idx, piece)
		}

	}

	console.log('Have', Math.floor(this.pieces.size / this.fileMetaData.numPieces * 100), "% of pieces.")
	this.seeding = this.pieces.size == fileMetaData.numPieces
	return this.seeding

}

Downloader.prototype.start = async function() {

	//dont start until metaData filled - pieces checked
	console.log('Starting...')
	this.announce()
	

	//this.addPeers(peerList || [])

	console.log( this.seeding ? 'seeding' : 'leeching')
	if (this.seeding)
		this.seed()
	else
		this.leech()
//	return peerList

}

Downloader.prototype.leech = function() {

	//clearInterval(this.sloop)
	//this.announceLoop()
	this.annLoop = setInterval((this.announceLoop).bind(this), 300 * 1e3)

	this.on('new_peers', (this.optUnchokeLoop).bind(this))
	this.optLoop = setInterval((this.optUnchokeLoop).bind(this), 30 * 1e3)
	this.on('new_peers', (this.unchokeLoop).bind(this))
	this.uLoop = setInterval((this.unchokeLoop).bind(this), 10 * 1e3)

	this.on('recieved_piece', (this.downloadPieces).bind(this))
	this.on('recieved_piecelet', (this.downloadPiecelets).bind(this))
	this.on('request_timeout', (this.downloadPieces).bind(this))
	this.on('request_timeout', (this.downloadPiecelets).bind(this))


	this.swarm.on('new_pieces', (this.downloadPieces).bind(this)) //from any connected peer
	this.swarm.on('peer_unchoked', (this.downloadPieces).bind(this))
	this.swarm.on('peer_choked', (this.downloadPieces).bind(this))

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
	
	this.announce()

	if(this.enableDHT || this.trackerless) {
		this.DHTAnnounce()	
	}

}

Downloader.prototype.seedLoop = function() {

		let swarm = this.swarm
		let peerMap = this.swarm.peerStats

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
			if(this.swarm.peers.get(candidate).choked) //if already unchoked do nothing
				this.swarm.peers.get(candidate).unchoke()

		}
		let self = this
		unchokeCandidates.filter(peer => !this.swarm.peers.get(peer).choked).forEach( peer => self.swarm.peers.get(peer).choke())

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
		
		for(let numUnchoked = 0; numUnchoked < 3 && unchokeCandidates.length > 0; numUnchoked++) { //maybe add randomness ??

			let randIdx = Math.floor(Math.random() ** 2 * unchokeCandidates.length)
			let candidate = unchokeCandidates[randIdx]
			this.swarm.peers.get(candidate).unchoke()

		}

}

Downloader.prototype.unchokeLoop = function() {

	let swarm = this.swarm

	//choke any peer that chokes me and is not opt unchoke
	let peers = swarm.leechers.difference(swarm.optimisticUnchokePeers)
	let unchoked = peers.intersection(swarm.unchokedPeers)

	let self = this
	unchoked.intersection(swarm.amChokedPeers).forEach( peer => self.swarm.peers.get(peer).choke() )
	
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
		if(this.swarm.peers.get(candidate).choke) //if already unchoked do nothing
			this.swarm.peers.get(candidate).unchoke()
		numUnchoked++

	}

	//choke rest of candidates
	unchokeCandidates.filter(peer => !this.swarm.peers.get(peer).choked).forEach( peer => self.swarm.peers.get(peer).choke())

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

	//console.log('downloadPieces')

	var maxActivePieces = () => {
		
		let left = this.fileMetaData.numPieces - this.pieces.size 
		return left >= 10 ? 10 : left

	}

	//call on no activePieces, leeching and connected to ->interested amUnchoked peers

	//actually interested, amUnchoked peers
	peers = this.swarm.amUnchokedPeers.intersection(this.swarm.aInterestedPeers) //amInterestedPeers
	//delete activePieces that no peer has 

	if( !(this.activePieces.size < maxActivePieces()))
		return this.downloadPiecelets()

	//no unchoked and no active pieces - create active piece from amongst pieces connected peers have
	if(this.swarm.amUnchokedPeers.size == 0 && this.activePieces.size == 0)
		peers = this.swarm.aInterestedPeers

	/////////////////
	hist = this.swarm.piecesByFreq(peers)
	hist = hist.filter( x => x || (x == 0) && true )
	hist = hist.filter(x => x < this.fileMetaData.numPieces)
	this.bar = hist
	///////////////
	//this.pieces.size + this.activePieces.size < this.fileMetaData.numPieces
	while( this.activePieces.size < maxActivePieces() && hist.length > 0 && this.pieces.size < this.fileMetaData.numPieces ) {//} && i++ < 1100) {

		let randArrIdx = Math.floor(Math.pow(Math.random(), 3) * hist.length)
		let pIndex = hist[randArrIdx]
		this.activePieces.set(Number(pIndex), new this.ActivePiece(Number(pIndex)))
		this.swarm.peers.forEach( peer => peer.updateInterested() )
	}

	this.downloadPiecelets()

	//download pieces from mutually unchoked peers in group (1) and amUnchoked peers in group (3)

}

Downloader.prototype.downloadPiecelets = function() {

	//call on no reqs, leeching and connected to ->interested amUnchoked peers
	//call on req timeout
	//call on req completion 

	let swarm = this.swarm, requests = this.requests, peers = swarm.amUnchokedPeers.intersection(swarm.interestedPeers)
	this.requests.filter( request => request.peer.pChoked ).map( req => clearTimeout(req.timeout) ).forEach( req => req.putBack(req) )

	this.requests = this.requests.filter( request => !request.peer.pChoked )// && !request.timeout_called )

	let self = this

	var reqToPeer = (( peer, req ) => {
		
		req.timeout = setTimeout(()=> {

			req.putBack(req); 
			self.requests.splice(self.requests.findIndex(requests => requests == req), 1)
			self.emit('request_timeout') 

		}, 30 * 1e3)

		req.peer = swarm.peers.get(peer)
		this.requests.push(req)

		this.swarm.peers.get(peer).request(req.index, req.begin, req.length)

	}).bind(this)

	var randReqToPeer = ((peer) => {

		let pieceletReq, randomIndex, piece

		if(!this.swarm.peers.has(peer))
			return null

		let pieces = this.swarm.peers.get(peer).pieces.intersection(new NSet(this.activePieces.keys())) //swarm.pieces(peers)
		let pieceList = Array.from(pieces)
		pieceList = pieceList.filter(p => p)

		if(pieces.size == 0)
			return null

		do { //randomly select piece, get piecelet or if no piecelet then repeat

			randomIndex = Math.floor(Math.random() * pieceList.length) //maybe favour pieces that idle peers have ??
			piece = Array.from(pieces)[randomIndex]
			pieceletReq = this.activePieces.get(piece).randPieceletReq()

			if(!pieceletReq)
				pieceList.splice(randomIndex, 1)

		} while (!pieceletReq && pieceList.length > 0) //fix infinite loop

		if(pieceletReq) //no more piecelets left
			reqToPeer( peer, pieceletReq )

		return pieceletReq

	}).bind(this)

	//always interested in these peers
	while(this.requests.length < peers.size * 4 && peers.size > 0 && this.activePieces.size > 0 ) {//  && i++ < 2000) {

		//randomly select peer - more heavily weight idle peers
		let rand = Math.random()
		let randomPeer = Array.from(peers)[Math.floor(rand * rand * peers.size)]	
		//console.log('sending rand req to', randomPeer)
		if( !randReqToPeer(randomPeer) ) //no more piecelets
			peers.delete(randomPeer) //just delete or remove

		peers.intersection(swarm.amUnchokedPeers.intersection(swarm.interestedPeers))

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

	if(this.seeding)
		return

	peers = peers.map( (tuple) => { return { host : tuple.ip, port : tuple.port } } )
	//apply filters
	if(!peers)
		return
	peers = peers.filter(peer => Array.from(this.swarm.peers.values()).every(oPeer => oPeer.port != peer.port && oPeer.host != peer.host))
	
	console.log('Connecting:', peers)

	let self = this
	
	this.swarm.addPeers(peers)

	this.pruneConn()

}

Downloader.prototype.DHTAnnounce = async function() {

	let dht = this.dht || new DHT(this.dhtPort, "")
	let peerList = await dht.announce(this.fileMetaData.infoHash, this.myPort)
	this.addPeers(peerList)

}

Downloader.prototype.announce = async function() {
	
	let infoHash = this.fileMetaData.infoHash
	let peerID = this.peerID

	let sock = await getUDPSocket() 
	
	var _annnounce = (async function (announceUrl, callback) {

		let resp, tracker
		let u = new url.URL(announceUrl)
		
		if(u.protocol == 'udp:')	
			tracker = this.trackers[u.href] || new UDPTracker(sock, u, infoHash, Buffer.from(peerID,'hex'), this.download.stats)
			
		else if (u.protocol == 'http:')
			tracker = this.trackers[u.href] || new HTTPTracker(this.fileMetaData, this.download, u)
		
		try {

			resp = await tracker.doAnnounce(this.myPort)
			let { numLeechers, numSeeders, interval, peerList } = resp

			this.addPeers(peerList || [])
			console.log("Tracker:", announceUrl)
			console.log("leechers:", numLeechers)
			console.log('seeders:', numSeeders)
			console.log('peers returned:', peerList)

		} catch(error) {

			console.log(error)

		} finally {

			callback()

		}

	}).bind(this)

	async.each( this.fileMetaData.announceUrlList, _annnounce, function (err, callback) {})

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

